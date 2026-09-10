import * as THREE from 'three';
import type { World } from '../sim/world';
import { GRID_N } from '../sim/heightfield';

/**
 * The corridor hole. A terrain triangle is dropped when every one of its vertices lies
 * inside the ribbon's own apron, so the hole can never be larger than what the ribbon
 * covers. Hairpins narrow the ribbon, and the hole narrows with it.
 */
const HOLE_SLACK = 2.0;

export interface TerrainBuild { geometry: THREE.BufferGeometry; droppedTriangles: number; }

/** Coarse massif mesh with the trail corridor cut out of it. */
export function buildTerrain(world: World): TerrainBuild {
  const hf = world.terrain;
  const n = GRID_N;
  const positions = new Float32Array(n * n * 3);
  const normals = new Float32Array(n * n * 3);
  const uvs = new Float32Array(n * n * 2);
  const slope = new Float32Array(n * n);

  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      positions[k * 3] = hf.x0 + i * hf.cell;
      positions[k * 3 + 1] = hf.h[k];
      positions[k * 3 + 2] = hf.z0 + j * hf.cell;
      uvs[k * 2] = i / (n - 1); uvs[k * 2 + 1] = j / (n - 1);
    }
  }
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      // Two-cell gradient: the toon ramp turns every small erosion wrinkle into a band
      // boundary, and 水墨 wants broad flat washes, not a dappled hillside.
      const il = Math.max(i - 2, 0), ir = Math.min(i + 2, n - 1);
      const jd = Math.max(j - 2, 0), ju = Math.min(j + 2, n - 1);
      const hx = positions[(j * n + ir) * 3 + 1] - positions[(j * n + il) * 3 + 1];
      const hz = positions[(ju * n + i) * 3 + 1] - positions[(jd * n + i) * 3 + 1];
      const sx = (ir - il) * hf.cell, sz = (ju - jd) * hf.cell;
      const nx = -hx * sz, ny = sx * sz, nz = -hz * sx;
      const l = Math.hypot(nx, ny, nz) || 1;
      normals[k * 3] = nx / l; normals[k * 3 + 1] = ny / l; normals[k * 3 + 2] = nz / l;
      slope[k] = 1 - normals[k * 3 + 1];
    }
  }

  const indices: number[] = [];
  let dropped = 0;
  const inHole = (k: number) => hf.corridorEdge[k] < hf.corridorSpan[k] - HOLE_SLACK;
  const tri = (a: number, b: number, c: number) => {
    if (inHole(a) && inHole(b) && inHole(c)) { dropped++; return; }
    indices.push(a, b, c);
  };
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const a = j * n + i, b = j * n + i + 1, c = (j + 1) * n + i, d = (j + 1) * n + i + 1;
      tri(a, c, b);
      tri(b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setAttribute('aSlope', new THREE.BufferAttribute(slope, 1));
  geo.setIndex(indices);
  geo.computeBoundingSphere();
  return { geometry: geo, droppedTriangles: dropped };
}
