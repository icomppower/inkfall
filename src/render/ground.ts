import type { World } from '../sim/world';
import { clamp, smoothstep } from '../sim/rng';
import { makeSample } from '../sim/course';
import { RAVINE_DEPTH } from '../sim/constants';

export const BLEND_OUT = 7;
const smp = makeSample();

/**
 * The single definition of "where the ground is" for rendering and prop placement:
 * the authoritative trail surface across the trail, blending out to the coarse terrain.
 * The trail ribbon, the scenery and the debug checks all read this, so they agree.
 */
export function groundHeight(world: World, s: number, lateral: number): number {
  const c = world.course;
  const halfW = c.widthAt(s) * 0.5;
  const a = Math.abs(lateral);
  c.sample(s, clamp(lateral, -halfW, halfW), smp);
  if (smp.voidGap) return c.centreY(s) - RAVINE_DEPTH;
  const trailY = smp.height;
  if (a <= halfW) return trailY;
  const i = c.idx(s);
  const x = c.centreX(s) + lateral * c.rx[i];
  const z = c.centreZ(s) + lateral * c.rz[i];
  const terrY = world.terrain.heightAt(x, z);
  if (a >= halfW + BLEND_OUT) return terrY;
  return trailY + (terrY - trailY) * smoothstep(halfW, halfW + BLEND_OUT, a);
}
