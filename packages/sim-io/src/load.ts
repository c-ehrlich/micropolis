import { World } from '../../sim-core/src/core/constants.ts';
import type { SimContext } from '../../sim-core/src/core/sim-context.ts';
import type { SimState } from '../../sim-core/src/core/sim-state.ts';
import { type CityFile, decodeCityFileForMap, readCityMeta } from '../../sim-core/src/io/cty.ts';
import { applyLoadedCityMetaToState } from '../../sim-core/src/io/cty-state.ts';
import { markFundsDirty } from '../../sim-core/src/systems/date-time.ts';
import { setFunds } from '../../sim-core/src/systems/funds.ts';
import { doSimInit, initWillStuff } from '../../sim-core/src/systems/init.ts';
import { CLASSIC_REPLAY_MAP_SIZE, type ReplayMapSize } from './replay.ts';
import { getScenarioDefinition, type ScenarioDefinition } from './scenarios.ts';

/**
 * Result payload for C-style `loadFile` orchestration.
 * Mirrors the loaded buffers produced by `loadFile` in `ref/micropolis/src/sim/s_fileio.c`.
 */
export interface LoadFileLikeCResult {
  city: CityFile;
}

/**
 * Result payload for C-style `LoadCity` orchestration.
 * Mirrors filename/city-name handling from `LoadCity` in `ref/micropolis/src/sim/s_fileio.c`.
 */
export interface LoadCityLikeCResult extends LoadFileLikeCResult {
  cityFileName: string;
  cityName: string;
}

/**
 * Result payload for C-style `LoadScenario` orchestration.
 * Mirrors the selected scenario table row in `LoadScenario` in `ref/micropolis/src/sim/s_fileio.c`.
 */
export interface LoadScenarioLikeCResult extends LoadFileLikeCResult {
  scenario: ScenarioDefinition;
}

/**
 * Reset funding percentages to C defaults.
 * Mirrors `InitFundingLevel()` in `ref/micropolis/src/sim/w_budget.c` (1:1 values).
 */
function initFundingLevelOnState(state: SimState): void {
  state.policePercent = 1;
  state.firePercent = 1;
  state.roadPercent = 1;
}

/**
 * Copy `.cty`/`snro.*` history + misc buffers into `SimState`.
 * Mirrors `_load_file` array assignment targets in `ref/micropolis/src/sim/s_fileio.c`.
 */
function applyCityArraysToState(state: SimState, city: CityFile): void {
  state.ResHis.set(city.histories.res);
  state.ComHis.set(city.histories.com);
  state.IndHis.set(city.histories.ind);
  state.CrimeHis.set(city.histories.crime);
  state.PollutionHis.set(city.histories.pollution);
  state.MoneyHis.set(city.histories.money);
  state.MiscHis.set(city.misc);
}

/**
 * Copy decoded map payload into the active map layer.
 * Mirrors `_load_file` map assignment to `Map[x][y]` in `ref/micropolis/src/sim/s_fileio.c`.
 *
 * Note: this expects `context.store` to be idle (not inside an active tick).
 */
function applyCityMapToStore(context: SimContext, city: CityFile): void {
  context.store.beginTick();
  try {
    const map = context.store.getLayer('map') as Uint16Array;
    map.set(city.map);
  } finally {
    context.store.commitTick();
  }
}

/**
 * Copy decoded city payload into runtime state + store.
 * Mirrors `_load_file` effects in `ref/micropolis/src/sim/s_fileio.c`.
 */
function applyDecodedCityToRuntime(state: SimState, context: SimContext, city: CityFile): void {
  applyCityArraysToState(state, city);
  applyCityMapToStore(context, city);
}

/**
 * Derive the city name using C `LoadCity` / `SaveCityAs` string-mutation semantics.
 * Mirrors `LoadCity` and `SaveCityAs` in `ref/micropolis/src/sim/s_fileio.c`:
 * 1. truncate at the last `.` in the full path string
 * 2. then take basename after `/` or `\\`
 */
export function deriveCityNameFromPath(value: string): string {
  let trimmed = value;

  const dotIndex = trimmed.lastIndexOf('.');
  if (dotIndex >= 0) {
    trimmed = trimmed.slice(0, dotIndex);
  }

  const slashIndex = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  if (slashIndex >= 0) {
    return trimmed.slice(slashIndex + 1);
  }

  return trimmed;
}

/**
 * Run C-style `loadFile` orchestration on already-read city bytes.
 * Mirrors `loadFile` in `ref/micropolis/src/sim/s_fileio.c` (minus UI invalidation calls):
 * - `_load_file` payload copy
 * - metadata normalization + funding-percent reset
 * - `ChangeCensus`, `InitWillStuff`, `InitSimLoad=1`, `DoSimInit`
 */
export function loadFileLikeC(
  state: SimState,
  context: SimContext,
  cityBytes: Uint8Array,
  mapSize: ReplayMapSize = CLASSIC_REPLAY_MAP_SIZE,
): LoadFileLikeCResult {
  const city = decodeCityFileForMap(cityBytes, mapSize);
  applyDecodedCityToRuntime(state, context, city);

  const loadedMeta = readCityMeta(city.misc);
  applyLoadedCityMetaToState(state, loadedMeta);
  context.hooks.changeCensus();

  // C `setSkips(0)` resets runtime skip counters after load; sim-core models
  // comparable pacing state in `Spdcycle`.
  state.Spdcycle = 0;

  initWillStuff(context, state);
  state.ScenarioID = 0;
  state.InitSimLoad = 1;
  state.DoInitialEval = 0;
  doSimInit(context, state);

  return { city };
}

/**
 * Run C-style `LoadCity` orchestration on already-read city bytes.
 * Mirrors `LoadCity` in `ref/micropolis/src/sim/s_fileio.c` (minus UI eval hooks).
 */
export function loadCityLikeC(
  state: SimState,
  context: SimContext,
  cityFileName: string,
  cityBytes: Uint8Array,
  mapSize: ReplayMapSize = CLASSIC_REPLAY_MAP_SIZE,
): LoadCityLikeCResult {
  const result = loadFileLikeC(state, context, cityBytes, mapSize);
  return {
    ...result,
    cityFileName,
    cityName: deriveCityNameFromPath(cityFileName),
  };
}

/**
 * Run C-style `LoadScenario` orchestration on already-read scenario bytes.
 * Mirrors `LoadScenario` in `ref/micropolis/src/sim/s_fileio.c` (minus UI/Kick calls):
 * - scenario table constants (`ScenarioID`, `CityTime`, `SetFunds`)
 * - `_load_file` map/history payload copy
 * - `setSpeed(3)`, `CityTax=7`, `InitWillStuff`, `InitFundingLevel`, `UpdateFunds`
 * - `InitSimLoad=1`, `DoSimInit`
 */
export function loadScenarioLikeC(
  state: SimState,
  context: SimContext,
  scenarioId: number,
  scenarioBytes: Uint8Array,
  mapSize: ReplayMapSize = CLASSIC_REPLAY_MAP_SIZE,
): LoadScenarioLikeCResult {
  const scenario = getScenarioDefinition(scenarioId);
  const city = decodeCityFileForMap(scenarioBytes, mapSize);
  applyDecodedCityToRuntime(state, context, city);

  state.ScenarioID = scenario.id;
  state.CityTime = scenario.startCityTime;
  setFunds(state, scenario.startFunds);

  state.SimSpeed = 3;
  state.CityTax = 7;
  state.Spdcycle = 0;

  initWillStuff(context, state);
  initFundingLevelOnState(state);
  markFundsDirty(state);

  state.InitSimLoad = 1;
  state.DoInitialEval = 0;
  doSimInit(context, state);

  return { city, scenario };
}

/**
 * Classic-map guard for orchestration helpers.
 * Mirrors supported classic world size in `ref/micropolis/src/sim/headers/sim.h`.
 */
export function assertClassicMapSize(value: ReplayMapSize): void {
  if (value.width !== World.WORLD_X || value.height !== World.WORLD_Y) {
    throw new Error(`unsupported map size for load orchestration: ${value.width}x${value.height}`);
  }
}
