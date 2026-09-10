import * as THREE from 'three';
import { makeInkMaterial, type InkUniforms } from './inkExports';

export type ParticleKind = 'dust' | 'spray' | 'spark';

interface Particle {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number; maxLife: number; size: number; kind: ParticleKind;
}

const CAPACITY = 420;

/**
 * Fixed particle pool. Everything is one instanced draw with the same ink material as
 * the world, so the geometry pass still writes normal+depth and the Sobel pass has no
 * hole to tear through.
 */
export class Particles {
  readonly mesh: THREE.InstancedMesh;
  private pool: Particle[] = [];
  private cursor = 0;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3();
  private tint: Float32Array;
  live = 0;
  enabled = true;

  constructor(shared: InkUniforms) {
    const geo = new THREE.OctahedronGeometry(0.5, 0);
    this.tint = new Float32Array(CAPACITY * 3).fill(1);
    geo.setAttribute('aTint', new THREE.InstancedBufferAttribute(this.tint, 3));
    const mat = makeInkMaterial(shared, { rampOffset: 0.20, tone: 1.0, instanced: true });
    this.mesh = new THREE.InstancedMesh(geo, mat, CAPACITY);
    this.mesh.frustumCulled = false;
    this.mesh.count = CAPACITY;
    for (let i = 0; i < CAPACITY; i++) {
      this.pool.push({ x: 0, y: -9999, z: 0, vx: 0, vy: 0, vz: 0, life: 0, maxLife: 1, size: 0.1, kind: 'dust' });
    }
    this.hideAll();
  }

  private hideAll(): void {
    this.m.makeScale(0, 0, 0);
    for (let i = 0; i < CAPACITY; i++) this.mesh.setMatrixAt(i, this.m);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  emit(kind: ParticleKind, x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, life: number): void {
    if (!this.enabled) return;
    const p = this.pool[this.cursor];
    this.cursor = (this.cursor + 1) % CAPACITY;
    p.kind = kind;
    p.x = x; p.y = y; p.z = z;
    p.vx = vx; p.vy = vy; p.vz = vz;
    p.size = size; p.life = life; p.maxLife = life;
  }

  /** Physics only — call from the fixed step so the pool is deterministic. */
  simulate(dt: number): void {
    let live = 0;
    for (let i = 0; i < CAPACITY; i++) {
      const p = this.pool[i];
      if (p.life <= 0) continue;
      p.life -= dt;
      const drag = p.kind === 'dust' ? 1.6 : p.kind === 'spray' ? 2.6 : 0.8;
      const grav = p.kind === 'dust' ? 1.2 : p.kind === 'spray' ? 7.5 : 11.0;
      const k = Math.exp(-drag * dt);
      p.vx *= k; p.vz *= k;
      p.vy = (p.vy - grav * dt) * k;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      live++;
    }
    this.live = live;
  }

  /** Write instance transforms. Render-rate only. */
  sync(): void {
    for (let i = 0; i < CAPACITY; i++) {
      const p = this.pool[i];
      if (p.life <= 0) { this.m.makeScale(0, 0, 0); this.mesh.setMatrixAt(i, this.m); continue; }
      const t = Math.max(0, p.life / p.maxLife);
      const grow = p.kind === 'dust' ? (1.6 - t * 0.6) : 1;
      const sc = p.size * grow * (0.25 + 0.75 * t);
      this.p.set(p.x, p.y, p.z);
      this.q.set(0, 0, 0, 1);
      this.s.set(sc, sc, sc);
      this.m.compose(this.p, this.q, this.s);
      this.mesh.setMatrixAt(i, this.m);
      const tone = p.kind === 'spark' ? 0.35 : p.kind === 'spray' ? 1.25 : 0.95;
      this.tint[i * 3] = this.tint[i * 3 + 1] = this.tint[i * 3 + 2] = tone;
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    (this.mesh.geometry.getAttribute('aTint') as THREE.InstancedBufferAttribute).needsUpdate = true;
  }

  clear(): void {
    for (const p of this.pool) p.life = 0;
    this.live = 0;
    this.hideAll();
  }
}
