import {
  SCENARIO_BUNDLE_V1_MAP_HEIGHT,
  SCENARIO_BUNDLE_V1_MAP_WIDTH,
  type ScenarioBundleV1,
  type ScenarioMapTileWordsV1,
  transcodeScenarioMapTileWordsV1,
} from '@city/scenario-core';
import {
  applyToolAction,
  coalSmoke,
  comPlop,
  countFreeZoneHouses,
  createBridgeHandler,
  createClassicMapStore,
  createRailHandler,
  createRoadHandler,
  createSimContext,
  createSimState,
  createToolContext,
  createZoneSystem,
  czPop,
  indPlop,
  izPop,
  makeTraf,
  type MapScanContext,
  mapScanSlice,
  MicropolisRng,
  resPlop,
  rzPop,
  setSmoke,
  smoothRiver,
  smoothTrees,
  smoothWater,
  Tile,
  TileFlag,
  TileMask,
  zonePlop,
} from '@city/sim-core';

import {
  doPowerScan,
  pushPowerStack,
  setZPowerAt,
} from '../../../../packages/sim-core/src/systems/power.ts';

const SCENARIO_EDITOR_TILE_WORD_MASK = 0xffff;
const SCENARIO_EDITOR_TOOL_FUNDS = 1_000_000_000;
const SCENARIO_EDITOR_TOOL_RNG_SEED = 0x00c17e77;
const SCENARIO_EDITOR_ZONE_PLACEMENT_RNG_SEED = 0x00c1de55;
const SCENARIO_EDITOR_TERRAIN_SMOOTH_RNG_SEED = 0x001ce5ee;
const SCENARIO_EDITOR_DERIVE_SIM_RNG_SEED = 0x00517a9e;
const SCENARIO_EDITOR_MAP_TOOL_ACTION_DEFAULTS = {
  simStep: 0,
  order: 0,
  tickId: 0,
  seq: 0,
} as const;
const SCENARIO_EDITOR_LOCAL_TERRAIN_RECOMPUTE_RADIUS = 4;
const SCENARIO_EDITOR_DERIVE_SIM_TICK_COUNT_DEFAULT = 16;
const SCENARIO_EDITOR_DERIVE_SIM_TICK_COUNT_MAX = 512;
const SCENARIO_EDITOR_DERIVE_TRAFFIC_ROAD_DENSITY_LIGHT = 96;
const SCENARIO_EDITOR_DERIVE_TRAFFIC_ROAD_DENSITY_HEAVY = 224;
const { ANIMBIT, BURNBIT, CONDBIT } = TileFlag;

/**
 * Editor-only special-zone identifiers for explicit scenario snapshot authoring.
 * Mirrors hospital/church `ZonePlop` placements in `ref/micropolis/src/sim/s_zone.c`.
 */
export type ScenarioEditorMapSpecialZoneKind = 'hospital' | 'church';

/**
 * Options for one "derive simulation" pass from authored map state.
 * Mirrors selected deterministic subsystems from `ref/micropolis/src/sim/s_sim.c`
 * without enabling full city growth/disaster runtime.
 */
export interface ScenarioEditorMapDeriveSimulationOptions {
  readonly ticks?: number;
}

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
 * Scenario editor zone-growth domains for direct R/C/I level authoring.
 * Mirrors zone family handlers in `DoResidential` / `DoCommercial` / `DoIndustrial`
 * from `ref/micropolis/src/sim/s_zone.c`.
 */
export const SCENARIO_EDITOR_MAP_ZONE_KINDS = ['res', 'com', 'ind'] as const;

/**
 * Scenario editor zone family identifier for density-level plop actions.
 * Mirrors the three classic zone families in `ref/micropolis/src/sim/s_zone.c`.
 */
export type ScenarioEditorMapZoneKind = (typeof SCENARIO_EDITOR_MAP_ZONE_KINDS)[number];

/**
 * Density/value controls for direct zone-level placement.
 * Mirrors `ResPlop` / `ComPlop` / `IndPlop` formulas in
 * `ref/micropolis/src/sim/s_zone.c` where `den` is zone level and `value`
 * follows zone-family constraints (`GetCRVal` 0..3 for R/C, `Rand16() & 1` for I).
 */
export interface ScenarioEditorMapZoneLevelOptions {
  readonly level: number;
  readonly value: number;
  readonly zone: ScenarioEditorMapZoneKind;
}

/**
 * Named base-tile entry sourced from classic tile constants.
 * Mirrors the "Character Mapping" table in `ref/micropolis/src/sim/headers/sim.h`
 * and exposes every named low-10-bit tile id for editor selection.
 * Parity difference: labels are curated UI-friendly names rather than raw C constants.
 */
export interface ScenarioEditorMapNamedBaseTile {
  readonly label: string;
  readonly name: string;
  readonly tileId: number;
}

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
 * Terrain post-processing mode for scenario map edits.
 * Mirrors Micropolis terrain smoothing routines from `ref/micropolis/src/sim/s_gen.c`:
 * - `global`: run smoothing over the whole map.
 * - `local`: run smoothing globally, but persist only a bounded neighborhood around one edit.
 * - `off`: skip terrain smoothing entirely for exact tile authoring.
 */
export type ScenarioEditorMapTerrainRecomputeMode = 'global' | 'local' | 'off';

/**
 * Terrain post-processing options for one editor map mutation.
 * Mirrors `SmoothTrees`/`SmoothWater`/`SmoothRiver` usage in Micropolis terrain tooling
 * (`ref/micropolis/src/sim/terrain/terra.c`) while allowing local-only persistence in the
 * web editor to reduce unrelated map churn.
 */
export interface ScenarioEditorMapTerrainRecomputeOptions {
  readonly mode?: ScenarioEditorMapTerrainRecomputeMode;
  readonly center?: ScenarioEditorMapPoint;
  readonly radius?: number;
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
 * Return all named base tiles available in classic Micropolis constants.
 * Mirrors `#define` tile-id labels in `ref/micropolis/src/sim/headers/sim.h`.
 */
export function getScenarioEditorMapNamedBaseTiles(): readonly ScenarioEditorMapNamedBaseTile[] {
  return SCENARIO_EDITOR_MAP_NAMED_BASE_TILES;
}

/**
 * Resolve one named base tile entry by constant name.
 * Mirrors direct tile label lookup from Micropolis `sim.h` constants.
 */
export function findScenarioEditorMapNamedBaseTileByName(
  name: string,
): ScenarioEditorMapNamedBaseTile | undefined {
  return SCENARIO_EDITOR_MAP_NAMED_BASE_TILE_BY_NAME.get(name);
}

/**
 * Resolve one named base tile entry by low-10-bit tile id.
 * Mirrors tile-id to named constant mapping from Micropolis `sim.h`.
 */
export function findScenarioEditorMapNamedBaseTileById(
  baseTileId: number,
): ScenarioEditorMapNamedBaseTile | undefined {
  return SCENARIO_EDITOR_MAP_NAMED_BASE_TILE_BY_ID.get(
    normalizeScenarioEditorBaseTileId(baseTileId),
  );
}

/**
 * Resolve max value class for one zone family.
 * Mirrors `DoIndustrial` in `ref/micropolis/src/sim/s_zone.c` which calls
 * `DoIndIn`/`DoIndOut` with `Rand16() & 1` (industrial value domain 0..1), while
 * residential/commercial use `GetCRVal` (0..3).
 */
export function getScenarioEditorMapZoneMaxValue(zone: ScenarioEditorMapZoneKind): number {
  if (zone === 'ind') {
    return 1;
  }
  return 3;
}

/**
 * Normalize zone-value class to the valid C domain for one zone family.
 * Mirrors `GetCRVal` bounds in `ref/micropolis/src/sim/s_zone.c` for R/C and
 * `Rand16() & 1` industrial value selection in `DoIndustrial`.
 */
export function normalizeScenarioEditorMapZoneValue(
  zone: ScenarioEditorMapZoneKind,
  value: number,
): number {
  return clamp(Math.trunc(value), 0, getScenarioEditorMapZoneMaxValue(zone));
}

/**
 * Resolve max density level for one zone family.
 * Mirrors `ResPlop`/`ComPlop`/`IndPlop` density domains in
 * `ref/micropolis/src/sim/s_zone.c` (`den` ranges: res/ind 0..3, com 0..4).
 */
export function getScenarioEditorMapZoneMaxLevel(zone: ScenarioEditorMapZoneKind): number {
  if (zone === 'com') {
    return 5;
  }
  return 4;
}

/**
 * Normalize editor zone level input to the valid C density domain.
 * Mirrors `den` bounds used by `ResPlop` / `ComPlop` / `IndPlop` formulas in
 * `ref/micropolis/src/sim/s_zone.c`.
 */
export function normalizeScenarioEditorMapZoneLevel(
  zone: ScenarioEditorMapZoneKind,
  level: number,
): number {
  return clamp(Math.trunc(level), 1, getScenarioEditorMapZoneMaxLevel(zone));
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
 * Recompute terrain-edge tiles after editor map mutation.
 * Mirrors terrain post-processing routines from `ref/micropolis/src/sim/s_gen.c`
 * and terraforming tooling from `ref/micropolis/src/sim/terrain/terra.c` by applying
 * `SmoothTrees` (twice), `SmoothWater`, and `SmoothRiver`.
 * Parity note: local mode keeps smoothing deterministic but persists only a bounded window.
 */
export function recomputeScenarioEditorMapTerrain(
  bundle: ScenarioBundleV1,
  options: ScenarioEditorMapTerrainRecomputeOptions = {},
): ScenarioBundleV1 {
  const mode = options.mode ?? 'global';
  if (mode === 'off') {
    return bundle;
  }

  const tileWordsMap = asTileWordsMap(bundle);
  const smoothedMap = Uint16Array.from(tileWordsMap.tileWords);
  applyScenarioEditorTerrainSmoothing(smoothedMap);

  if (mode === 'local') {
    return applyScenarioEditorLocalTerrainRecompute(bundle, tileWordsMap, smoothedMap, options);
  }

  let changed = false;
  for (let index = 0; index < smoothedMap.length; index += 1) {
    if (smoothedMap[index] !== tileWordsMap.tileWords[index]) {
      changed = true;
      break;
    }
  }

  if (!changed && bundle.map.kind === 'tile-words') {
    return bundle;
  }

  return toScenarioEditorTileWordsBundle(bundle, Array.from(smoothedMap));
}

/**
 * Apply the classic terrain smoothing stack on a mutable map buffer.
 * Mirrors "smooth both" terraforming flow in `ref/micropolis/src/sim/terrain/terra.c`:
 * `SmoothWater`/`SmoothRiver` for water and `SmoothTrees` twice for forests.
 */
function applyScenarioEditorTerrainSmoothing(map: Uint16Array): void {
  const rng = new MicropolisRng(SCENARIO_EDITOR_TERRAIN_SMOOTH_RNG_SEED);
  smoothTrees(map);
  smoothTrees(map);
  smoothWater(map);
  smoothRiver(map, rng);
}

/**
 * Persist only a local window from a globally smoothed map.
 * Parity difference from C: smoothing still runs with the full map context, but only a bounded
 * area around one edit is written back to reduce unrelated editor churn.
 */
function applyScenarioEditorLocalTerrainRecompute(
  bundle: ScenarioBundleV1,
  tileWordsMap: ScenarioMapTileWordsV1,
  smoothedMap: Uint16Array,
  options: ScenarioEditorMapTerrainRecomputeOptions,
): ScenarioBundleV1 {
  const bounds = resolveScenarioEditorLocalRecomputeBounds(options.center, options.radius);
  if (bounds === null) {
    if (bundle.map.kind === 'tile-words') {
      return bundle;
    }
    return toScenarioEditorTileWordsBundle(bundle, tileWordsMap.tileWords);
  }

  const nextTileWords = tileWordsMap.tileWords.slice();
  let changed = false;
  for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
    const xOffset = x * SCENARIO_BUNDLE_V1_MAP_HEIGHT;
    for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
      const index = xOffset + y;
      const nextTileWord = smoothedMap[index];
      const currentTileWord = nextTileWords[index];
      if (
        nextTileWord === undefined ||
        currentTileWord === undefined ||
        nextTileWord === currentTileWord
      ) {
        continue;
      }
      nextTileWords[index] = nextTileWord;
      changed = true;
    }
  }

  if (!changed && bundle.map.kind === 'tile-words') {
    return bundle;
  }

  return toScenarioEditorTileWordsBundle(bundle, nextTileWords);
}

/**
 * Resolve and clamp the local terrain recompute window.
 * Not from Micropolis C: editor-only neighborhood persistence control over otherwise
 * full-map smoothing passes.
 */
function resolveScenarioEditorLocalRecomputeBounds(
  center: ScenarioEditorMapPoint | undefined,
  radius: number | undefined,
): { minX: number; maxX: number; minY: number; maxY: number } | null {
  if (center === undefined) {
    return null;
  }
  if (getScenarioEditorMapIndex(center) === null) {
    return null;
  }

  const normalizedRadius = normalizeScenarioEditorLocalRecomputeRadius(radius);
  return {
    minX: Math.max(0, center.x - normalizedRadius),
    maxX: Math.min(SCENARIO_BUNDLE_V1_MAP_WIDTH - 1, center.x + normalizedRadius),
    minY: Math.max(0, center.y - normalizedRadius),
    maxY: Math.min(SCENARIO_BUNDLE_V1_MAP_HEIGHT - 1, center.y + normalizedRadius),
  };
}

/**
 * Clamp the local recompute radius to a practical editor-safe range.
 * Not from Micropolis C: this bounds user-driven editor parameters for deterministic behavior.
 */
function normalizeScenarioEditorLocalRecomputeRadius(radius: number | undefined): number {
  if (radius === undefined || !Number.isFinite(radius)) {
    return SCENARIO_EDITOR_LOCAL_TERRAIN_RECOMPUTE_RADIUS;
  }
  return clamp(Math.trunc(radius), 1, 32);
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
 * Place one R/C/I zone at a chosen density/value level.
 * Mirrors `ResPlop` / `ComPlop` / `IndPlop` + `ZonePlop` in
 * `ref/micropolis/src/sim/s_zone.c` for explicit scenario authoring of zone state.
 */
export function applyScenarioEditorMapZoneLevelAtPoint(
  bundle: ScenarioBundleV1,
  point: ScenarioEditorMapPoint,
  options: ScenarioEditorMapZoneLevelOptions,
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

  const zone = options.zone;
  const level = normalizeScenarioEditorMapZoneLevel(zone, options.level);
  const value = normalizeScenarioEditorMapZoneValue(zone, options.value);

  store.beginTick();
  const state = createSimState();
  const context = createSimContext({
    store,
    rng: new MicropolisRng(SCENARIO_EDITOR_ZONE_PLACEMENT_RNG_SEED),
  });
  const zoneSystem = createZoneSystem(state, context);

  if (zone === 'res') {
    resPlop(zoneSystem, point.x, point.y, level - 1, value);
  } else if (zone === 'com') {
    comPlop(zoneSystem, point.x, point.y, level - 1, value);
  } else {
    indPlop(zoneSystem, point.x, point.y, level - 1, value);
  }

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
 * Place one hospital/church 3x3 special zone at a target center tile.
 * Mirrors `ZonePlop(HOSPITAL - 4)` / `ZonePlop(CHURCH - 4)` in
 * `ref/micropolis/src/sim/s_zone.c`, preserving C center-tile flag semantics.
 */
export function applyScenarioEditorMapSpecialZoneAtPoint(
  bundle: ScenarioBundleV1,
  point: ScenarioEditorMapPoint,
  zone: ScenarioEditorMapSpecialZoneKind,
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
  const state = createSimState();
  const context = createSimContext({
    store,
    rng: new MicropolisRng(SCENARIO_EDITOR_ZONE_PLACEMENT_RNG_SEED),
  });
  const zoneSystem = createZoneSystem(state, context);
  const base = zone === 'hospital' ? Tile.HOSPITAL - 4 : Tile.CHURCH - 4;
  zonePlop(zoneSystem, point.x, point.y, base);

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
 * Recompute power connectivity and zone/utility power flags over the authored map.
 * Mirrors `DoPowerScan` + `SetZPower`/`DoNilPower` flows in
 * `ref/micropolis/src/sim/s_power.c` and `ref/micropolis/src/sim/s_sim.c`.
 * Parity note: editor pass is power-only and intentionally omits growth/disaster logic.
 */
export function deriveScenarioEditorMapPower(bundle: ScenarioBundleV1): ScenarioBundleV1 {
  const tileWordsMap = asTileWordsMap(bundle);
  const store = createClassicMapStore();
  const initialMapLayer = store.snapshot('map');
  if (!(initialMapLayer instanceof Uint16Array)) {
    throw new Error('expected uint16 map layer');
  }
  initialMapLayer.set(tileWordsMap.tileWords);

  store.beginTick();
  const map = store.getLayer('map');
  if (!(map instanceof Uint16Array)) {
    throw new Error('expected uint16 map layer');
  }
  map.set(tileWordsMap.tileWords);

  const state = createSimState();
  const context = createSimContext({
    store,
    rng: new MicropolisRng(SCENARIO_EDITOR_DERIVE_SIM_RNG_SEED),
  });
  seedScenarioEditorPowerScanState(state, map);
  doPowerScan(state, context, {
    lastTileId: Tile.DIRT,
  });
  applyScenarioEditorDerivedPowerFlags(context);

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
 * Run a constrained simulation-derive pass over the authored map.
 * Mirrors selected update paths from `ref/micropolis/src/sim/s_sim.c`:
 * - power propagation (`DoPowerScan` / `SetZPower`)
 * - traffic-memory driven road visuals (`DoRoad`)
 * - bridge open/close animation frames (`DoBridge`)
 * - industrial/plant smoke and airport radar animation updates (`DoIndustrial`/`DoSPZone`)
 *
 * Parity note: this intentionally skips full zone growth/decline and disasters so
 * authored lot composition remains unchanged.
 */
export function deriveScenarioEditorMapSimulation(
  bundle: ScenarioBundleV1,
  options: ScenarioEditorMapDeriveSimulationOptions = {},
): ScenarioBundleV1 {
  const ticks = normalizeScenarioEditorDeriveSimulationTickCount(options.ticks);
  if (ticks <= 0) {
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
  const map = store.getLayer('map');
  if (!(map instanceof Uint16Array)) {
    throw new Error('expected uint16 map layer');
  }
  map.set(tileWordsMap.tileWords);

  const trfDensity = store.getLayer('trfDensity');
  if (!(trfDensity instanceof Uint8Array)) {
    throw new Error('expected uint8 traffic density layer');
  }
  seedScenarioEditorTrafficDensityFromRoadTiles(map, trfDensity);

  const state = createSimState();
  const context = createSimContext({
    store,
    rng: new MicropolisRng(SCENARIO_EDITOR_DERIVE_SIM_RNG_SEED),
  });
  const zoneSystem = createZoneSystem(state, context);
  const bridgeHandler = createBridgeHandler(state, context);
  const roadHandler = createRoadHandler(state, context, {
    doBridge: bridgeHandler,
  });
  const railHandler = createRailHandler(state, context);

  for (let tick = 0; tick < ticks; tick += 1) {
    runScenarioEditorDerivedTrafficStep(state, context);
    seedScenarioEditorPowerScanState(state, map);
    doPowerScan(state, context, {
      lastTileId: Tile.DIRT,
    });
    applyScenarioEditorDerivedPowerFlags(context);
    state.NewPower = 1;

    mapScanSlice(
      state,
      context,
      0,
      SCENARIO_BUNDLE_V1_MAP_WIDTH,
      {
        onRoad: roadHandler,
        onRail: railHandler,
        onZone: (scan) => {
          applyScenarioEditorDerivedZoneVisuals(zoneSystem, scan);
        },
      },
      {
        newPower: true,
      },
    );
  }

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
 * Clamp derive-pass tick count to a deterministic editor-safe range.
 * Not from Micropolis C: editor-only control for bounded derive runtime cost.
 */
function normalizeScenarioEditorDeriveSimulationTickCount(ticks: number | undefined): number {
  if (ticks === undefined || !Number.isFinite(ticks)) {
    return SCENARIO_EDITOR_DERIVE_SIM_TICK_COUNT_DEFAULT;
  }
  return clamp(Math.trunc(ticks), 1, SCENARIO_EDITOR_DERIVE_SIM_TICK_COUNT_MAX);
}

/**
 * Apply power-bit flags over the full authored map from current power-layer state.
 * Mirrors `SetZPower` usage from `DoNilPower` and map-scan conductive updates in
 * `ref/micropolis/src/sim/s_sim.c`/`s_power.c`, with editor-specific full-map scope.
 */
function applyScenarioEditorDerivedPowerFlags(context: ReturnType<typeof createSimContext>): void {
  const map = context.store.getLayer('map');
  if (!(map instanceof Uint16Array)) {
    throw new Error('expected uint16 map layer');
  }
  const power = context.store.getLayer('power');
  if (!(power instanceof Uint16Array)) {
    throw new Error('expected uint16 power layer');
  }

  for (let x = 0; x < SCENARIO_BUNDLE_V1_MAP_WIDTH; x += 1) {
    const xOffset = x * SCENARIO_BUNDLE_V1_MAP_HEIGHT;
    for (let y = 0; y < SCENARIO_BUNDLE_V1_MAP_HEIGHT; y += 1) {
      const index = xOffset + y;
      const tile = map[index];
      if (tile === undefined || tile === 0) {
        continue;
      }
      if ((tile & (TileFlag.CONDBIT | TileFlag.ZONEBIT)) === 0) {
        continue;
      }
      setZPowerAt(context.store, power, x, y, index, tile);
    }
  }
}

/**
 * Seed the power scan stack and plant counts from current map content.
 * Mirrors the per-zone `pushPowerStack` behavior used in `DoSPZone` in
 * `ref/micropolis/src/sim/s_zone.c`, without triggering full zone updates.
 */
function seedScenarioEditorPowerScanState(
  state: ReturnType<typeof createSimState>,
  map: Uint16Array,
): void {
  state.PowerStackNum = 0;
  state.CoalPop = 0;
  state.NuclearPop = 0;

  for (let x = 0; x < SCENARIO_BUNDLE_V1_MAP_WIDTH; x += 1) {
    const xOffset = x * SCENARIO_BUNDLE_V1_MAP_HEIGHT;
    for (let y = 0; y < SCENARIO_BUNDLE_V1_MAP_HEIGHT; y += 1) {
      const index = xOffset + y;
      const tileWord = map[index];
      if (tileWord === undefined) {
        continue;
      }
      const tileId = tileWord & TileMask.LOMASK;
      if (tileId === Tile.POWERPLANT) {
        state.CoalPop += 1;
        pushPowerStack(state, x, y);
        continue;
      }
      if (tileId === Tile.NUCLEAR) {
        state.NuclearPop += 1;
        pushPowerStack(state, x, y);
      }
    }
  }
}

/**
 * Initialize traffic-memory cells from authored road tile density classes.
 * Mirrors road visual classes from `DoRoad` in `ref/micropolis/src/sim/s_sim.c`:
 * base (`ROADBASE`), light (`LTRFBASE`), heavy (`HTRFBASE`).
 */
function seedScenarioEditorTrafficDensityFromRoadTiles(
  map: Uint16Array,
  trfDensity: Uint8Array,
): void {
  trfDensity.fill(0);
  for (let x = 0; x < SCENARIO_BUNDLE_V1_MAP_WIDTH; x += 1) {
    const xOffset = x * SCENARIO_BUNDLE_V1_MAP_HEIGHT;
    for (let y = 0; y < SCENARIO_BUNDLE_V1_MAP_HEIGHT; y += 1) {
      const tileWord = map[xOffset + y];
      if (tileWord === undefined) {
        continue;
      }
      const tileId = tileWord & TileMask.LOMASK;
      if (tileId < Tile.ROADBASE || tileId >= Tile.POWERBASE) {
        continue;
      }
      const trfIndex = (x >> 1) * (SCENARIO_BUNDLE_V1_MAP_HEIGHT >> 1) + (y >> 1);
      const currentDensity = trfDensity[trfIndex];
      if (currentDensity === undefined) {
        continue;
      }
      let nextDensity = currentDensity;
      if (tileId >= Tile.HTRFBASE) {
        nextDensity = Math.max(nextDensity, SCENARIO_EDITOR_DERIVE_TRAFFIC_ROAD_DENSITY_HEAVY);
      } else if (tileId >= Tile.LTRFBASE) {
        nextDensity = Math.max(nextDensity, SCENARIO_EDITOR_DERIVE_TRAFFIC_ROAD_DENSITY_LIGHT);
      }
      if (nextDensity !== currentDensity) {
        trfDensity[trfIndex] = nextDensity;
      }
    }
  }
}

/**
 * Generate one traffic-memory step from existing R/C/I zone centers only.
 * Mirrors `DoResidential`/`DoCommercial`/`DoIndustrial` traffic gates in
 * `ref/micropolis/src/sim/s_zone.c`, excluding any growth/decline branches.
 */
function runScenarioEditorDerivedTrafficStep(
  state: ReturnType<typeof createSimState>,
  context: ReturnType<typeof createSimContext>,
): void {
  const map = context.store.getLayer('map');
  if (!(map instanceof Uint16Array)) {
    throw new Error('expected uint16 map layer');
  }

  for (let x = 0; x < SCENARIO_BUNDLE_V1_MAP_WIDTH; x += 1) {
    const xOffset = x * SCENARIO_BUNDLE_V1_MAP_HEIGHT;
    for (let y = 0; y < SCENARIO_BUNDLE_V1_MAP_HEIGHT; y += 1) {
      const index = xOffset + y;
      const tileWord = map[index];
      if (tileWord === undefined || (tileWord & TileFlag.ZONEBIT) === 0) {
        continue;
      }
      const tileId = tileWord & TileMask.LOMASK;

      if (tileId < Tile.HOSPITAL) {
        const population = tileId === Tile.FREEZ ? countFreeZoneHouses(map, x, y) : rzPop(tileId);
        if (population > context.rng.rand(35)) {
          makeTraf(state, context, x, y, 0);
        }
        continue;
      }
      if (tileId >= Tile.COMBASE && tileId < Tile.INDBASE) {
        const population = czPop(tileId);
        if (population > context.rng.rand(5)) {
          makeTraf(state, context, x, y, 1);
        }
        continue;
      }
      if (tileId >= Tile.INDBASE && tileId < Tile.PORTBASE) {
        const population = izPop(tileId);
        if (population > context.rng.rand(5)) {
          makeTraf(state, context, x, y, 2);
        }
      }
    }
  }
}

/**
 * Apply non-growth zone-derived visuals for one scanned zone center.
 * Mirrors the non-plop parts of `DoIndustrial`/`DoSPZone` in
 * `ref/micropolis/src/sim/s_zone.c`: zone power bit, industrial smoke,
 * coal smoke, and airport radar animation state.
 */
function applyScenarioEditorDerivedZoneVisuals(
  zoneSystem: ReturnType<typeof createZoneSystem>,
  scan: MapScanContext,
): void {
  const powered = setZPowerAt(scan.store, zoneSystem.power, scan.x, scan.y, scan.index, scan.tile);

  if (scan.tileId >= Tile.IZB && scan.tileId < Tile.PORTBASE) {
    setSmoke(zoneSystem, scan.x, scan.y, scan.tileId, powered);
  }

  if (scan.tileId === Tile.POWERPLANT && powered) {
    coalSmoke(zoneSystem, scan.x, scan.y);
  }

  if (scan.tileId !== Tile.AIRPORT) {
    return;
  }
  const radarX = scan.x + 1;
  const radarY = scan.y - 1;
  if (
    radarX < 0 ||
    radarX >= SCENARIO_BUNDLE_V1_MAP_WIDTH ||
    radarY < 0 ||
    radarY >= SCENARIO_BUNDLE_V1_MAP_HEIGHT
  ) {
    return;
  }
  const radarIndex = radarX * SCENARIO_BUNDLE_V1_MAP_HEIGHT + radarY;
  const radarTileWord = scan.map[radarIndex];
  if (radarTileWord === undefined) {
    return;
  }

  if (powered) {
    const radarTileId = radarTileWord & TileMask.LOMASK;
    if (radarTileId === Tile.RADAR) {
      scan.store.write('map', radarIndex, Tile.RADAR | ANIMBIT | CONDBIT | BURNBIT);
    }
    return;
  }
  scan.store.write('map', radarIndex, Tile.RADAR | CONDBIT | BURNBIT);
}

/**
 * Runtime guard for map tool ids selected from form controls.
 * Mirrors closed tool dispatch set for `do_tool` in `w_tool.c`.
 */
export function isScenarioEditorMapTool(value: string): value is ScenarioEditorMapTool {
  return SCENARIO_EDITOR_MAP_TOOL_SET.has(value as ScenarioEditorMapTool);
}

/**
 * Runtime guard for zone-family ids selected from form controls.
 * Mirrors closed residential/commercial/industrial domains in `s_zone.c`.
 */
export function isScenarioEditorMapZoneKind(value: string): value is ScenarioEditorMapZoneKind {
  return SCENARIO_EDITOR_MAP_ZONE_KIND_SET.has(value as ScenarioEditorMapZoneKind);
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
const SCENARIO_EDITOR_MAP_ZONE_KIND_SET = new Set<ScenarioEditorMapZoneKind>(
  SCENARIO_EDITOR_MAP_ZONE_KINDS,
);
const SCENARIO_EDITOR_MAP_NAMED_BASE_TILES: readonly ScenarioEditorMapNamedBaseTile[] = [
  { name: 'DIRT', label: 'Dirt', tileId: Tile.DIRT },
  { name: 'RIVER', label: 'River', tileId: Tile.RIVER },
  { name: 'REDGE', label: 'River Edge', tileId: Tile.REDGE },
  { name: 'CHANNEL', label: 'Channel', tileId: Tile.CHANNEL },
  { name: 'FIRSTRIVEDGE', label: 'First River Edge', tileId: Tile.FIRSTRIVEDGE },
  { name: 'LASTRIVEDGE', label: 'Last River Edge', tileId: Tile.LASTRIVEDGE },
  { name: 'TREEBASE', label: 'Tree Base', tileId: Tile.TREEBASE },
  { name: 'LASTTREE', label: 'Last Tree', tileId: Tile.LASTTREE },
  { name: 'WOODS', label: 'Forest', tileId: Tile.WOODS },
  { name: 'WOODS2', label: 'Forest Variant 2', tileId: Tile.WOODS2 },
  { name: 'WOODS3', label: 'Forest Variant 3', tileId: Tile.WOODS3 },
  { name: 'WOODS4', label: 'Forest Variant 4', tileId: Tile.WOODS4 },
  { name: 'WOODS5', label: 'Forest Variant 5', tileId: Tile.WOODS5 },
  { name: 'RUBBLE', label: 'Rubble', tileId: Tile.RUBBLE },
  { name: 'LASTRUBBLE', label: 'Last Rubble', tileId: Tile.LASTRUBBLE },
  { name: 'FLOOD', label: 'Flood', tileId: Tile.FLOOD },
  { name: 'LASTFLOOD', label: 'Last Flood', tileId: Tile.LASTFLOOD },
  { name: 'RADTILE', label: 'Radiation Tile', tileId: Tile.RADTILE },
  { name: 'FIRE', label: 'Fire', tileId: Tile.FIRE },
  { name: 'FIREBASE', label: 'Fire Base', tileId: Tile.FIREBASE },
  { name: 'LASTFIRE', label: 'Last Fire', tileId: Tile.LASTFIRE },
  { name: 'ROADBASE', label: 'Road Base', tileId: Tile.ROADBASE },
  { name: 'HBRIDGE', label: 'Horizontal Bridge', tileId: Tile.HBRIDGE },
  { name: 'VBRIDGE', label: 'Vertical Bridge', tileId: Tile.VBRIDGE },
  { name: 'ROADS', label: 'Road', tileId: Tile.ROADS },
  { name: 'INTERSECTION', label: 'Intersection', tileId: Tile.INTERSECTION },
  { name: 'HROADPOWER', label: 'Horizontal Road Power', tileId: Tile.HROADPOWER },
  { name: 'VROADPOWER', label: 'Vertical Road Power', tileId: Tile.VROADPOWER },
  { name: 'BRWH', label: 'Bridge Horizontal Open', tileId: Tile.BRWH },
  { name: 'LTRFBASE', label: 'Light Traffic Base', tileId: Tile.LTRFBASE },
  { name: 'BRWV', label: 'Bridge Vertical Open', tileId: Tile.BRWV },
  { name: 'HTRFBASE', label: 'Heavy Traffic Base', tileId: Tile.HTRFBASE },
  { name: 'LASTROAD', label: 'Last Road', tileId: Tile.LASTROAD },
  { name: 'POWERBASE', label: 'Power Base', tileId: Tile.POWERBASE },
  { name: 'HPOWER', label: 'Horizontal Power', tileId: Tile.HPOWER },
  { name: 'VPOWER', label: 'Vertical Power', tileId: Tile.VPOWER },
  { name: 'LHPOWER', label: 'Left Horizontal Power', tileId: Tile.LHPOWER },
  { name: 'LVPOWER', label: 'Left Vertical Power', tileId: Tile.LVPOWER },
  { name: 'RAILHPOWERV', label: 'Rail Horizontal Power Vertical', tileId: Tile.RAILHPOWERV },
  { name: 'RAILVPOWERH', label: 'Rail Vertical Power Horizontal', tileId: Tile.RAILVPOWERH },
  { name: 'LASTPOWER', label: 'Last Power', tileId: Tile.LASTPOWER },
  { name: 'RAILBASE', label: 'Rail Base', tileId: Tile.RAILBASE },
  { name: 'HRAIL', label: 'Horizontal Rail', tileId: Tile.HRAIL },
  { name: 'VRAIL', label: 'Vertical Rail', tileId: Tile.VRAIL },
  { name: 'LHRAIL', label: 'Left Horizontal Rail', tileId: Tile.LHRAIL },
  { name: 'LVRAIL', label: 'Left Vertical Rail', tileId: Tile.LVRAIL },
  { name: 'HRAILROAD', label: 'Horizontal Rail Road', tileId: Tile.HRAILROAD },
  { name: 'VRAILROAD', label: 'Vertical Rail Road', tileId: Tile.VRAILROAD },
  { name: 'LASTRAIL', label: 'Last Rail', tileId: Tile.LASTRAIL },
  { name: 'ROADVPOWERH', label: 'Road Vertical Power Horizontal', tileId: Tile.ROADVPOWERH },
  { name: 'RESBASE', label: 'Residential Base', tileId: Tile.RESBASE },
  { name: 'FREEZ', label: 'Free Zone', tileId: Tile.FREEZ },
  { name: 'HOUSE', label: 'House', tileId: Tile.HOUSE },
  { name: 'LHTHR', label: 'Low House Threshold', tileId: Tile.LHTHR },
  { name: 'HHTHR', label: 'High House Threshold', tileId: Tile.HHTHR },
  { name: 'RZB', label: 'Residential Zone Base', tileId: Tile.RZB },
  { name: 'HOSPITAL', label: 'Hospital', tileId: Tile.HOSPITAL },
  { name: 'CHURCH', label: 'Church', tileId: Tile.CHURCH },
  { name: 'COMBASE', label: 'Commercial Base', tileId: Tile.COMBASE },
  { name: 'COMCLR', label: 'Commercial Clear', tileId: Tile.COMCLR },
  { name: 'CZB', label: 'Commercial Zone Base', tileId: Tile.CZB },
  { name: 'INDBASE', label: 'Industrial Base', tileId: Tile.INDBASE },
  { name: 'INDCLR', label: 'Industrial Clear', tileId: Tile.INDCLR },
  { name: 'LASTIND', label: 'Last Industrial', tileId: Tile.LASTIND },
  { name: 'IND1', label: 'Industrial Variant 1', tileId: Tile.IND1 },
  { name: 'IZB', label: 'Industrial Zone Base', tileId: Tile.IZB },
  { name: 'IND2', label: 'Industrial Variant 2', tileId: Tile.IND2 },
  { name: 'IND3', label: 'Industrial Variant 3', tileId: Tile.IND3 },
  { name: 'IND4', label: 'Industrial Variant 4', tileId: Tile.IND4 },
  { name: 'IND5', label: 'Industrial Variant 5', tileId: Tile.IND5 },
  { name: 'IND6', label: 'Industrial Variant 6', tileId: Tile.IND6 },
  { name: 'IND7', label: 'Industrial Variant 7', tileId: Tile.IND7 },
  { name: 'IND8', label: 'Industrial Variant 8', tileId: Tile.IND8 },
  { name: 'IND9', label: 'Industrial Variant 9', tileId: Tile.IND9 },
  { name: 'PORTBASE', label: 'Port Base', tileId: Tile.PORTBASE },
  { name: 'PORT', label: 'Port', tileId: Tile.PORT },
  { name: 'LASTPORT', label: 'Last Port', tileId: Tile.LASTPORT },
  { name: 'AIRPORTBASE', label: 'Airport Base', tileId: Tile.AIRPORTBASE },
  { name: 'RADAR', label: 'Radar', tileId: Tile.RADAR },
  { name: 'AIRPORT', label: 'Airport', tileId: Tile.AIRPORT },
  { name: 'COALBASE', label: 'Coal Base', tileId: Tile.COALBASE },
  { name: 'POWERPLANT', label: 'Power Plant', tileId: Tile.POWERPLANT },
  { name: 'LASTPOWERPLANT', label: 'Last Power Plant', tileId: Tile.LASTPOWERPLANT },
  { name: 'FIRESTBASE', label: 'Fire Station Base', tileId: Tile.FIRESTBASE },
  { name: 'FIRESTATION', label: 'Fire Station', tileId: Tile.FIRESTATION },
  { name: 'POLICESTBASE', label: 'Police Station Base', tileId: Tile.POLICESTBASE },
  { name: 'POLICESTATION', label: 'Police Station', tileId: Tile.POLICESTATION },
  { name: 'STADIUMBASE', label: 'Stadium Base', tileId: Tile.STADIUMBASE },
  { name: 'STADIUM', label: 'Stadium', tileId: Tile.STADIUM },
  { name: 'FULLSTADIUM', label: 'Full Stadium', tileId: Tile.FULLSTADIUM },
  { name: 'NUCLEARBASE', label: 'Nuclear Base', tileId: Tile.NUCLEARBASE },
  { name: 'NUCLEAR', label: 'Nuclear', tileId: Tile.NUCLEAR },
  { name: 'LASTZONE', label: 'Last Zone', tileId: Tile.LASTZONE },
  { name: 'LIGHTNINGBOLT', label: 'Lightning Bolt', tileId: Tile.LIGHTNINGBOLT },
  { name: 'HBRDG0', label: 'Horizontal Bridge Variant 0', tileId: Tile.HBRDG0 },
  { name: 'HBRDG1', label: 'Horizontal Bridge Variant 1', tileId: Tile.HBRDG1 },
  { name: 'HBRDG2', label: 'Horizontal Bridge Variant 2', tileId: Tile.HBRDG2 },
  { name: 'HBRDG3', label: 'Horizontal Bridge Variant 3', tileId: Tile.HBRDG3 },
  { name: 'RADAR0', label: 'Radar Variant 0', tileId: Tile.RADAR0 },
  { name: 'RADAR1', label: 'Radar Variant 1', tileId: Tile.RADAR1 },
  { name: 'RADAR2', label: 'Radar Variant 2', tileId: Tile.RADAR2 },
  { name: 'RADAR3', label: 'Radar Variant 3', tileId: Tile.RADAR3 },
  { name: 'RADAR4', label: 'Radar Variant 4', tileId: Tile.RADAR4 },
  { name: 'RADAR5', label: 'Radar Variant 5', tileId: Tile.RADAR5 },
  { name: 'RADAR6', label: 'Radar Variant 6', tileId: Tile.RADAR6 },
  { name: 'RADAR7', label: 'Radar Variant 7', tileId: Tile.RADAR7 },
  { name: 'FOUNTAIN', label: 'Fountain', tileId: Tile.FOUNTAIN },
  { name: 'TELEBASE', label: 'Tele Base', tileId: Tile.TELEBASE },
  { name: 'TELELAST', label: 'Tele Last', tileId: Tile.TELELAST },
  { name: 'SMOKEBASE', label: 'Smoke Base', tileId: Tile.SMOKEBASE },
  { name: 'TINYEXP', label: 'Tiny Explosion', tileId: Tile.TINYEXP },
  { name: 'SOMETINYEXP', label: 'Some Tiny Explosion', tileId: Tile.SOMETINYEXP },
  { name: 'LASTTINYEXP', label: 'Last Tiny Explosion', tileId: Tile.LASTTINYEXP },
  { name: 'COALSMOKE1', label: 'Coal Smoke 1', tileId: Tile.COALSMOKE1 },
  { name: 'COALSMOKE2', label: 'Coal Smoke 2', tileId: Tile.COALSMOKE2 },
  { name: 'COALSMOKE3', label: 'Coal Smoke 3', tileId: Tile.COALSMOKE3 },
  { name: 'COALSMOKE4', label: 'Coal Smoke 4', tileId: Tile.COALSMOKE4 },
  { name: 'FOOTBALLGAME1', label: 'Football Game 1', tileId: Tile.FOOTBALLGAME1 },
  { name: 'FOOTBALLGAME2', label: 'Football Game 2', tileId: Tile.FOOTBALLGAME2 },
  { name: 'VBRDG0', label: 'Vertical Bridge Variant 0', tileId: Tile.VBRDG0 },
  { name: 'VBRDG1', label: 'Vertical Bridge Variant 1', tileId: Tile.VBRDG1 },
  { name: 'VBRDG2', label: 'Vertical Bridge Variant 2', tileId: Tile.VBRDG2 },
  { name: 'VBRDG3', label: 'Vertical Bridge Variant 3', tileId: Tile.VBRDG3 },
];
const SCENARIO_EDITOR_MAP_NAMED_BASE_TILE_BY_NAME = new Map<string, ScenarioEditorMapNamedBaseTile>(
  SCENARIO_EDITOR_MAP_NAMED_BASE_TILES.map((entry) => [entry.name, entry]),
);
const SCENARIO_EDITOR_MAP_NAMED_BASE_TILE_BY_ID = new Map<number, ScenarioEditorMapNamedBaseTile>();
for (const entry of SCENARIO_EDITOR_MAP_NAMED_BASE_TILES) {
  if (!SCENARIO_EDITOR_MAP_NAMED_BASE_TILE_BY_ID.has(entry.tileId)) {
    SCENARIO_EDITOR_MAP_NAMED_BASE_TILE_BY_ID.set(entry.tileId, entry);
  }
}

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

/**
 * Integer clamp helper for editor numeric inputs.
 * Not from Micropolis C: small utility to keep UI values in valid authored ranges.
 */
function clamp(value: number, min: number, max: number): number {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}
