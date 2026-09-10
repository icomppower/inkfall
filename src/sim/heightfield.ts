import { Rng, clamp, lerp, smoothstep } from './rng';
import { Noise2D } from './noise';
import { Course } from './course';
import { SECTIONS, RAVINE_S, RAVINE_WIDTH, RAVINE_DEPTH } from './constants';

/** Ribbon apron limits, shared with the render layer so the hole and the ribbon agree. */
export const RIBBON_APRON = 13;
export const RIBBON_MIN_APRON = 6;

export const GRID_N = 257;                 // 257² FBM heightfield, per spec
export const EROSION_DROPLETS = 14000;     // ≥ 10k

/**
 * Coarse 大帽山 massif. Built from the course elevation outward, roughened with
 * ridged multifractal noise, eroded hydraulically, then masked back down so the
 * terrain triangles never cover the trail apron.
 */
export class Heightfield {
  readonly n = GRID_N;
  readonly h = new Float32Array(GRID_N * GRID_N);
  /** Blend weight of the carved trail corridor, 1 = pure trail. Used by the render mask. */
  readonly trailMask = new Float32Array(GRID_N * GRID_N);
  /** Metres from the trail edge at each grid vertex; large means "nowhere near the trail". */
  readonly corridorEdge = new Float32Array(GRID_N * GRID_N).fill(1e6);
  /** How far past the trail edge the ribbon reaches at that vertex's nearest track point. */
  readonly corridorSpan = new Float32Array(GRID_N * GRID_N);
  readonly x0: number; readonly z0: number; readonly size: number; readonly cell: number;
  erodedDroplets = 0;

  constructor(course: Course, seed: string) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < course.px.length; i += 8) {
      minX = Math.min(minX, course.px[i]); maxX = Math.max(maxX, course.px[i]);
      minZ = Math.min(minZ, course.pz[i]); maxZ = Math.max(maxZ, course.pz[i]);
    }
    const pad = 620;
    const spanX = maxX - minX + pad * 2;
    const spanZ = maxZ - minZ + pad * 2;
    this.size = Math.max(spanX, spanZ);
    this.cell = this.size / (GRID_N - 1);
    this.x0 = (minX + maxX) * 0.5 - this.size * 0.5;
    this.z0 = (minZ + maxZ) * 0.5 - this.size * 0.5;

    this.buildBase(course, seed);
    this.erode(new Rng(`erode:${seed}`));
    // A cel ramp turns every erosion wrinkle into its own band boundary. Two light
    // smoothing passes keep the gullies and give the hillsides broad flat washes.
    this.smooth(2, 0.5);
    this.carveCourse(course);
  }

  private buildBase(course: Course, seed: string): void {
    const ridge = new Noise2D(`ridge:${seed}`);
    const hills = new Noise2D(`hills:${seed}`);
    const fine = new Noise2D(`fine:${seed}`);

    // Elevation trend, fitted to the course by inverse-distance weighting. Building the
    // massif as "rises with distance from the trail" instead puts the whole descent at
    // the bottom of a V-canyon; this way two switchback legs at different heights
    // produce the cross-slope between them all by themselves.
    const STRIDE = 16;                       // course samples every 8 m
    const n = course.px.length;
    const cxs: number[] = [], czs: number[] = [], cys: number[] = [];
    for (let i = 0; i < n; i += STRIDE) { cxs.push(course.px[i]); czs.push(course.pz[i]); cys.push(course.py[i]); }
    const m = cxs.length;
    const R2 = 90 * 90;

    for (let j = 0; j < GRID_N; j++) {
      for (let i = 0; i < GRID_N; i++) {
        const x = this.x0 + i * this.cell;
        const z = this.z0 + j * this.cell;
        let num = 0, den = 0, best = Infinity;
        for (let c = 0; c < m; c++) {
          const dx = cxs[c] - x, dz = czs[c] - z;
          const d2 = dx * dx + dz * dz;
          if (d2 < best) best = d2;
          // 1/(d²+R²)² is local enough that the trend actually passes through the course.
          // A plain 1/(d²+R²) kernel sags a hundred metres below the summit.
          const wd = 1 / (d2 + R2);
          const w = wd * wd;
          num += w * cys[c];
          den += w;
        }
        const trend = num / den;
        const d = Math.sqrt(best);
        const fade = smoothstep(14, 150, d);
        const r = (ridge.ridged(x * 0.00085, z * 0.00085, 6) - 0.42) * 120 * fade;
        const f = hills.fbm(x * 0.0031, z * 0.0031, 5) * 26 * fade;
        const g = fine.fbm(x * 0.0135, z * 0.0135, 3) * 1.6 * fade;
        this.h[j * GRID_N + i] = trend + r + f + g;
      }
    }
  }

  /** Droplet hydraulic erosion — carves gullies that read as 石澗 tributaries. */
  private erode(rng: Rng): void {
    const N = GRID_N;
    // Droplet erosion assumes vertical and horizontal units match. One grid step is
    // this.cell metres across, so work in cell units and scale back afterwards —
    // otherwise every droplet moves tens of metres of rock per step.
    const unit = this.cell;
    for (let i = 0; i < this.h.length; i++) this.h[i] /= unit;
    const inertia = 0.055, capacity = 3.4, deposition = 0.28, erosion = 0.32;
    const evaporation = 0.018, gravity = 10, minSlope = 0.0006, maxSteps = 42;
    const radius = 2;
    const wKernel: { dx: number; dy: number; w: number }[] = [];
    let wSum = 0;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const dist = Math.hypot(dx, dy);
        if (dist > radius) continue;
        const w = 1 - dist / radius;
        wKernel.push({ dx, dy, w });
        wSum += w;
      }
    }
    for (const k of wKernel) k.w /= wSum;

    const gradAt = (px: number, py: number) => {
      const ix = clamp(Math.floor(px), 0, N - 2), iy = clamp(Math.floor(py), 0, N - 2);
      const u = px - ix, v = py - iy;
      const h00 = this.h[iy * N + ix], h10 = this.h[iy * N + ix + 1];
      const h01 = this.h[(iy + 1) * N + ix], h11 = this.h[(iy + 1) * N + ix + 1];
      return {
        gx: (h10 - h00) * (1 - v) + (h11 - h01) * v,
        gy: (h01 - h00) * (1 - u) + (h11 - h10) * u,
        h: h00 * (1 - u) * (1 - v) + h10 * u * (1 - v) + h01 * (1 - u) * v + h11 * u * v,
        ix, iy, u, v,
      };
    };
    const deposit = (ix: number, iy: number, u: number, v: number, amount: number) => {
      this.h[iy * N + ix] += amount * (1 - u) * (1 - v);
      this.h[iy * N + ix + 1] += amount * u * (1 - v);
      this.h[(iy + 1) * N + ix] += amount * (1 - u) * v;
      this.h[(iy + 1) * N + ix + 1] += amount * u * v;
    };

    for (let drop = 0; drop < EROSION_DROPLETS; drop++) {
      let px = rng.range(radius + 1, N - radius - 2);
      let py = rng.range(radius + 1, N - radius - 2);
      let dx = 0, dy = 0, speed = 1, water = 1, sediment = 0;
      for (let step = 0; step < maxSteps; step++) {
        const g = gradAt(px, py);
        dx = dx * inertia - g.gx * (1 - inertia);
        dy = dy * inertia - g.gy * (1 - inertia);
        const dl = Math.hypot(dx, dy);
        if (dl < 1e-6) break;
        dx /= dl; dy /= dl;
        const nx = px + dx, ny = py + dy;
        if (nx < radius + 1 || nx > N - radius - 2 || ny < radius + 1 || ny > N - radius - 2) break;
        const g2 = gradAt(nx, ny);
        const dh = g2.h - g.h;
        const cap = Math.max(-dh, minSlope) * speed * water * capacity;
        if (sediment > cap || dh > 0) {
          const amount = dh > 0 ? Math.min(dh, sediment) : (sediment - cap) * deposition;
          sediment -= amount;
          deposit(g.ix, g.iy, g.u, g.v, amount);
        } else {
          const amount = Math.min((cap - sediment) * erosion, -dh);
          sediment += amount;
          for (const k of wKernel) {
            const kx = g.ix + k.dx, ky = g.iy + k.dy;
            if (kx < 0 || ky < 0 || kx >= N || ky >= N) continue;
            this.h[ky * N + kx] -= amount * k.w;
          }
        }
        speed = Math.sqrt(Math.max(0, speed * speed + -dh * gravity));
        water *= 1 - evaporation;
        px = nx; py = ny;
      }
      this.erodedDroplets++;
    }
    for (let i = 0; i < this.h.length; i++) this.h[i] *= unit;
  }

  /** Separable-ish 3x3 relaxation. Keeps large forms, drops single-cell wrinkles. */
  private smooth(passes: number, amount: number): void {
    const N = GRID_N;
    const tmp = new Float32Array(this.h.length);
    for (let p = 0; p < passes; p++) {
      tmp.set(this.h);
      for (let j = 1; j < N - 1; j++) {
        for (let i = 1; i < N - 1; i++) {
          const k = j * N + i;
          // Weights must sum to exactly 1, or every pass scales the whole massif.
          const avg = (tmp[k - 1] + tmp[k + 1] + tmp[k - N] + tmp[k + N]) * 0.125
                    + (tmp[k - N - 1] + tmp[k - N + 1] + tmp[k + N - 1] + tmp[k + N + 1]) * 0.0625
                    + tmp[k] * 0.25;
          this.h[k] = tmp[k] + (avg - tmp[k]) * amount;
        }
      }
    }
  }

  /**
   * Course mask: flatten the corridor back to the authoritative trail surface and blend
   * outward, so no coarse triangle pokes through the apron. Also cuts the 芒草坡 cliff.
   */
  private carveCourse(course: Course): void {
    const CORRIDOR = 11.0;     // metres of apron held flat at trail level
    const BLEND = 50;
    const MARGIN = 1.10;   // the corridor is a cut: terrain sits below the trail surface
    const gi = course.idx(RAVINE_S);
    const gorgeX = course.centreX(RAVINE_S), gorgeZ = course.centreZ(RAVINE_S);
    const gorgeY = course.centreY(RAVINE_S);
    const gorgeTX = course.tx[gi], gorgeTZ = course.tz[gi];
    for (let j = 0; j < GRID_N; j++) {
      for (let i = 0; i < GRID_N; i++) {
        const x = this.x0 + i * this.cell;
        const z = this.z0 + j * this.cell;
        const near = course.nearest(x, z);
        const halfW = course.widthAt(near.s) * 0.5;
        const lat = clamp(near.lateral, -halfW, halfW);
        const edge = Math.abs(near.lateral) - halfW;
        const k = j * GRID_N + i;
        if (edge > BLEND) { this.trailMask[k] = 0; continue; }
        const trailY = course.surfaceHeight(near.s, lat);
        let target = trailY - MARGIN;
        if (edge > CORRIDOR) {
          // Beyond the apron, run out to the surrounding land.
          const t = smoothstep(CORRIDOR, BLEND, edge);
          target = lerp(trailY - MARGIN, this.h[k], t * t);
        }
        const w = clamp(1 - smoothstep(CORRIDOR, BLEND, Math.max(edge, 0)), 0, 1);
        this.h[k] = lerp(this.h[k], target, w);
        this.trailMask[k] = w;
        this.corridorEdge[k] = edge;
        this.corridorSpan[k] = course.ribbonSpan(near.s, RIBBON_APRON, RIBBON_MIN_APRON) - halfW;

        // 竹林峽 gorge: the stream cut the trail in two. Carve it as a band across the
        // track so the ravine reads as a real hole rather than a painted gap.
        {
          const along = Math.abs((x - gorgeX) * gorgeTX + (z - gorgeZ) * gorgeTZ);
          const half = RAVINE_WIDTH * 0.5;
          if (along < half + 14) {
            const t = 1 - smoothstep(half - 1, half + 14, along);
            const floor = gorgeY - RAVINE_DEPTH;
            this.h[k] = Math.min(this.h[k], lerp(this.h[k], floor, t));
          }
        }

        // Cliff on the left of 芒草坡: the land simply stops.
        const sec = SECTIONS[course.sectionAt(near.s).index];
        if (sec.index === 1 && near.lateral < -(halfW + 2)) {
          const fall = clamp((-near.lateral - halfW - 2) / 34, 0, 1);
          this.h[k] -= 96 * fall * fall;
        }
      }
    }
  }

  heightAt(x: number, z: number): number {
    const fx = clamp((x - this.x0) / this.cell, 0, GRID_N - 1.001);
    const fz = clamp((z - this.z0) / this.cell, 0, GRID_N - 1.001);
    const ix = Math.floor(fx), iz = Math.floor(fz);
    const u = fx - ix, v = fz - iz;
    const h00 = this.h[iz * GRID_N + ix], h10 = this.h[iz * GRID_N + ix + 1];
    const h01 = this.h[(iz + 1) * GRID_N + ix], h11 = this.h[(iz + 1) * GRID_N + ix + 1];
    return h00 * (1 - u) * (1 - v) + h10 * u * (1 - v) + h01 * (1 - u) * v + h11 * u * v;
  }

  maskAt(x: number, z: number): number {
    const fx = clamp((x - this.x0) / this.cell, 0, GRID_N - 1.001);
    const fz = clamp((z - this.z0) / this.cell, 0, GRID_N - 1.001);
    return this.trailMask[Math.round(fz) * GRID_N + Math.round(fx)];
  }

  slopeAt(x: number, z: number): number {
    const d = this.cell;
    const hx = this.heightAt(x + d, z) - this.heightAt(x - d, z);
    const hz = this.heightAt(x, z + d) - this.heightAt(x, z - d);
    return Math.hypot(hx, hz) / (2 * d);
  }
}
