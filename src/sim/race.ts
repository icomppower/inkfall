import { World } from './world';
import { Rider, neutralInput, type RiderInput } from './bike';
import { Pilot, STYLES, AUTOPILOT, type PilotStyle } from './pilot';
import { Weather } from './weather';
import { clamp } from './rng';
import { CHECKPOINTS, COURSE_LENGTH } from './constants';

export interface Entrant {
  rider: Rider;
  pilot: Pilot | null;
  style: PilotStyle;
  isPlayer: boolean;
}

const CONTACT_S = 1.55;       // longitudinal overlap for a capsule hit
const CONTACT_LAT = 0.74;     // lateral half-width sum
const CONTACT_SCRUB = 0.08;   // speed lost per contact event
const GRID: { id: string; lateral: number }[] = [
  { id: 'MUN', lateral: -2.7 },
  { id: 'INK', lateral: -0.9 },
  { id: 'JING', lateral: 0.9 },
  { id: 'BO', lateral: 2.7 },
];

/**
 * The race: one player and three rivals on the same physics, plus contact and placements.
 * There is no rubber-banding anywhere — a rival's pace is entirely its style parameters.
 */
export class Race {
  readonly world: World;
  readonly weather: Weather;
  readonly entrants: Entrant[] = [];
  readonly player: Rider;
  time = 0;
  contacts = 0;
  /** Player split times at the five checkpoint gates, in order. */
  splits: number[] = [];
  finishOrder: string[] = [];
  private cooldown = new Map<string, number>();
  private autoPilot: Pilot;
  autopilotOn = false;

  constructor(world: World, weather: Weather, seed: string) {
    this.world = world;
    this.weather = weather;
    this.autoPilot = new Pilot(world, AUTOPILOT, seed);

    for (const slot of GRID) {
      const isPlayer = slot.id === 'INK';
      const rider = new Rider(world, slot.id);
      rider.lateral = slot.lateral;
      const style = isPlayer ? AUTOPILOT : STYLES[slot.id];
      this.entrants.push({
        rider,
        pilot: isPlayer ? null : new Pilot(world, style, seed),
        style,
        isPlayer,
      });
    }
    this.player = this.entrants.find((e) => e.isPlayer)!.rider;
  }

  reset(): void {
    this.time = 0;
    this.contacts = 0;
    this.splits = [];
    this.finishOrder = [];
    this.cooldown.clear();
    this.autoPilot.reset();
    for (const e of this.entrants) {
      const slot = GRID.find((g) => g.id === e.rider.id)!;
      e.rider.reset(0);
      e.rider.lateral = slot.lateral;
      e.rider.phase = 'ready';
      e.rider.crashes = 0;
      e.rider.style = 0;
      e.rider.boost = 0;
      e.rider.checkpoint = 0;
      e.rider.checkpointS = 0;
      e.rider.finishTime = 0;
      e.pilot?.reset();
    }
  }

  start(): void {
    for (const e of this.entrants) if (e.rider.phase === 'ready') e.rider.phase = 'riding';
  }

  step(dt: number, playerInput: RiderInput): void {
    this.time += dt;
    const wet = this.weather.wetness;

    for (const e of this.entrants) {
      e.rider.wetness = wet;
      let input: RiderInput;
      if (e.isPlayer) {
        input = this.autopilotOn ? this.autoPilot.step(dt, e.rider, wet) : playerInput;
      } else {
        input = e.pilot!.step(dt, e.rider, wet);
        // 肥波 closes the door on whoever is beside him.
        if (e.style.aggressive) {
          for (const other of this.entrants) {
            if (other === e) continue;
            const gap = Math.abs(other.rider.s - e.rider.s);
            const urge = e.pilot!.contactUrge(e.rider, other.rider.lateral, gap);
            if (urge !== 0) input.steer = clamp(input.steer + urge, -1, 1);
          }
        }
      }
      const before = e.rider.phase;
      e.rider.step(dt, input);
      if (before !== 'finished' && e.rider.phase === 'finished') {
        e.rider.finishTime = this.time;
        this.finishOrder.push(e.rider.id);
      }
      // Checkpoints.
      for (let i = e.rider.checkpoint; i < CHECKPOINTS.length; i++) {
        if (e.rider.s >= CHECKPOINTS[i]) {
          e.rider.checkpoint = i + 1;
          e.rider.checkpointS = CHECKPOINTS[i];
          if (e.isPlayer) this.splits[i] = this.time;
        } else break;
      }
    }

    this.resolveContacts(dt);
  }

  /** Riders are lateral capsules: contact shoves both sideways and scrubs speed. */
  private resolveContacts(dt: number): void {
    for (const [k, v] of this.cooldown) {
      const nv = v - dt;
      if (nv <= 0) this.cooldown.delete(k); else this.cooldown.set(k, nv);
    }
    const list = this.entrants;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        const ra = a.rider, rb = b.rider;
        if (ra.phase !== 'riding' || rb.phase !== 'riding') continue;
        if (ra.airborne || rb.airborne) continue;
        if (Math.abs(ra.s - rb.s) > CONTACT_S) continue;
        const dl = ra.lateral - rb.lateral;
        if (Math.abs(dl) > CONTACT_LAT) continue;

        const overlap = CONTACT_LAT - Math.abs(dl);
        const dir = dl >= 0 ? 1 : -1;
        const total = a.style.mass + b.style.mass;
        // The heavier rider gives less ground.
        ra.lateral += dir * overlap * (b.style.mass / total);
        rb.lateral -= dir * overlap * (a.style.mass / total);
        ra.lateralVel += dir * 1.5 * (b.style.mass / total);
        rb.lateralVel -= dir * 1.5 * (a.style.mass / total);

        const key = `${ra.id}|${rb.id}`;
        if (!this.cooldown.has(key)) {
          this.cooldown.set(key, 1.3);
          this.contacts++;
          ra.speed *= 1 - CONTACT_SCRUB;
          rb.speed *= 1 - CONTACT_SCRUB;
          // Contact while sliding *can* topple the lighter rider — a hard hit, not every hit.
          const ratio = a.style.mass / b.style.mass;
          const hard = Math.abs(ra.lateralVel - rb.lateralVel) > 2.4;
          if (hard && (ra.sliding || rb.sliding)) {
            if (ratio > 1.22 && Math.abs(rb.slipAngle) > 0.22) rb.crash(`shoved by ${a.style.en}`);
            else if (ratio < 0.82 && Math.abs(ra.slipAngle) > 0.22) ra.crash(`shoved by ${b.style.en}`);
          }
        }
      }
    }
  }

  /** 1..4, finished riders first by time, then by distance down the hill. */
  placement(rider: Rider): number {
    let ahead = 0;
    for (const e of this.entrants) {
      const o = e.rider;
      if (o === rider) continue;
      if (o.phase === 'finished' && rider.phase === 'finished') {
        if (o.finishTime < rider.finishTime) ahead++;
      } else if (o.phase === 'finished') ahead++;
      else if (rider.phase !== 'finished' && o.s > rider.s) ahead++;
    }
    return ahead + 1;
  }

  get allFinished(): boolean {
    return this.entrants.every((e) => e.rider.phase === 'finished');
  }

  get progress(): number {
    return clamp(this.player.s / COURSE_LENGTH, 0, 1);
  }

  summary(): Record<string, unknown>[] {
    return this.entrants.map((e) => ({
      id: e.rider.id,
      zh: e.style.zh,
      en: e.style.en,
      isPlayer: e.isPlayer,
      s: +e.rider.s.toFixed(2),
      speedKmh: +(e.rider.speed * 3.6).toFixed(1),
      lateral: +e.rider.lateral.toFixed(2),
      phase: e.rider.phase,
      crashes: e.rider.crashes,
      style: e.rider.style,
      tricks: e.pilot?.tricksAttempted ?? 0,
      finishTime: +e.rider.finishTime.toFixed(3),
      lastCrashReason: e.rider.lastCrashReason,
      lastCrashS: e.rider.lastCrashS,
      place: this.placement(e.rider),
    }));
  }
}

export { neutralInput };
