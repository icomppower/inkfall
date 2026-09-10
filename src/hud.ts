import { SECTIONS, CHECKPOINTS, COURSE_LENGTH } from './sim/constants';
import { TRICKS } from './sim/bike';
import { loadBest, saveBest, type BestRun } from './storage';

const CSS = `
#hud { position: fixed; inset: 0; pointer-events: none; color: #1b1b1e;
  font-family: "PingFang HK","Hiragino Sans","Noto Sans CJK HK",system-ui,sans-serif;
  text-shadow: 0 1px 0 rgba(244,241,234,.75); }
#hud .brush { position: absolute; }
#hud .speed { left: 26px; bottom: 22px; }
#hud .speed b { font-size: 62px; font-weight: 800; letter-spacing: -2px; line-height: .9; }
#hud .speed i { font-style: normal; font-size: 15px; opacity: .72; margin-left: 6px; }
#hud .place { right: 26px; top: 20px; text-align: right; }
#hud .place b { font-size: 40px; font-weight: 800; line-height: .95; }
#hud .place i { font-style: normal; font-size: 13px; opacity: .72; display: block; }
#hud .timer { left: 50%; top: 16px; transform: translateX(-50%); text-align: center; }
#hud .timer b { font-size: 34px; font-weight: 700; font-variant-numeric: tabular-nums; }
#hud .timer i { font-style: normal; display: block; font-size: 13px; opacity: .7; min-height: 17px; }
#hud .boost { left: 26px; bottom: 96px; }
#hud .boost canvas { display: block; }
#hud .boost span { font-size: 11px; letter-spacing: .28em; opacity: .68; }
#hud .crashes { right: 26px; bottom: 24px; text-align: right; font-size: 14px; opacity: .78; }
#hud .card { left: 50%; top: 46%; transform: translate(-50%,-50%); text-align: center;
  opacity: 0; transition: opacity .5s ease; }
#hud .card b { font-size: 46px; font-weight: 800; letter-spacing: .18em; display: block; }
#hud .card i { font-style: normal; font-size: 15px; letter-spacing: .34em; opacity: .68; }
#hud .card.show { opacity: 1; }
#hud .flash { left: 50%; top: 62%; transform: translate(-50%,-50%); text-align: center;
  font-size: 26px; font-weight: 800; letter-spacing: .1em; opacity: 0; transition: opacity .25s; }
#hud .flash.show { opacity: 1; }
#hud .split { left: 50%; top: 72px; transform: translateX(-50%); font-size: 22px; font-weight: 700;
  opacity: 0; transition: opacity .3s; font-variant-numeric: tabular-nums; }
#hud .split.show { opacity: 1; }
#hud .split.up { color: #1b6b3a; }
#hud .split.down { color: #a01f1a; }
#hud .board { position: absolute; inset: 0; display: none; place-items: center;
  background: rgba(244,241,234,.90); pointer-events: auto; }
#hud .board.show { display: grid; }
#hud .panel { max-width: min(560px, 86vw); text-align: center; padding: 30px 34px;
  border: 2px solid #1b1b1e; background: #f7f4ee; }
#hud .panel h1 { margin: 0 0 4px; font-size: 40px; letter-spacing: .22em; }
#hud .panel h2 { margin: 0 0 18px; font-size: 13px; letter-spacing: .42em; opacity: .66; font-weight: 500; }
#hud .panel table { width: 100%; border-collapse: collapse; font-size: 15px; margin: 10px 0 14px; }
#hud .panel td { padding: 5px 2px; border-bottom: 1px solid rgba(27,27,30,.18); text-align: left; }
#hud .panel td:last-child { text-align: right; font-variant-numeric: tabular-nums; }
#hud .panel p { font-size: 13px; opacity: .74; line-height: 1.6; margin: 12px 0 0; }
#hud .panel .keys { font-size: 12px; opacity: .66; line-height: 1.9; }
#hud .panel button { margin-top: 16px; font: inherit; font-size: 15px; letter-spacing: .2em;
  padding: 9px 26px; border: 2px solid #1b1b1e; background: #1b1b1e; color: #f7f4ee; cursor: pointer; }
`;

function fmt(t: number): string {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}
function signed(d: number): string {
  return `${d >= 0 ? '+' : '−'}${Math.abs(d).toFixed(2)}`;
}

export interface HudModel {
  seed: string;
  speedKmh: number;
  place: number;
  time: number;
  boost: number;
  crashes: number;
  style: number;
  s: number;
  checkpoint: number;
  splits: number[];
  phase: string;
  trick: number;
  landedTrick: number;
  paused: boolean;
}

/** Ink-brush HUD, results board and the start card. Plain DOM over the canvas. */
export class Hud {
  readonly root: HTMLElement;
  onStart: (() => void) | null = null;
  onRestart: (() => void) | null = null;
  best: BestRun | null;

  private speedEl: HTMLElement;
  private placeEl: HTMLElement;
  private timerEl: HTMLElement;
  private bestEl: HTMLElement;
  private crashEl: HTMLElement;
  private cardEl: HTMLElement;
  private flashEl: HTMLElement;
  private splitEl: HTMLElement;
  private boostCanvas: HTMLCanvasElement;
  private boardEl: HTMLElement;
  private panelEl: HTMLElement;
  private seed: string;

  private lastSection = -1;
  private cardUntil = 0;
  private flashUntil = 0;
  private splitUntil = 0;
  private lastCheckpoint = 0;
  private lastBoost = -1;
  private lastTrick = 0;
  private savedThisRun = false;
  private mode: 'start' | 'race' | 'results' | 'paused' = 'start';

  constructor(parent: HTMLElement, seed: string) {
    this.seed = seed;
    this.best = loadBest(seed);
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    this.root = document.createElement('div');
    this.root.id = 'hud';
    this.root.innerHTML = `
      <div class="brush speed"><b>0</b><i>km/h</i></div>
      <div class="brush place"><b>1</b><i>／4</i></div>
      <div class="brush timer"><b>0:00.00</b><i></i></div>
      <div class="brush boost"><span>墨 BOOST</span><canvas width="232" height="26"></canvas></div>
      <div class="brush crashes">摔車 0</div>
      <div class="brush card"><b></b><i></i></div>
      <div class="brush flash"></div>
      <div class="brush split"></div>
      <div class="board"><div class="panel"></div></div>`;
    parent.appendChild(this.root);

    this.speedEl = this.root.querySelector('.speed b')!;
    this.placeEl = this.root.querySelector('.place b')!;
    this.timerEl = this.root.querySelector('.timer b')!;
    this.bestEl = this.root.querySelector('.timer i')!;
    this.crashEl = this.root.querySelector('.crashes')!;
    this.cardEl = this.root.querySelector('.card')!;
    this.flashEl = this.root.querySelector('.flash')!;
    this.splitEl = this.root.querySelector('.split')!;
    this.boostCanvas = this.root.querySelector('.boost canvas')!;
    this.boardEl = this.root.querySelector('.board')!;
    this.panelEl = this.root.querySelector('.panel')!;
    this.showStart();
  }

  /** The boost meter is a brush stroke that fills, not a rectangle. */
  private drawBoost(v: number): void {
    const c = this.boostCanvas;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, c.width, c.height);
    const stroke = (frac: number, colour: string) => {
      if (frac <= 0) return;
      const w = (c.width - 8) * frac;
      ctx.beginPath();
      ctx.moveTo(4, 18);
      for (let x = 0; x <= w; x += 4) {
        const t = x / (c.width - 8);
        const thick = 7.5 * Math.sin(Math.min(1, t * 6.5) * Math.PI * 0.5) * (1 - t * 0.25);
        ctx.lineTo(4 + x, 18 - thick - Math.sin(t * 9) * 1.1);
      }
      for (let x = w; x >= 0; x -= 4) {
        const t = x / (c.width - 8);
        const thick = 4.0 * Math.sin(Math.min(1, t * 6.5) * Math.PI * 0.5) * (1 - t * 0.3);
        ctx.lineTo(4 + x, 18 + thick + Math.sin(t * 7 + 1.7) * 0.8);
      }
      ctx.closePath();
      ctx.fillStyle = colour;
      ctx.fill();
    };
    stroke(1, 'rgba(27,27,30,.14)');
    stroke(v, '#1b1b1e');
  }

  showStart(): void {
    this.mode = 'start';
    const best = this.best ? `最佳 BEST ${fmt(this.best.time)}` : '未有紀錄 NO TIME YET';
    this.panelEl.innerHTML = `
      <h1>墨落大帽山</h1>
      <h2>I N K F A L L</h2>
      <p>由大帽山雷達站直落川龍村，2.3 公里。<br>2.3 km, top to bottom. Rain rolls in on the way down.</p>
      <div class="keys">
        W / ↑ 踩 pedal · A D 走線 line · S / ↓ 煞車 brake · Space 蓄力／跳 preload &amp; hop<br>
        Shift 加速 boost · C manual · 1–5 空中花式 tricks · R 重來 · P 暫停 · M 靜音 · V 天氣 · F 特效
      </div>
      <p>${best}</p>
      <button type="button">開始 START</button>`;
    this.boardEl.classList.add('show');
    this.panelEl.querySelector('button')!.addEventListener('click', () => {
      this.boardEl.classList.remove('show');
      this.mode = 'race';
      this.savedThisRun = false;
      this.onStart?.();
    });
  }

  showPaused(paused: boolean): void {
    if (this.mode === 'results' || this.mode === 'start') return;
    if (paused) {
      this.mode = 'paused';
      this.panelEl.innerHTML = `<h1>暫停</h1><h2>P A U S E D</h2><p>P 或 Esc 繼續 · R 重新開始</p>`;
      this.boardEl.classList.add('show');
    } else {
      this.mode = 'race';
      this.boardEl.classList.remove('show');
    }
  }

  showResults(m: HudModel, riders: { zh: string; en: string; place: number; finishTime: number; isPlayer: boolean; phase: string }[]): void {
    if (this.mode === 'results') return;
    this.mode = 'results';
    const run: BestRun = { time: m.time, splits: m.splits.slice(), style: m.style, place: m.place };
    const improved = !this.savedThisRun && saveBest(this.seed, run);
    this.savedThisRun = true;
    if (improved) this.best = run;
    const rows = riders
      .slice()
      .sort((a, b) => a.place - b.place)
      .map((r) => `<tr><td>${r.place}. ${r.zh} <span style="opacity:.6">${r.en}</span>${r.isPlayer ? ' ←' : ''}</td>
        <td>${r.phase === 'finished' ? fmt(r.finishTime) : 'DNF'}</td></tr>`).join('');
    const splitRows = m.splits.map((t, i) => {
      const b = this.best?.splits?.[i];
      const d = b !== undefined && !improved ? ` <span style="opacity:.7">(${signed(t - b)})</span>` : '';
      return `<tr><td>${CHECKPOINTS[i]} m</td><td>${fmt(t)}${d}</td></tr>`;
    }).join('');
    this.panelEl.innerHTML = `
      <h1>${m.place === 1 ? '第一名' : `第 ${m.place} 名`}</h1>
      <h2>F I N I S H</h2>
      <table>${rows}</table>
      <table>${splitRows}</table>
      <p>時間 TIME ${fmt(m.time)} · 花式分 STYLE ${m.style} · 摔車 CRASHES ${m.crashes}<br>
      最佳 BEST ${this.best ? fmt(this.best.time) : '—'}${improved ? ' · 新紀錄 NEW BEST' : ''}</p>
      <button type="button">再來一次 RESTART</button>`;
    this.boardEl.classList.add('show');
    this.panelEl.querySelector('button')!.addEventListener('click', () => {
      this.boardEl.classList.remove('show');
      this.mode = 'race';
      this.savedThisRun = false;
      this.onRestart?.();
    });
  }

  reset(): void {
    this.lastSection = -1;
    this.lastCheckpoint = 0;
    this.savedThisRun = false;
    this.mode = 'race';
    this.boardEl.classList.remove('show');
  }

  update(m: HudModel, riders: { zh: string; en: string; place: number; finishTime: number; isPlayer: boolean; phase: string }[], now: number): void {
    this.speedEl.textContent = String(Math.round(m.speedKmh));
    this.placeEl.textContent = String(m.place);
    this.timerEl.textContent = fmt(m.time);
    this.bestEl.textContent = this.best ? `最佳 ${fmt(this.best.time)}` : '';
    this.crashEl.textContent = `摔車 ${m.crashes}`;

    if (Math.abs(m.boost - this.lastBoost) > 0.004) {
      this.lastBoost = m.boost;
      this.drawBoost(m.boost);
    }

    const sec = SECTIONS[Math.min(SECTIONS.length - 1, Math.max(0, secIndex(m.s)))];
    if (sec.index !== this.lastSection) {
      this.lastSection = sec.index;
      this.cardEl.querySelector('b')!.textContent = sec.zh;
      this.cardEl.querySelector('i')!.textContent = sec.en.toUpperCase();
      this.cardUntil = now + 2600;
    }
    this.cardEl.classList.toggle('show', now < this.cardUntil);

    if (m.checkpoint > this.lastCheckpoint) {
      const i = m.checkpoint - 1;
      const t = m.splits[i];
      const b = this.best?.splits?.[i];
      this.lastCheckpoint = m.checkpoint;
      if (t !== undefined) {
        if (b === undefined) {
          this.splitEl.textContent = `${CHECKPOINTS[i]} m · ${fmt(t)}`;
          this.splitEl.className = 'brush split show';
        } else {
          const d = t - b;
          this.splitEl.textContent = `${CHECKPOINTS[i]} m · ${signed(d)}`;
          this.splitEl.className = `brush split show ${d <= 0 ? 'up' : 'down'}`;
        }
        this.splitUntil = now + 2400;
      }
    }
    if (now > this.splitUntil) this.splitEl.classList.remove('show');

    if (m.landedTrick && m.landedTrick !== this.lastTrick) {
      const t = TRICKS[m.landedTrick];
      if (t) {
        this.flashEl.textContent = `${t.zh} ${t.en.toUpperCase()}`;
        this.flashUntil = now + 1400;
      }
    }
    this.lastTrick = m.landedTrick;
    this.flashEl.classList.toggle('show', now < this.flashUntil);

    if (m.phase === 'finished') this.showResults(m, riders);
  }

  get boardVisible(): boolean { return this.boardEl.classList.contains('show'); }
  get currentMode(): string { return this.mode; }
}

function secIndex(s: number): number {
  for (const sec of SECTIONS) if (s < sec.end) return sec.index;
  return SECTIONS.length - 1;
}

export { COURSE_LENGTH };
