import {
  SCENARIO_BUNDLE_V1_MAP_HEIGHT,
  SCENARIO_BUNDLE_V1_MAP_WIDTH,
  SCENARIO_BUNDLE_V1_TILE_COUNT,
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
