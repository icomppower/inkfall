import { neutralInput, type RiderInput } from './sim/bike';

export interface UiEvents {
  restart: boolean;
  pause: boolean;
  mute: boolean;
  weather: boolean;
  effects: boolean;
}

/** Keyboard + gamepad → RiderInput. Touch is out of scope for v1. */
export class InputSource {
  private keys = new Set<string>();
  private pressed = new Set<string>();
  private current: RiderInput = neutralInput();
  /** When set, scripted input from the debug API overrides the hardware. */
  scripted: Partial<RiderInput> | null = null;
  enabled = true;

  constructor(target: EventTarget = window) {
    target.addEventListener('keydown', (e) => {
      const ev = e as KeyboardEvent;
      if (ev.repeat) return;
      this.keys.add(ev.code);
      this.pressed.add(ev.code);
      if (INTERCEPT.has(ev.code)) ev.preventDefault();
    });
    target.addEventListener('keyup', (e) => this.keys.delete((e as KeyboardEvent).code));
    target.addEventListener('blur', () => this.keys.clear());
  }

  private pad(): Gamepad | null {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return null;
    for (const p of navigator.getGamepads()) if (p && p.connected) return p;
    return null;
  }

  sample(): RiderInput {
    const i = this.current;
    const k = this.keys;
    const pad = this.pad();
    const held = (...codes: string[]) => codes.some((c) => k.has(c));

    i.pedal = held('KeyW', 'ArrowUp') ? 1 : 0;
    i.brake = held('KeyS', 'ArrowDown') ? 1 : 0;
    i.frontBrake = 0;
    i.steer = (held('KeyD', 'ArrowRight') ? 1 : 0) - (held('KeyA', 'ArrowLeft') ? 1 : 0);
    i.preload = held('Space');
    i.boost = held('ShiftLeft', 'ShiftRight');
    i.manual = held('KeyC');
    i.airPitch = (held('KeyS', 'ArrowDown') ? 1 : 0) - (held('KeyW', 'ArrowUp') ? 1 : 0);
    i.airRoll = i.steer;
    i.trick = 0;
    for (let t = 1; t <= 5; t++) if (this.pressed.has(`Digit${t}`)) i.trick = t;

    if (pad) {
      const ax = pad.axes[0] ?? 0;
      i.pedal = Math.max(i.pedal, pad.buttons[7]?.value ?? 0);
      i.frontBrake = Math.max(i.frontBrake, pad.buttons[6]?.value ?? 0);
      if (Math.abs(ax) > 0.15) { i.steer = ax; i.airRoll = ax; }
      if (pad.buttons[0]?.pressed) i.preload = true;
      if (pad.buttons[2]?.pressed) i.boost = true;
      if (pad.buttons[1]?.pressed) i.manual = true;
      for (let b = 12; b <= 15; b++) if (pad.buttons[b]?.pressed) i.trick = b - 11;
      if (pad.buttons[3]?.pressed) i.trick = 5;
    }

    if (!this.enabled) {
      i.pedal = 0; i.brake = 0; i.steer = 0; i.preload = false; i.boost = false; i.manual = false; i.trick = 0;
      i.airPitch = 0; i.airRoll = 0; i.frontBrake = 0;
    }
    if (this.scripted) Object.assign(i, this.scripted);
    return i;
  }

  /** Call once per rendered frame, after sample(), to clear edge-triggered keys. */
  endFrame(): void { this.pressed.clear(); }

  consumeUi(): UiEvents {
    const take = (code: string) => this.pressed.has(code);
    return {
      restart: take('KeyR'),
      pause: take('KeyP') || take('Escape'),
      mute: take('KeyM'),
      weather: take('KeyV'),
      effects: take('KeyF'),
    };
  }
}

const INTERCEPT = new Set([
  'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyC', 'KeyR', 'KeyM', 'KeyV', 'KeyF',
  'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5',
]);
