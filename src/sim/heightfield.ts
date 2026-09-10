import { Rng, clamp, lerp, smoothstep } from './rng';
import { Noise2D } from './noise';
import { Course } from './course';
import { SECTIONS, RAVINE_S, RAVINE_WIDTH, RAVINE_DEPTH } from './constants';

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
    this.carveCourse(course);
  }

  private buildBase(course: Course, seed: string): void {
    const ridge = new Noise2D(`ridge:${seed}`);
    const hills = new Noise2D(`hills:${seed}`);
    const fine = new Noise2D(`fine:${seed}`);
    for (let j = 0; j < GRID_N; j++) {
      for (let i = 0; i < GRID_N; i++) {
        const x = this.x0 + i * this.cell;
        const z = this.z0 + j * this.cell;
        const near = course.nearest(x, z);
        const d = near.dist;
        const trailY = course.centreY(near.s);
        // Hillsides rise away from the trail and flatten out into the massif.
        const rise = 168 * (1 - Math.exp(-d / 235));
        const fade = 1 - Math.exp(-d / 130);
        const r = (ridge.ridged(x * 0.00085, z * 0.00085, 6) - 0.42) * 96 * fade;
        const f = hills.fbm(x * 0.0031, z * 0.0031, 5) * 19 * fade;
        const g = fine.fbm(x * 0.0135, z * 0.0135, 3) * 4.2 * fade;
        this.h[j * GRID_N + i] = trailY + rise + r + f + g;
      }
    }
  }

  /** Droplet hydraulic erosion — carves gullies that read as 石澗 tributaries. */
  private erode(rng: Rng): void {
    const N = GRID_N;
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
  }

  /**
   * Course mask: flatten the corridor back to the authoritative trail surface and blend
   * outward, so no coarse triangle pokes through the apron. Also cuts the 芒草坡 cliff.
   */
  private carveCourse(course: Course): void {
    const CORRIDOR = 4.0;      // metres of apron beyond the trail edge
    const BLEND = 62;
    // A query point inside a cell is at most cell*sqrt(2) from any of its corners, so a
    // corner carved to the lowest trail surface within that radius can never interpolate
    // above the trail. This is what stops coarse triangles covering the apron.
    const REACH = this.cell * Math.SQRT2 * 1.15;
    const MARGIN = 0.32;
    const scratch: number[] = [];
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
        const w = 1 - smoothstep(CORRIDOR, BLEND, Math.max(edge, 0));
        this.h[k] = lerp(this.h[k], target, clamp(w, 0, 1));
        this.trailMask[k] = clamp(w, 0, 1);
        if (edge < REACH + halfW) {
          const lo = course.lowestNearbySurface(x, z, REACH, scratch);
          if (Number.isFinite(lo) && this.h[k] > lo - MARGIN) this.h[k] = lo - MARGIN;
        }

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
