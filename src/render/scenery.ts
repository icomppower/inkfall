import * as THREE from 'three';
import type { World } from '../sim/world';
import { Rng } from '../sim/rng';
import { COURSE_LENGTH, SECTIONS, CHECKPOINTS, TABLETOPS, STEP_DOWN_S, BRIDGE_S, BRIDGE_LEN, RAVINE_S, RAVINE_WIDTH } from '../sim/constants';
import { makeInkMaterial, type InkUniforms } from './inkExports';
import { groundHeight } from './ground';
import {
  makeTree, makeBamboo, makeBoulder, makeGrassTuft, makeRadome, makeTerraceWall,
  makeFootbridge, makeCrowdFigure, makeSignpost, makeTextTexture,
} from './props';

export interface SceneryStats {
  trees: number; bamboo: number; boulders: number; grass: number;
  signposts: number; walls: number; crowd: number; gates: number; instancedMeshes: number;
}

interface Placement { x: number; y: number; z: number; ry: number; scale: number; tint: number; }

const ACCENT_RED = new THREE.Color(0.72, 0.16, 0.14);

/** Everything that is not terrain, trail or rider. All instanced, all generated in code. */
export class Scenery {
  readonly group = new THREE.Group();
  readonly stats: SceneryStats = {
    trees: 0, bamboo: 0, boulders: 0, grass: 0,
    signposts: 0, walls: 0, crowd: 0, gates: 0, instancedMeshes: 0,
  };
  private world: World;
  private shared: InkUniforms;
  private rng: Rng;

  constructor(world: World, shared: InkUniforms) {
    this.world = world;
    this.shared = shared;
    this.rng = new Rng(`scenery:${world.seed}`);
    this.build();
  }

  /** World position at a track coordinate, sitting on whichever surface is authoritative. */
  private at(s: number, lateral: number): { x: number; y: number; z: number } {
    const c = this.world.course;
    const i = c.idx(s);
    const x = c.centreX(s) + lateral * c.rx[i];
    const z = c.centreZ(s) + lateral * c.rz[i];
    return { x, y: groundHeight(this.world, s, lateral), z };
  }

  private heading(s: number): number {
    const c = this.world.course;
    const i = c.idx(s);
    return Math.atan2(c.tx[i], -c.tz[i]);
  }

  private addInstanced(
    geo: THREE.BufferGeometry, places: Placement[], opts: Parameters<typeof makeInkMaterial>[1],
  ): void {
    if (!places.length) return;
    const mat = makeInkMaterial(this.shared, { ...opts, instanced: true });
    const mesh = new THREE.InstancedMesh(geo, mat, places.length);
    const tints = new Float32Array(places.length * 3);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    places.forEach((p, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.ry);
      pos.set(p.x, p.y, p.z);
      scl.set(p.scale, p.scale, p.scale);
      m.compose(pos, q, scl);
      mesh.setMatrixAt(i, m);
      tints[i * 3] = tints[i * 3 + 1] = tints[i * 3 + 2] = p.tint;
    });
    geo.setAttribute('aTint', new THREE.InstancedBufferAttribute(tints, 3));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    this.group.add(mesh);
    this.stats.instancedMeshes++;
  }

  private build(): void {
    this.buildGrass();
    this.buildTrees();
    this.buildBamboo();
    this.buildBoulders();
    this.buildRadarStation();
    this.buildTerraces();
    this.buildBridgeAndGorge();
    this.buildVillage();
    this.buildSignposts();
    this.buildCheckpointGates();
  }

  /** 芒草坡: silvergrass on the open ridge, thinning downhill. */
  private buildGrass(): void {
    const rng = this.rng.fork('grass');
    const places: Placement[] = [];
    for (let s = 4; s < COURSE_LENGTH - 4; s += 1.1) {
      const sec = SECTIONS[this.world.course.sectionAt(s).index];
      const density = sec.index === 1 ? 0.85 : sec.index === 0 ? 0.26 : sec.index === 2 ? 0.22 : sec.index === 3 ? 0.18 : 0.08;
      const halfW = this.world.course.widthAt(s) * 0.5;
      const n = rng.next() < density ? rng.int(2, 6) : 0;
      for (let i = 0; i < n; i++) {
        const side = rng.next() < 0.5 ? -1 : 1;
        const lat = side * (halfW + rng.range(0.4, 26));
        const p = this.at(s + rng.range(-0.5, 0.5), lat);
        places.push({ x: p.x, y: p.y - 0.08, z: p.z, ry: rng.range(0, Math.PI * 2), scale: rng.range(0.6, 1.05), tint: rng.range(0.92, 1.10) });
      }
    }
    this.stats.grass = places.length;
    // Four tuft variants keep the ridge from reading as one repeated stamp.
    const buckets: Placement[][] = [[], [], [], []];
    places.forEach((p, i) => buckets[i & 3].push(p));
    for (let v = 0; v < 4; v++) {
      this.addInstanced(makeGrassTuft(rng), buckets[v], { rampOffset: 0.14, tone: 1.0, sway: true });
    }
  }

  /** Trees: three LOD builds banded by distance from the trail, which is where the camera lives. */
  private buildTrees(): void {
    const rng = this.rng.fork('trees');
    const near: Placement[] = [], mid: Placement[] = [], far: Placement[] = [];
    for (let s = 4; s < COURSE_LENGTH - 4; s += 2.4) {
      const idx = this.world.course.sectionAt(s).index;
      // Above 700 m 大帽山 is grassland; woodland starts in the tea terraces and below.
      const density = idx <= 1 ? 0.03 : idx === 2 ? 0.05 : idx === 3 ? 0.15 : idx === 4 ? 0.10 : 0.15;
      if (rng.next() > density) continue;
      const halfW = this.world.course.widthAt(s) * 0.5;
      const n = rng.int(1, 4);
      for (let i = 0; i < n; i++) {
        const side = rng.next() < 0.5 ? -1 : 1;
        const lat = side * (halfW + rng.range(8, 40));
        if (Math.abs(s - RAVINE_S) < RAVINE_WIDTH && Math.abs(lat) < 24) continue;
        const p = this.at(s, lat);
        const d = Math.abs(lat) - halfW;
        const pl: Placement = { x: p.x, y: p.y - 0.25, z: p.z, ry: rng.range(0, Math.PI * 2), scale: rng.range(0.75, 1.3), tint: rng.range(0.82, 1.04) };
        (d < 16 ? near : mid).push(pl);
      }
    }
    // Background woodland on the hillsides, placed straight onto the terrain.
    const hf = this.world.terrain;
    for (let i = 0; i < 3000; i++) {
      const x = hf.x0 + rng.next() * hf.size;
      const z = hf.z0 + rng.next() * hf.size;
      const nearTrack = this.world.course.nearest(x, z);
      if (nearTrack.dist < 34 || nearTrack.dist > 420) continue;
      if (hf.slopeAt(x, z) > 0.95) continue;
      const y = hf.heightAt(x, z);
      if (y > 780) continue;                       // treeline
      far.push({ x, y: y - 0.3, z, ry: rng.range(0, Math.PI * 2), scale: rng.range(0.8, 1.5), tint: rng.range(0.78, 1.0) });
    }
    this.stats.trees = near.length + mid.length + far.length;
    for (let v = 0; v < 3; v++) {
      const slice = (arr: Placement[]) => arr.filter((_, i) => i % 3 === v);
      this.addInstanced(makeTree(rng, 0), slice(near), { rampOffset: -0.05, tone: 0.90 });
      this.addInstanced(makeTree(rng, 1), slice(mid), { rampOffset: -0.05, tone: 0.90 });
      this.addInstanced(makeTree(rng, 2), slice(far), { rampOffset: -0.04, tone: 0.93 });
    }
  }

  /** 竹林峽: dense bamboo pressing in on both sides of the trail. */
  private buildBamboo(): void {
    const rng = this.rng.fork('bamboo');
    const near: Placement[] = [], far: Placement[] = [];
    for (let s = 1640; s < 2060; s += 1.9) {
      const halfW = this.world.course.widthAt(s) * 0.5;
      const n = rng.int(1, 4);
      for (let i = 0; i < n; i++) {
        const side = rng.next() < 0.5 ? -1 : 1;
        const d = rng.range(1.8, 32);
        const lat = side * (halfW + d);
        if (Math.abs(s - RAVINE_S) < RAVINE_WIDTH * 0.5 + 3 && Math.abs(lat) < 20) continue;
        if (Math.abs(s - BRIDGE_S) < BRIDGE_LEN * 0.5 && Math.abs(lat) < 4) continue;
        const p = this.at(s, lat);
        const pl: Placement = { x: p.x, y: p.y - 0.2, z: p.z, ry: rng.range(0, Math.PI * 2), scale: rng.range(0.72, 1.25), tint: rng.range(0.85, 1.05) };
        (d < 9 ? near : far).push(pl);
      }
    }
    this.stats.bamboo = near.length + far.length;
    for (let v = 0; v < 3; v++) {
      const slice = (arr: Placement[]) => arr.filter((_, i) => i % 3 === v);
      this.addInstanced(makeBamboo(rng, 0), slice(near), { rampOffset: -0.02, tone: 0.94, sway: true });
      this.addInstanced(makeBamboo(rng, 1), slice(far), { rampOffset: -0.02, tone: 0.94, sway: true });
    }
  }

  /** 石澗: the stream bed is a rock garden, so boulders line and litter it. */
  private buildBoulders(): void {
    const rng = this.rng.fork('boulders');
    const near: Placement[] = [], far: Placement[] = [];
    for (let s = 795; s < 1210; s += 5.0) {
      const halfW = this.world.course.widthAt(s) * 0.5;
      for (let i = 0; i < rng.int(1, 3); i++) {
        const side = rng.next() < 0.5 ? -1 : 1;
        const lat = side * (halfW + rng.range(0.2, 20));
        const p = this.at(s, lat);
        const sc = rng.range(0.5, 2.3);
        near.push({ x: p.x, y: p.y - sc * 0.35, z: p.z, ry: rng.range(0, Math.PI * 2), scale: sc, tint: rng.range(0.8, 1.02) });
      }
    }
    for (let s = 4; s < COURSE_LENGTH - 4; s += 7) {
      if (rng.next() > 0.34) continue;
      const halfW = this.world.course.widthAt(s) * 0.5;
      const side = rng.next() < 0.5 ? -1 : 1;
      const lat = side * (halfW + rng.range(4, 44));
      const p = this.at(s, lat);
      const sc = rng.range(0.7, 3.1);
      far.push({ x: p.x, y: p.y - sc * 0.35, z: p.z, ry: rng.range(0, Math.PI * 2), scale: sc, tint: rng.range(0.8, 1.0) });
    }
    this.stats.boulders = near.length + far.length;
    for (let v = 0; v < 3; v++) {
      const slice = (arr: Placement[]) => arr.filter((_, i) => i % 3 === v);
      this.addInstanced(makeBoulder(rng, 0), slice(near), { rampOffset: -0.03, tone: 0.93, wetBand: 0.7 });
      this.addInstanced(makeBoulder(rng, 1), slice(far), { rampOffset: -0.03, tone: 0.93, wetBand: 0.5 });
    }
  }

  /** The radar station that the run starts under. */
  private buildRadarStation(): void {
    const p = this.at(-2 + 6, -22);
    const mesh = new THREE.Mesh(makeRadome(), makeInkMaterial(this.shared, { rampOffset: 0.16, tone: 1.04 }));
    mesh.position.set(p.x, p.y - 0.5, p.z);
    mesh.rotation.y = this.heading(0);
    this.group.add(mesh);
  }

  /** 茶園 terrace walls, running across the fall line beside the jump line. */
  private buildTerraces(): void {
    const rng = this.rng.fork('terraces');
    const mat = makeInkMaterial(this.shared, { rampOffset: -0.04, tone: 0.92, wetBand: 0.4 });
    let walls = 0;
    for (let s = 1215; s < 1645; s += 26) {
      for (const side of [-1, 1]) {
        const halfW = this.world.course.widthAt(s) * 0.5;
        const lat = side * (halfW + rng.range(4, 9));
        const p = this.at(s, lat);
        const len = rng.range(14, 30);
        const g = makeTerraceWall(rng, len, rng.range(0.8, 1.7));
        const mesh = new THREE.Mesh(g, mat);
        mesh.position.set(p.x, p.y - 0.3, p.z);
        mesh.rotation.y = this.heading(s) + Math.PI * 0.5 + rng.range(-0.18, 0.18);
        this.group.add(mesh);
        walls++;
      }
    }
    // The step-down wall the trail actually drops over.
    const p = this.at(STEP_DOWN_S + 0.4, 0);
    const g = makeTerraceWall(rng, this.world.course.widthAt(STEP_DOWN_S) + 9, 2.4);
    const mesh = new THREE.Mesh(g, mat);
    mesh.position.set(p.x, p.y - 2.35, p.z);
    mesh.rotation.y = this.heading(STEP_DOWN_S) + Math.PI * 0.5;
    this.group.add(mesh);
    this.stats.walls += walls + 1;
  }

  private buildBridgeAndGorge(): void {
    const p = this.at(BRIDGE_S, 0);
    const mesh = new THREE.Mesh(
      makeFootbridge(BRIDGE_LEN, this.world.course.widthAt(BRIDGE_S) * 0.62),
      makeInkMaterial(this.shared, { rampOffset: -0.06, tone: 0.80, wetBand: 0.8 }),
    );
    mesh.position.set(p.x, p.y + 0.05, p.z);
    mesh.rotation.y = this.heading(BRIDGE_S);
    this.group.add(mesh);
  }

  /** 川龍村: stone lanes, the 豆腐花 banner, and flat ink villagers. */
  private buildVillage(): void {
    const rng = this.rng.fork('village');
    const stone = makeInkMaterial(this.shared, { rampOffset: -0.05, tone: 0.88, wetBand: 0.5 });
    let walls = 0;
    for (let s = 2055; s < COURSE_LENGTH - 6; s += 9) {
      for (const side of [-1, 1]) {
        if (rng.next() < 0.18) continue;
        const halfW = this.world.course.widthAt(s) * 0.5;
        const lat = side * (halfW + rng.range(1.2, 3.0));
        const p = this.at(s, lat);
        const g = makeTerraceWall(rng, rng.range(6, 11), rng.range(1.6, 3.4));
        const mesh = new THREE.Mesh(g, stone);
        mesh.position.set(p.x, p.y - 0.2, p.z);
        mesh.rotation.y = this.heading(s);
        this.group.add(mesh);
        walls++;
      }
    }
    this.stats.walls += walls;

    // Finish banner: 「川龍豆腐花」 strung across the lane.
    const bs = COURSE_LENGTH - 6;
    const halfW = this.world.course.widthAt(bs) * 0.5;
    const bannerW = halfW * 2 + 3.2;
    const banner = new THREE.Mesh(
      new THREE.PlaneGeometry(bannerW, 1.5),
      makeInkMaterial(this.shared, {
        rampOffset: 0.30, tone: 1.0, tint: ACCENT_RED,
        map: makeTextTexture('川龍豆腐花', { width: 768, height: 160, ink: '#f6efe2', paper: '#b5241f' }),
        side: THREE.DoubleSide,
      }),
    );
    const bp = this.at(bs, 0);
    banner.position.set(bp.x, bp.y + 4.0, bp.z);
    banner.rotation.y = this.heading(bs);
    this.group.add(banner);
    for (const side of [-1, 1]) {
      const pp = this.at(bs, side * (halfW + 1.6));
      const post = new THREE.Mesh(
        new THREE.CylinderGeometry(0.12, 0.16, 5.2, 6),
        makeInkMaterial(this.shared, { rampOffset: -0.08, tone: 0.72 }),
      );
      post.position.set(pp.x, pp.y + 2.6, pp.z);
      this.group.add(post);
    }

    // Villagers watching, as flat ink figures.
    const crowd: Placement[] = [];
    for (let s = COURSE_LENGTH - 90; s < COURSE_LENGTH - 2; s += 2.4) {
      for (const side of [-1, 1]) {
        if (rng.next() < 0.45) continue;
        const hw = this.world.course.widthAt(s) * 0.5;
        const p = this.at(s, side * (hw + rng.range(0.6, 2.4)));
        crowd.push({
          x: p.x, y: p.y, z: p.z,
          ry: this.heading(s) + Math.PI * 0.5 * side + rng.range(-0.4, 0.4),
          scale: rng.range(0.92, 1.1), tint: rng.range(0.55, 0.85),
        });
      }
    }
    this.stats.crowd = crowd.length;
    for (let v = 0; v < 3; v++) {
      this.addInstanced(makeCrowdFigure(rng), crowd.filter((_, i) => i % 3 === v),
        { rampOffset: -0.35, tone: 0.5, side: THREE.DoubleSide });
    }
  }

  /** Three signposts with drawn characters, one per landmark. */
  private buildSignposts(): void {
    const signs: { s: number; text: string; side: number }[] = [
      { s: 26, text: '大帽山', side: 1 },
      { s: 1105, text: '小心落石', side: -1 },
      { s: 2075, text: '川龍', side: 1 },
    ];
    for (const sign of signs) {
      const halfW = this.world.course.widthAt(sign.s) * 0.5;
      const p = this.at(sign.s, sign.side * (halfW + 1.6));
      const { post, board } = makeSignpost(1.5, 1.05);
      const g = new THREE.Group();
      g.add(new THREE.Mesh(post, makeInkMaterial(this.shared, { rampOffset: -0.08, tone: 0.72 })));
      g.add(new THREE.Mesh(board, makeInkMaterial(this.shared, {
        rampOffset: 0.28, tone: 1.02, side: THREE.DoubleSide,
        map: makeTextTexture(sign.text, { width: 384, height: 256, border: true }),
      })));
      g.position.set(p.x, p.y, p.z);
      g.rotation.y = this.heading(sign.s) + Math.PI + (sign.side > 0 ? 0.35 : -0.35);
      this.group.add(g);
      this.stats.signposts++;
    }
  }

  /** Split gates: two posts and a rope at each checkpoint, plus one at every tabletop lip. */
  private buildCheckpointGates(): void {
    const mat = makeInkMaterial(this.shared, { rampOffset: -0.10, tone: 0.68 });
    const tapeMat = makeInkMaterial(this.shared, { rampOffset: 0.22, tone: 1.0, tint: ACCENT_RED, side: THREE.DoubleSide });
    for (const cp of CHECKPOINTS) {
      const halfW = this.world.course.widthAt(cp) * 0.5 + 1.1;
      const g = new THREE.Group();
      for (const side of [-1, 1]) {
        const p = this.at(cp, side * halfW);
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 3.0, 6), mat);
        post.position.set(p.x, p.y + 1.5, p.z);
        g.add(post);
      }
      const c = this.at(cp, 0);
      const tape = new THREE.Mesh(new THREE.PlaneGeometry(halfW * 2, 0.26), tapeMat);
      tape.position.set(c.x, c.y + 2.85, c.z);
      tape.rotation.y = this.heading(cp);
      g.add(tape);
      this.group.add(g);
      this.stats.gates++;
    }
    // A marker board on the lip of each tabletop so the jump line reads at speed.
    for (const t of TABLETOPS) {
      const halfW = this.world.course.widthAt(t.s) * 0.5 + 0.8;
      for (const side of [-1, 1]) {
        const p = this.at(t.s - t.deck * 0.5 - t.lipRun, side * halfW);
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.0, 0.18), tapeMat);
        post.position.set(p.x, p.y + 0.5, p.z);
        post.rotation.y = this.heading(t.s);
        this.group.add(post);
      }
    }
  }
}
