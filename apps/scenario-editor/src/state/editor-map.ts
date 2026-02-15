import {
  SCENARIO_BUNDLE_V1_MAP_HEIGHT,
  SCENARIO_BUNDLE_V1_MAP_WIDTH,
  type ScenarioBundleV1,
  type ScenarioMapTileWordsV1,
  transcodeScenarioMapTileWordsV1,
} from '@city/scenario-core';

const SCENARIO_EDITOR_TILE_WORD_MASK = 0xffff;

/**
 * One tile coordinate in the fixed Stage 3 editor map.
 * Mirrors Micropolis `Map[x][y]` addressing in `ref/micropolis/src/sim/s_alloc.c`
 * and `ref/micropolis/src/sim/w_sim.c` (`SimCmdTile` bounds + write semantics).
 */
export interface ScenarioEditorMapPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * Normalize editor tile input to the persisted 16-bit map-word domain.
 * Mirrors C `short` assignment behavior from `Map[x][y] = tile` in
 * `ref/micropolis/src/sim/w_sim.c` (`SimCmdTile`) by keeping only the lower 16 bits.
 */
export function normalizeScenarioEditorTileWord(tileWord: number): number {
  return Math.trunc(tileWord) & SCENARIO_EDITOR_TILE_WORD_MASK;
}

/**
 * Convert map coordinates to the canonical Stage 0 linear tile index.
 * Mirrors x-major map storage from `Map[x][y]` setup in `ref/micropolis/src/sim/s_alloc.c`
 * where each x-column spans `WORLD_Y` contiguous words (`index = x * WORLD_Y + y`).
 */
export function getScenarioEditorMapIndex(point: ScenarioEditorMapPoint): number | null {
  if (
    !Number.isInteger(point.x) ||
    !Number.isInteger(point.y) ||
    point.x < 0 ||
    point.x >= SCENARIO_BUNDLE_V1_MAP_WIDTH ||
    point.y < 0 ||
    point.y >= SCENARIO_BUNDLE_V1_MAP_HEIGHT
  ) {
    return null;
  }

  return point.x * SCENARIO_BUNDLE_V1_MAP_HEIGHT + point.y;
}

/**
 * Read the editable map as tile words, transcoding if the bundle currently stores bytes.
 * Reuses Stage 0 map transcoding parity from `@city/scenario-core`, which mirrors
 * `_load_short((&Map[0][0]), WORLD_X * WORLD_Y, ...)` in `ref/micropolis/src/sim/s_fileio.c`.
 */
export function getScenarioEditorMapTileWords(bundle: ScenarioBundleV1): readonly number[] {
  return asTileWordsMap(bundle).tileWords;
}

/**
 * Read one tile word with Micropolis-style bounds guards.
 * Mirrors `SimCmdTile` coordinate validation in `ref/micropolis/src/sim/w_sim.c`:
 * invalid coordinates are rejected; this helper returns `null` instead of TCL error.
 */
export function readScenarioEditorMapTileWord(
  bundle: ScenarioBundleV1,
  point: ScenarioEditorMapPoint,
): number | null {
  const index = getScenarioEditorMapIndex(point);
  if (index === null) {
    return null;
  }

  const tileWord = asTileWordsMap(bundle).tileWords[index];
  return tileWord ?? null;
}

/**
 * Write one tile word immutably into the editor bundle.
 * Mirrors `Map[x][y] = tile` from `SimCmdTile` in `ref/micropolis/src/sim/w_sim.c`
 * with Stage 0 parity difference: output map is normalized to `tile-words` JSON form.
 */
export function writeScenarioEditorMapTileWord(
  bundle: ScenarioBundleV1,
  point: ScenarioEditorMapPoint,
  tileWord: number,
): ScenarioBundleV1 {
  const index = getScenarioEditorMapIndex(point);
  if (index === null) {
    return bundle;
  }

  const tileWordsMap = asTileWordsMap(bundle);
  const currentTileWord = tileWordsMap.tileWords[index];
  if (currentTileWord === undefined) {
    return bundle;
  }

  const normalizedTileWord = normalizeScenarioEditorTileWord(tileWord);
  if (currentTileWord === normalizedTileWord && bundle.map.kind === 'tile-words') {
    return bundle;
  }

  const nextTileWords = tileWordsMap.tileWords.slice();
  nextTileWords[index] = normalizedTileWord;

  return {
    ...bundle,
    map: {
      kind: 'tile-words',
      width: SCENARIO_BUNDLE_V1_MAP_WIDTH,
      height: SCENARIO_BUNDLE_V1_MAP_HEIGHT,
      tileWords: nextTileWords,
    },
  };
}

/**
 * Fill the entire map with one tile word.
 * Mirrors `SimCmdFill` in `ref/micropolis/src/sim/w_sim.c` (`for x/y: Map[x][y] = tile`)
 * while preserving immutable editor state and normalized 16-bit tile words.
 */
export function fillScenarioEditorMapTileWord(
  bundle: ScenarioBundleV1,
  tileWord: number,
): ScenarioBundleV1 {
  const normalizedTileWord = normalizeScenarioEditorTileWord(tileWord);
  const tileWordsMap = asTileWordsMap(bundle);
  const hasDifference = tileWordsMap.tileWords.some((word) => word !== normalizedTileWord);
  if (!hasDifference && bundle.map.kind === 'tile-words') {
    return bundle;
  }

  return {
    ...bundle,
    map: {
      kind: 'tile-words',
      width: SCENARIO_BUNDLE_V1_MAP_WIDTH,
      height: SCENARIO_BUNDLE_V1_MAP_HEIGHT,
      tileWords: new Array<number>(
        SCENARIO_BUNDLE_V1_MAP_WIDTH * SCENARIO_BUNDLE_V1_MAP_HEIGHT,
      ).fill(normalizedTileWord),
    },
  };
}

/**
 * Ensure editor map operations always work over tile-word payloads.
 * Reuses Stage 0 map transcoding parity from `ref/micropolis/src/sim/s_fileio.c`
 * (`_load_short` map-word decode order); parity difference: result is JSON-friendly data.
 */
function asTileWordsMap(bundle: ScenarioBundleV1): ScenarioMapTileWordsV1 {
  return bundle.map.kind === 'tile-words'
    ? bundle.map
    : transcodeScenarioMapTileWordsV1(bundle.map);
}
