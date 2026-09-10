import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { makeInkMaterial, makeHullMaterial, type InkUniforms } from './inkExports';
import { makeTextTexture } from './props';
import { WHEEL_R } from '../sim/bike';
import { clamp, lerp } from '../sim/rng';

const TAU = Math.PI * 2;
const CRANK_R = 0.165;

function tube(r1: number, r2: number, len: number, seg = 7): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(r1, r2, len, seg, 1);
}

/** Place a tube between two points. */
function strut(a: THREE.Vector3, b: THREE.Vector3, r: number, seg = 7): THREE.BufferGeometry {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const g = tube(r, r, len, seg);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  const m = new THREE.Matrix4().compose(new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1));
  g.applyMatrix4(m);
  return g;
}

/** A wheel: rim, tyre and 24 spokes. */
function wheelGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const tyre = new THREE.TorusGeometry(WHEEL_R - 0.03, 0.032, 5, 20);
  parts.push(tyre);
  const rim = new THREE.TorusGeometry(WHEEL_R - 0.075, 0.016, 4, 20);
  parts.push(rim);
  const hub = tube(0.038, 0.038, 0.11, 6);
  hub.rotateX(Math.PI * 0.5);
  parts.push(hub);
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * TAU;
    const outer = new THREE.Vector3(Math.cos(a) * (WHEEL_R - 0.08), Math.sin(a) * (WHEEL_R - 0.08), 0);
    const inner = new THREE.Vector3(Math.cos(a) * 0.03, Math.sin(a) * 0.03, (i % 2 ? 0.035 : -0.035));
    parts.push(strut(inner, outer, 0.006, 3));
  }
  const g = mergeGeometries(parts, false)!;
  g.computeVertexNormals();
  return g;
}

// Local frame: y = 0 is the ground contact patch, +z is forward.
export const BB_Y = 0.285;
export const AXLE_Y = WHEEL_R;
export const HEAD_PIVOT = new THREE.Vector3(0, 0.70, 0.42);
export const BAR_Y = 0.95;

function frameGeometry(): THREE.BufferGeometry {
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const bb = v(0, BB_Y, 0);
  const seat = v(0, 0.80, -0.14);
  const headTop = v(0, 0.80, 0.40);
  const headBot = v(0, 0.60, 0.44);
  const rearAxle = v(0, AXLE_Y, -0.525);
  const parts: THREE.BufferGeometry[] = [];
  parts.push(strut(bb, seat, 0.019));                  // seat tube
  parts.push(strut(seat, headTop, 0.019));             // top tube
  parts.push(strut(bb, headBot, 0.021));               // down tube
  parts.push(strut(headBot, headTop, 0.022, 8));       // head tube
  for (const s of [-1, 1]) {
    parts.push(strut(bb, v(s * 0.055, rearAxle.y, rearAxle.z), 0.014));       // chain stays
    parts.push(strut(seat, v(s * 0.048, rearAxle.y, rearAxle.z), 0.012));     // seat stays
  }
  // Saddle.
  const saddle = new THREE.BoxGeometry(0.09, 0.035, 0.24);
  saddle.translate(seat.x, seat.y + 0.05, seat.z - 0.02);
  parts.push(saddle);
  // Chainring and cranks.
  const ring = new THREE.TorusGeometry(0.105, 0.010, 4, 16);
  ring.rotateY(Math.PI * 0.5);
  ring.translate(0.045, BB_Y, 0);
  parts.push(ring);
  // Brake calipers.
  for (const [y, z] of [[rearAxle.y + 0.11, rearAxle.z + 0.07], [AXLE_Y + 0.11, 0.46]] as [number, number][]) {
    const cal = new THREE.BoxGeometry(0.10, 0.05, 0.05);
    cal.translate(0, y, z);
    parts.push(cal);
  }
  const g = mergeGeometries(parts, false)!;
  g.computeVertexNormals();
  return g;
}

function forkGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  // Local to the steering pivot: crown down to the axle, stem and bars up.
  const dropY = AXLE_Y - HEAD_PIVOT.y, dropZ = 0.525 - HEAD_PIVOT.z;
  parts.push(strut(v(0, 0.02, 0), v(0, dropY * 0.45, dropZ * 0.45), 0.020));
  for (const s of [-1, 1]) parts.push(strut(v(0, dropY * 0.40, dropZ * 0.40), v(s * 0.075, dropY, dropZ), 0.014));
  parts.push(strut(v(0, 0.02, 0), v(0, BAR_Y - HEAD_PIVOT.y, -0.06), 0.018));
  const bar = tube(0.014, 0.014, 0.60, 6);
  bar.rotateZ(Math.PI * 0.5);
  bar.translate(0, BAR_Y - HEAD_PIVOT.y, -0.06);
  parts.push(bar);
  for (const s of [-1, 1]) {
    const grip = tube(0.019, 0.019, 0.12, 6);
    grip.rotateZ(Math.PI * 0.5);
    grip.translate(s * 0.24, BAR_Y - HEAD_PIVOT.y, -0.06);
    parts.push(grip);
  }
  const g = mergeGeometries(parts, false)!;
  g.computeVertexNormals();
  return g;
}

interface Limb { upper: THREE.Mesh; lower: THREE.Mesh; l1: number; l2: number; }

/** Analytic two-bone IK. Returns the joint position for a root→target chain. */
function solveTwoBone(root: THREE.Vector3, target: THREE.Vector3, l1: number, l2: number, pole: THREE.Vector3, out: THREE.Vector3): void {
  const dir = new THREE.Vector3().subVectors(target, root);
  let d = dir.length();
  const max = (l1 + l2) * 0.999;
  if (d > max) { d = max; dir.setLength(max); }
  if (d < 1e-4) { out.copy(root); return; }
  dir.divideScalar(d);
  const cos = clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1);
  const along = l1 * cos;
  const perp = Math.sqrt(Math.max(0, l1 * l1 - along * along));
  const side = new THREE.Vector3().copy(pole).addScaledVector(dir, -pole.dot(dir));
  if (side.lengthSq() < 1e-8) side.set(0, 1, 0).addScaledVector(dir, -dir.y);
  side.normalize();
  out.copy(root).addScaledVector(dir, along).addScaledVector(side, perp);
}

function orientSegment(mesh: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3): void {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = Math.max(dir.length(), 1e-4);
  mesh.position.copy(a).addScaledVector(dir, 0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.divideScalar(len));
  mesh.scale.set(1, len / (mesh.userData.baseLen as number), 1);
}

export interface RiderStyle {
  jersey: number;      // tone multiplier
  helmet: 'round' | 'visor' | 'aero';
  mark?: string;       // character on the back
  accent?: THREE.Color;
}

/**
 * One rider: a generated bicycle plus an athletic rig whose hands and feet stay locked
 * to the grips and pedals through analytic two-bone IK.
 */
export class RiderRig {
  readonly root = new THREE.Group();
  private frame = new THREE.Group();
  private steer = new THREE.Group();
  private bodyPivot = new THREE.Group();
  private wheelF = new THREE.Group();
  private wheelR = new THREE.Group();
  private crank = new THREE.Group();
  private torso!: THREE.Mesh;
  private hips!: THREE.Mesh;
  private head!: THREE.Group;
  private arms: Limb[] = [];
  private legs: Limb[] = [];
  private pelvis = new THREE.Vector3(0, 0.98, -0.13);
  private shoulderC = new THREE.Vector3(0, 1.33, 0.19);
  private compressionSmoothed = 0;
  private crankAngle = 0;

  constructor(shared: InkUniforms, style: RiderStyle) {
    const tone = style.jersey;
    const metal = makeInkMaterial(shared, { rampOffset: -0.10, tone: 0.62 });
    const skin = makeInkMaterial(shared, { rampOffset: 0.10, tone: 1.0 });
    const cloth = makeInkMaterial(shared, { rampOffset: -0.04, tone });
    const hull = makeHullMaterial(shared, 0.016);

    const outlined = (geo: THREE.BufferGeometry, mat: THREE.Material): THREE.Mesh => {
      const m = new THREE.Mesh(geo, mat);
      m.add(new THREE.Mesh(geo, hull));
      return m;
    };

    // --- Bicycle.
    this.root.add(this.frame);
    this.frame.add(outlined(frameGeometry(), metal));
    this.frame.add(this.steer);
    this.steer.position.copy(HEAD_PIVOT);
    this.steer.add(outlined(forkGeometry(), metal));

    const wheelGeo = wheelGeometry();
    this.wheelF.position.set(0, AXLE_Y - HEAD_PIVOT.y, 0.525 - HEAD_PIVOT.z);
    this.wheelF.add(outlined(wheelGeo, metal));
    this.steer.add(this.wheelF);
    this.wheelR.position.set(0, AXLE_Y, -0.525);
    this.wheelR.add(outlined(wheelGeo, metal));
    this.frame.add(this.wheelR);

    const crankArm = new THREE.BoxGeometry(0.026, CRANK_R, 0.026);
    crankArm.translate(0, -CRANK_R * 0.5, 0);
    for (const s of [-1, 1]) {
      const arm = new THREE.Mesh(crankArm, metal);
      arm.position.set(s * 0.075, 0, 0);
      arm.rotation.z = s > 0 ? 0 : Math.PI;
      const pedal = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.022, 0.075), metal);
      pedal.position.set(0, -CRANK_R, 0);
      arm.add(pedal);
      this.crank.add(arm);
    }
    this.crank.position.set(0, BB_Y, 0);
    this.frame.add(this.crank);

    // --- Rider, hung off a pivot so weight lags the suspension by a frame.
    this.frame.add(this.bodyPivot);
    this.torso = outlined(new THREE.BoxGeometry(0.30, 0.44, 0.20), cloth);
    this.bodyPivot.add(this.torso);
    this.torso.userData.baseLen = 0.44;
    this.hips = outlined(new THREE.BoxGeometry(0.28, 0.17, 0.21), cloth);
    this.bodyPivot.add(this.hips);

    this.head = new THREE.Group();
    const helmetGeo = style.helmet === 'aero'
      ? new THREE.SphereGeometry(0.125, 8, 6).scale(1, 0.92, 1.35) as unknown as THREE.BufferGeometry
      : style.helmet === 'visor'
        ? new THREE.SphereGeometry(0.128, 8, 6)
        : new THREE.SphereGeometry(0.13, 7, 5);
    this.head.add(outlined(helmetGeo, cloth));
    const face = outlined(new THREE.BoxGeometry(0.115, 0.10, 0.10), skin);
    face.position.set(0, -0.045, 0.085);
    this.head.add(face);
    if (style.helmet === 'visor') {
      const visor = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.03, 0.13), metal);
      visor.position.set(0, 0.05, 0.10);
      this.head.add(visor);
    }
    this.bodyPivot.add(this.head);

    if (style.mark) {
      const mark = new THREE.Mesh(
        new THREE.PlaneGeometry(0.20, 0.20),
        makeInkMaterial(shared, {
          rampOffset: 0.34, tone: 1.0, tint: style.accent ?? new THREE.Color(0.72, 0.16, 0.14),
          map: makeTextTexture(style.mark, { width: 128, height: 128, alpha: true, ink: '#ffffff' }),
          side: THREE.DoubleSide,
        }),
      );
      mark.position.set(0, 0.0, -0.11);
      mark.rotation.y = Math.PI;
      this.torso.add(mark);
    }

    const seg = (r1: number, r2: number, len: number): THREE.BufferGeometry => {
      const g = tube(r1, r2, len, 6);
      return g;
    };
    const makeLimb = (l1: number, l2: number, r: number, mat: THREE.Material): Limb => {
      const upper = outlined(seg(r, r * 0.85, l1), mat);
      const lower = outlined(seg(r * 0.85, r * 0.7, l2), mat);
      upper.userData.baseLen = l1;
      lower.userData.baseLen = l2;
      this.bodyPivot.add(upper); this.bodyPivot.add(lower);
      return { upper, lower, l1, l2 };
    };
    for (let i = 0; i < 2; i++) this.arms.push(makeLimb(0.29, 0.27, 0.046, cloth));
    for (let i = 0; i < 2; i++) this.legs.push(makeLimb(0.44, 0.42, 0.060, cloth));
  }

  /** Pose the rig from sim state. `phase` fields come straight off the Rider. */
  update(state: {
    x: number; y: number; z: number;
    heading: number; pitch: number; roll: number;
    compressionF: number; compressionR: number; wheelRpm: number; steer: number;
    trick: number; trickPhase: number; crashed: boolean; crashTime: number; dt: number;
  }): void {
    const { dt } = state;
    this.root.position.set(state.x, state.y, state.z);
    this.root.rotation.set(0, 0, 0);
    this.root.rotateY(state.heading);
    this.root.rotateX(-state.pitch);
    this.root.rotateZ(-state.roll);
    // Weight lags the suspension by roughly a frame — that is what sells the impact.
    this.compressionSmoothed = lerp(this.compressionSmoothed, (state.compressionF + state.compressionR) * 0.5, 1 - Math.exp(-26 * dt));
    const squash = this.compressionSmoothed * 0.16;
    this.bodyPivot.position.y = -squash;
    this.wheelF.position.y = (AXLE_Y - HEAD_PIVOT.y) + state.compressionF * 0.05;
    this.wheelR.position.y = AXLE_Y + state.compressionR * 0.05;

    this.crankAngle += (state.wheelRpm / 60) * TAU * dt * 0.42;
    this.crank.rotation.x = this.crankAngle;
    this.wheelF.rotation.x = -this.crankAngle * 2.4;
    this.wheelR.rotation.x = -this.crankAngle * 2.4;
    this.steer.rotation.y = -state.steer * 0.34;

    // Trick poses, keyframed in code.
    const p = state.trickPhase;
    this.frame.rotation.set(0, 0, 0);
    this.frame.position.set(0, 0, 0);
    this.steer.rotation.z = 0;
    let leanOverride = 0;
    switch (state.trick) {
      case 1: this.frame.rotation.z = Math.sin(p * Math.PI) * 1.25; leanOverride = -0.5; break;   // tabletop
      case 2: this.steer.rotation.y += Math.sin(p * Math.PI) * Math.PI; break;                    // x-up
      case 3: this.frame.rotation.y = p * TAU; break;                                             // tailwhip
      case 4: this.root.rotation.y += p * TAU; break;                                             // 360
      case 5: this.frame.rotation.x = -p * TAU; break;                                            // backflip
      default: break;
    }
    if (state.crashed) {
      const t = state.crashTime;
      this.frame.rotation.z += t * 6.0;
      this.frame.rotation.x += t * 3.4;
      this.bodyPivot.rotation.z = t * 2.2;
      this.bodyPivot.position.y += Math.min(t, 0.4) * 0.5;
    } else {
      this.bodyPivot.rotation.z = leanOverride * 0.2;
    }

    // --- Contact targets, then IK. Hands stay on the grips, feet on the pedals.
    const sq = new THREE.Vector3(0, squash, 0);
    const hipC = this.pelvis.clone().sub(sq);
    const shoulderC = this.shoulderC.clone().sub(sq.clone().multiplyScalar(1.25));
    const grip = (s: number) => new THREE.Vector3(s * 0.24, BAR_Y, 0.36);
    const pedalPos = (s: number): THREE.Vector3 => {
      const a = this.crankAngle + (s > 0 ? 0 : Math.PI);
      return new THREE.Vector3(s * 0.085, BB_Y - Math.cos(a) * CRANK_R, Math.sin(a) * CRANK_R);
    };

    const spine = new THREE.Vector3().subVectors(shoulderC, hipC);
    orientSegment(this.torso, hipC, shoulderC);
    this.hips.position.copy(hipC);
    this.head.position.copy(shoulderC).addScaledVector(spine.clone().normalize(), 0.20);
    this.head.rotation.set(-0.30, 0, 0);

    for (let i = 0; i < 2; i++) {
      const s = i === 0 ? -1 : 1;
      const shoulder = shoulderC.clone().add(new THREE.Vector3(s * 0.15, -0.02, 0));
      const hand = grip(s);
      const joint = new THREE.Vector3();
      solveTwoBone(shoulder, hand, this.arms[i].l1, this.arms[i].l2, new THREE.Vector3(s * 0.35, -0.6, -1), joint);
      orientSegment(this.arms[i].upper, shoulder, joint);
      orientSegment(this.arms[i].lower, joint, hand);

      const hip = hipC.clone().add(new THREE.Vector3(s * 0.10, 0, 0));
      const foot = pedalPos(s);
      const knee = new THREE.Vector3();
      solveTwoBone(hip, foot, this.legs[i].l1, this.legs[i].l2, new THREE.Vector3(0, 0, 1), knee);
      orientSegment(this.legs[i].upper, hip, knee);
      orientSegment(this.legs[i].lower, knee, foot);
    }
  }
}
