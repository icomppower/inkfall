import { World } from './world';
import { Rider, neutralInput, type RiderInput } from './bike';
import { TABLE_DS } from './course';
import { clamp, lerp, Rng } from './rng';
import {
  COURSE_LENGTH, GRAVITY, SPEED_CAP, TABLETOPS, RAVINE_S, RAVINE_WIDTH, RAVINE_LIP_RUN,
  STEP_DOWN_S,
} from './constants';

export interface PilotStyle {
  id: string;
  zh: string;
  en: string;
  /** How hard the line cuts to the inside of a corner, in metres. */
  lineBias: number;
  /** <1 brakes later than the physics wants. */
  brakePoint: number;
  /** Multiplier on the curvature speed profile. */
  pace: number;
  /** Grip multiplier in the wet — JING barely notices it. */
  rainFactor: number;
  /** 0 avoids every lip, 1 hits all of them. */
  jumpAppetite: number;
  /** Probability of trying a trick on a launch that gives enough air. */
  trickChance: number;
  /** Closes the door on anyone within 1.2 m laterally. */
  aggressive: boolean;
  /** Relative mass in a collision. */
  mass: number;
  /** Mistakes per second of riding. */
  errorRate: number;
  jersey: number;
  helmet: 'round' | 'visor' | 'aero';
}

/** The three rivals, per spec §5. No rubber-banding: these numbers are the whole story. */
export const STYLES: Record<string, PilotStyle> = {
  JING: {
    id: 'JING', zh: '阿靜', en: 'JING',
    lineBias: 1.9, brakePoint: 1.18, pace: 0.965, rainFactor: 0.90,
    jumpAppetite: 0.15, trickChance: 0, aggressive: false, mass: 0.92,
    errorRate: 0.0000, jersey: 0.95, helmet: 'aero',
  },
  BO: {
    id: 'BO', zh: '肥波', en: 'BO',
    lineBias: 2.6, brakePoint: 0.86, pace: 1.035, rainFactor: 0.66,
    jumpAppetite: 0.0, trickChance: 0, aggressive: true, mass: 1.28,
    errorRate: 0.0042, jersey: 0.62, helmet: 'round',
  },
  MUN: {
    id: 'MUN', zh: '小蚊', en: 'MUN',
    lineBias: 2.2, brakePoint: 0.95, pace: 1.02, rainFactor: 0.74,
    jumpAppetite: 1.0, trickChance: 1.0, aggressive: false, mass: 0.86,
    errorRate: 0.0034, jersey: 0.78, helmet: 'visor',
  },
};

export const AUTOPILOT: PilotStyle = {
  id: 'AUTO', zh: '自動', en: 'Autopilot',
  lineBias: 1.8, brakePoint: 1.30, pace: 0.90, rainFactor: 0.85,
  jumpAppetite: 1.0, trickChance: 0, aggressive: false, mass: 1.0,
  errorRate: 0, jersey: 0.3, helmet: 'visor',
};

/** Launch edges the pilot has to time a hop for: deck exits, the ravine lip, the step-down. */
export function launchPoints(): number[] {
  const pts = TABLETOPS.map((t) => t.s + t.deck * 0.5);
  pts.push(RAVINE_S - RAVINE_WIDTH * 0.5);
  pts.push(STEP_DOWN_S);
  return pts.sort((a, b) => a - b);
}

/**
 * Curvature-derived speed profile, computed once at boot from the spline and then
 * walked backwards so the rider is already slow when it reaches the corner.
 */
export function buildSpeedProfile(world: World, style: PilotStyle, wetness = 0): Float32Array {
  const c = world.course;
  const n = c.kap.length;
  const v = new Float32Array(n);
  const launches = launchPoints();
  for (let i = 0; i < n; i++) {
    const s = i * TABLE_DS;
    const surf = c.surfaceAt(s, 0);
    const mu = world.grip(surf === 'void' ? 'dirt' : surf, wetness * style.rainFactor);
    const k = Math.max(Math.abs(c.kap[i]), 1e-4);
    const camberHelp = 1 + Math.max(0, -Math.sign(c.kap[i]) * c.cam[i]) * 0.9;
    v[i] = Math.min(SPEED_CAP, Math.sqrt((mu * GRAVITY * camberHelp) / k) * style.pace);
  }
  // The ravine has a minimum, not a maximum: come in slow and you are in the stream.
  for (const lp of launches) {
    if (Math.abs(lp - (RAVINE_S - RAVINE_WIDTH * 0.5)) > 0.5) continue;
    const from = Math.max(0, Math.round((lp - RAVINE_LIP_RUN - 40) / TABLE_DS));
    const to = Math.min(n - 1, Math.round((lp + 2) / TABLE_DS));
    for (let i = from; i <= to; i++) v[i] = Math.max(v[i], 15.5);
  }
  // Backward pass: respect how hard this rider is willing to brake.
  const decel = 5.2 * style.brakePoint;
  for (let i = n - 2; i >= 0; i--) {
    const limit = Math.sqrt(v[i + 1] * v[i + 1] + 2 * decel * TABLE_DS);
    if (v[i] > limit) v[i] = limit;
  }
  return v;
}

/**
 * A rider's brain. Produces RiderInput from sim state only — no rubber-banding, no
 * knowledge of where the player is except through honest proximity.
 */
export class Pilot {
  readonly style: PilotStyle;
  readonly world: World;
  private profile: Float32Array;
  private input: RiderInput = neutralInput();
  private rng: Rng;
  private launches = launchPoints();
  private preloading = false;
  private targetLaunch = -1;
  private wetnessBaked = 0;
  private trickWanted = 0;
  tricksAttempted = 0;

  constructor(world: World, style: PilotStyle, seed: string) {
    this.world = world;
    this.style = style;
    this.rng = new Rng(`pilot:${style.id}:${seed}`);
    this.profile = buildSpeedProfile(world, style, 0);
  }

  reset(): void {
    this.preloading = false;
    this.targetLaunch = -1;
    this.trickWanted = 0;
    this.tricksAttempted = 0;
  }

  /** The style's racing-line lateral offset at a track position. */
  lineOffset(s: number): number {
    const c = this.world.course;
    const k = c.curvatureAt(s);
    const halfW = c.widthAt(s) * 0.5;
    const inside = -Math.sign(k) * Math.min(this.style.lineBias, halfW * 0.62);
    // BO takes the terrace bypass instead of the jump line.
    if (this.style.jumpAppetite < 0.2) {
      for (const t of TABLETOPS) {
        if (Math.abs(s - t.s) < t.deck * 0.5 + t.lipRun + 6) return halfW * 0.78;
      }
    }
    return clamp(inside, -halfW * 0.8, halfW * 0.8);
  }

  targetSpeed(s: number): number {
    const c = this.world.course;
    const i = c.idx(Math.min(s + 6, COURSE_LENGTH));
    return this.profile[i];
  }

  step(dt: number, rider: Rider, wetness: number): RiderInput {
    const i = this.input;
    Object.assign(i, neutralInput());
    if (rider.phase !== 'riding') return i;

    // Rebuild the profile when the weather has genuinely changed the grip.
    if (Math.abs(wetness - this.wetnessBaked) > 0.12) {
      this.wetnessBaked = wetness;
      this.profile = buildSpeedProfile(this.world, this.style, wetness);
    }

    const target = this.targetSpeed(rider.s);
    if (rider.speed > target * 1.02) {
      i.brake = clamp((rider.speed - target) * 0.55, 0, 1);
      i.pedal = 0;
    } else {
      i.pedal = clamp((target - rider.speed) * 0.6, 0, 1);
      i.brake = 0;
    }

    // Steering: proportional-derivative onto the racing line.
    const want = this.lineOffset(rider.s + Math.max(4, rider.speed * 0.45));
    const err = want - rider.lateral;
    i.steer = clamp(err * 0.85 - rider.lateralVel * 0.42, -1, 1);

    // Hop timing at the next launch edge.
    const next = this.launches.find((p) => p > rider.s - 1);
    if (next !== undefined && this.style.jumpAppetite > 0.2) {
      const dist = next - rider.s;
      const tt = dist / Math.max(rider.speed, 1);
      if (tt < 0.42 && dist > -0.5) {
        i.preload = true;
        this.preloading = true;
        this.targetLaunch = next;
      } else if (this.preloading && rider.s >= this.targetLaunch) {
        i.preload = false;
        this.preloading = false;
        if (this.rng.next() < this.style.trickChance) {
          this.trickWanted = 1 + Math.floor(this.rng.next() * 5);
        }
      }
    }
    if (rider.airborne && this.trickWanted > 0 && rider.trick === 0) {
      // Only commit to a trick that fits inside the air actually available.
      const air = Math.max(0, rider.vy) * 2 / GRAVITY + rider.airTime;
      const wanted = air > 1.25 ? this.trickWanted : air > 0.9 ? Math.min(this.trickWanted, 4) : Math.min(this.trickWanted, 2);
      i.trick = wanted;
      this.trickWanted = 0;
      this.tricksAttempted++;
    }

    // Spend banked boost on the straights.
    if (rider.boost > 0.3 && Math.abs(this.world.course.curvatureAt(rider.s)) < 0.006 && !rider.airborne) {
      i.boost = true;
    }

    // Honest mistakes, seeded. Rain makes them likelier.
    if (this.style.errorRate > 0) {
      const p = this.style.errorRate * dt * (1 + wetness * 2.6);
      if (this.rng.next() < p) {
        i.steer = clamp(i.steer + (this.rng.next() < 0.5 ? -1.6 : 1.6), -1, 1);
        i.brake = Math.max(i.brake, 0.9);
      }
    }
    return i;
  }

  /** Lateral nudge when this rider decides to close the door on a neighbour. */
  contactUrge(rider: Rider, otherLateral: number, gap: number): number {
    if (!this.style.aggressive) return 0;
    if (gap > 6 || Math.abs(otherLateral - rider.lateral) > 1.9) return 0;
    return Math.sign(otherLateral - rider.lateral) * 0.55;
  }
}

export function blendSteer(a: number, b: number, t: number): number {
  return clamp(lerp(a, b, t), -1, 1);
}
