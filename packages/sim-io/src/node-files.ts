import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { scenarioFileNameForId } from '../../scenario-core/src/classic-scenarios.ts';
import type { SimContext } from '../../sim-core/src/core/sim-context.ts';
import type { SimState } from '../../sim-core/src/core/sim-state.ts';
import {
  loadCityLikeC,
  type LoadCityLikeCResult,
  loadScenarioLikeC,
  type LoadScenarioLikeCResult,
} from './load.ts';
import { CLASSIC_REPLAY_MAP_SIZE, type ReplayMapSize } from './replay.ts';
import {
  saveCityAsLikeC,
  type SaveCityAsLikeCResult,
  saveCityLikeC,
  type SaveCityLikeCSaveAsRequiredResult,
  type SaveCityLikeCSavedResult,
  saveFileLikeC,
  type SaveFileLikeCResult,
} from './save.ts';

/**
 * Read a binary city/scenario resource from disk.
 * Node-only helper used by `sim-io` orchestration wrappers.
 */
export function readBinaryResource(filePath: string): Uint8Array {
  return new Uint8Array(readFileSync(filePath));
}

/**
 * Write a binary city/scenario resource to disk.
 * Node-only helper used by `sim-io` save orchestration wrappers.
 */
export function writeBinaryResource(filePath: string, bytes: Uint8Array): void {
  writeFileSync(filePath, bytes);
}

/**
 * Run C-style `LoadCity` orchestration from a city filepath.
 * Mirrors `LoadCity(char *filename)` in `ref/micropolis/src/sim/s_fileio.c`.
 */
export function loadCityFromFileLikeC(
  state: SimState,
  context: SimContext,
  filePath: string,
  mapSize: ReplayMapSize = CLASSIC_REPLAY_MAP_SIZE,
): LoadCityLikeCResult {
  return loadCityLikeC(state, context, filePath, readBinaryResource(filePath), mapSize);
}

/**
 * Run C-style `LoadScenario` orchestration from a Micropolis resource directory.
 * Mirrors `_load_file(fname, ResourceDir)` inside `LoadScenario` in
 * `ref/micropolis/src/sim/s_fileio.c`.
 */
export function loadScenarioFromResourceDirLikeC(
  state: SimState,
  context: SimContext,
  resourceDir: string,
  scenarioId: number,
  mapSize: ReplayMapSize = CLASSIC_REPLAY_MAP_SIZE,
): LoadScenarioLikeCResult {
  const fileName = scenarioFileNameForId(scenarioId);
  const filePath = path.join(resourceDir, fileName);
  return loadScenarioLikeC(state, context, scenarioId, readBinaryResource(filePath), mapSize);
}

/**
 * Result payload for `saveFile` path wrappers.
 * Mirrors `saveFile(filename)` in `ref/micropolis/src/sim/s_fileio.c`, with explicit bytes.
 */
export interface SaveFileToPathLikeCResult extends SaveFileLikeCResult {
  filePath: string;
}

/**
 * Result payload for `SaveCity` path wrappers.
 * Mirrors `SaveCity` in `ref/micropolis/src/sim/s_fileio.c` (minus UI eval calls).
 */
export type SaveCityToFileLikeCResult =
  | SaveCityLikeCSaveAsRequiredResult
  | SaveCityToFileLikeCSavedResult;

/**
 * Successful `SaveCity` path wrapper result.
 * Mirrors the `saveFile(CityFileName)` branch in `SaveCity` in
 * `ref/micropolis/src/sim/s_fileio.c`.
 */
export interface SaveCityToFileLikeCSavedResult extends SaveCityLikeCSavedResult {
  filePath: string;
}

/**
 * Result payload for `SaveCityAs` path wrappers.
 * Mirrors `SaveCityAs` in `ref/micropolis/src/sim/s_fileio.c` (minus UI eval calls).
 */
export interface SaveCityAsToFileLikeCResult extends SaveCityAsLikeCResult {
  filePath: string;
}

/**
 * Run C-style `saveFile` orchestration and write bytes to disk.
 * Mirrors `saveFile(char *filename)` in `ref/micropolis/src/sim/s_fileio.c` (1:1 data packing),
 * with explicit Node `writeFileSync` I/O instead of C `fwrite`.
 */
export function saveFileToPathLikeC(
  state: SimState,
  context: SimContext,
  filePath: string,
  mapSize: ReplayMapSize = CLASSIC_REPLAY_MAP_SIZE,
): SaveFileToPathLikeCResult {
  const result = saveFileLikeC(state, context, mapSize);
  writeBinaryResource(filePath, result.cityBytes);
  return { filePath, ...result };
}

/**
 * Run C-style `SaveCity` orchestration and write bytes when possible.
 * Mirrors `SaveCity()` in `ref/micropolis/src/sim/s_fileio.c` (minus UI eval calls).
 */
export function saveCityToFileLikeC(
  state: SimState,
  context: SimContext,
  cityFileName: string | null,
  mapSize: ReplayMapSize = CLASSIC_REPLAY_MAP_SIZE,
): SaveCityToFileLikeCResult {
  const result = saveCityLikeC(state, context, cityFileName, mapSize);
  if (result.action === 'save-as-required') {
    return result;
  }

  writeBinaryResource(result.cityFileName, result.cityBytes);
  return {
    ...result,
    filePath: result.cityFileName,
  };
}

/**
 * Run C-style `SaveCityAs` orchestration and write bytes to the selected path.
 * Mirrors `SaveCityAs(char *filename)` in `ref/micropolis/src/sim/s_fileio.c` (minus UI eval calls).
 */
export function saveCityAsToFileLikeC(
  state: SimState,
  context: SimContext,
  filePath: string,
  mapSize: ReplayMapSize = CLASSIC_REPLAY_MAP_SIZE,
): SaveCityAsToFileLikeCResult {
  const result = saveCityAsLikeC(state, context, filePath, mapSize);
  writeBinaryResource(result.cityFileName, result.cityBytes);
  return {
    ...result,
    filePath: result.cityFileName,
  };
}
