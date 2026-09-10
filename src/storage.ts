export interface BestRun {
  time: number;
  splits: number[];
  style: number;
  place: number;
}

const KEY = 'inkfall.best.v1';

/** Best time and splits, per seed. localStorage only — no server, no ghost, no replay. */
export function loadBest(seed: string): BestRun | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const all = JSON.parse(raw) as Record<string, BestRun>;
    return all[seed] ?? null;
  } catch {
    return null;
  }
}

export function saveBest(seed: string, run: BestRun): boolean {
  try {
    const raw = localStorage.getItem(KEY);
    const all = raw ? (JSON.parse(raw) as Record<string, BestRun>) : {};
    const prev = all[seed];
    if (prev && prev.time <= run.time) return false;
    all[seed] = run;
    localStorage.setItem(KEY, JSON.stringify(all));
    return true;
  } catch {
    return false;
  }
}

export function clearBest(): void {
  try { localStorage.removeItem(KEY); } catch { /* private mode */ }
}
