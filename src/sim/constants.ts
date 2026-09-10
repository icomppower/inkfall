/** Shared sim constants. Pure data — no three, no DOM. */

export const FIXED_DT = 1 / 120;
export const MAX_CATCHUP_STEPS = 4;

export const COURSE_LENGTH = 2300;      // metres, point-to-point
export const SUMMIT_Y = 950;            // 大帽山 radar station apron
export const TOTAL_DROP = 420;          // metres to 川龍村

export type SurfaceType = 'tarmac' | 'hardpack' | 'rock' | 'dirt' | 'wood' | 'stone' | 'void';

export interface SurfaceDef {
  /** Dry lateral-grip coefficient. */
  muDry: number;
  /** Fully-wet lateral-grip coefficient. */
  muWet: number;
  /** Vertical roughness amplitude in metres (drives camera shake + tyre audio). */
  rough: number;
  /** Rolling drag scale. */
  roll: number;
}

export const SURFACES: Record<SurfaceType, SurfaceDef> = {
  tarmac:   { muDry: 1.00, muWet: 0.72, rough: 0.005, roll: 1.00 },
  hardpack: { muDry: 0.90, muWet: 0.65, rough: 0.030, roll: 1.06 },
  rock:     { muDry: 0.85, muWet: 0.55, rough: 0.150, roll: 1.22 },
  dirt:     { muDry: 0.95, muWet: 0.68, rough: 0.045, roll: 1.10 },
  wood:     { muDry: 0.88, muWet: 0.58, rough: 0.020, roll: 1.04 },
  stone:    { muDry: 0.92, muWet: 0.66, rough: 0.055, roll: 1.08 },
  void:     { muDry: 0.00, muWet: 0.00, rough: 0.000, roll: 1.00 },
};

export interface SectionDef {
  index: number;
  start: number;
  end: number;
  zh: string;
  en: string;
  surface: SurfaceType;
  width: number;
  drop: number;
}

export const SECTIONS: SectionDef[] = [
  { index: 0, start: 0,    end: 350,  zh: '雷達站',   en: 'Radar Station',  surface: 'tarmac',   width: 8.0,  drop: 45 },
  { index: 1, start: 350,  end: 800,  zh: '芒草坡',   en: 'Silvergrass Ridge', surface: 'hardpack', width: 7.0, drop: 78 },
  { index: 2, start: 800,  end: 1200, zh: '石澗',     en: 'Stream Bed',     surface: 'rock',     width: 9.0,  drop: 82 },
  { index: 3, start: 1200, end: 1650, zh: '茶園',     en: 'Tea Terraces',   surface: 'dirt',     width: 10.0, drop: 92 },
  { index: 4, start: 1650, end: 2050, zh: '竹林峽',   en: 'Bamboo Gap',     surface: 'dirt',     width: 6.5,  drop: 88 },
  { index: 5, start: 2050, end: 2300, zh: '川龍村',   en: 'Cheung Lung Village', surface: 'stone', width: 5.5, drop: 35 },
];

/** Split gates. Five checkpoints (section entries 1..5) plus the finish line. */
export const CHECKPOINTS = [350, 800, 1200, 1650, 2050];
export const FINISH_S = COURSE_LENGTH;

/** Tea-terrace jump line: three tabletops (6 / 9 / 12 m decks) then a step-down. */
export interface TabletopDef { s: number; deck: number; lipRise: number; lipRun: number; }
export const TABLETOPS: TabletopDef[] = [
  { s: 1288, deck: 6,  lipRise: 1.7, lipRun: 7.0 },
  { s: 1408, deck: 9,  lipRise: 2.1, lipRun: 7.5 },
  { s: 1536, deck: 12, lipRise: 2.6, lipRun: 8.0 },
];
export const STEP_DOWN_S = 1614;
export const STEP_DOWN_DROP = 2.5;
/** Length of the landing ramp under the terrace wall — a rideable 27°, not a cliff. */
export const STEP_DOWN_RUN = 5.0;

/** Bamboo-gap ravine — 14 m of nothing, mandatory hop timing. */
export const RAVINE_S = 1884;
export const RAVINE_WIDTH = 14;
export const RAVINE_LIP_RUN = 9.0;
export const RAVINE_LIP_RISE = 2.0;
export const RAVINE_DEPTH = 26;

/** Wooden footbridge over the stream below the gap. */
export const BRIDGE_S = 1985;
export const BRIDGE_LEN = 22;

/** 300 mm ledges in the rock garden. */
export const ROCK_DROPS = [872, 941, 1013, 1076, 1148];
export const ROCK_DROP_HEIGHT = 0.3;

/** Bike / rider. */
export const WHEELBASE = 1.05;
export const SPEED_CAP = 78 / 3.6;          // m/s
export const PEDAL_TOP_SPEED = 32 / 3.6;    // pedal torque fades out here
export const GRAVITY = 9.81;

export const RAIN_RAMP_SECONDS = 20;
export const RAIN_GRIP_FACTOR = 0.72;

export const RIDER_SEEDS = ['TMS-01', 'TMS-02', 'TMS-03', 'TMS-04', 'TMS-05'] as const;
export const DEFAULT_SEED = 'TMS-01';
