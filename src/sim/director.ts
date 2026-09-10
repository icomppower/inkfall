import { World } from './world';
import { Rider } from './bike';
import { clamp, lerp } from './rng';

export type ShotName = 'chase' | 'berm' | 'side' | 'wide' | 'rival' | 'finish';

export interface CameraPose {
  px: number; py: number; pz: number;
  tx: number; ty: number; tz: number;   // look-at target
  fov: number;
  roll: number;
}

export interface ShotCut { t: number; shot: ShotName; s: number; }

export function makePose(): CameraPose {
  return { px: 0, py: 0, pz: 0, tx: 0, ty: 0, tz: 0, fov: 60, roll: 0 };
}

/**
 * Cinematic camera director. Every shot is a pure function of sim state, so a seed
 * reproduces the same film. Extended with the full shot list at build step 7.
 */
export class Director {
  readonly world: World;
  readonly pose: CameraPose = makePose();
  readonly cuts: ShotCut[] = [];
  shot: ShotName = 'chase';
  shotTime = 0;
  time = 0;
  private started = false;
  private vx = 0; private vy = 0; private vz = 0;

  constructor(world: World) {
    this.world = world;
  }

  reset(): void {
    this.cuts.length = 0;
    this.shot = 'chase';
    this.shotTime = 0;
    this.time = 0;
    this.started = false;
    this.vx = this.vy = this.vz = 0;
  }

  /** Base chase framing: behind and above, looking along the spline tangent. */
  protected chaseTarget(rider: Rider, out: CameraPose): void {
    const c = this.world.course;
    const i = c.idx(rider.s);
    const back = 6.4, up = 2.45;
    const sBack = Math.max(rider.s - back, 0);
    const j = c.idx(sBack);
    const lat = rider.lateral * 0.75;
    out.px = c.centreX(sBack) + lat * c.rx[j];
    out.pz = c.centreZ(sBack) + lat * c.rz[j];
    out.py = Math.max(c.surfaceHeight(sBack, lat), rider.y) + up;
    const sAhead = Math.min(rider.s + 13, c.length);
    const k = c.idx(sAhead);
    out.tx = c.centreX(sAhead) + rider.lateral * 0.5 * c.rx[k];
    out.tz = c.centreZ(sAhead) + rider.lateral * 0.5 * c.rz[k];
    out.ty = c.surfaceHeight(sAhead, rider.lateral * 0.5) + 1.35;
    out.fov = 60 + 18 * (rider.boosting ? 1 : 0);
    out.roll = -rider.roll * 0.12;
    void i;
  }

  step(dt: number, rider: Rider): void {
    this.time += dt;
    this.shotTime += dt;
    const desired = makePose();
    this.chaseTarget(rider, desired);
    this.applySpring(dt, desired, 6.5);
    this.liftAboveGround();
  }

  /** Never let a shot end up inside a cut bank. */
  protected liftAboveGround(clearance = 2.1): void {
    const p = this.pose;
    const ground = this.world.terrain.heightAt(p.px, p.pz);
    if (p.py < ground + clearance) {
      p.py = ground + clearance;
      if (this.vy < 0) this.vy = 0;
    }
  }

  /** Critically damped follow, integrated at the fixed step so it stays deterministic. */
  protected applySpring(dt: number, desired: CameraPose, stiffness: number): void {
    const p = this.pose;
    if (!this.started) {
      p.px = desired.px; p.py = desired.py; p.pz = desired.pz;
      this.started = true;
    }
    const w = stiffness;
    const a = (target: number, cur: number, vel: number) => (target - cur) * w * w - 2 * w * vel;
    const ax = a(desired.px, p.px, this.vx);
    const ay = a(desired.py, p.py, this.vy);
    const az = a(desired.pz, p.pz, this.vz);
    this.vx += ax * dt; this.vy += ay * dt; this.vz += az * dt;
    p.px += this.vx * dt; p.py += this.vy * dt; p.pz += this.vz * dt;
    const k = 1 - Math.exp(-9 * dt);
    p.tx = lerp(p.tx, desired.tx, k);
    p.ty = lerp(p.ty, desired.ty, k);
    p.tz = lerp(p.tz, desired.tz, k);
    p.fov = lerp(p.fov, desired.fov, 1 - Math.exp(-4 * dt));
    p.roll = lerp(p.roll, desired.roll, k);
  }

  protected cutTo(shot: ShotName, s: number): void {
    this.shot = shot;
    this.shotTime = 0;
    this.cuts.push({ t: +this.time.toFixed(4), shot, s: +s.toFixed(2) });
    this.vx = this.vy = this.vz = 0;
  }

  protected snapTo(desired: CameraPose): void {
    const p = this.pose;
    p.px = desired.px; p.py = desired.py; p.pz = desired.pz;
    p.tx = desired.tx; p.ty = desired.ty; p.tz = desired.tz;
    p.fov = desired.fov; p.roll = desired.roll;
    this.vx = this.vy = this.vz = 0;
  }

  protected clampNumbers(): void {
    const p = this.pose;
    p.fov = clamp(p.fov, 35, 95);
  }
}
