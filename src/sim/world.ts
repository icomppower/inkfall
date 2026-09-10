import { Course, makeSample, type SampleOut } from './course';
import { Heightfield } from './heightfield';
import { SURFACES, RAIN_GRIP_FACTOR, type SurfaceType } from './constants';
import { lerp } from './rng';

/** The world: authoritative track query plus the coarse terrain it is carved into. */
export class World {
  readonly course: Course;
  readonly terrain: Heightfield;
  readonly seed: string;
  private scratch: SampleOut = makeSample();

  constructor(seed: string) {
    this.seed = seed;
    this.course = new Course(seed);
    this.terrain = new Heightfield(this.course, seed);
  }

  /** THE query. Track surface is authoritative — terrain never overrides it. */
  sample(s: number, lateral: number, out?: SampleOut): SampleOut {
    return this.course.sample(s, lateral, out ?? this.scratch);
  }

  /** Lateral grip coefficient for a surface at a given wetness in [0, 1]. */
  grip(surface: SurfaceType, wetness: number): number {
    const def = SURFACES[surface];
    return lerp(def.muDry, def.muWet, wetness);
  }

  /** Global weather grip factor, for HUD/debug readouts. */
  weatherFactor(wetness: number): number {
    return lerp(1, RAIN_GRIP_FACTOR, wetness);
  }

  get length(): number { return this.course.length; }
}

export { makeSample };
export type { SampleOut };
