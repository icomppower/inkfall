import * as THREE from 'three';
import type { World } from '../sim/world';
import { GRID_N } from '../sim/heightfield';

/**
 * Coarse massif mesh. Vertices inside the trail corridor are pushed slightly below the
 * authoritative trail surface (the course mask) so no terrain triangle covers the apron.
 */
export function buildTerrainGeometry(world: World): THREE.BufferGeometry {
  const hf = world.terrain;
  const n = GRID_N;
  const positions = new Float32Array(n * n * 3);
  const normals = new Float32Array(n * n * 3);
  const uvs = new Float32Array(n * n * 2);
  const slope = new Float32Array(n * n);

  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      const x = hf.x0 + i * hf.cell;
      const z = hf.z0 + j * hf.cell;
      const mask = hf.trailMask[k];
      // Sink masked vertices under the trail ribbon: the ribbon is what the rider sees.
      const y = hf.h[k] - mask * 0.05;
      positions[k * 3] = x; positions[k * 3 + 1] = y; positions[k * 3 + 2] = z;
      uvs[k * 2] = i / (n - 1); uvs[k * 2 + 1] = j / (n - 1);
    }
  }
  // Central-difference normals over the sunk heights.
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      const il = Math.max(i - 1, 0), ir = Math.min(i + 1, n - 1);
      const jd = Math.max(j - 1, 0), ju = Math.min(j + 1, n - 1);
      const hx = positions[(j * n + ir) * 3 + 1] - positions[(j * n + il) * 3 + 1];
      const hz = positions[(ju * n + i) * 3 + 1] - positions[(jd * n + i) * 3 + 1];
      const sx = (ir - il) * hf.cell, sz = (ju - jd) * hf.cell;
      const nx = -hx * sz, ny = sx * sz, nz = -hz * sx;
      const l = Math.hypot(nx, ny, nz) || 1;
      normals[k * 3] = nx / l; normals[k * 3 + 1] = ny / l; normals[k * 3 + 2] = nz / l;
      slope[k] = 1 - normals[k * 3 + 1];
    }
  }

  const indices = new Uint32Array((n - 1) * (n - 1) * 6);
  let o = 0;
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const a = j * n + i, b = j * n + i + 1, c = (j + 1) * n + i, d = (j + 1) * n + i + 1;
      indices[o++] = a; indices[o++] = c; indices[o++] = b;
      indices[o++] = b; indices[o++] = c; indices[o++] = d;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setAttribute('aSlope', new THREE.BufferAttribute(slope, 1));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  geo.computeBoundingSphere();
  return geo;
}
