import {
  SCENARIO_BUNDLE_V1_MAP_HEIGHT,
  SCENARIO_BUNDLE_V1_MAP_WIDTH,
  type ScenarioBundleV1,
  type ScenarioMapTileWordsV1,
  transcodeScenarioMapTileWordsV1,
} from '@city/scenario-core';
import {
  applyToolAction,
  createClassicMapStore,
  createToolContext,
  MicropolisRng,
  TileMask,
} from '@city/sim-core';

const SCENARIO_EDITOR_TILE_WORD_MASK = 0xffff;
const SCENARIO_EDITOR_TOOL_FUNDS = 1_000_000_000;
const SCENARIO_EDITOR_TOOL_RNG_SEED = 0x00c17e77;
const SCENARIO_EDITOR_MAP_TOOL_ACTION_DEFAULTS = {
  simStep: 0,
  order: 0,
  tickId: 0,
  seq: 0,
} as const;

/**
 * Tool names exposed by the scenario map editor.
 * Mirrors playable tool coverage routed through `do_tool` in
 * `ref/micropolis/src/sim/w_tool.c`; parity note: this omits editor-only C states
 * (`chalk`, `eraser`, `network`) that are not exposed by the current web toolbar.
 */
export const SCENARIO_EDITOR_MAP_TOOLS = [
  'res',
  'com',
  'ind',
  'fire',
  'query',
  'police',
  'wire',
  'bulldoze',
  'rail',
  'road',
  'stadium',
  'park',
  'seaport',
  'coal',
  'nuclear',
  'airport',
] as const;

/**
 * Scenario map editor tool identifier.
 * Mirrors `tool_state`-backed names from `ref/micropolis/src/sim/w_tool.c`
 * exposed by the current playable runtime tool palette.
 */
export type ScenarioEditorMapTool = (typeof SCENARIO_EDITOR_MAP_TOOLS)[number];

/**
 * Base-tile write options for map painting.
 * Mirrors Micropolis low-10-bit tile id semantics from `sim.h`; preserving flags
 * keeps status bits (`PWRBIT`, `ZONEBIT`, etc.) while replacing only base tile id.
 */
export interface ScenarioEditorMapBaseTileWriteOptions {
  readonly preserveFlags?: boolean;
}

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
 * Normalize base tile id input to Micropolis low-10-bit tile id domain.
 * Mirrors `LOMASK` masking in `ref/micropolis/src/sim/headers/sim.h`.
 */
export function normalizeScenarioEditorBaseTileId(baseTileId: number): number {
  return Math.trunc(baseTileId) & TileMask.LOMASK;
}

/**
 * Write one base tile id while optionally preserving status flags.
 * Mirrors C tile word layout in `ref/micropolis/src/sim/headers/sim.h` where
 * low bits are tile id and high bits are status flags (`ALLBITS` mask).
 */
export function writeScenarioEditorMapBaseTileId(
  bundle: ScenarioBundleV1,
  point: ScenarioEditorMapPoint,
  baseTileId: number,
  options: ScenarioEditorMapBaseTileWriteOptions = {},
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

  const nextTileWord = toScenarioEditorBaseTileWord(currentTileWord, baseTileId, options);
  if (nextTileWord === currentTileWord && bundle.map.kind === 'tile-words') {
    return bundle;
  }

  const nextTileWords = tileWordsMap.tileWords.slice();
  nextTileWords[index] = nextTileWord;

  return toScenarioEditorTileWordsBundle(bundle, nextTileWords);
}

/**
 * Fill the entire map with one base tile id.
 * Mirrors whole-map assignment semantics from `SimCmdFill` in
 * `ref/micropolis/src/sim/w_sim.c`, applied only to low tile-id bits.
 */
export function fillScenarioEditorMapBaseTileId(
  bundle: ScenarioBundleV1,
  baseTileId: number,
  options: ScenarioEditorMapBaseTileWriteOptions = {},
): ScenarioBundleV1 {
  const tileWordsMap = asTileWordsMap(bundle);
  const nextTileWords = tileWordsMap.tileWords.map((tileWord) =>
    toScenarioEditorBaseTileWord(tileWord, baseTileId, options),
  );
  const hasDifference = nextTileWords.some((tileWord, index) => {
    const current = tileWordsMap.tileWords[index];
    return current !== undefined && current !== tileWord;
  });

  if (!hasDifference && bundle.map.kind === 'tile-words') {
    return bundle;
  }

  return toScenarioEditorTileWordsBundle(bundle, nextTileWords);
}

/**
 * Apply one Micropolis tool at a map coordinate and persist resulting tile words.
 * Mirrors `DoTool`/`do_tool` behavior from `ref/micropolis/src/sim/w_tool.c`
 * via sim-core C-parity tool tables and placement rules.
 */
export function applyScenarioEditorMapToolAtPoint(
  bundle: ScenarioBundleV1,
  point: ScenarioEditorMapPoint,
  tool: ScenarioEditorMapTool,
): ScenarioBundleV1 {
  const index = getScenarioEditorMapIndex(point);
  if (index === null) {
    return bundle;
  }

  const tileWordsMap = asTileWordsMap(bundle);
  const store = createClassicMapStore();
  const initialMapLayer = store.snapshot('map');
  if (!(initialMapLayer instanceof Uint16Array)) {
    throw new Error('expected uint16 map layer');
  }
  initialMapLayer.set(tileWordsMap.tileWords);

  store.beginTick();
  const context = createToolContext({
    store,
    rng: new MicropolisRng(SCENARIO_EDITOR_TOOL_RNG_SEED),
    funds: SCENARIO_EDITOR_TOOL_FUNDS,
    autoBulldoze: true,
    doAnimation: false,
    players: 1,
    overrideCost: true,
    superUser: true,
  });
  applyToolAction(context, {
    ...SCENARIO_EDITOR_MAP_TOOL_ACTION_DEFAULTS,
    tool,
    x: point.x,
    y: point.y,
  });
  const tickResult = store.commitTick();
  if (tickResult.patches.length === 0) {
    return bundle;
  }

  const nextMapLayer = store.snapshot('map');
  if (!(nextMapLayer instanceof Uint16Array)) {
    throw new Error('expected uint16 map layer');
  }

  return toScenarioEditorTileWordsBundle(bundle, Array.from(nextMapLayer));
}

/**
 * Runtime guard for map tool ids selected from form controls.
 * Mirrors closed tool dispatch set for `do_tool` in `w_tool.c`.
 */
export function isScenarioEditorMapTool(value: string): value is ScenarioEditorMapTool {
  return SCENARIO_EDITOR_MAP_TOOL_SET.has(value as ScenarioEditorMapTool);
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

const SCENARIO_EDITOR_MAP_TOOL_SET = new Set<ScenarioEditorMapTool>(SCENARIO_EDITOR_MAP_TOOLS);

/**
 * Convert one tile word to a next tile word with replaced low tile-id bits.
 * Mirrors low/high tile-word split in `sim.h` (`LOMASK`/`ALLBITS`).
 */
function toScenarioEditorBaseTileWord(
  tileWord: number,
  baseTileId: number,
  options: ScenarioEditorMapBaseTileWriteOptions,
): number {
  const preserveFlags = options.preserveFlags ?? true;
  const normalizedBaseTileId = normalizeScenarioEditorBaseTileId(baseTileId);
  const normalizedTileWord = normalizeScenarioEditorTileWord(tileWord);

  if (!preserveFlags) {
    return normalizedBaseTileId;
  }

  return (normalizedTileWord & TileMask.ALLBITS) | normalizedBaseTileId;
}

/**
 * Persist one full tile-word map payload into canonical editor bundle form.
 * Mirrors Stage 0 canonical map writing to `tile-words` JSON representation.
 */
function toScenarioEditorTileWordsBundle(
  bundle: ScenarioBundleV1,
  tileWords: readonly number[],
): ScenarioBundleV1 {
  return {
    ...bundle,
    map: {
      kind: 'tile-words',
      width: SCENARIO_BUNDLE_V1_MAP_WIDTH,
      height: SCENARIO_BUNDLE_V1_MAP_HEIGHT,
      tileWords: [...tileWords],
    },
  };
}
