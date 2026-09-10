import { World } from './world';
import { Rider } from './bike';
import { clamp, lerp } from './rng';
import { COURSE_LENGTH, GRAVITY, SECTIONS } from './constants';

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

const MIN_CUT_GAP = 4.0;          // seconds — hard rule from the shot list
const BERM_KAPPA = 0.030;         // 1/33 m: the tarmac switchbacks and nothing else
const WIDE_HOLD = 5.0;
const RIVAL_RANGE = 3.0;

/**
 * Cinematic camera director. Every shot is a pure function of sim state, so a seed
 * reproduces the same film. Cuts are hard, never closer than MIN_CUT_GAP, and never
 * during an impact frame or in the 0.4 s before a landing.
 */
export class Director {
  readonly world: World;
  readonly pose: CameraPose = makePose();
  readonly cuts: ShotCut[] = [];
  shot: ShotName = 'chase';
  shotTime = 0;
  time = 0;
  /** Set by the game when an impact frame is on screen — cuts are blocked. */
  impactActive = false;
  forced: ShotName | null = null;

  private started = false;
  private vx = 0; private vy = 0; private vz = 0;
  private lastCutAt = -99;
  private shotEndsAt = 0;
  private shotAnchorS = 0;
  private shotSide = 1;
  private wideUsed = false;
  private finishUsed = false;
  private wasAirborne = false;
  private landedAt = -99;

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
    this.lastCutAt = -99;
    this.shotEndsAt = 0;
    this.wideUsed = false;
    this.finishUsed = false;
    this.wasAirborne = false;
    this.landedAt = -99;
    this.forced = null;
    this.impactActive = false;
  }

  /** Seconds until this rider touches down again, or Infinity on the ground. */
  private timeToLand(rider: Rider): number {
    if (!rider.airborne) return Infinity;
    const drop = rider.y - (rider.groundHeight() + 0.63);
    const a = 0.5 * GRAVITY;
    const b = -rider.vy;
    const c = -Math.max(drop, 0);
    const disc = b * b - 4 * a * c;
    if (disc < 0) return Infinity;
    return (-b + Math.sqrt(disc)) / (2 * a);
  }

  private canCut(rider: Rider): boolean {
    if (this.time - this.lastCutAt < MIN_CUT_GAP) return false;
    if (this.impactActive) return false;
    if (this.timeToLand(rider) < 0.4) return false;
    return true;
  }

  private trackPos(s: number, lateral: number, up: number, out: CameraPose, target: boolean): void {
    const c = this.world.course;
    const sc = clamp(s, 0, COURSE_LENGTH);
    const i = c.idx(sc);
    const x = c.centreX(sc) + lateral * c.rx[i];
    const z = c.centreZ(sc) + lateral * c.rz[i];
    const y = Math.max(c.surfaceHeight(sc, clamp(lateral, -c.widthAt(sc) * 0.5, c.widthAt(sc) * 0.5)),
                       this.world.terrain.heightAt(x, z)) + up;
    if (target) { out.tx = x; out.ty = y; out.tz = z; } else { out.px = x; out.py = y; out.pz = z; }
  }

  step(dt: number, rider: Rider, rivals: Rider[] = []): void {
    this.time += dt;
    this.shotTime += dt;
    if (this.wasAirborne && !rider.airborne) this.landedAt = this.time;
    this.wasAirborne = rider.airborne;

    this.chooseShot(rider, rivals);

    const desired = makePose();
    this.poseFor(this.shot, rider, rivals, desired);
    if (this.shotTime <= dt * 1.5) this.snapTo(desired);      // hard cut
    else this.applySpring(dt, desired, this.shot === 'chase' ? 6.5 : 3.4);
    this.liftAboveGround(this.shot === 'berm' ? 0.35 : 2.1);
    this.pose.fov = clamp(this.pose.fov, 35, 95);
  }

  private chooseShot(rider: Rider, rivals: Rider[]): void {
    if (this.forced) {
      if (this.shot !== this.forced) this.cutTo(this.forced, rider.s);
      return;
    }
    // Finish reverse owns the last 120 m and never gives the camera back.
    if (rider.s > COURSE_LENGTH - 120) {
      if (!this.finishUsed) { this.finishUsed = true; this.cutTo('finish', rider.s); }
      return;
    }
    if (this.time < this.shotEndsAt) return;

    if (!this.canCut(rider)) return;

    // Air side-dolly: only for launches that are actually going to hang.
    if (rider.airborne && this.shot !== 'side') {
      const predicted = this.timeToLand(rider) + rider.airTime;
      if (predicted > 0.6) {
        this.shotSide = rider.lateral >= 0 ? -1 : 1;
        this.shotAnchorS = rider.s;
        this.cutTo('side', rider.s);
        // Cut back on landing + 0.3 s, but never sooner than the 4 s cut floor.
        this.shotEndsAt = this.time + MIN_CUT_GAP;
        return;
      }
    }
    if (this.shot === 'side') {
      const back = Math.max(this.lastCutAt + MIN_CUT_GAP, this.landedAt + 0.3);
      if (this.time >= back) this.cutTo('chase', rider.s);
      return;
    }

    // Drone-wide: once per run, over 芒草坡.
    const sec = this.world.course.sectionAt(rider.s).index;
    if (!this.wideUsed && sec === SECTIONS[1].index && rider.s > SECTIONS[1].start + 60 && !rider.airborne) {
      this.wideUsed = true;
      this.shotSide = rider.lateral >= 0 ? -1 : 1;
      this.cutTo('wide', rider.s);
      this.shotEndsAt = this.time + WIDE_HOLD;
      return;
    }

    // Berm low-track on a real switchback.
    const k = this.world.course.curvatureAt(rider.s + 12);
    if (this.shot !== 'berm' && Math.abs(k) > BERM_KAPPA && !rider.airborne) {
      this.shotSide = -Math.sign(k) || 1;
      this.shotAnchorS = rider.s + 14;
      this.cutTo('berm', rider.s);
      this.shotEndsAt = this.time + MIN_CUT_GAP;
      return;
    }
    if (this.shot === 'berm') {
      if (Math.abs(this.world.course.curvatureAt(rider.s)) < BERM_KAPPA * 0.5) this.cutTo('chase', rider.s);
      return;
    }

    // Rival cam: someone within 3 m and closing.
    for (const r of rivals) {
      if (r === rider || r.phase === 'finished') continue;
      const gap = Math.abs(r.s - rider.s);
      const closing = (r.s > rider.s) === (r.speed < rider.speed);
      if (gap < RIVAL_RANGE && closing) {
        this.shotSide = r.lateral >= rider.lateral ? 1 : -1;
        this.cutTo('rival', rider.s);
        this.shotEndsAt = this.time + MIN_CUT_GAP;
        return;
      }
    }

    if (this.shot !== 'chase') this.cutTo('chase', rider.s);
  }

  private poseFor(shot: ShotName, rider: Rider, rivals: Rider[], out: CameraPose): void {
    const c = this.world.course;
    switch (shot) {
      case 'berm': {
        // Locked off at hub height on the inside of the turn.
        const halfW = c.widthAt(this.shotAnchorS) * 0.5;
        this.trackPos(this.shotAnchorS, this.shotSide * (halfW + 2.2), 0.45, out, false);
        this.trackPos(rider.s, rider.lateral, 1.0, out, true);
        out.fov = 54; out.roll = 0.04 * this.shotSide;
        break;
      }
      case 'side': {
        // Dolly tracking the arc from the side.
        this.trackPos(rider.s + 2, this.shotSide * 11, 1.9, out, false);
        out.tx = c.centreX(rider.s) + rider.lateral * c.rx[c.idx(rider.s)];
        out.tz = c.centreZ(rider.s) + rider.lateral * c.rz[c.idx(rider.s)];
        out.ty = rider.y + 0.2;
        out.fov = 52; out.roll = 0;
        break;
      }
      case 'wide': {
        this.trackPos(rider.s - 55, this.shotSide * 62, 58, out, false);
        this.trackPos(rider.s + 25, rider.lateral * 0.5, 2.0, out, true);
        out.fov = 44; out.roll = 0;
        break;
      }
      case 'rival': {
        let best: Rider | null = null;
        let bestGap = Infinity;
        for (const r of rivals) {
          if (r === rider) continue;
          const g = Math.abs(r.s - rider.s);
          if (g < bestGap) { bestGap = g; best = r; }
        }
        const other = best ?? rider;
        this.trackPos(rider.s - 3.6, rider.lateral + this.shotSide * 2.3, 1.75, out, false);
        const mid = (rider.s + other.s) * 0.5 + 3;
        this.trackPos(mid, (rider.lateral + other.lateral) * 0.5, 1.1, out, true);
        out.fov = 50; out.roll = 0;
        break;
      }
      case 'finish': {
        // On the line, facing uphill; the rider comes under the banner at the camera.
        const i = c.idx(COURSE_LENGTH - 2);
        const x = c.centreX(COURSE_LENGTH - 2) + 0.4 * c.rx[i];
        const z = c.centreZ(COURSE_LENGTH - 2) + 0.4 * c.rz[i];
        out.px = x - c.tx[i] * 9; out.pz = z - c.tz[i] * 9;
        out.py = c.surfaceHeight(COURSE_LENGTH - 2, 0) + 2.0;
        // Face back up the hill at the rider.
        this.trackPos(Math.max(rider.s, COURSE_LENGTH - 118), rider.lateral, 1.2, out, true);
        out.fov = 52; out.roll = 0;
        break;
      }
      default:
        this.chaseTarget(rider, out);
        break;
    }
  }

  /** Base chase framing: behind and above, looking along the spline tangent. */
  private chaseTarget(rider: Rider, out: CameraPose): void {
    const c = this.world.course;
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
  }

  /** Never let a shot end up inside a cut bank. */
  private liftAboveGround(clearance: number): void {
    const p = this.pose;
    const ground = this.world.terrain.heightAt(p.px, p.pz);
    if (p.py < ground + clearance) {
      p.py = ground + clearance;
      if (this.vy < 0) this.vy = 0;
    }
  }

  /** Critically damped follow, integrated at the fixed step so it stays deterministic. */
  private applySpring(dt: number, desired: CameraPose, stiffness: number): void {
    const p = this.pose;
    if (!this.started) { this.snapTo(desired); this.started = true; return; }
    const w = stiffness;
    const acc = (target: number, cur: number, vel: number) => (target - cur) * w * w - 2 * w * vel;
    this.vx += acc(desired.px, p.px, this.vx) * dt;
    this.vy += acc(desired.py, p.py, this.vy) * dt;
    this.vz += acc(desired.pz, p.pz, this.vz) * dt;
    p.px += this.vx * dt; p.py += this.vy * dt; p.pz += this.vz * dt;
    const k = 1 - Math.exp(-9 * dt);
    p.tx = lerp(p.tx, desired.tx, k);
    p.ty = lerp(p.ty, desired.ty, k);
    p.tz = lerp(p.tz, desired.tz, k);
    p.fov = lerp(p.fov, desired.fov, 1 - Math.exp(-4 * dt));
    p.roll = lerp(p.roll, desired.roll, k);
  }

  private cutTo(shot: ShotName, s: number): void {
    this.shot = shot;
    this.shotTime = 0;
    this.lastCutAt = this.time;
    this.shotEndsAt = this.time;
    this.cuts.push({ t: +this.time.toFixed(3), shot, s: +s.toFixed(2) });
    this.vx = this.vy = this.vz = 0;
  }

  private snapTo(desired: CameraPose): void {
    const p = this.pose;
    p.px = desired.px; p.py = desired.py; p.pz = desired.pz;
    p.tx = desired.tx; p.ty = desired.ty; p.tz = desired.tz;
    p.fov = desired.fov; p.roll = desired.roll;
    this.vx = this.vy = this.vz = 0;
  }

  /** Smallest gap between consecutive cuts, for the kill gate. */
  minCutGap(): number {
    let min = Infinity;
    for (let i = 1; i < this.cuts.length; i++) min = Math.min(min, this.cuts[i].t - this.cuts[i - 1].t);
    return min;
  }
}
