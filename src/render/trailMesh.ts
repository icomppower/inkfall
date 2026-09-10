import * as THREE from 'three';
import type { World } from '../sim/world';
import { COURSE_LENGTH } from '../sim/constants';
import { makeSample } from '../sim/course';

const LAT_STEPS = 7;

/** Trail ribbon built directly from world.sample — the surface the rider actually rides. */
export function buildTrailGeometry(world: World, ds = 1.0): THREE.BufferGeometry {
  const course = world.course;
  const rows = Math.floor(COURSE_LENGTH / ds) + 1;
  const cols = LAT_STEPS;
  const pos: number[] = [];
  const nrm: number[] = [];
  const uv: number[] = [];
  const surfId: number[] = [];
  const idx: number[] = [];
  const smp = makeSample();
  const SURF_ID: Record<string, number> = { tarmac: 0, hardpack: 1, rock: 2, dirt: 3, wood: 4, stone: 5, void: 6 };

  for (let r = 0; r < rows; r++) {
    const s = Math.min(r * ds, COURSE_LENGTH);
    const halfW = course.widthAt(s) * 0.5;
    const i = course.idx(s);
    for (let c = 0; c < cols; c++) {
      const lat = -halfW + (2 * halfW * c) / (cols - 1);
      course.sample(s, lat, smp);
      const y = smp.voidGap ? course.centreY(s) - 100 : smp.height + 0.02;
      pos.push(course.centreX(s) + lat * course.rx[i], y, course.centreZ(s) + lat * course.rz[i]);
      nrm.push(smp.nx, smp.ny, smp.nz);
      uv.push(c / (cols - 1), s * 0.25);
      surfId.push(SURF_ID[smp.surface]);
    }
  }
  for (let r = 0; r < rows - 1; r++) {
    // Skip quads that span the ravine — there is genuinely nothing there.
    const sMid = (r + 0.5) * ds;
    if (course.isVoid(sMid, 0)) continue;
    for (let c = 0; c < cols - 1; c++) {
      const a = r * cols + c, b = a + 1, d = (r + 1) * cols + c, e = d + 1;
      idx.push(a, d, b, b, d, e);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('aSurface', new THREE.Float32BufferAttribute(surfId, 1));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  return geo;
}
