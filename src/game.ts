import * as THREE from 'three';
import { World } from './sim/world';
import { Rider, neutralInput, WHEEL_R, RIDE_HEIGHT, type RiderInput } from './sim/bike';
import { makeSample } from './sim/course';
import { Director } from './sim/director';
import { InputSource } from './input';
import { FIXED_DT, MAX_CATCHUP_STEPS, CHECKPOINTS, COURSE_LENGTH, GRAVITY, DEFAULT_SEED } from './sim/constants';
import { buildTerrain } from './render/terrainMesh';
import { buildTrailGeometry } from './render/trailMesh';
import { InkPipeline } from './render/pipeline';
import { makeInkMaterial } from './render/inkExports';
import { makeHatchTexture } from './render/hatch';
import { makeSky } from './render/sky';
import { analyzeCanvas } from './render/analyze';
import { Scenery } from './render/scenery';
import { RiderRig } from './render/riderMesh';
import { Weather } from './sim/weather';
import { Pilot, AUTOPILOT } from './sim/pilot';
import { Particles } from './render/particles';

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
  scenery!: Scenery;
  weather: Weather;
  autoPilot: Pilot;
  autopilotOn = false;
  rivals: Rider[] = [];
  particles!: Particles;
  terrainDropped = 0;

  seed: string;
  paused = false;
  simSteps = 0;
  simTime = 0;
  frames = 0;
  firstFrameAt = 0;
  private accumulator = 0;
  private lastSteer = 0;
  private emitAccum = 0;
  private emitSeq = 1;
  flash = 0;
  effectsOn = true;
  private frameEma = 16;
  private dprCooldown = 0;
  private last = 0;
  playerRig!: RiderRig;
  private group = new THREE.Group();

  constructor(parent: HTMLElement, opts: GameOptions = {}) {
    this.seed = opts.seed ?? DEFAULT_SEED;
    this.world = new World(this.seed);
    this.player = new Rider(this.world, 'INK');
    this.director = new Director(this.world);
    this.weather = new Weather(this.seed);
    this.autoPilot = new Pilot(this.world, AUTOPILOT, this.seed);
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

    this.playerRig = new RiderRig(this.pipeline.shared, {
      jersey: 0.30, helmet: 'visor', mark: '墨', accent: new THREE.Color(0.72, 0.16, 0.14),
    });
    this.group.add(this.playerRig.root);

    this.resize();
    addEventListener('resize', () => this.resize());
  }

  private buildScene(): void {
    const shared = this.pipeline.shared;
    const terrain = buildTerrain(this.world);
    this.terrainDropped = terrain.droppedTriangles;
    this.group.add(new THREE.Mesh(
      terrain.geometry,
      makeInkMaterial(shared, { rampOffset: 0.03, tone: 1.05, wetBand: 0.35, slope: true }),
    ));
    this.group.add(new THREE.Mesh(
      buildTrailGeometry(this.world),
      makeInkMaterial(shared, { rampOffset: -0.06, tone: 0.70, wetBand: 0.9, surfaceId: true, apronTone: 1.05 / 0.70 }),
    ));
    this.scenery = new Scenery(this.world, shared);
    this.group.add(this.scenery.group);
    this.particles = new Particles(shared);
    this.group.add(this.particles.mesh);
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
      this.group.add(this.playerRig.root);
      this.weather = new Weather(seed);
      this.autoPilot = new Pilot(this.world, AUTOPILOT, seed);
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
    this.weather.reset();
    this.autoPilot.reset();
    this.particles.clear();
    this.flash = 0;
    this.simSteps = 0;
    this.simTime = 0;
    this.accumulator = 0;
  }

  /** One deterministic 120 Hz tick. */
  fixedStep(rawInput: RiderInput): void {
    this.weather.step(FIXED_DT, this.player.s, this.player.speed);
    this.player.wetness = this.weather.wetness;
    const input = this.autopilotOn
      ? this.autoPilot.step(FIXED_DT, this.player, this.weather.wetness)
      : rawInput;
    this.lastSteer = input.steer;
    const landedBefore = this.player.lastLanding;
    this.player.step(FIXED_DT, input);
    if (this.player.lastLanding !== landedBefore && this.player.lastLanding) {
      const ev = this.player.lastLanding;
      if (!ev.clean) this.flash = 0.9;
      this.burst(ev.crash ? 26 : 14, ev.crash ? 'spark' : 'dust');
    }
    this.emitContact(FIXED_DT);
    this.particles.simulate(FIXED_DT);
    this.updateEffectUniforms(FIXED_DT);
    // Checkpoint gates.
    for (let i = this.player.checkpoint; i < CHECKPOINTS.length; i++) {
      if (this.player.s >= CHECKPOINTS[i]) {
        this.player.checkpoint = i + 1;
        this.player.checkpointS = CHECKPOINTS[i];
      } else break;
    }
    this.director.impactActive = this.flash > 0.05;
    this.director.step(FIXED_DT, this.player, this.rivals);
    this.simSteps++;
    this.simTime += FIXED_DT;
  }

  /** Advance exactly n fixed steps with the current input. Used by the capture API. */
  stepFrames(n: number, input?: RiderInput): void {
    const inp = input ?? this.input.sample();
    for (let i = 0; i < n; i++) this.fixedStep(inp);
    this.applyCamera();
  }

  /** Contact spray, dust and sparks. Emission is a function of sim state, not wall time. */
  private emitContact(dt: number): void {
    const r = this.player;
    if (!this.effectsOn || r.airborne || r.phase !== 'riding') return;
    const c = this.world.course;
    const i = c.idx(r.s);
    const x = c.centreX(r.s) + r.lateral * c.rx[i];
    const z = c.centreZ(r.s) + r.lateral * c.rz[i];
    const y = r.groundHeight() + 0.06;
    const surface = c.surfaceAt(r.s, r.lateral);
    const slip = Math.abs(r.slipAngle);
    const wet = this.weather.wetness;
    const rate = (slip * 26 + r.speed * 0.35) * (r.sliding ? 2.4 : 0.35);
    this.emitAccum += rate * dt;
    while (this.emitAccum >= 1) {
      this.emitAccum -= 1;
      const j = this.emitSeq++;
      const a = (j * 2.399963) % (Math.PI * 2);
      const sx = Math.cos(a), sz = Math.sin(a);
      const back = -c.tx[i] * r.speed * 0.22, backZ = -c.tz[i] * r.speed * 0.22;
      if (wet > 0.25) {
        this.particles.emit('spray', x, y, z, back + sx * 1.6, 1.6 + (j % 5) * 0.2, backZ + sz * 1.6, 0.11, 0.45);
      } else if (surface === 'rock' && slip > 0.2) {
        this.particles.emit('spark', x, y, z, back + sx * 2.4, 1.9, backZ + sz * 2.4, 0.05, 0.30);
      } else {
        this.particles.emit('dust', x, y, z, back * 0.5 + sx * 1.1, 0.9, backZ * 0.5 + sz * 1.1, 0.16, 0.85);
      }
    }
  }

  private burst(n: number, kind: 'dust' | 'spark'): void {
    if (!this.effectsOn) return;
    const r = this.player;
    const c = this.world.course;
    const i = c.idx(r.s);
    const x = c.centreX(r.s) + r.lateral * c.rx[i];
    const z = c.centreZ(r.s) + r.lateral * c.rz[i];
    const y = r.groundHeight() + 0.1;
    for (let k = 0; k < n; k++) {
      const a = (this.emitSeq++ * 2.399963) % (Math.PI * 2);
      const sp = 1.4 + (k % 7) * 0.45;
      this.particles.emit(kind, x, y, z, Math.cos(a) * sp, 1.4 + (k % 4) * 0.7, Math.sin(a) * sp, kind === 'spark' ? 0.06 : 0.19, 0.7);
    }
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

  private syncRider(dt: number): void {
    const c = this.world.course;
    const r = this.player;
    const i = c.idx(r.s);
    this.playerRig.update({
      x: c.centreX(r.s) + r.lateral * c.rx[i],
      y: r.y - (WHEEL_R + RIDE_HEIGHT),
      z: c.centreZ(r.s) + r.lateral * c.rz[i],
      heading: Math.atan2(c.tx[i], -c.tz[i]) + r.yaw,
      pitch: r.pitch,
      roll: r.roll,
      compressionF: r.compressionF,
      compressionR: r.compressionR,
      wheelRpm: r.wheelRpm,
      steer: this.lastSteer,
      trick: r.trick,
      trickPhase: r.trickPhaseNorm,
      crashed: r.phase === 'crashed',
      crashTime: Math.max(0, 1.6 - r.crashTimer),
      dt,
    });
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

    const ui = this.input.consumeUi();
    if (ui.restart) this.restart();
    if (ui.pause) this.paused = !this.paused;
    if (ui.weather) this.weather.toggle();
    if (ui.effects) this.setEffects(!this.effectsOn);
  }

  setEffects(on: boolean): void {
    this.effectsOn = on;
    this.particles.enabled = on;
    this.particles.mesh.visible = on;
    this.pipeline.shadowsEnabled = on;
    if (!on) this.particles.clear();
  }

  private focus = new THREE.Vector3();
  private pokeSample = makeSample();
  private lastRenderAt = 0;

  render(): void {
    const now = performance.now();
    const dt = this.lastRenderAt ? Math.min(0.1, (now - this.lastRenderAt) / 1000) : 1 / 60;
    this.lastRenderAt = now;

    this.applyCamera();
    this.syncRider(dt);
    this.particles.sync();

    this.focus.copy(this.playerRig.root.position);
    this.sky.position.set(this.camera.position.x, 0, this.camera.position.z);
    this.pipeline.render(this.scene, this.camera, this.focus, [this.sky]);
    this.frames++;
    if (this.firstFrameAt === 0) this.firstFrameAt = performance.now();
    this.adaptDpr(performance.now() - now, dt);
  }

  /** Screen effects are deterministic functions of sim state, so they live in the tick. */
  private updateEffectUniforms(dt: number): void {
    const shared = this.pipeline.shared;
    const post = this.pipeline.post.uniforms;
    shared.uTime.value = this.simTime;
    shared.uWetness.value = this.weather.wetness;
    shared.uCloudShade.value = this.weather.cloudShade;
    post.uTime.value = this.simTime;
    post.uRain.value = this.effectsOn ? this.weather.rainIntensity : 0;
    post.uDroplets.value = this.effectsOn ? this.weather.droplets : 0;
    const kmh = this.player.speed * 3.6;
    const stroke = Math.max(0, (kmh - 45) / 33) * (this.player.boosting ? 1.6 : 1);
    post.uSpeedStroke.value = this.effectsOn ? Math.min(1.1, stroke) : 0;
    this.flash = Math.max(0, this.flash - dt * 7.5);
    post.uFlash.value = this.effectsOn ? Math.min(0.85, this.flash) : 0;
    const rough = this.world.course.sample(this.player.s, this.player.lateral, this.pokeSample).rough;
    const shake = this.player.phase === 'crashed'
      ? 1
      : Math.min(1, rough * this.player.speed * 0.55 + (this.player.sliding ? 0.15 : 0));
    post.uShake.value = this.effectsOn ? shake : 0;
  }

  /** Hold frame pacing by trading resolution, 0.6 → 1.0. */
  private adaptDpr(cpuMs: number, dt: number): void {
    void cpuMs;
    this.frameEma = this.frameEma * 0.9 + Math.min(60, dt * 1000) * 0.1;
    this.dprCooldown -= 1;
    if (this.dprCooldown > 0 || this.frames < 30) return;
    const dpr = this.pipeline.dpr;
    if (this.frameEma > 20 && dpr > 0.6) {
      this.pipeline.setSize(window.innerWidth, window.innerHeight, Math.max(0.6, dpr - 0.1));
      this.dprCooldown = 45;
    } else if (this.frameEma < 13.5 && dpr < 1) {
      this.pipeline.setSize(window.innerWidth, window.innerHeight, Math.min(1, dpr + 0.1));
      this.dprCooldown = 45;
    }
  }

  /**
   * How far the rendered coarse terrain rises above the trail surface, sampled across
   * the trail width. This is the honest test of the course mask.
   */
  terrainPoke(): { worst: number; samples: number; over5cm: number } {
    const c = this.world.course;
    const hf = this.world.terrain;
    let worst = -Infinity, samples = 0, over = 0;
    for (let s = 4; s < c.length - 4; s += 2) {
      const halfW = c.widthAt(s) * 0.5;
      const i = c.idx(s);
      for (let f = -1; f <= 1; f += 0.5) {
        const lat = f * halfW;
        if (c.sample(s, lat, this.pokeSample).voidGap) continue;
        const x = c.centreX(s) + lat * c.rx[i];
        const z = c.centreZ(s) + lat * c.rz[i];
        const d = hf.heightAt(x, z) - this.pokeSample.height;   // raw coarse field vs trail
        samples++;
        if (d > worst) worst = d;
        if (d > 0.05) over++;
      }
    }
    return { worst: +worst.toFixed(3), samples, over5cm: over };
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
        weather: this.weather.mode,
        rainIntensity: +this.weather.rainIntensity.toFixed(4),
        droplets: this.weather.dropletCount,
        onsetS: +this.weather.onsetS.toFixed(1),
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
        scenery: this.scenery.stats,
        drawCalls: this.pipeline.geoCalls,
        triangles: this.pipeline.geoTriangles,
        dpr: +this.pipeline.dpr.toFixed(2),
        particles: this.particles.live,
        effects: this.effectsOn,
        flash: +this.flash.toFixed(3),
        speedStroke: +(this.pipeline.post.uniforms.uSpeedStroke.value as number).toFixed(3),
        frameMs: +this.frameEma.toFixed(2),
      },
      riders: [],
    };
  }
}
