import type { SimContext } from '../../sim-core/src/core/sim-context.ts';
import type { SimState } from '../../sim-core/src/core/sim-state.ts';
import {
  CITY_HISTORY_LENGTH,
  CITY_MISC_LENGTH,
  type CityFile,
  createCityFile,
  encodeCityFile,
  writeCityMeta,
} from '../../sim-core/src/io/cty.ts';
import { cityMetaFromState } from '../../sim-core/src/io/cty-state.ts';
import { assertClassicMapSize, deriveCityNameFromPath } from './load.ts';
import { CLASSIC_REPLAY_MAP_SIZE, type ReplayMapSize } from './replay.ts';

/**
 * Result payload for C-style `saveFile` orchestration.
 * Mirrors `saveFile` in `ref/micropolis/src/sim/s_fileio.c` (1:1 data packing),
 * but intentionally returns bytes instead of writing a filesystem path.
 */
export interface SaveFileLikeCResult {
  city: CityFile;
  cityBytes: Uint8Array;
}

/**
 * Successful `SaveCity` result when `CityFileName` is already known.
 * Mirrors the `saveFile(CityFileName)` branch in `SaveCity` in
 * `ref/micropolis/src/sim/s_fileio.c`.
 */
export interface SaveCityLikeCSavedResult extends SaveFileLikeCResult {
  action: 'saved';
  cityFileName: string;
}

/**
 * `SaveCity` result when no `CityFileName` exists yet.
 * Mirrors `DoSaveCityAs()` in `SaveCity` in `ref/micropolis/src/sim/s_fileio.c`.
 */
export interface SaveCityLikeCSaveAsRequiredResult {
  action: 'save-as-required';
}

/**
 * Union result for C-style `SaveCity` orchestration.
 * Mirrors `SaveCity` in `ref/micropolis/src/sim/s_fileio.c` (minus UI eval calls).
 */
export type SaveCityLikeCResult = SaveCityLikeCSavedResult | SaveCityLikeCSaveAsRequiredResult;

/**
 * Result payload for C-style `SaveCityAs` orchestration.
 * Mirrors `SaveCityAs` in `ref/micropolis/src/sim/s_fileio.c` (minus UI eval calls).
 */
export interface SaveCityAsLikeCResult extends SaveFileLikeCResult {
  cityFileName: string;
  cityName: string;
}

/**
 * Copy one history buffer into a `.cty` payload.
 * Mirrors fixed-size `HISTLEN / 2` short writes in `saveFile` in
 * `ref/micropolis/src/sim/s_fileio.c`.
 */
function copyHistoryLikeC(target: Int16Array, source: Int16Array, name: string): void {
  if (source.length < CITY_HISTORY_LENGTH) {
    throw new Error(`state ${name} length is smaller than ${CITY_HISTORY_LENGTH}`);
  }
  target.set(source.subarray(0, CITY_HISTORY_LENGTH));
}

/**
 * Build a serializable city snapshot from runtime buffers.
 * Mirrors `saveFile` in `ref/micropolis/src/sim/s_fileio.c`:
 * - pack state scalars into `MiscHis`
 * - write fixed-size history/misc/map buffers in C order.
 */
function createCityForSaveLikeC(
  state: SimState,
  context: SimContext,
  mapSize: ReplayMapSize,
): CityFile {
  assertClassicMapSize(mapSize);

  // C `saveFile` writes these runtime values directly into `MiscHis` before persisting.
  writeCityMeta(state.MiscHis, cityMetaFromState(state));

  if (state.MiscHis.length < CITY_MISC_LENGTH) {
    throw new Error(`state MiscHis length is smaller than ${CITY_MISC_LENGTH}`);
  }

  const city = createCityFile(mapSize);
  copyHistoryLikeC(city.histories.res, state.ResHis, 'ResHis');
  copyHistoryLikeC(city.histories.com, state.ComHis, 'ComHis');
  copyHistoryLikeC(city.histories.ind, state.IndHis, 'IndHis');
  copyHistoryLikeC(city.histories.crime, state.CrimeHis, 'CrimeHis');
  copyHistoryLikeC(city.histories.pollution, state.PollutionHis, 'PollutionHis');
  copyHistoryLikeC(city.histories.money, state.MoneyHis, 'MoneyHis');
  city.misc.set(state.MiscHis.subarray(0, CITY_MISC_LENGTH));

  const map = context.store.snapshot('map');
  if (!(map instanceof Uint16Array)) {
    throw new Error('map layer must be Uint16Array');
  }
  if (map.length < city.map.length) {
    throw new Error(`map layer length ${map.length} is smaller than ${city.map.length}`);
  }
  city.map.set(map.subarray(0, city.map.length));

  return city;
}

/**
 * Run C-style `saveFile` orchestration and return encoded bytes.
 * Mirrors `saveFile` in `ref/micropolis/src/sim/s_fileio.c` (1:1 data layout and packing),
 * with the intentional difference that disk I/O is delegated to caller wrappers.
 */
export function saveFileLikeC(
  state: SimState,
  context: SimContext,
  mapSize: ReplayMapSize = CLASSIC_REPLAY_MAP_SIZE,
): SaveFileLikeCResult {
  const city = createCityForSaveLikeC(state, context, mapSize);
  const cityBytes = encodeCityFile(city);
  return { city, cityBytes };
}

/**
 * Run C-style `SaveCity` orchestration.
 * Mirrors `SaveCity` in `ref/micropolis/src/sim/s_fileio.c` (minus UI eval calls):
 * - if no filename, request save-as flow
 * - otherwise persist using `saveFile`.
 */
export function saveCityLikeC(
  state: SimState,
  context: SimContext,
  cityFileName: string | null,
  mapSize: ReplayMapSize = CLASSIC_REPLAY_MAP_SIZE,
): SaveCityLikeCResult {
  if (cityFileName == null) {
    return { action: 'save-as-required' };
  }

  return {
    action: 'saved',
    cityFileName,
    ...saveFileLikeC(state, context, mapSize),
  };
}

/**
 * Run C-style `SaveCityAs` orchestration.
 * Mirrors `SaveCityAs` in `ref/micropolis/src/sim/s_fileio.c` (minus UI eval calls):
 * - sets `CityFileName` to the requested path
 * - derives city name using the same truncate-then-basename string behavior.
 */
export function saveCityAsLikeC(
  state: SimState,
  context: SimContext,
  cityFileName: string,
  mapSize: ReplayMapSize = CLASSIC_REPLAY_MAP_SIZE,
): SaveCityAsLikeCResult {
  return {
    cityFileName,
    cityName: deriveCityNameFromPath(cityFileName),
    ...saveFileLikeC(state, context, mapSize),
  };
}
