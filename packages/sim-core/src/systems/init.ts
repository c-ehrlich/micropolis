import { TileFlag, World } from '../core/constants.ts';
import type { LayerId, MapStore } from '../core/map-store.ts';
import { CLASSIC_LAYER_DEFS } from '../core/map-store.ts';
import { randomSeedFromTime } from '../core/rng.ts';
import type { SimContext } from '../core/sim-context.ts';
import type { SimState } from '../core/sim-state.ts';
import { runUiUpdate } from './date-time.ts';
import { mapScanSlice } from './map-scan.ts';
import { setZPowerAt } from './power.ts';

const { WORLD_X, WORLD_Y } = World;
const { ZONEBIT } = TileFlag;

const ALL_LAYER_IDS = Object.keys(CLASSIC_LAYER_DEFS) as LayerId[];
const WILL_STUFF_LAYERS: LayerId[] = [
  'popDensity',
  'trfDensity',
  'pollutionMem',
  'landValueMem',
  'crimeMem',
  'terrainMem',
  'rateOGMem',
  'fireRate',
  'comRate',
  'policeMap',
  'policeMapEffect',
  'fireStMap',
];

const DISASTER_WAIT_TABLE = [0, 2, 10, 5, 20, 3, 5, 5, 2 * 48] as const;
const SCORE_WAIT_TABLE = [
  0,
  30 * 48,
  5 * 48,
  5 * 48,
  10 * 48,
  5 * 48,
  10 * 48,
  5 * 48,
  10 * 48,
] as const;

const noop = () => {};

export interface InitWillStuffOptions {
  seed?: number;
}

export interface SimInitSystems {
  setValves?: () => void;
  clearCensus?: () => void;
  mapScan?: (x1: number, x2: number) => void;
  doPowerScan?: () => void;
  ptlScan?: () => void;
  crimeScan?: () => void;
  popDenScan?: () => void;
  fireAnalysis?: () => void;
  evalInit?: () => void;
  setGameLevel?: (level: number) => void;
}

function withStoreTick(store: MapStore, fn: () => void): void {
  store.beginTick();
  try {
    fn();
  } finally {
    store.commitTick();
  }
}

function clearLayer(store: MapStore, layer: LayerId): void {
  const arr = store.getLayer(layer);
  arr.fill(0);
}

export function initMapArrays(store: MapStore): void {
  withStoreTick(store, () => {
    for (const layer of ALL_LAYER_IDS) {
      clearLayer(store, layer);
    }
  });
}

export function initWillStuff(
  context: SimContext,
  state: SimState,
  options: InitWillStuffOptions = {},
): void {
  if (options.seed !== undefined) {
    context.rng.seed(options.seed);
  } else {
    randomSeedFromTime(context.rng);
  }

  state.RoadEffect = 32;
  state.PoliceEffect = 1000;
  state.FireEffect = 1000;
  state.CityScore = 500;
  state.CityPop = -1;
  state.LastCityTime = -1;
  state.LastCityYear = -1;
  state.LastCityMonth = -1;
  state.LastFunds = -1;
  state.MessagePort = 0;
  state.MesX = 0;
  state.MesY = 0;
  state.RoadFund = 0;
  state.PoliceFund = 0;
  state.FireFund = 0;
  state.ValveFlag = 1;
  state.DisasterEvent = 0;
  state.TaxFlag = 0;

  withStoreTick(context.store, () => {
    for (const layer of WILL_STUFF_LAYERS) {
      clearLayer(context.store, layer);
    }
  });

  context.hooks.destroyAllSprites();
  runUiUpdate(state, context);
}

export function doSimInit(
  context: SimContext,
  state: SimState,
  systems: SimInitSystems = {},
): void {
  state.Fcycle = 0;
  state.Scycle = 0;

  withStoreTick(context.store, () => {
    if (state.InitSimLoad === 2) {
      initSimMemory(context, state, systems);
    } else if (state.InitSimLoad === 1) {
      simLoadInit(context, state, systems);
    }

    const setValves = systems.setValves ?? noop;
    const clearCensus = systems.clearCensus ?? noop;
    const mapScan = systems.mapScan ?? ((x1, x2) => mapScanSlice(state, context, x1, x2));
    const doPowerScan = systems.doPowerScan ?? noop;
    const ptlScan = systems.ptlScan ?? noop;
    const crimeScan = systems.crimeScan ?? noop;
    const popDenScan = systems.popDenScan ?? noop;
    const fireAnalysis = systems.fireAnalysis ?? noop;

    setValves();
    clearCensus();
    mapScan(0, WORLD_X);

    doPowerScan();
    state.NewPower = 1;

    ptlScan();
    crimeScan();
    popDenScan();
    fireAnalysis();

    state.NewMap = 1;
    context.hooks.doAllGraphs();
    state.NewGraph = 1;
    state.TotalPop = 1;
    state.DoInitialEval = 1;
  });
}

export function initSimMemory(
  _context: SimContext,
  state: SimState,
  systems: SimInitSystems = {},
): void {
  setCommonInits(state, systems);

  state.ResHis.fill(0);
  state.ComHis.fill(0);
  state.IndHis.fill(0);
  state.MoneyHis.fill(128);
  state.CrimeHis.fill(0);
  state.PollutionHis.fill(0);

  state.CrimeRamp = 0;
  state.PolluteRamp = 0;
  state.TotalPop = 0;
  state.RValve = 0;
  state.CValve = 0;
  state.IValve = 0;
  state.ResCap = 0;
  state.ComCap = 0;
  state.IndCap = 0;
  state.EMarket = 6;
  state.DisasterEvent = 0;
  state.ScoreType = 0;

  if (systems.doPowerScan) {
    // s_sim.c InitSimMemory: reset before DoPowerScan to clear powermem.
    state.PowerStackNum = 0;
    systems.doPowerScan();
  }
  state.NewPower = 1;
  state.InitSimLoad = 0;
}

export function simLoadInit(
  context: SimContext,
  state: SimState,
  systems: SimInitSystems = {},
): void {
  const misc = state.MiscHis;

  state.EMarket = misc[1] ?? 0;
  state.ResPop = misc[2] ?? 0;
  state.ComPop = misc[3] ?? 0;
  state.IndPop = misc[4] ?? 0;
  state.RValve = misc[5] ?? 0;
  state.CValve = misc[6] ?? 0;
  state.IValve = misc[7] ?? 0;
  state.CrimeRamp = misc[10] ?? 0;
  state.PolluteRamp = misc[11] ?? 0;
  state.LVAverage = misc[12] ?? 0;
  state.CrimeAverage = misc[13] ?? 0;
  state.PolluteAverage = misc[14] ?? 0;
  state.GameLevel = misc[15] ?? 0;

  if (state.CityTime < 0) {
    state.CityTime = 0;
  }
  if (!state.EMarket) {
    state.EMarket = 4;
  }
  if (state.GameLevel < 0 || state.GameLevel > 2) {
    state.GameLevel = 0;
  }
  systems.setGameLevel?.(state.GameLevel);

  setCommonInits(state, systems);

  state.CityClass = misc[16] ?? 0;
  state.CityScore = misc[17] ?? 0;

  if (state.CityClass < 0 || state.CityClass > 5) {
    state.CityClass = 0;
  }
  if (state.CityScore < 1 || state.CityScore > 999) {
    state.CityScore = 500;
  }

  state.ResCap = 0;
  state.ComCap = 0;
  state.IndCap = 0;

  state.AvCityTax = (state.CityTime % 48) * 7;

  const power = context.store.getLayer('power') as Uint16Array;
  power.fill(0xffff);

  doNilPower(context);

  if (state.ScenarioID > 8 || state.ScenarioID < 0) {
    state.ScenarioID = 0;
  }

  if (state.ScenarioID) {
    state.DisasterEvent = state.ScenarioID;
    state.DisasterWait = DISASTER_WAIT_TABLE[state.ScenarioID] ?? 0;
    state.ScoreType = state.ScenarioID;
    state.ScoreWait = SCORE_WAIT_TABLE[state.ScenarioID] ?? 0;
  } else {
    state.DisasterEvent = 0;
    state.ScoreType = 0;
  }

  state.RoadEffect = 32;
  state.PoliceEffect = 1000;
  state.FireEffect = 1000;
  state.InitSimLoad = 0;
}

export function doNilPower(context: SimContext): void {
  const store = context.store;
  const map = store.getLayer('map') as Uint16Array;
  const power = store.getLayer('power') as Uint16Array;

  for (let x = 0; x < WORLD_X; x += 1) {
    const baseIndex = x * WORLD_Y;
    for (let y = 0; y < WORLD_Y; y += 1) {
      const index = baseIndex + y;
      const tile = map[index] ?? 0;
      if ((tile & ZONEBIT) !== 0) {
        setZPowerAt(store, power, x, y, index, tile);
      }
    }
  }
}

function setCommonInits(state: SimState, systems: SimInitSystems): void {
  systems.evalInit?.();
  state.RoadEffect = 32;
  state.PoliceEffect = 1000;
  state.FireEffect = 1000;
  state.TaxFlag = 0;
  state.TaxFund = 0;
}
