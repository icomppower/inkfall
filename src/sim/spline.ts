/** Centripetal Catmull-Rom spline through 3D control points. Pure math. */

export interface Vec3 { x: number; y: number; z: number; }

export function v3(x = 0, y = 0, z = 0): Vec3 { return { x, y, z }; }

function tj(ti: number, a: Vec3, b: Vec3, alpha: number): number {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  return ti + Math.pow(Math.sqrt(dx * dx + dy * dy + dz * dz), alpha);
}

/** Centripetal (alpha=0.5) Catmull-Rom — no cusps or overshoot on uneven spacing. */
export function catmullRom(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, t: number, out: Vec3, alpha = 0.5): Vec3 {
  const t0 = 0;
  const t1 = tj(t0, p0, p1, alpha);
  const t2 = tj(t1, p1, p2, alpha);
  const t3 = tj(t2, p2, p3, alpha);
  const tt = t1 + (t2 - t1) * t;
  const d01 = t1 - t0 || 1e-6, d12 = t2 - t1 || 1e-6, d23 = t3 - t2 || 1e-6;
  const d02 = t2 - t0 || 1e-6, d13 = t3 - t1 || 1e-6;

  const a1x = (t1 - tt) / d01 * p0.x + (tt - t0) / d01 * p1.x;
  const a1y = (t1 - tt) / d01 * p0.y + (tt - t0) / d01 * p1.y;
  const a1z = (t1 - tt) / d01 * p0.z + (tt - t0) / d01 * p1.z;
  const a2x = (t2 - tt) / d12 * p1.x + (tt - t1) / d12 * p2.x;
  const a2y = (t2 - tt) / d12 * p1.y + (tt - t1) / d12 * p2.y;
  const a2z = (t2 - tt) / d12 * p1.z + (tt - t1) / d12 * p2.z;
  const a3x = (t3 - tt) / d23 * p2.x + (tt - t2) / d23 * p3.x;
  const a3y = (t3 - tt) / d23 * p2.y + (tt - t2) / d23 * p3.y;
  const a3z = (t3 - tt) / d23 * p2.z + (tt - t2) / d23 * p3.z;

  const b1x = (t2 - tt) / d02 * a1x + (tt - t0) / d02 * a2x;
  const b1y = (t2 - tt) / d02 * a1y + (tt - t0) / d02 * a2y;
  const b1z = (t2 - tt) / d02 * a1z + (tt - t0) / d02 * a2z;
  const b2x = (t3 - tt) / d13 * a2x + (tt - t1) / d13 * a3x;
  const b2y = (t3 - tt) / d13 * a2y + (tt - t1) / d13 * a3y;
  const b2z = (t3 - tt) / d13 * a2z + (tt - t1) / d13 * a3z;

  out.x = (t2 - tt) / d12 * b1x + (tt - t1) / d12 * b2x;
  out.y = (t2 - tt) / d12 * b1y + (tt - t1) / d12 * b2y;
  out.z = (t2 - tt) / d12 * b1z + (tt - t1) / d12 * b2z;
  return out;
}

function reflect(a: Vec3, b: Vec3): Vec3 {
  // Phantom end point. Duplicating an endpoint instead would give the centripetal
  // parameterisation a zero-length knot span and collapse the segment to the origin.
  return { x: 2 * a.x - b.x, y: 2 * a.y - b.y, z: 2 * a.z - b.z };
}

/** Evaluate a whole control polygon at u in [0, segments]. */
export function evalSpline(cps: Vec3[], u: number, out: Vec3): Vec3 {
  const n = cps.length;
  const seg = Math.min(Math.max(Math.floor(u), 0), n - 2);
  const t = Math.min(Math.max(u - seg, 0), 1);
  const p1 = cps[seg];
  const p2 = cps[seg + 1];
  const p0 = seg - 1 >= 0 ? cps[seg - 1] : reflect(p1, p2);
  const p3 = seg + 2 <= n - 1 ? cps[seg + 2] : reflect(p2, p1);
  return catmullRom(p0, p1, p2, p3, t, out);
}
