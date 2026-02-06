import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { SimContext } from '../../sim-core/src/core/sim-context.ts';
import type { SimState } from '../../sim-core/src/core/sim-state.ts';
import {
  loadCityLikeC,
  type LoadCityLikeCResult,
  loadScenarioLikeC,
  type LoadScenarioLikeCResult,
} from './load.ts';
import { CLASSIC_REPLAY_MAP_SIZE, type ReplayMapSize } from './replay.ts';
import { scenarioFileNameForId } from './scenarios.ts';

/**
 * Read a binary city/scenario resource from disk.
 * Node-only helper used by `sim-io` orchestration wrappers.
 */
export function readBinaryResource(filePath: string): Uint8Array {
  return new Uint8Array(readFileSync(filePath));
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
