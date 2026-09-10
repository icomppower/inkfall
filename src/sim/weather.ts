import { Rng, clamp } from './rng';
import { RAIN_RAMP_SECONDS } from './constants';

export type WeatherMode = 'dry' | 'rain';

/**
 * Hong Kong monsoon on a timer. The onset point is seeded and lands somewhere in
 * sections 2–4, so the rain arrives mid-run without ever being a surprise to the sim:
 * everything downstream reads `wetness`, which is a pure function of elapsed time.
 */
export class Weather {
  mode: WeatherMode = 'dry';
  /** 0 = dry, 1 = fully wet. Grip, fog and the mix all key off this. */
  wetness = 0;
  /** Visor droplet coverage, 0..1. Accumulates in rain, drains when it stops. */
  droplets = 0;
  /** Screen-space rain streak intensity. Leads wetness — you see it before you feel it. */
  rainIntensity = 0;
  readonly onsetS: number;
  private forced = false;

  constructor(seed: string) {
    const rng = new Rng(`weather:${seed}`);
    this.onsetS = rng.range(830, 1520);
  }

  reset(): void {
    this.mode = 'dry';
    this.wetness = 0;
    this.droplets = 0;
    this.rainIntensity = 0;
    this.forced = false;
  }

  /** Player toggle (V) and the debug API both land here. */
  set(mode: WeatherMode): void {
    this.mode = mode;
    this.forced = true;
  }

  toggle(): void {
    this.set(this.mode === 'dry' ? 'rain' : 'dry');
  }

  step(dt: number, playerS: number, speed: number): void {
    if (!this.forced && this.mode === 'dry' && playerS >= this.onsetS) this.mode = 'rain';
    const target = this.mode === 'rain' ? 1 : 0;
    const rate = 1 / RAIN_RAMP_SECONDS;
    this.wetness = target > this.wetness
      ? Math.min(target, this.wetness + rate * dt)
      : Math.max(target, this.wetness - rate * 1.6 * dt);
    // Streaks appear almost immediately; the ground takes 20 s to give up its grip.
    this.rainIntensity = target > this.rainIntensity
      ? Math.min(target, this.rainIntensity + dt * 0.6)
      : Math.max(target, this.rainIntensity - dt * 0.5);

    if (this.mode === 'rain') {
      this.droplets = clamp(this.droplets + dt * (0.30 + speed * 0.020) * this.rainIntensity, 0, 1);
    } else {
      // Airflow strips the visor: fully clear well inside 30 s.
      this.droplets = clamp(this.droplets - dt * (0.055 + speed * 0.004), 0, 1);
    }
  }

  get dropletCount(): number {
    return Math.round(this.droplets * 48);
  }

  get cloudShade(): number {
    return this.rainIntensity;
  }
}
