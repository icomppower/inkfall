import { World } from './world';
import { makeSample, type SampleOut } from './course';
import { clamp, lerp } from './rng';
import {
  GRAVITY, WHEELBASE, SPEED_CAP, PEDAL_TOP_SPEED, SURFACES, SECTIONS,
} from './constants';

export interface RiderInput {
  pedal: number;       // 0..1
  brake: number;       // 0..1 rear brake — slides when steering
  frontBrake: number;  // 0..1 gamepad only; locking at lean washes out
  steer: number;       // -1..1, positive = rider's right
  preload: boolean;    // Space held: compress now, release to hop
  boost: boolean;
  manual: boolean;
  trick: number;       // 1..5 requested this step, 0 = none
  airPitch: number;    // -1..1 while airborne
  airRoll: number;     // -1..1 while airborne
}

export function neutralInput(): RiderInput {
  return { pedal: 0, brake: 0, frontBrake: 0, steer: 0, preload: false, boost: false, manual: false, trick: 0, airPitch: 0, airRoll: 0 };
}

export type RiderPhase = 'ready' | 'riding' | 'crashed' | 'finished';

export interface TrickDef { id: number; zh: string; en: string; duration: number; style: number; }

export const TRICKS: Record<number, TrickDef> = {
  1: { id: 1, zh: '平台式', en: 'Tabletop', duration: 0.55, style: 40 },
  2: { id: 2, zh: '交叉把', en: 'X-Up',     duration: 0.60, style: 45 },
  3: { id: 3, zh: '甩尾',   en: 'Tailwhip', duration: 0.85, style: 70 },
  4: { id: 4, zh: '轉體360', en: '360',     duration: 0.95, style: 85 },
  5: { id: 5, zh: '後空翻', en: 'Backflip', duration: 1.15, style: 120 },
};

// --- Suspension / chassis constants (tuned so a 1 m drop bottoms out near 60% travel).
export const WHEEL_R = 0.33;
export const RIDE_HEIGHT = 0.30;
export const MAX_TRAVEL = 0.22;
export const SPRING_K = 21000;      // N/m per wheel — a 1 m drop peaks at ~60% travel
export const DAMP_C = 880;          // N·s/m per wheel
const MASS = 92;             // kg, rider + bike

const PEDAL_ACCEL = 5.2;
const DRAG_K = 0.0043;
const ROLL_DECEL = 0.34;
const REAR_BRAKE_DECEL = 5.6;
const FRONT_BRAKE_DECEL = 9.4;
const LAT_GAIN = 5.2;
const MAX_LAT_VEL = 3.2;
const SLIP_THRESHOLD = 0.145;      // rad
const BOOST_DRAIN = 0.34;
const BOOST_PEDAL_MULT = 1.3;
const HOP_IMPULSE = 4.3;
const PRELOAD_RATE = 3.2;
const AIR_MIN = 0.10;              // seconds before a hop counts as real air

export interface LandingEvent {
  clean: boolean;
  scrub: boolean;
  crash: boolean;
  angleDeg: number;
  trick: number;
  trickComplete: boolean;
  style: number;
  airTime: number;
  s: number;
}

export class Rider {
  readonly world: World;
  readonly id: string;

  s = 0;
  lateral = 0;
  speed = 0;
  lateralVel = 0;
  y = 0;
  vy = 0;

  pitch = 0;         // nose-up positive
  roll = 0;          // lean to rider's right positive
  yaw = 0;           // heading relative to the track tangent

  airborne = false;
  airTime = 0;
  groundTime = 0;
  compressionF = 0;
  compressionR = 0;
  preload = 0;
  sliding = false;
  slipAngle = 0;
  gripUsage = 0;     // |lateral demand| / grip limit
  wheelRpm = 0;

  boost = 0;
  boosting = false;
  manualing = false;
  style = 0;
  crashes = 0;
  phase: RiderPhase = 'ready';
  crashTimer = 0;
  finishTime = 0;

  trick = 0;
  trickTimer = 0;
  trickPhaseNorm = 0;   // 0..1 through the current trick
  lastLanding: LandingEvent | null = null;
  lastCrashReason = '';
  lastCrashS = 0;

  checkpoint = 0;
  checkpointS = 0;

  /** Wetness in [0,1] is owned by the weather system and pushed in each step. */
  wetness = 0;

  /** Suspension rates. Instance fields so the drop-test rig can sweep them. */
  springK = SPRING_K;
  dampC = DAMP_C;

  private smp: SampleOut = makeSample();
  private smpF: SampleOut = makeSample();
  private smpR: SampleOut = makeSample();
  private airPitchVel = 0;
  private airRollVel = 0;
  private prevPreload = false;
  private hopArmed = false;

  constructor(world: World, id: string) {
    this.world = world;
    this.id = id;
    this.reset(0);
  }

  reset(s: number): void {
    this.s = s;
    this.lateral = 0;
    this.speed = 0;
    this.lateralVel = 0;
    const g = this.world.sample(s, 0, this.smp);
    this.y = g.height + WHEEL_R + RIDE_HEIGHT - (MASS * GRAVITY) / (2 * this.springK);
    this.vy = 0;
    const c = this.world.course;
    const sF = Math.min(s + WHEELBASE * 0.5, c.length), sR = Math.max(s - WHEELBASE * 0.5, 0);
    this.pitch = Math.atan2(c.surfaceHeight(sF, 0) - c.surfaceHeight(sR, 0), WHEELBASE);
    this.roll = 0; this.yaw = 0;
    this.airborne = false; this.airTime = 0; this.groundTime = 0;
    this.trick = 0; this.trickTimer = 0; this.trickPhaseNorm = 0;
    this.sliding = false; this.slipAngle = 0;
    this.preload = 0; this.hopArmed = false; this.prevPreload = false;
    this.airPitchVel = 0; this.airRollVel = 0;
  }

  /** Surface height directly under the contact patch. */
  groundHeight(): number {
    return this.world.course.surfaceHeight(this.s, this.lateral);
  }

  heightAboveSurface(): number {
    return this.y - WHEEL_R - RIDE_HEIGHT - this.groundHeight();
  }

  effectiveGrip(): number {
    const surf = this.world.course.surfaceAt(this.s, this.lateral);
    let mu = this.world.grip(surf === 'void' ? 'dirt' : surf, this.wetness);
    if (Math.abs(this.lateral) > this.smp.width * 0.5) mu *= 0.62;   // off the prepared trail
    return mu;
  }

  step(dt: number, input: RiderInput): void {
    if (this.phase === 'finished') return;
    if (this.phase === 'crashed') {
      this.crashTimer -= dt;
      this.speed = Math.max(0, this.speed - 12 * dt);
      this.pitch += 6.0 * dt;
      this.roll += 4.5 * dt;
      this.y = Math.max(this.y - 3 * dt, this.groundHeight() + 0.25);
      if (this.crashTimer <= 0) this.respawn();
      return;
    }
    this.phase = 'riding';

    const course = this.world.course;
    const g = course.sample(this.s, this.lateral, this.smp);
    const sF = Math.min(this.s + WHEELBASE * 0.5, course.length);
    const sR = Math.max(this.s - WHEELBASE * 0.5, 0);
    const gF = course.sample(sF, this.lateral, this.smpF);
    const gR = course.sample(sR, this.lateral, this.smpR);

    // ---- Suspension: two wheel probes against world.sample.
    const restF = gF.height + WHEEL_R + RIDE_HEIGHT;
    const restR = gR.height + WHEEL_R + RIDE_HEIGHT;
    // Chassis attachment points sit fore and aft of the centre, tilted by the current
    // pitch — otherwise on any gradient the rear probe carries the whole bike.
    const armF = Math.sin(this.pitch) * WHEELBASE * 0.5;
    const armR = -armF;
    const preloadPush = this.preload * PRELOAD_RATE * MAX_TRAVEL;
    let compF = clamp(restF - (this.y + armF) + preloadPush, 0, MAX_TRAVEL);
    let compR = clamp(restR - (this.y + armR) + preloadPush, 0, MAX_TRAVEL);
    // Half a wheelbase over a chasm is not support: either probe in the void means air.
    const inVoid = gF.voidGap || gR.voidGap;
    if (inVoid) { compF = 0; compR = 0; }

    // The ground itself is falling away beneath a descending rider; dampers resist the
    // chassis moving relative to the ground, not relative to the world. Using absolute
    // vertical velocity here launches the bike off every metre of gradient.
    const dSurfDs = (gF.height - gR.height) / WHEELBASE;
    const groundVy = this.speed * dSurfDs;
    const springForce = this.springK * (compF + compR);
    const wheelsDown = (compF > 0 ? 1 : 0) + (compR > 0 ? 1 : 0);
    const damping = this.dampC * (this.vy - groundVy) * wheelsDown;
    const netAccel = (springForce - damping) / MASS - GRAVITY;
    this.vy += netAccel * dt;
    this.y += this.vy * dt;

    // Hard travel stop — the chassis cannot pass through the ground.
    const floor = Math.max(restF - armF, restR - armR) - MAX_TRAVEL;
    if (!inVoid && this.y < floor) { this.y = floor; if (this.vy < groundVy) this.vy = groundVy; }

    this.compressionF = compF / MAX_TRAVEL;
    this.compressionR = compR / MAX_TRAVEL;
    const grounded = !inVoid && (compF > 0.0005 || compR > 0.0005);

    // Coyote window: skipping over a stone is not "air". Only sustained separation
    // switches the rider into the airborne model and arms landing judgement.
    if (grounded) {
      if (this.airborne) this.judgeLanding(g);
      this.airborne = false;
      this.airTime = 0;
      this.groundTime += dt;
    } else {
      this.airTime += dt;
      this.groundTime = 0;
      if (this.airTime > AIR_MIN) this.airborne = true;
    }

    // Falling into 竹林峽 is a crash, not a long descent.
    const lipLevel = course.centreY(this.s) + course.featureHeight(this.s);
    if (inVoid && this.y < lipLevel - 3.5) {
      this.crash('short of the ravine');
      return;
    }

    // ---- Preload / hop.
    if (input.preload && grounded) {
      this.preload = Math.min(1, this.preload + dt * 3.4);
      this.hopArmed = true;
    } else if (!input.preload) {
      if (this.prevPreload && this.hopArmed && grounded && this.preload > 0.12) this.doHop();
      this.preload = Math.max(0, this.preload - dt * 5.0);
      if (!input.preload) this.hopArmed = false;
    }
    this.prevPreload = input.preload;

    // ---- Longitudinal.
    const slopeAccel = -GRAVITY * this.trackSlope();
    const pedalMult = (input.boost && this.boost > 0) ? BOOST_PEDAL_MULT : 1;
    const topSpeed = PEDAL_TOP_SPEED * pedalMult;
    let accel = slopeAccel;
    if (!this.airborne) {
      accel += input.pedal * PEDAL_ACCEL * pedalMult * Math.max(0, 1 - this.speed / topSpeed);
      accel -= ROLL_DECEL * SURFACES[g.surface === 'void' ? 'dirt' : g.surface].roll;
      accel -= input.brake * REAR_BRAKE_DECEL * (this.sliding ? 0.55 : 1);
      accel -= input.frontBrake * FRONT_BRAKE_DECEL;
      if (g.offTrail) accel -= 1.9;
    }
    accel -= DRAG_K * this.speed * this.speed;
    this.speed = clamp(this.speed + accel * dt, 0, SPEED_CAP);

    // ---- Boost meter.
    this.boosting = false;
    this.manualing = false;
    if (input.boost && this.boost > 0 && this.speed > 1) {
      this.boost = Math.max(0, this.boost - BOOST_DRAIN * dt);
      this.boosting = true;
    }
    if (input.manual && !this.airborne && Math.abs(this.trackSlope()) < 0.09 && this.speed > 2) {
      this.boost = Math.min(1, this.boost + 0.055 * dt);
      this.manualing = true;
    }

    // ---- Lateral: grip budget shared between holding the line and steering.
    const kappa = course.curvatureAt(this.s);
    const camberAccel = -GRAVITY * g.camber;
    const gripLimit = this.effectiveGrip() * GRAVITY;
    if (this.airborne) {
      this.lateralVel += input.steer * 2.4 * dt;
      this.gripUsage = 0;
      this.sliding = false;
    } else {
      const rearLock = input.brake > 0.4 && Math.abs(input.steer) > 0.25;
      const targetLatVel = input.steer * MAX_LAT_VEL * clamp(this.speed / 8, 0.25, 1);
      const desiredTire = (targetLatVel - this.lateralVel) * LAT_GAIN
        + this.speed * this.speed * kappa - camberAccel;
      const limit = gripLimit * (rearLock ? 1.12 : 1);
      this.gripUsage = Math.abs(desiredTire) / Math.max(limit, 0.001);
      const tire = clamp(desiredTire, -limit, limit);
      const latAccel = tire + camberAccel - this.speed * this.speed * kappa;
      this.lateralVel += latAccel * dt;
      this.slipAngle = Math.atan2(this.lateralVel, Math.max(this.speed, 1.5));
      this.sliding = rearLock || Math.abs(this.slipAngle) > SLIP_THRESHOLD;
      if (this.sliding) this.speed = Math.max(0, this.speed - Math.abs(this.slipAngle) * 5.5 * dt);
      // Front brake locked at lean washes the front out.
      if (input.frontBrake > 0.5 && this.gripUsage > 0.85 && this.speed > 6) {
        this.crash('front washout');
        return;
      }
    }
    this.lateral += this.lateralVel * dt;

    // Off the edge of 芒草坡 there is nothing but air.
    const halfW = g.width * 0.5;
    const onRidge = course.sectionAt(this.s).index === SECTIONS[1].index;
    if (onRidge && this.lateral < -(halfW + 2.0)) {
      this.crash('over the cliff edge');
      return;
    }
    // Scrub, bank and undergrowth stop you leaving the corridor anywhere else.
    const bound = halfW + 2.4;
    if (this.lateral > bound) { this.lateral = bound; this.lateralVel = Math.min(0, this.lateralVel); }
    if (this.lateral < -bound && !onRidge) { this.lateral = -bound; this.lateralVel = Math.max(0, this.lateralVel); }

    // ---- Attitude.
    if (this.airborne) {
      this.airPitchVel = lerp(this.airPitchVel, input.airPitch * 2.6, 1 - Math.exp(-6 * dt));
      this.airRollVel = lerp(this.airRollVel, input.airRoll * 3.0, 1 - Math.exp(-6 * dt));
      this.pitch += this.airPitchVel * dt;
      this.roll += this.airRollVel * dt;
      if (input.trick > 0 && this.trick === 0 && this.airTime > 0.05) this.startTrick(input.trick);
      if (this.trick > 0) {
        this.trickTimer += dt;
        this.trickPhaseNorm = clamp(this.trickTimer / TRICKS[this.trick].duration, 0, 1);
      }
    } else {
      const targetPitch = Math.atan2(gF.height - gR.height, WHEELBASE)
        + (compR - compF) * 0.9;
      this.pitch = lerp(this.pitch, targetPitch, 1 - Math.exp(-14 * dt));
      const lean = Math.atan2(this.speed * this.speed * kappa - camberAccel, GRAVITY);
      this.roll = lerp(this.roll, clamp(lean, -0.95, 0.95), 1 - Math.exp(-9 * dt));
      this.airPitchVel = 0; this.airRollVel = 0;
    }
    this.yaw = lerp(this.yaw, Math.atan2(this.lateralVel, Math.max(this.speed, 2)) * 0.85, 1 - Math.exp(-11 * dt));

    // ---- Advance along the track. No wrong-way riding.
    this.s = clamp(this.s + this.speed * dt, 0, course.length);
    this.wheelRpm = (this.speed / (2 * Math.PI * WHEEL_R)) * 60;

    if (this.s >= course.length - 1e-6 && this.phase === 'riding') this.phase = 'finished';
  }

  private trackSlope(): number {
    const c = this.world.course;
    const d = 1.0;
    const s0 = clamp(this.s - d, 0, c.length), s1 = clamp(this.s + d, 0, c.length);
    const h0 = c.centreY(s0) + c.featureHeight(s0);
    const h1 = c.centreY(s1) + c.featureHeight(s1);
    return clamp((h1 - h0) / (s1 - s0 || 1), -0.65, 0.65);
  }

  private doHop(): void {
    // Timing window: full pop when released within ±80 ms of the lip crest.
    const lipDt = this.timeToNextLip();
    const timing = Math.abs(lipDt) <= 0.08 ? 1 : clamp(1 - (Math.abs(lipDt) - 0.08) / 0.42, 0.35, 1);
    this.vy += HOP_IMPULSE * (0.45 + 0.55 * this.preload) * timing;
    this.preload = 0;
    this.hopArmed = false;
  }

  /** Seconds of air left before touchdown, from the current ballistic state. */
  predictedAirRemaining(): number {
    if (!this.airborne) return 0;
    const c = this.world.course;
    const ride = WHEEL_R + RIDE_HEIGHT;
    // Fixed-point: the ground you land on is the ground where you will be, not the
    // ground under the deck you just left.
    let t = 0;
    for (let k = 0; k < 4; k++) {
      const landS = clamp(this.s + this.speed * t, 0, c.length);
      const groundY = c.landingHeight(landS, this.lateral) + ride;
      const drop = Math.max(0, this.y - groundY);
      const disc = this.vy * this.vy + 2 * GRAVITY * drop;
      t = disc <= 0 ? 0 : (this.vy + Math.sqrt(disc)) / GRAVITY;
    }
    return t;
  }

  /** Seconds until the next crest ahead (negative = just passed one). */
  timeToNextLip(): number {
    const c = this.world.course;
    const v = Math.max(this.speed, 1);
    for (let ds = -3; ds <= 26; ds += 0.5) {
      const s = clamp(this.s + ds, 0, c.length);
      // A launch edge is where the ground stops holding you up: the far side of a
      // tabletop deck, the ravine lip, the terrace step.
      if (c.isVoid(s, this.lateral)) return ds / v;
      const h1 = c.featureHeight(s);
      const h2 = c.featureHeight(clamp(s + 0.6, 0, c.length));
      if (h1 > 0.30 && h2 < h1 - 0.06) return ds / v;
    }
    return 999;
  }

  private startTrick(id: number): void {
    if (!TRICKS[id]) return;
    this.trick = id;
    this.trickTimer = 0;
    this.trickPhaseNorm = 0;
  }

  private macroN = { x: 0, y: 1, z: 0 };

  private judgeLanding(_g: SampleOut): void {
    // Judge against the macro surface: a 300 mm ledge is a landing, a 100 mm stone is not.
    this.world.course.macroNormal(this.s, this.lateral, this.macroN);
    const g = { nx: this.macroN.x, ny: this.macroN.y, nz: this.macroN.z };
    // Bike up vector from pitch/roll, compared with the surface normal.
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const cr = Math.cos(this.roll), sr = Math.sin(this.roll);
    const upLocalY = cp * cr;
    const upLocalX = cp * sr;
    const upLocalZ = -sp;
    // Track basis at this point.
    const i = this.world.course.idx(this.s);
    const tx = this.world.course.tx[i], tz = this.world.course.tz[i];
    const rx = this.world.course.rx[i], rz = this.world.course.rz[i];
    const ux = upLocalX * rx + upLocalZ * tx;
    const uz = upLocalX * rz + upLocalZ * tz;
    const uy = upLocalY;
    const dot = clamp(ux * g.nx + uy * g.ny + uz * g.nz, -1, 1);
    const angleDeg = (Math.acos(dot) * 180) / Math.PI;

    const tdef = this.trick > 0 ? TRICKS[this.trick] : null;
    const trickComplete = tdef ? this.trickTimer >= tdef.duration : true;
    const airTime = this.airTime;
    const ev: LandingEvent = {
      clean: false, scrub: false, crash: false,
      angleDeg, trick: this.trick, trickComplete,
      style: 0, airTime, s: this.s,
    };

    if (!trickComplete || angleDeg > 35) {
      ev.crash = true;
      this.lastLanding = ev;
      this.trick = 0; this.trickTimer = 0; this.trickPhaseNorm = 0;
      this.crash(!trickComplete ? 'trick not completed' : `landed ${angleDeg.toFixed(0)}° off`);
      return;
    }
    if (angleDeg <= 18) {
      ev.clean = true;
      this.boost = Math.min(1, this.boost + 0.15 + Math.min(airTime, 1.4) * 0.05);
      ev.style += 20 + Math.round(airTime * 30);
    } else {
      ev.scrub = true;
      this.speed *= 0.6;
      ev.style += 5;
    }
    if (tdef) {
      ev.style += tdef.style;
      this.boost = Math.min(1, this.boost + tdef.style / 700);
    }
    this.style += ev.style;
    this.pitch *= 0.2; this.roll *= 0.25;
    this.trick = 0; this.trickTimer = 0; this.trickPhaseNorm = 0;
    this.lastLanding = ev;
  }

  crash(reason: string): void {
    if (this.phase === 'crashed' || this.phase === 'finished') return;
    this.phase = 'crashed';
    this.crashTimer = 1.6;
    this.crashes++;
    this.lastCrashReason = reason;
    this.lastCrashS = +this.s.toFixed(1);
    this.trick = 0; this.trickTimer = 0; this.trickPhaseNorm = 0;
    this.sliding = false;
    this.boost = Math.max(0, this.boost - 0.35);
  }

  private respawn(): void {
    const s = this.checkpointS;
    this.reset(s);
    this.phase = 'riding';
  }

  /** Absolute world position of the chassis. */
  worldPos(out: { x: number; y: number; z: number }): void {
    const c = this.world.course;
    const i = c.idx(this.s);
    out.x = c.centreX(this.s) + this.lateral * c.rx[i];
    out.z = c.centreZ(this.s) + this.lateral * c.rz[i];
    out.y = this.y;
  }
}
