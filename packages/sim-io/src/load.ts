import {
  cityTimeForScenarioYear,
  getScenarioDefinition,
  type ScenarioDefinition,
} from '../../scenario-core/src/classic-scenarios.ts';
import type { ScenarioBundleV1 } from '../../scenario-core/src/scenario-bundle-v1.ts';
import {
  readScenarioMapTileWordsV1,
  SCENARIO_BUNDLE_V1_CITY_FILE_BYTE_LENGTH,
  SCENARIO_BUNDLE_V1_CITY_FILE_MAP_OFFSET_BYTES,
} from '../../scenario-core/src/scenario-map-v1.ts';
import { World } from '../../sim-core/src/core/constants.ts';
import type { SimContext } from '../../sim-core/src/core/sim-context.ts';
import type { SimState } from '../../sim-core/src/core/sim-state.ts';
import { type CityFile, decodeCityFileForMap, readCityMeta } from '../../sim-core/src/io/cty.ts';
import { applyLoadedCityMetaToState } from '../../sim-core/src/io/cty-state.ts';
import { markFundsDirty } from '../../sim-core/src/systems/date-time.ts';
import { setFunds } from '../../sim-core/src/systems/funds.ts';
import { doSimInit, initWillStuff } from '../../sim-core/src/systems/init.ts';
import { CLASSIC_REPLAY_MAP_SIZE, type ReplayMapSize } from './replay.ts';

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
 * Result payload for Stage 2 user-scenario startup orchestration.
 * Mirrors `LoadScenario` start-state ownership in `ref/micropolis/src/sim/s_fileio.c`.
 * Parity note: unlike classic C `LoadScenario(short s)`, this carries `user/*`
 * key/name metadata from `ScenarioBundleV1` instead of a numeric scenario table row.
 */
export interface LoadScenarioBundleLikeCResult extends LoadFileLikeCResult {
  scenarioKey: string;
  scenarioName: string;
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
 * Apply C `setSpeed(short)` scalar side effects used by load/scenario flows.
 * Mirrors `setSpeed` in `ref/micropolis/src/sim/w_util.c` for `SimMetaSpeed`
 * and `SimSpeed` assignment/clamping.
 *
 * Parity note: `sim_paused`/timer callbacks are host-owned in TypeScript, so
 * this helper only applies persisted simulation speed scalars.
 */
function applyLoadedSpeedLikeC(state: SimState, value: number): void {
  let speed = Math.trunc(value);
  if (speed < 0) {
    speed = 0;
  } else if (speed > 3) {
    speed = 3;
  }

  state.SimMetaSpeed = speed;
  state.SimSpeed = speed;
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
  // C `loadFile` calls `setSpeed(SimSpeed)` after loading metadata.
  applyLoadedSpeedLikeC(state, state.SimSpeed);
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

  // C `LoadScenario` applies `setSpeed(3)`.
  applyLoadedSpeedLikeC(state, 3);
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
 * Compile one Stage 0 scenario bundle map into classic city-file bytes.
 * Mirrors map-byte layout from `saveFile`/`loadFile` in
 * `ref/micropolis/src/sim/s_fileio.c` for `WORLD_X * WORLD_Y` map words.
 * Parity difference: history/misc regions are intentionally zeroed for
 * deterministic bundle map payloads.
 */
function compileScenarioBundleMapToCityFileBytes(bundle: ScenarioBundleV1): Uint8Array {
  const tileWords = readScenarioMapTileWordsV1(bundle.map);
  const cityFileBytes = new Uint8Array(SCENARIO_BUNDLE_V1_CITY_FILE_BYTE_LENGTH);
  const cityFileView = new DataView(cityFileBytes.buffer, cityFileBytes.byteOffset);

  for (let index = 0; index < tileWords.length; index += 1) {
    const byteOffset = SCENARIO_BUNDLE_V1_CITY_FILE_MAP_OFFSET_BYTES + index * 2;
    cityFileView.setUint16(byteOffset, tileWords[index] ?? 0, false);
  }

  return cityFileBytes;
}

/**
 * Run C-style scenario startup orchestration from a Stage 0 bundle payload.
 * Mirrors `LoadScenario` in `ref/micropolis/src/sim/s_fileio.c` for load/init
 * sequencing (`setSpeed(3)`, `CityTax=7`, funding reset, `DoSimInit`).
 * Parity difference: `ScenarioID` is forced to `0` (no legacy numeric id) and
 * `CityTime`/funds come from bundle start parameters.
 */
export function loadScenarioBundleLikeC(
  state: SimState,
  context: SimContext,
  bundle: ScenarioBundleV1,
  mapSize: ReplayMapSize = CLASSIC_REPLAY_MAP_SIZE,
): LoadScenarioBundleLikeCResult {
  const city = decodeCityFileForMap(compileScenarioBundleMapToCityFileBytes(bundle), mapSize);
  applyDecodedCityToRuntime(state, context, city);

  state.ScenarioID = 0;
  state.CityTime = cityTimeForScenarioYear(bundle.start.startYear);
  setFunds(state, bundle.start.startFunds);

  // C `LoadScenario` applies `setSpeed(3)`.
  applyLoadedSpeedLikeC(state, 3);
  state.CityTax = 7;
  state.Spdcycle = 0;

  initWillStuff(context, state);
  initFundingLevelOnState(state);
  markFundsDirty(state);

  state.InitSimLoad = 1;
  state.DoInitialEval = 0;
  doSimInit(context, state);

  return {
    city,
    scenarioKey: bundle.key,
    scenarioName: bundle.name,
  };
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
