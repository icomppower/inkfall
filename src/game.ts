import * as THREE from 'three';
import { World } from './sim/world';
import { Rider, neutralInput, type RiderInput } from './sim/bike';
import { Director } from './sim/director';
import { InputSource } from './input';
import { FIXED_DT, MAX_CATCHUP_STEPS, CHECKPOINTS, COURSE_LENGTH, GRAVITY, DEFAULT_SEED } from './sim/constants';
import { buildTerrainGeometry } from './render/terrainMesh';
import { buildTrailGeometry } from './render/trailMesh';
import { InkPipeline } from './render/pipeline';
import { makeInkMaterial, makeHullMaterial } from './render/inkExports';
import { makeHatchTexture } from './render/hatch';
import { makeSky } from './render/sky';
import { analyzeCanvas } from './render/analyze';

export interface GameOptions { seed?: string; capture?: boolean; }

export class Game {
  world: World;
  player: Rider;
  director: Director;
  input: InputSource;
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(60, 1, 0.35, 6000);

  pipeline: InkPipeline;
  sky: THREE.Mesh;

  seed: string;
  paused = false;
  simSteps = 0;
  simTime = 0;
  frames = 0;
  firstFrameAt = 0;
  private accumulator = 0;
  private last = 0;
  private bikeProxy: THREE.Mesh;
  private group = new THREE.Group();

  constructor(parent: HTMLElement, opts: GameOptions = {}) {
    this.seed = opts.seed ?? DEFAULT_SEED;
    this.world = new World(this.seed);
    this.player = new Rider(this.world, 'INK');
    this.director = new Director(this.world);
    this.input = new InputSource();

    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: opts.capture === true,
    });
    this.renderer.setPixelRatio(1);
    this.renderer.autoClear = false;
    parent.appendChild(this.renderer.domElement);

    this.pipeline = new InkPipeline(this.renderer);
    this.pipeline.shared.uHatch.value = makeHatchTexture(this.seed);
    this.sky = makeSky(this.pipeline.shared);

    this.scene.background = null;
    this.scene.add(this.sky);
    this.scene.add(this.group);
    this.buildScene();

    this.bikeProxy = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.92, 1.72),
      makeInkMaterial(this.pipeline.shared, { rampOffset: -0.14, tone: 0.55 }),
    );
    this.bikeProxy.add(new THREE.Mesh(this.bikeProxy.geometry, makeHullMaterial(this.pipeline.shared, 0.045)));
    this.group.add(this.bikeProxy);

    this.resize();
    addEventListener('resize', () => this.resize());
  }

  private buildScene(): void {
    const shared = this.pipeline.shared;
    this.group.add(new THREE.Mesh(
      buildTerrainGeometry(this.world),
      makeInkMaterial(shared, { rampOffset: 0.03, tone: 1.02, wetBand: 0.35, slope: true }),
    ));
    this.group.add(new THREE.Mesh(
      buildTrailGeometry(this.world),
      makeInkMaterial(shared, { rampOffset: -0.06, tone: 0.74, wetBand: 0.9, surfaceId: true }),
    ));
  }

  resize(): void {
    const w = Math.max(1, window.innerWidth), h = Math.max(1, window.innerHeight);
    this.renderer.setSize(w, h, false);
    this.pipeline.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  restart(seed?: string): void {
    if (seed && seed !== this.seed) {
      this.seed = seed;
      this.world = new World(seed);
      this.player = new Rider(this.world, 'INK');
      this.director = new Director(this.world);
      this.group.clear();
      this.buildScene();
      this.group.add(this.bikeProxy);
    } else {
      this.player.reset(0);
    }
    this.player.phase = 'ready';
    this.player.crashes = 0;
    this.player.style = 0;
    this.player.boost = 0;
    this.player.checkpoint = 0;
    this.player.checkpointS = 0;
    this.director.reset();
    this.simSteps = 0;
    this.simTime = 0;
    this.accumulator = 0;
  }

  /** One deterministic 120 Hz tick. */
  fixedStep(input: RiderInput): void {
    this.player.step(FIXED_DT, input);
    // Checkpoint gates.
    for (let i = this.player.checkpoint; i < CHECKPOINTS.length; i++) {
      if (this.player.s >= CHECKPOINTS[i]) {
        this.player.checkpoint = i + 1;
        this.player.checkpointS = CHECKPOINTS[i];
      } else break;
    }
    this.director.step(FIXED_DT, this.player);
    this.simSteps++;
    this.simTime += FIXED_DT;
  }

  /** Advance exactly n fixed steps with the current input. Used by the capture API. */
  stepFrames(n: number, input?: RiderInput): void {
    const inp = input ?? this.input.sample();
    for (let i = 0; i < n; i++) this.fixedStep(inp);
    this.applyCamera();
  }

  applyCamera(): void {
    const p = this.director.pose;
    this.camera.position.set(p.px, p.py, p.pz);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(p.tx, p.ty, p.tz);
    if (p.roll !== 0) this.camera.rotateZ(p.roll);
    if (Math.abs(this.camera.fov - p.fov) > 0.01) {
      this.camera.fov = p.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  private syncProxy(): void {
    const c = this.world.course;
    const r = this.player;
    const i = c.idx(r.s);
    this.bikeProxy.position.set(
      c.centreX(r.s) + r.lateral * c.rx[i],
      r.y,
      c.centreZ(r.s) + r.lateral * c.rz[i],
    );
    const heading = Math.atan2(c.tx[i], -c.tz[i]) + r.yaw;
    this.bikeProxy.rotation.set(0, 0, 0);
    this.bikeProxy.rotateY(heading);
    this.bikeProxy.rotateX(-r.pitch);
    this.bikeProxy.rotateZ(-r.roll);
  }

  advance(nowMs: number): void {
    if (this.last === 0) this.last = nowMs;
    let dt = (nowMs - this.last) / 1000;
    this.last = nowMs;
    if (!Number.isFinite(dt) || dt < 0) dt = 0;
    dt = Math.min(dt, 0.25);
    if (this.paused) { this.accumulator = 0; return; }
    this.accumulator += dt;
    let steps = 0;
    const input = this.input.sample();
    while (this.accumulator >= FIXED_DT && steps < MAX_CATCHUP_STEPS) {
      this.fixedStep(input);
      this.accumulator -= FIXED_DT;
      steps++;
    }
    if (steps === MAX_CATCHUP_STEPS) this.accumulator = 0;   // capped catch-up
  }

  private focus = new THREE.Vector3();

  render(): void {
    this.applyCamera();
    this.syncProxy();
    this.pipeline.shared.uTime.value = this.simTime;
    this.pipeline.post.uniforms.uTime.value = this.simTime;
    this.focus.copy(this.bikeProxy.position);
    this.sky.position.set(this.camera.position.x, 0, this.camera.position.z);
    this.pipeline.render(this.scene, this.camera, this.focus, [this.sky]);
    this.frames++;
    if (this.firstFrameAt === 0) this.firstFrameAt = performance.now();
  }

  analyzeFrame(): ReturnType<typeof analyzeCanvas> {
    return analyzeCanvas(this.renderer.domElement);
  }

  /** Isolated suspension probe: equivalent of dropping the bike from `h` metres. */
  dropTest(h: number, k?: number, c?: number): { peakCompression: number; samples: number[] } {
    // Averaged over several places on the course: a single spot lands on one particular
    // micro-bump and turns a suspension measurement into a noise measurement.
    const spots = [420, 700, 1215, 1330, 2150];
    const samples: number[] = [];
    const inp = neutralInput();
    for (const spot of spots) {
      const probe = new Rider(this.world, 'probe');
      if (k !== undefined) probe.springK = k;
      if (c !== undefined) probe.dampC = c;
      probe.reset(spot);
      probe.vy = -Math.sqrt(2 * GRAVITY * h);
      let peak = 0;
      for (let i = 0; i < 300; i++) {
        probe.step(FIXED_DT, inp);
        peak = Math.max(peak, probe.compressionF, probe.compressionR);
      }
      samples.push(+peak.toFixed(4));
    }
    return { peakCompression: samples.reduce((a, b) => a + b, 0) / samples.length, samples };
  }

  state(): Record<string, unknown> {
    const p = this.player;
    const c = this.world.course;
    return {
      race: {
        seed: this.seed,
        phase: p.phase,
        s: +p.s.toFixed(3),
        progress: +(p.s / COURSE_LENGTH).toFixed(5),
        time: +this.simTime.toFixed(4),
        simSteps: this.simSteps,
        checkpoint: p.checkpoint,
        crashes: p.crashes,
        style: p.style,
        section: c.sectionAt(p.s).index,
      },
      physics: {
        speed: +p.speed.toFixed(4),
        speedKmh: +(p.speed * 3.6).toFixed(2),
        lateral: +p.lateral.toFixed(4),
        lateralVel: +p.lateralVel.toFixed(4),
        y: +p.y.toFixed(4),
        vy: +p.vy.toFixed(4),
        heightAboveSurface: +p.heightAboveSurface().toFixed(4),
        surfaceHeight: +p.groundHeight().toFixed(4),
        pitch: +p.pitch.toFixed(4),
        roll: +p.roll.toFixed(4),
        airborne: p.airborne,
        airTime: +p.airTime.toFixed(4),
        sliding: p.sliding,
        slipAngle: +p.slipAngle.toFixed(4),
        gripUsage: +p.gripUsage.toFixed(4),
        grip: +p.effectiveGrip().toFixed(4),
        wetness: +p.wetness.toFixed(4),
        compressionF: +p.compressionF.toFixed(4),
        compressionR: +p.compressionR.toFixed(4),
        boost: +p.boost.toFixed(4),
        surface: c.surfaceAt(p.s, p.lateral),
        trick: p.trick,
        lastLanding: p.lastLanding,
        lastCrashReason: p.lastCrashReason,
      },
      render: {
        frames: this.frames,
        shot: this.director.shot,
        cuts: this.director.cuts.length,
        fov: +this.director.pose.fov.toFixed(2),
        drawCalls: this.pipeline.geoCalls,
        triangles: this.pipeline.geoTriangles,
        dpr: this.pipeline.dpr,
      },
      riders: [],
    };
  }
}
