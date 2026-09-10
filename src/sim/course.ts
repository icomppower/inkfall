import { Rng, clamp, lerp, smoothstep } from './rng';
import { Noise2D } from './noise';
import { evalSpline, v3, type Vec3 } from './spline';
import {
  COURSE_LENGTH, SUMMIT_Y, SECTIONS, SURFACES, TABLETOPS, STEP_DOWN_S, STEP_DOWN_DROP,
  RAVINE_S, RAVINE_WIDTH, RAVINE_LIP_RUN, RAVINE_LIP_RISE, RAVINE_DEPTH,
  BRIDGE_S, BRIDGE_LEN, ROCK_DROPS, ROCK_DROP_HEIGHT,
  type SurfaceType, type SectionDef,
} from './constants';

export const TABLE_DS = 0.5;
const TABLE_N = Math.round(COURSE_LENGTH / TABLE_DS) + 1;

export interface SampleOut {
  height: number;
  nx: number; ny: number; nz: number;
  surface: SurfaceType;
  camber: number;
  width: number;
  /** True when the lateral offset is off the prepared trail. */
  offTrail: boolean;
  /** True when there is no ground at all (ravine). */
  voidGap: boolean;
  rough: number;
}

interface CurveSeg { len: number; kappa: number; }

/**
 * Curvature schedule: the course design, one run of segments per section. Each section's
 * schedule is normalised onto that section's own arc length so the designed features stay
 * where the section table says they are.
 */
function curvatureSchedule(rng: Rng): CurveSeg[][] {
  const perSection: CurveSeg[][] = [];
  let dir = rng.next() < 0.5 ? 1 : -1;
  const run = (build: (push: (len: number, kappa: number) => void) => void): void => {
    const segs: CurveSeg[] = [];
    build((len, kappa) => { if (len > 0) segs.push({ len, kappa }); });
    perSection.push(segs);
  };

  // 1. 雷達站 — five tarmac switchbacks off the radar apron. Wide enough hairpins that
  //    the hillside between two legs stays a slope and not a wall.
  run((push) => {
    push(30, 0);
    for (let i = 0; i < 5; i++) {
      const r = rng.range(16.5, 19.5);
      push(r * rng.range(2.85, 3.05), dir / r);   // ~170° hairpin
      push(rng.range(30, 42), 0);
      dir = -dir;
    }
  });

  // 2. 芒草坡 — long fast sweepers on an exposed ridge.
  run((push) => {
    for (let i = 0; i < 6; i++) {
      const r = rng.range(70, 135);
      push(rng.range(55, 95), dir / r);
      push(rng.range(16, 34), 0);
      dir = -dir;
    }
  });

  // 3. 石澗 — the stream bed wanders; wide radii, boulder-forced kinks.
  run((push) => {
    for (let i = 0; i < 7; i++) {
      const r = rng.range(95, 210);
      push(rng.range(38, 70), dir / r);
      push(rng.range(12, 26), 0);
      if (rng.next() < 0.6) dir = -dir;
    }
  });

  // 4. 茶園 — the jump line wants straight run-ups; bends only between tabletops.
  run((push) => {
    for (let i = 0; i < 5; i++) {
      push(rng.range(52, 78), 0);
      push(rng.range(24, 40), dir / rng.range(120, 240));
      dir = -dir;
    }
  });

  // 5. 竹林峽 — bamboo forces a tight line, but the ravine approach is dead straight.
  run((push) => {
    for (let i = 0; i < 5; i++) {
      push(rng.range(30, 52), dir / rng.range(60, 130));
      push(rng.range(22, 44), 0);
      dir = -dir;
    }
  });

  // 6. 川龍村 — village lane, almost straight to the banner.
  run((push) => {
    for (let i = 0; i < 3; i++) {
      push(rng.range(45, 75), dir / rng.range(150, 300));
      push(rng.range(18, 32), 0);
      dir = -dir;
    }
  });
  return perSection;
}

/** Curvature at arc position s, with each section's schedule stretched onto that section. */
function kappaAtSection(perSection: CurveSeg[][], s: number): number {
  const sec = sectionAt(s);
  const segs = perSection[sec.index];
  const total = segs.reduce((a, b) => a + b.len, 0) || 1;
  const secLen = sec.end - sec.start;
  const scale = secLen / total;          // schedule metres → course metres
  const local = (s - sec.start) / scale;
  let acc = 0;
  for (const seg of segs) {
    if (local < acc + seg.len) return seg.kappa / scale;
    acc += seg.len;
  }
  return 0;
}

/** Flatten curvature near jump lips so nobody launches into a corner. */
function straightenZones(): { s: number; half: number }[] {
  const z: { s: number; half: number }[] = [];
  for (const t of TABLETOPS) z.push({ s: t.s, half: t.lipRun + t.deck + 22 });
  z.push({ s: RAVINE_S, half: RAVINE_WIDTH + 34 });
  z.push({ s: STEP_DOWN_S, half: 20 });
  z.push({ s: BRIDGE_S, half: BRIDGE_LEN * 0.5 + 10 });
  return z;
}

export class Course {
  readonly seed: string;
  readonly length = COURSE_LENGTH;
  readonly controlPoints: Vec3[] = [];

  // Dense arc-length table (TABLE_DS metre spacing).
  readonly px = new Float64Array(TABLE_N);
  readonly py = new Float64Array(TABLE_N);
  readonly pz = new Float64Array(TABLE_N);
  readonly tx = new Float64Array(TABLE_N);   // unit horizontal tangent
  readonly tz = new Float64Array(TABLE_N);
  readonly ty = new Float64Array(TABLE_N);   // vertical component of the 3D tangent
  readonly rx = new Float64Array(TABLE_N);   // lateral (rider's right)
  readonly rz = new Float64Array(TABLE_N);
  readonly kap = new Float64Array(TABLE_N);
  readonly wid = new Float64Array(TABLE_N);
  readonly cam = new Float64Array(TABLE_N);
  readonly sec = new Uint8Array(TABLE_N);

  private roughNoise: Noise2D;
  private undulate: Noise2D;
  /** Spatial hash of table indices for nearestS queries. */
  private cellSize = 40;
  private buckets = new Map<number, number[]>();
  private minX = 0; private minZ = 0;

  constructor(seed: string) {
    this.seed = seed;
    const rng = new Rng(`course:${seed}`);
    this.roughNoise = new Noise2D(`rough:${seed}`);
    this.undulate = new Noise2D(`undulate:${seed}`);

    const segs = curvatureSchedule(rng);
    const raw = this.integratePlan(segs, rng);
    this.buildControlPoints(raw, rng);
    this.buildTable();
    this.buildIndex();
  }

  /** Walk the curvature schedule at 1 m steps to get the plan-view centreline. */
  private integratePlan(perSection: CurveSeg[][], rng: Rng): { x: number; z: number; y: number; k: number }[] {
    const zones = straightenZones();
    const wobble = new Noise2D(`wobble:${seed_(rng)}`);

    // Elevation: per-section drop, redistributed with a little seeded undulation.
    const yProfile = new Float64Array(COURSE_LENGTH + 1);
    let y = SUMMIT_Y;
    yProfile[0] = y;
    for (const sec of SECTIONS) {
      const n = sec.end - sec.start;
      const w = new Float64Array(n);
      let sum = 0;
      for (let i = 0; i < n; i++) {
        const s = sec.start + i;
        w[i] = 1 + 0.42 * this.undulate.fbm(s * 0.0032, 7.7, 3);
        if (w[i] < 0.25) w[i] = 0.25;
        sum += w[i];
      }
      for (let i = 0; i < n; i++) {
        y -= (sec.drop * w[i]) / sum;
        yProfile[sec.start + i + 1] = y;
      }
    }

    const out: { x: number; z: number; y: number; k: number }[] = [];
    let px = 0, pz = 0, theta = 0;
    for (let s = 0; s <= COURSE_LENGTH; s++) {
      let k = kappaAtSection(perSection, s);
      // Micro-wander so straights never read as CAD lines.
      k += 0.0016 * wobble.fbm(s * 0.0071, 3.1, 2);
      for (const z of zones) {
        const d = Math.abs(s - z.s);
        if (d < z.half) k *= smoothstep(0, 1, d / z.half) * 0.85;
      }
      out.push({ x: px, z: pz, y: yProfile[Math.min(s, COURSE_LENGTH)], k });
      // Heading 0 points down −Z; positive kappa turns toward +X (rider's right).
      const dx = Math.sin(theta), dz = -Math.cos(theta);
      px += dx; pz += dz;
      theta += k;
    }
    return out;
  }

  /** Non-uniform control points: dense through hairpins, sparse on straights. */
  private buildControlPoints(raw: { x: number; z: number; y: number; k: number }[], _rng: Rng): void {
    const cps: Vec3[] = [v3(raw[0].x, raw[0].y, raw[0].z)];
    let lastIdx = 0, dTheta = 0;
    for (let i = 1; i < raw.length; i++) {
      dTheta += Math.abs(raw[i].k);
      const dist = i - lastIdx;
      if ((dist >= 10 && dTheta >= 0.22) || dist >= 45) {
        cps.push(v3(raw[i].x, raw[i].y, raw[i].z));
        lastIdx = i; dTheta = 0;
      }
    }
    const last = raw[raw.length - 1];
    if (lastIdx !== raw.length - 1) cps.push(v3(last.x, last.y, last.z));

    // Orient the whole descent so start→finish runs down world −Z, per the course brief.
    {
      const a = cps[0], b = cps[cps.length - 1];
      const ang = Math.atan2(b.x - a.x, -(b.z - a.z));   // heading of the net descent
      const c = Math.cos(ang), sn = Math.sin(ang);
      for (const p of cps) {
        const dx = p.x - a.x, dz = p.z - a.z;
        p.x = a.x + dx * c + dz * sn;
        p.z = a.z + dz * c - dx * sn;
      }
    }

    // Iterate a planar scale so the spline's true 3D arc length lands on 2300 m.
    for (let pass = 0; pass < 4; pass++) {
      const L = splineLength(cps);
      const f = COURSE_LENGTH / L;
      if (Math.abs(f - 1) < 1e-5) break;
      // Only x/z scale — the elevation profile is a design decision, not a free parameter.
      const cx = cps[0].x, cz = cps[0].z;
      for (const p of cps) { p.x = cx + (p.x - cx) * f; p.z = cz + (p.z - cz) * f; }
    }
    this.controlPoints.push(...cps);
  }

  /** Resample the spline uniformly in arc length, then attach width / camber / surface. */
  private buildTable(): void {
    const cps = this.controlPoints;
    const segCount = cps.length - 1;
    const FINE = 24;                          // sub-samples per control segment
    const fine: Vec3[] = [];
    const arc: number[] = [0];
    const tmp = v3();
    for (let i = 0; i <= segCount * FINE; i++) {
      const p = v3();
      evalSpline(cps, i / FINE, p);
      fine.push(p);
      if (i > 0) {
        const a = fine[i - 1];
        arc.push(arc[i - 1] + Math.hypot(p.x - a.x, p.y - a.y, p.z - a.z));
      }
    }
    const total = arc[arc.length - 1];
    let cursor = 0;
    for (let i = 0; i < TABLE_N; i++) {
      const target = (i / (TABLE_N - 1)) * total;
      while (cursor < arc.length - 2 && arc[cursor + 1] < target) cursor++;
      const span = arc[cursor + 1] - arc[cursor] || 1e-9;
      const t = (target - arc[cursor]) / span;
      const a = fine[cursor], b = fine[cursor + 1];
      this.px[i] = lerp(a.x, b.x, t);
      this.py[i] = lerp(a.y, b.y, t);
      this.pz[i] = lerp(a.z, b.z, t);
      void tmp;
    }
    // Tangents, lateral basis, curvature.
    for (let i = 0; i < TABLE_N; i++) {
      const i0 = Math.max(0, i - 1), i1 = Math.min(TABLE_N - 1, i + 1);
      let dx = this.px[i1] - this.px[i0];
      let dy = this.py[i1] - this.py[i0];
      let dz = this.pz[i1] - this.pz[i0];
      const len3 = Math.hypot(dx, dy, dz) || 1e-9;
      dx /= len3; dy /= len3; dz /= len3;
      const hl = Math.hypot(dx, dz) || 1e-9;
      this.tx[i] = dx / hl; this.tz[i] = dz / hl; this.ty[i] = dy;
      this.rx[i] = -this.tz[i]; this.rz[i] = this.tx[i];
    }
    for (let i = 0; i < TABLE_N; i++) {
      const i0 = Math.max(0, i - 2), i1 = Math.min(TABLE_N - 1, i + 2);
      const a0 = Math.atan2(this.tx[i0], -this.tz[i0]);
      const a1 = Math.atan2(this.tx[i1], -this.tz[i1]);
      let da = a1 - a0;
      while (da > Math.PI) da -= 2 * Math.PI;
      while (da < -Math.PI) da += 2 * Math.PI;
      this.kap[i] = da / ((i1 - i0) * TABLE_DS);
    }
    // Width, camber, section id.
    const cambNoise = new Noise2D(`camber:${this.seed}`);
    for (let i = 0; i < TABLE_N; i++) {
      const s = i * TABLE_DS;
      const sec = sectionAt(s);
      this.sec[i] = sec.index;
      let w = sec.width;
      // Taper across section joins so the trail never steps in width.
      const dEdge = Math.min(s - sec.start, sec.end - s);
      if (dEdge < 25) {
        const other = sectionAt(s - sec.start < sec.end - s ? Math.max(0, sec.start - 1) : Math.min(COURSE_LENGTH, sec.end + 1));
        w = lerp((sec.width + other.width) * 0.5, sec.width, smoothstep(0, 25, dEdge));
      }
      // Hairpins pinch, the jump line opens up.
      w *= 1 - 0.18 * clamp(Math.abs(this.kap[i]) * 12, 0, 1);
      this.wid[i] = w;

      const k = this.kap[i];
      const bank = clamp(Math.abs(k) * 4.4, 0, 1);
      let camber = -Math.sign(k) * bank * 0.34;                 // berm: outside of the turn rides high
      if (sec.index === 1) {
        // 芒草坡 is deliberately off-camber in places, and falls away toward the cliff on the left.
        const off = 0.5 + 0.5 * cambNoise.fbm(s * 0.004, 2.3, 2);
        camber = lerp(camber, -camber * 0.9, off) - 0.055;
      }
      this.cam[i] = camber;
    }
  }

  private buildIndex(): void {
    let minX = Infinity, minZ = Infinity;
    for (let i = 0; i < TABLE_N; i++) {
      if (this.px[i] < minX) minX = this.px[i];
      if (this.pz[i] < minZ) minZ = this.pz[i];
    }
    this.minX = minX - 1; this.minZ = minZ - 1;
    for (let i = 0; i < TABLE_N; i += 4) {
      const key = this.cellKey(this.px[i], this.pz[i]);
      let b = this.buckets.get(key);
      if (!b) { b = []; this.buckets.set(key, b); }
      b.push(i);
    }
  }

  private cellKey(x: number, z: number): number {
    const cx = Math.floor((x - this.minX) / this.cellSize);
    const cz = Math.floor((z - this.minZ) / this.cellSize);
    return cx * 8192 + cz;
  }

  /** Nearest point on the centreline. Returns arc position and signed lateral offset. */
  nearest(x: number, z: number): { s: number; lateral: number; dist: number } {
    const cx = Math.floor((x - this.minX) / this.cellSize);
    const cz = Math.floor((z - this.minZ) / this.cellSize);
    let bestI = -1, bestD = Infinity;
    for (let r = 1; r <= 6 && bestI < 0; r++) {
      for (let a = -r; a <= r; a++) {
        for (let b = -r; b <= r; b++) {
          if (r > 1 && Math.abs(a) !== r && Math.abs(b) !== r) continue;
          const bucket = this.buckets.get((cx + a) * 8192 + (cz + b));
          if (!bucket) continue;
          for (const i of bucket) {
            const d = (this.px[i] - x) ** 2 + (this.pz[i] - z) ** 2;
            if (d < bestD) { bestD = d; bestI = i; }
          }
        }
      }
    }
    if (bestI < 0) {
      for (let i = 0; i < TABLE_N; i += 8) {
        const d = (this.px[i] - x) ** 2 + (this.pz[i] - z) ** 2;
        if (d < bestD) { bestD = d; bestI = i; }
      }
    }
    // Refine locally.
    let bi = bestI;
    for (let i = Math.max(0, bestI - 8); i <= Math.min(TABLE_N - 1, bestI + 8); i++) {
      const d = (this.px[i] - x) ** 2 + (this.pz[i] - z) ** 2;
      if (d < bestD) { bestD = d; bi = i; }
    }
    const s = bi * TABLE_DS;
    const lateral = (x - this.px[bi]) * this.rx[bi] + (z - this.pz[bi]) * this.rz[bi];
    return { s, lateral, dist: Math.sqrt(bestD) };
  }

  /** Table indices whose centreline point lies within `radius` of (x, z). */
  nearbyIndices(x: number, z: number, radius: number, out: number[]): number[] {
    out.length = 0;
    const r = Math.ceil(radius / this.cellSize);
    const cx = Math.floor((x - this.minX) / this.cellSize);
    const cz = Math.floor((z - this.minZ) / this.cellSize);
    const r2 = radius * radius;
    for (let a = -r; a <= r; a++) {
      for (let b = -r; b <= r; b++) {
        const bucket = this.buckets.get((cx + a) * 8192 + (cz + b));
        if (!bucket) continue;
        for (const i of bucket) {
          if ((this.px[i] - x) ** 2 + (this.pz[i] - z) ** 2 <= r2) out.push(i);
        }
      }
    }
    return out;
  }

  /** Lowest trail surface within reach of a point — the conservative carve target. */
  lowestNearbySurface(x: number, z: number, radius: number, scratch: number[]): number {
    const list = this.nearbyIndices(x, z, radius, scratch);
    let lo = Infinity;
    for (const i of list) {
      const s = i * TABLE_DS;
      const halfW = this.wid[i] * 0.5;
      let lat = (x - this.px[i]) * this.rx[i] + (z - this.pz[i]) * this.rz[i];
      lat = clamp(lat, -halfW, halfW);
      if (this.isVoid(s, lat)) continue;
      const h = this.surfaceHeight(s, lat);
      if (h < lo) lo = h;
    }
    return lo;
  }

  idx(s: number): number {
    return clamp(Math.round(s / TABLE_DS), 0, TABLE_N - 1);
  }

  centreY(s: number): number {
    const f = clamp(s / TABLE_DS, 0, TABLE_N - 1);
    const i = Math.floor(f), t = f - i;
    const j = Math.min(i + 1, TABLE_N - 1);
    return lerp(this.py[i], this.py[j], t);
  }

  /** World position of a track coordinate, ignoring feature relief. */
  centreX(s: number): number {
    const f = clamp(s / TABLE_DS, 0, TABLE_N - 1);
    const i = Math.floor(f), t = f - i, j = Math.min(i + 1, TABLE_N - 1);
    return lerp(this.px[i], this.px[j], t);
  }
  centreZ(s: number): number {
    const f = clamp(s / TABLE_DS, 0, TABLE_N - 1);
    const i = Math.floor(f), t = f - i, j = Math.min(i + 1, TABLE_N - 1);
    return lerp(this.pz[i], this.pz[j], t);
  }
  widthAt(s: number): number { return this.wid[this.idx(s)]; }
  curvatureAt(s: number): number { return this.kap[this.idx(s)]; }
  camberAt(s: number): number { return this.cam[this.idx(s)]; }
  sectionAt(s: number): SectionDef { return sectionAt(s); }

  toWorld(s: number, lateral: number, out: { x: number; y: number; z: number }, height?: number): void {
    const i = this.idx(s);
    out.x = this.centreX(s) + lateral * this.rx[i];
    out.z = this.centreZ(s) + lateral * this.rz[i];
    out.y = height !== undefined ? height : this.surfaceHeight(s, lateral);
  }

  /** Surface type at a track coordinate. */
  surfaceAt(s: number, lateral: number): SurfaceType {
    if (this.isVoid(s, lateral)) return 'void';
    if (Math.abs(s - BRIDGE_S) < BRIDGE_LEN * 0.5) return 'wood';
    const sec = sectionAt(s);
    if (sec.index === 2 && lateral < -1.0) return 'rock';   // low line: raw stream bed
    return sec.surface;
  }

  isVoid(s: number, lateral: number): boolean {
    const half = RAVINE_WIDTH * 0.5;
    if (Math.abs(s - RAVINE_S) > half) return false;
    // The ravine spans the full trail width — no chicken line.
    return Math.abs(lateral) < this.widthAt(s) * 0.5 + 14;
  }

  /** Relief added on top of the spline: lips, decks, ledges, the step-down. */
  featureHeight(s: number): number {
    let h = 0;
    for (const t of TABLETOPS) {
      const half = t.deck * 0.5;
      const d = s - t.s;
      if (d < -half - t.lipRun || d > half + t.lipRun * 0.9) continue;
      if (d < -half) h += t.lipRise * smoothstep(0, 1, (d + half + t.lipRun) / t.lipRun);
      else if (d <= half) h += t.lipRise;
      else h += t.lipRise * (1 - smoothstep(0, 1, (d - half) / (t.lipRun * 0.9)));
    }
    // Ravine take-off lip.
    {
      const lipStart = RAVINE_S - RAVINE_WIDTH * 0.5 - RAVINE_LIP_RUN;
      const lipEnd = RAVINE_S - RAVINE_WIDTH * 0.5;
      if (s > lipStart && s < lipEnd) h += RAVINE_LIP_RISE * smoothstep(0, 1, (s - lipStart) / RAVINE_LIP_RUN);
      else if (s >= lipEnd && s < RAVINE_S + RAVINE_WIDTH * 0.5 + 6) {
        h += RAVINE_LIP_RISE * (1 - smoothstep(0, 1, (s - RAVINE_S - RAVINE_WIDTH * 0.5) / 6));
      }
    }
    // Terrace step-down: the trail runs flat to a wall edge and drops.
    if (s > STEP_DOWN_S - 14 && s < STEP_DOWN_S) h += STEP_DOWN_DROP * smoothstep(0, 1, (s - (STEP_DOWN_S - 14)) / 14);
    else if (s >= STEP_DOWN_S && s < STEP_DOWN_S + 1.2) h += STEP_DOWN_DROP * (1 - (s - STEP_DOWN_S) / 1.2);
    // 300 mm rock ledges.
    for (const r of ROCK_DROPS) {
      if (s > r - 9 && s < r) h += ROCK_DROP_HEIGHT * smoothstep(0, 1, (s - (r - 9)) / 9);
      else if (s >= r && s < r + 0.6) h += ROCK_DROP_HEIGHT * (1 - (s - r) / 0.6);
    }
    // Footbridge deck sits proud of the stream cut.
    {
      const d = Math.abs(s - BRIDGE_S);
      if (d < BRIDGE_LEN * 0.5 + 5) h += 0.9 * smoothstep(BRIDGE_LEN * 0.5 + 5, BRIDGE_LEN * 0.35, d);
    }
    return h;
  }

  /** Deterministic micro-relief. Rough on the 石澗 low line, glassy on tarmac. */
  roughHeight(s: number, lateral: number): number {
    const surf = this.surfaceAt(s, lateral);
    let amp = SURFACES[surf].rough;
    const sec = sectionAt(s);
    if (sec.index === 2) amp *= lateral < -1.0 ? 1.55 : 0.45;   // low line raw, high line groomed
    if (amp <= 0.0001) return 0;
    const n = this.roughNoise.fbm(s * 0.85, lateral * 0.85, 3)
            + 0.45 * this.roughNoise.at(s * 3.1, lateral * 2.7);
    return amp * n;
  }

  surfaceHeight(s: number, lateral: number): number {
    if (this.isVoid(s, lateral)) return this.centreY(s) + this.featureHeight(s) - RAVINE_DEPTH;
    return this.centreY(s) + this.featureHeight(s)
         + lateral * this.camberAt(s)
         + this.roughHeight(s, lateral);
  }

  /** The authoritative track query. */
  sample(s: number, lateral: number, out: SampleOut): SampleOut {
    const sc = clamp(s, 0, COURSE_LENGTH);
    const h = this.surfaceHeight(sc, lateral);
    const d = 0.35;
    const hs1 = this.surfaceHeight(clamp(sc + d, 0, COURSE_LENGTH), lateral);
    const hs0 = this.surfaceHeight(clamp(sc - d, 0, COURSE_LENGTH), lateral);
    const hl1 = this.surfaceHeight(sc, lateral + d);
    const hl0 = this.surfaceHeight(sc, lateral - d);
    const dhds = (hs1 - hs0) / (2 * d);
    const dhdl = (hl1 - hl0) / (2 * d);
    const i = this.idx(sc);
    const ax = this.tx[i], ay = dhds, az = this.tz[i];
    const bx = this.rx[i], by = dhdl, bz = this.rz[i];
    // n = B × A, which points up for a level surface.
    let nx = by * az - bz * ay;
    let ny = bz * ax - bx * az;
    let nz = bx * ay - by * ax;
    const nl = Math.hypot(nx, ny, nz) || 1e-9;
    nx /= nl; ny /= nl; nz /= nl;
    if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }

    out.height = h;
    out.nx = nx; out.ny = ny; out.nz = nz;
    out.surface = this.surfaceAt(sc, lateral);
    out.camber = this.camberAt(sc);
    out.width = this.widthAt(sc);
    out.offTrail = Math.abs(lateral) > out.width * 0.5;
    out.voidGap = out.surface === 'void';
    out.rough = SURFACES[out.surface].rough;
    return out;
  }
}

export function sectionAt(s: number): SectionDef {
  for (const sec of SECTIONS) if (s < sec.end) return sec;
  return SECTIONS[SECTIONS.length - 1];
}

export function makeSample(): SampleOut {
  return { height: 0, nx: 0, ny: 1, nz: 0, surface: 'dirt', camber: 0, width: 8, offTrail: false, voidGap: false, rough: 0 };
}

function splineLength(cps: Vec3[]): number {
  const p = v3(), q = v3();
  let L = 0;
  const segs = cps.length - 1;
  evalSpline(cps, 0, p);
  for (let i = 1; i <= segs * 24; i++) {
    evalSpline(cps, i / 24, q);
    L += Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z);
    p.x = q.x; p.y = q.y; p.z = q.z;
  }
  return L;
}

/** Derive a stable sub-seed from an RNG stream position without consuming design randomness. */
function seed_(rng: Rng): number {
  return Math.floor(rng.next() * 0xffffffff);
}
