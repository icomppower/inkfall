import * as THREE from 'three';
import type { World } from '../sim/world';
import { COURSE_LENGTH } from '../sim/constants';
import { makeSample } from '../sim/course';
import { clamp } from '../sim/rng';
import { RIBBON_APRON, RIBBON_MIN_APRON } from '../sim/heightfield';
import { groundHeight } from './ground';

/**
 * Trail ribbon plus its apron. The ribbon carries the authoritative trail surface across
 * the trail width, blends to the terrain height over the next few metres, then follows
 * the terrain exactly out past the corridor hole so the seam is invisible.
 */
const LAT_STEPS = 17;

export function buildTrailGeometry(world: World, ds = 1.0): THREE.BufferGeometry {
  const course = world.course;
  const rows = Math.floor(COURSE_LENGTH / ds) + 1;
  const cols = LAT_STEPS;
  const pos = new Float32Array(rows * cols * 3);
  const uv = new Float32Array(rows * cols * 2);
  const surfId = new Float32Array(rows * cols);
  const idx: number[] = [];
  const smp = makeSample();
  const SURF_ID: Record<string, number> = { tarmac: 0, hardpack: 1, rock: 2, dirt: 3, wood: 4, stone: 5, void: 6 };

  for (let r = 0; r < rows; r++) {
    const s = Math.min(r * ds, COURSE_LENGTH);
    const halfW = course.widthAt(s) * 0.5;
    const i = course.idx(s);
    const span = course.ribbonSpan(s, RIBBON_APRON, RIBBON_MIN_APRON);
    for (let c = 0; c < cols; c++) {
      const t = c / (cols - 1);
      // Bunch the lateral samples toward the trail, where the shape actually matters.
      const sgn = t < 0.5 ? -1 : 1;
      const u = Math.abs(t - 0.5) * 2;
      const lat = sgn * span * u * u;
      const k = r * cols + c;
      pos[k * 3] = course.centreX(s) + lat * course.rx[i];
      pos[k * 3 + 1] = groundHeight(world, s, lat) + (Math.abs(lat) <= halfW ? 0.02 : 0);
      pos[k * 3 + 2] = course.centreZ(s) + lat * course.rz[i];
      uv[k * 2] = lat / (halfW * 2) + 0.5;      // 0..1 spans the trail itself
      uv[k * 2 + 1] = s * 0.25;
      course.sample(s, clamp(lat, -halfW, halfW), smp);
      surfId[k] = SURF_ID[smp.surface];
    }
  }
  for (let r = 0; r < rows - 1; r++) {
    const sMid = (r + 0.5) * ds;
    for (let c = 0; c < cols - 1; c++) {
      const a = r * cols + c, b = a + 1, d = (r + 1) * cols + c, e = d + 1;
      // The ravine is a real hole: no ribbon quad spans it at any lateral offset.
      if (course.isVoid(sMid, 0)) continue;
      // Wind so the face normal points up: right × forward = +Y.
      idx.push(a, b, d, b, e, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('aSurface', new THREE.BufferAttribute(surfId, 1));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}
