import {
  SCENARIO_BUNDLE_V1_MAP_HEIGHT,
  SCENARIO_BUNDLE_V1_MAP_WIDTH,
  SCENARIO_BUNDLE_V1_TILE_COUNT,
  type ScenarioMapTileWordsV1,
} from '@city/scenario-core';

/**
 * Fixed index ordering for AI extraction grids.
 * Mirrors Micropolis `Map[x][y]` column-major storage from
 * `ref/micropolis/src/sim/s_alloc.c` where linear offsets are `x * WORLD_Y + y`.
 */
export const SCENARIO_EDITOR_FEATURE_MAP_COORDINATE_ORDER = 'x-major' as const;

/**
 * Closed set of extractable map features for Stage 5 AI/image import.
 * Mapping note: keys correspond to high-level Micropolis tile domains from
 * `ref/micropolis/src/sim/headers/sim.h` (terrain/network/zone/building families).
 * Parity difference: this is an editor-only intermediate contract, not a C runtime structure.
 */
export const SCENARIO_EDITOR_FEATURE_MAP_FEATURE_KEYS = [
  'dirt',
  'river',
  'channel',
  'tree',
  'road',
  'rail',
  'wire',
  'residential-zone',
  'commercial-zone',
  'industrial-zone',
  'seaport',
  'airport',
  'coal-power-plant',
  'nuclear-power-plant',
  'fire-station',
  'police-station',
  'stadium',
] as const;

/**
 * One supported feature key in the Stage 5 extraction contract.
 * Mirrors coarse tile-domain groupings from `sim.h`; this is not a 1:1 tile-id enum.
 */
export type ScenarioEditorFeatureMapFeatureKey =
  (typeof SCENARIO_EDITOR_FEATURE_MAP_FEATURE_KEYS)[number];

/**
 * One tile coordinate in the extraction `featureMap`.
 * Mirrors `Map[x][y]` addressing from `ref/micropolis/src/sim/s_alloc.c`.
 */
export interface ScenarioEditorFeatureMapPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * Ranked AI confidence entry for one feature at one tile.
 * Parity note: Micropolis C has no confidence scores; these values are editor-only hints
 * consumed by later deterministic compilation passes.
 */
export interface ScenarioEditorFeatureMapFeatureScore {
  readonly confidence: number;
  readonly feature: ScenarioEditorFeatureMapFeatureKey;
}

/**
 * One tile extraction row in the Stage 5 `featureMap`.
 * Parity note: Micropolis stores one final tile-word per tile; this intermediate preserves
 * multiple ranked candidates for deterministic Stage 5.2 resolution.
 */
export interface ScenarioEditorFeatureMapCell {
  readonly features: readonly ScenarioEditorFeatureMapFeatureScore[];
}

/**
 * Extraction provenance metadata for one AI-generated `featureMap`.
 * Not from Micropolis C: this is editor-only traceability for provider/model/time provenance.
 */
export interface ScenarioEditorFeatureMapSource {
  readonly extractedAtIso: string;
  readonly model: string;
  readonly provider: string;
}

/**
 * Ephemeral Stage 5 AI extraction contract consumed before map compilation.
 * Mirrors classic fixed map dimensions (`WORLD_X=120`, `WORLD_Y=100`) from
 * `ref/micropolis/src/sim/headers/sim.h`; parity difference: this contract is never saved
 * into final scenario bundles (compiled map output remains canonical).
 */
export interface ScenarioEditorFeatureMap {
  readonly cells: readonly ScenarioEditorFeatureMapCell[];
  readonly coordinateOrder: typeof SCENARIO_EDITOR_FEATURE_MAP_COORDINATE_ORDER;
  readonly height: number;
  readonly source: ScenarioEditorFeatureMapSource;
  readonly width: number;
}

/**
 * Validation issue emitted while parsing raw vision extraction output.
 * Not from Micropolis C: structured JSON diagnostics for editor contract enforcement.
 */
export interface ScenarioEditorFeatureMapIssue {
  readonly message: string;
  readonly path: string;
  readonly source: 'validation';
}

/**
 * Parse result for Stage 5 extraction payloads.
 * Not from Micropolis C: modern union result used for editor-side contract validation.
 */
export type ScenarioEditorFeatureMapParseResult =
  | {
      readonly featureMap: ScenarioEditorFeatureMap;
      readonly issues: readonly [];
      readonly ok: true;
    }
  | {
      readonly issues: readonly ScenarioEditorFeatureMapIssue[];
      readonly ok: false;
    };

const SCENARIO_EDITOR_TILE_WORD_DIRT = 0;
const SCENARIO_EDITOR_TILE_WORD_RIVER = 2;
const SCENARIO_EDITOR_TILE_WORD_CHANNEL = 4;
const SCENARIO_EDITOR_TILE_WORD_WOODS2 = 40;
const SCENARIO_EDITOR_TILE_WORD_ROADS = 66;
const SCENARIO_EDITOR_TILE_WORD_LHPOWER = 210;
const SCENARIO_EDITOR_TILE_WORD_LHRAIL = 226;
const SCENARIO_EDITOR_TILE_WORD_RESBASE = 240;
const SCENARIO_EDITOR_TILE_WORD_COMBASE = 423;
const SCENARIO_EDITOR_TILE_WORD_INDBASE = 612;
const SCENARIO_EDITOR_TILE_WORD_PORTBASE = 693;
const SCENARIO_EDITOR_TILE_WORD_AIRPORTBASE = 709;
const SCENARIO_EDITOR_TILE_WORD_COALBASE = 745;
const SCENARIO_EDITOR_TILE_WORD_FIRESTBASE = 761;
const SCENARIO_EDITOR_TILE_WORD_POLICESTBASE = 770;
const SCENARIO_EDITOR_TILE_WORD_STADIUMBASE = 779;
const SCENARIO_EDITOR_TILE_WORD_NUCLEARBASE = 811;
const SCENARIO_EDITOR_TILE_FLAG_CONDBIT = 0x4000;
const SCENARIO_EDITOR_TILE_FLAG_BURNBIT = 0x2000;
const SCENARIO_EDITOR_TILE_FLAG_BULLBIT = 0x1000;
const SCENARIO_EDITOR_TILE_FLAG_ZONEBIT = 0x0400;
const SCENARIO_EDITOR_TILE_FLAG_BNCNBIT =
  SCENARIO_EDITOR_TILE_FLAG_BURNBIT | SCENARIO_EDITOR_TILE_FLAG_CONDBIT;

const SCENARIO_EDITOR_FEATURE_MAP_PRIORITY_BY_KEY = new Map<
  ScenarioEditorFeatureMapFeatureKey,
  number
>(SCENARIO_EDITOR_FEATURE_MAP_FEATURE_KEYS.map((feature, index) => [feature, index]));

const SCENARIO_EDITOR_TERRAIN_FEATURE_KEYS = new Set<ScenarioEditorFeatureMapFeatureKey>([
  'dirt',
  'river',
  'channel',
  'tree',
]);

const SCENARIO_EDITOR_NETWORK_FEATURE_KEYS = new Set<ScenarioEditorFeatureMapFeatureKey>([
  'road',
  'rail',
  'wire',
]);

const SCENARIO_EDITOR_ZONE_FEATURE_KEYS = new Set<ScenarioEditorFeatureMapFeatureKey>([
  'residential-zone',
  'commercial-zone',
  'industrial-zone',
  'seaport',
  'airport',
  'coal-power-plant',
  'nuclear-power-plant',
  'fire-station',
  'police-station',
  'stadium',
]);

/**
 * Compile one validated Stage 5 `featureMap` into deterministic `tile-words`.
 * Mirrors tile id/flag constants in `ref/micropolis/src/sim/headers/sim.h` and uses
 * zone-center tile encoding from `check3x3`/`check4x4`/`check6x6` in
 * `ref/micropolis/src/sim/w_tool.c`; parity difference: this compiles direct from
 * vision-feature probabilities instead of invoking interactive tool placement.
 */
export function compileScenarioEditorFeatureMapToTileWordsMap(
  featureMap: ScenarioEditorFeatureMap,
): ScenarioMapTileWordsV1 {
  const compiledTileWords = runScenarioEditorFeatureMapTerrainPass(featureMap);
  runScenarioEditorFeatureMapNetworkPass(featureMap, compiledTileWords);
  runScenarioEditorFeatureMapZonePass(featureMap, compiledTileWords);

  return {
    kind: 'tile-words',
    width: SCENARIO_BUNDLE_V1_MAP_WIDTH,
    height: SCENARIO_BUNDLE_V1_MAP_HEIGHT,
    tileWords: compiledTileWords,
  };
}

/**
 * Runtime guard for supported feature keys.
 * Mapping note: keys represent tile families in `sim.h`; this guard is editor-only.
 */
export function isScenarioEditorFeatureMapFeatureKey(
  value: string,
): value is ScenarioEditorFeatureMapFeatureKey {
  return (SCENARIO_EDITOR_FEATURE_MAP_FEATURE_KEYS as readonly string[]).includes(value);
}

/**
 * Pass 1: apply terrain defaults (`dirt`/`river`/`channel`/`tree`) across all tiles.
 * Mirrors Micropolis terrain tile ids from `sim.h`; parity difference: terrain picks are
 * confidence-ranked from Stage 5 AI extraction instead of generated world terrain routines.
 */
function runScenarioEditorFeatureMapTerrainPass(featureMap: ScenarioEditorFeatureMap): number[] {
  const compiledTileWords = new Array<number>(SCENARIO_BUNDLE_V1_TILE_COUNT).fill(
    SCENARIO_EDITOR_TILE_WORD_DIRT,
  );

  for (let index = 0; index < SCENARIO_BUNDLE_V1_TILE_COUNT; index += 1) {
    const feature = pickFeatureForPass(
      featureMap.cells[index],
      SCENARIO_EDITOR_TERRAIN_FEATURE_KEYS,
    );
    if (feature === null) {
      continue;
    }

    compiledTileWords[index] = compileTerrainFeatureToTileWord(feature);
  }

  return compiledTileWords;
}

/**
 * Pass 2: overlay deterministic network tiles (`road`/`rail`/`wire`) over terrain output.
 * Mirrors baseline road/rail/wire tile words from `_LayRoad`/`_LayRail`/`_LayWire` in
 * `ref/micropolis/src/sim/w_con.c` and `w_tool.c`; parity difference: this pass does not run
 * connection auto-tiling (`fixZone`) and keeps deterministic single-tile defaults.
 */
function runScenarioEditorFeatureMapNetworkPass(
  featureMap: ScenarioEditorFeatureMap,
  compiledTileWords: number[],
): void {
  for (let index = 0; index < SCENARIO_BUNDLE_V1_TILE_COUNT; index += 1) {
    const feature = pickFeatureForPass(
      featureMap.cells[index],
      SCENARIO_EDITOR_NETWORK_FEATURE_KEYS,
    );
    if (feature === null) {
      continue;
    }

    compiledTileWords[index] = compileNetworkFeatureToTileWord(feature);
  }
}

/**
 * Pass 3: overlay zone/structure center tiles over prior pass output.
 * Mirrors zone-center words written by `check3x3`/`check4x4`/`check6x6` in
 * `ref/micropolis/src/sim/w_tool.c` (center offset + `BNCNBIT + ZONEBIT` semantics).
 */
function runScenarioEditorFeatureMapZonePass(
  featureMap: ScenarioEditorFeatureMap,
  compiledTileWords: number[],
): void {
  for (let index = 0; index < SCENARIO_BUNDLE_V1_TILE_COUNT; index += 1) {
    const feature = pickFeatureForPass(featureMap.cells[index], SCENARIO_EDITOR_ZONE_FEATURE_KEYS);
    if (feature === null) {
      continue;
    }

    compiledTileWords[index] = compileZoneFeatureToTileWord(feature);
  }
}

/**
 * Pick one feature candidate for a compiler pass using confidence then stable key priority.
 * Not from Micropolis C: deterministic tie-breaking for editor-side AI extraction output.
 */
function pickFeatureForPass(
  cell: ScenarioEditorFeatureMapCell | undefined,
  passFeatureKeys: ReadonlySet<ScenarioEditorFeatureMapFeatureKey>,
): ScenarioEditorFeatureMapFeatureKey | null {
  if (cell === undefined) {
    return null;
  }

  let bestFeature: ScenarioEditorFeatureMapFeatureKey | null = null;
  let bestConfidence = Number.NEGATIVE_INFINITY;
  let bestPriority = Number.POSITIVE_INFINITY;

  for (const featureScore of cell.features) {
    if (!passFeatureKeys.has(featureScore.feature)) {
      continue;
    }

    const featurePriority = getScenarioEditorFeaturePriority(featureScore.feature);
    if (
      featureScore.confidence > bestConfidence ||
      (featureScore.confidence === bestConfidence && featurePriority < bestPriority)
    ) {
      bestFeature = featureScore.feature;
      bestConfidence = featureScore.confidence;
      bestPriority = featurePriority;
    }
  }

  return bestFeature;
}

/**
 * Resolve one deterministic sort-priority rank for a supported feature key.
 * Not from Micropolis C: editor compiler tie-break metadata keyed by contract order.
 */
function getScenarioEditorFeaturePriority(feature: ScenarioEditorFeatureMapFeatureKey): number {
  return SCENARIO_EDITOR_FEATURE_MAP_PRIORITY_BY_KEY.get(feature) ?? Number.MAX_SAFE_INTEGER;
}

/**
 * Convert one terrain feature key to a compiled map tile word.
 * Mirrors terrain tile constants in `ref/micropolis/src/sim/headers/sim.h`.
 */
function compileTerrainFeatureToTileWord(feature: ScenarioEditorFeatureMapFeatureKey): number {
  switch (feature) {
    case 'river':
      return SCENARIO_EDITOR_TILE_WORD_RIVER;
    case 'channel':
      return SCENARIO_EDITOR_TILE_WORD_CHANNEL;
    case 'tree':
      return SCENARIO_EDITOR_TILE_WORD_WOODS2;
    case 'dirt':
    default:
      return SCENARIO_EDITOR_TILE_WORD_DIRT;
  }
}

/**
 * Convert one network feature key to a compiled map tile word.
 * Mirrors `_LayRoad`/`_LayRail`/`_LayWire` baseline placed words in
 * `ref/micropolis/src/sim/w_con.c` and `w_tool.c`.
 */
function compileNetworkFeatureToTileWord(feature: ScenarioEditorFeatureMapFeatureKey): number {
  switch (feature) {
    case 'rail':
      return (
        SCENARIO_EDITOR_TILE_WORD_LHRAIL |
        SCENARIO_EDITOR_TILE_FLAG_BULLBIT |
        SCENARIO_EDITOR_TILE_FLAG_BURNBIT
      );
    case 'wire':
      return (
        SCENARIO_EDITOR_TILE_WORD_LHPOWER |
        SCENARIO_EDITOR_TILE_FLAG_CONDBIT |
        SCENARIO_EDITOR_TILE_FLAG_BULLBIT |
        SCENARIO_EDITOR_TILE_FLAG_BURNBIT
      );
    case 'road':
    default:
      return (
        SCENARIO_EDITOR_TILE_WORD_ROADS |
        SCENARIO_EDITOR_TILE_FLAG_BULLBIT |
        SCENARIO_EDITOR_TILE_FLAG_BURNBIT
      );
  }
}

/**
 * Convert one zone/structure feature key to the deterministic center tile word.
 * Mirrors zone center-writing offsets in `check3x3`/`check4x4`/`check6x6` from
 * `ref/micropolis/src/sim/w_tool.c`.
 */
function compileZoneFeatureToTileWord(feature: ScenarioEditorFeatureMapFeatureKey): number {
  switch (feature) {
    case 'residential-zone':
      return compile3x3CenterTileWord(SCENARIO_EDITOR_TILE_WORD_RESBASE);
    case 'commercial-zone':
      return compile3x3CenterTileWord(SCENARIO_EDITOR_TILE_WORD_COMBASE);
    case 'industrial-zone':
      return compile3x3CenterTileWord(SCENARIO_EDITOR_TILE_WORD_INDBASE);
    case 'fire-station':
      return compile3x3CenterTileWord(SCENARIO_EDITOR_TILE_WORD_FIRESTBASE);
    case 'police-station':
      return compile3x3CenterTileWord(SCENARIO_EDITOR_TILE_WORD_POLICESTBASE);
    case 'seaport':
      return compile4x4CenterTileWord(SCENARIO_EDITOR_TILE_WORD_PORTBASE);
    case 'coal-power-plant':
      return compile4x4CenterTileWord(SCENARIO_EDITOR_TILE_WORD_COALBASE);
    case 'stadium':
      return compile4x4CenterTileWord(SCENARIO_EDITOR_TILE_WORD_STADIUMBASE);
    case 'nuclear-power-plant':
      return compile4x4CenterTileWord(SCENARIO_EDITOR_TILE_WORD_NUCLEARBASE);
    case 'airport':
      return compile6x6CenterTileWord(SCENARIO_EDITOR_TILE_WORD_AIRPORTBASE);
    default:
      return SCENARIO_EDITOR_TILE_WORD_DIRT;
  }
}

/**
 * Build one 3x3-zone center tile word (`offset=4`) with zone flags.
 * Mirrors `check3x3` center-cell write in `ref/micropolis/src/sim/w_tool.c`.
 */
function compile3x3CenterTileWord(baseTile: number): number {
  return baseTile + 4 + SCENARIO_EDITOR_TILE_FLAG_BNCNBIT + SCENARIO_EDITOR_TILE_FLAG_ZONEBIT;
}

/**
 * Build one 4x4-zone center tile word (`offset=5`) with zone flags.
 * Mirrors `check4x4` center-cell write in `ref/micropolis/src/sim/w_tool.c`.
 */
function compile4x4CenterTileWord(baseTile: number): number {
  return baseTile + 5 + SCENARIO_EDITOR_TILE_FLAG_BNCNBIT + SCENARIO_EDITOR_TILE_FLAG_ZONEBIT;
}

/**
 * Build one 6x6-zone center tile word (`offset=7`) with zone flags.
 * Mirrors `check6x6` center-cell write in `ref/micropolis/src/sim/w_tool.c`.
 */
function compile6x6CenterTileWord(baseTile: number): number {
  return baseTile + 7 + SCENARIO_EDITOR_TILE_FLAG_BNCNBIT + SCENARIO_EDITOR_TILE_FLAG_ZONEBIT;
}

/**
 * Convert x/y coordinates to Stage 5 extraction index.
 * Mirrors Micropolis map linearization from `ref/micropolis/src/sim/s_alloc.c`
 * (`index = x * WORLD_Y + y`) with fixed `120x100` bounds.
 */
export function getScenarioEditorFeatureMapIndex(
  point: ScenarioEditorFeatureMapPoint,
): number | null {
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
 * Parse and validate one raw vision extraction payload into the Stage 5 `featureMap` contract.
 * Mapping note: fixed dimensions and x-major addressing mirror Micropolis map storage in
 * `ref/micropolis/src/sim/s_alloc.c`; parity difference: ranked confidence candidates are
 * editor-only and deterministic compiler input for Stage 5.2.
 */
export function parseScenarioEditorFeatureMap(
  rawValue: unknown,
): ScenarioEditorFeatureMapParseResult {
  if (!isRecord(rawValue)) {
    return {
      ok: false,
      issues: [toIssue('$', 'featureMap payload must be an object')],
    };
  }

  const issues: ScenarioEditorFeatureMapIssue[] = [];
  const width = readIntegerField(rawValue, 'width', 'width', issues);
  const height = readIntegerField(rawValue, 'height', 'height', issues);
  const coordinateOrder = rawValue.coordinateOrder;
  const sourceValue = rawValue.source;
  const cellsValue = rawValue.cells;

  if (width !== SCENARIO_BUNDLE_V1_MAP_WIDTH) {
    issues.push(
      toIssue(
        'width',
        `featureMap width must be ${SCENARIO_BUNDLE_V1_MAP_WIDTH} (fixed WORLD_X parity)`,
      ),
    );
  }
  if (height !== SCENARIO_BUNDLE_V1_MAP_HEIGHT) {
    issues.push(
      toIssue(
        'height',
        `featureMap height must be ${SCENARIO_BUNDLE_V1_MAP_HEIGHT} (fixed WORLD_Y parity)`,
      ),
    );
  }
  if (coordinateOrder !== SCENARIO_EDITOR_FEATURE_MAP_COORDINATE_ORDER) {
    issues.push(
      toIssue(
        'coordinateOrder',
        `coordinateOrder must be "${SCENARIO_EDITOR_FEATURE_MAP_COORDINATE_ORDER}"`,
      ),
    );
  }

  const source = parseSource(sourceValue, issues);
  const cells = parseCells(cellsValue, issues);

  if (issues.length > 0) {
    return {
      ok: false,
      issues,
    };
  }

  return {
    ok: true,
    issues: [],
    featureMap: {
      width: SCENARIO_BUNDLE_V1_MAP_WIDTH,
      height: SCENARIO_BUNDLE_V1_MAP_HEIGHT,
      coordinateOrder: SCENARIO_EDITOR_FEATURE_MAP_COORDINATE_ORDER,
      source,
      cells,
    },
  };
}

/**
 * Parse source metadata fields from one raw extraction payload.
 * Not from Micropolis C: editor-only provenance metadata validation.
 */
function parseSource(
  rawSource: unknown,
  issues: ScenarioEditorFeatureMapIssue[],
): ScenarioEditorFeatureMapSource {
  if (!isRecord(rawSource)) {
    issues.push(toIssue('source', 'source must be an object'));
    return {
      provider: '',
      model: '',
      extractedAtIso: '',
    };
  }

  const provider = readStringField(rawSource, 'provider', 'source.provider', issues);
  const model = readStringField(rawSource, 'model', 'source.model', issues);
  const extractedAtIso = readStringField(
    rawSource,
    'extractedAtIso',
    'source.extractedAtIso',
    issues,
  );

  if (!isValidIsoTimestamp(extractedAtIso)) {
    issues.push(toIssue('source.extractedAtIso', 'extractedAtIso must be a valid ISO timestamp'));
  }

  return {
    provider,
    model,
    extractedAtIso,
  };
}

/**
 * Parse per-tile extraction cells from one raw extraction payload.
 * Mirrors fixed map cardinality (`WORLD_X * WORLD_Y`) from `sim.h`; parity difference:
 * each cell keeps ranked candidates before deterministic compilation.
 */
function parseCells(
  rawCells: unknown,
  issues: ScenarioEditorFeatureMapIssue[],
): readonly ScenarioEditorFeatureMapCell[] {
  if (!Array.isArray(rawCells)) {
    issues.push(toIssue('cells', 'cells must be an array'));
    return [];
  }

  if (rawCells.length !== SCENARIO_BUNDLE_V1_TILE_COUNT) {
    issues.push(
      toIssue(
        'cells',
        `cells must contain exactly ${SCENARIO_BUNDLE_V1_TILE_COUNT} entries (WORLD_X * WORLD_Y)`,
      ),
    );
  }

  const cells: ScenarioEditorFeatureMapCell[] = [];
  const maxCellCount = Math.min(rawCells.length, SCENARIO_BUNDLE_V1_TILE_COUNT);
  for (let index = 0; index < maxCellCount; index += 1) {
    const rawCell = rawCells[index];
    if (!isRecord(rawCell)) {
      issues.push(toIssue(`cells.${index}`, 'cell must be an object'));
      continue;
    }

    const rawFeatures = rawCell.features;
    if (!Array.isArray(rawFeatures) || rawFeatures.length === 0) {
      issues.push(toIssue(`cells.${index}.features`, 'features must be a non-empty array'));
      continue;
    }

    const features: ScenarioEditorFeatureMapFeatureScore[] = [];
    let previousConfidence = Number.POSITIVE_INFINITY;
    const seenFeatures = new Set<ScenarioEditorFeatureMapFeatureKey>();
    for (let featureIndex = 0; featureIndex < rawFeatures.length; featureIndex += 1) {
      const rawFeature = rawFeatures[featureIndex];
      if (!isRecord(rawFeature)) {
        issues.push(
          toIssue(`cells.${index}.features.${featureIndex}`, 'feature entry must be an object'),
        );
        continue;
      }

      const featurePath = `cells.${index}.features.${featureIndex}.feature`;
      const confidencePath = `cells.${index}.features.${featureIndex}.confidence`;
      const featureValue = rawFeature.feature;
      const confidenceValue = rawFeature.confidence;

      if (typeof featureValue !== 'string' || !isScenarioEditorFeatureMapFeatureKey(featureValue)) {
        issues.push(
          toIssue(featurePath, 'feature must be one of SCENARIO_EDITOR_FEATURE_MAP_FEATURE_KEYS'),
        );
        continue;
      }
      if (
        typeof confidenceValue !== 'number' ||
        !Number.isFinite(confidenceValue) ||
        confidenceValue < 0 ||
        confidenceValue > 1
      ) {
        issues.push(
          toIssue(
            confidencePath,
            'confidence must be a finite number in the inclusive range [0, 1]',
          ),
        );
        continue;
      }
      if (seenFeatures.has(featureValue)) {
        issues.push(toIssue(featurePath, 'feature entries must be unique per cell'));
        continue;
      }
      if (confidenceValue > previousConfidence) {
        issues.push(
          toIssue(confidencePath, 'feature confidences must be sorted in descending order'),
        );
        continue;
      }

      seenFeatures.add(featureValue);
      previousConfidence = confidenceValue;
      features.push({
        feature: featureValue,
        confidence: confidenceValue,
      });
    }

    if (features.length > 0) {
      cells.push({ features });
    }
  }

  return cells;
}

/**
 * Read one integer field from a raw payload object.
 * Not from Micropolis C: editor-only structural validation helper.
 */
function readIntegerField(
  value: Record<string, unknown>,
  key: string,
  path: string,
  issues: ScenarioEditorFeatureMapIssue[],
): number {
  const fieldValue = value[key];
  if (typeof fieldValue !== 'number' || !Number.isInteger(fieldValue)) {
    issues.push(toIssue(path, `${key} must be an integer`));
    return Number.NaN;
  }
  return fieldValue;
}

/**
 * Read one non-empty string field from a raw payload object.
 * Not from Micropolis C: editor-only structural validation helper.
 */
function readStringField(
  value: Record<string, unknown>,
  key: string,
  path: string,
  issues: ScenarioEditorFeatureMapIssue[],
): string {
  const fieldValue = value[key];
  if (typeof fieldValue !== 'string' || fieldValue.trim().length === 0) {
    issues.push(toIssue(path, `${key} must be a non-empty string`));
    return '';
  }

  return fieldValue.trim();
}

/**
 * Narrow unknown values to object records for parser checks.
 * Not from Micropolis C: editor-only TypeScript runtime guard.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Validate that a string parses as one ISO-like timestamp.
 * Not from Micropolis C: editor-only metadata validation helper.
 */
function isValidIsoTimestamp(value: string): boolean {
  return value.length > 0 && !Number.isNaN(Date.parse(value));
}

/**
 * Construct one structured parser issue.
 * Not from Micropolis C: editor-only diagnostics helper.
 */
function toIssue(path: string, message: string): ScenarioEditorFeatureMapIssue {
  return {
    source: 'validation',
    path,
    message,
  };
}
