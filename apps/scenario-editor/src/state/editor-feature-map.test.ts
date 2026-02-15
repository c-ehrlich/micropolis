import { describe, expect, test } from 'vitest';

import {
  compileScenarioEditorFeatureMapToTileWordsMap,
  getScenarioEditorFeatureMapIndex,
  isScenarioEditorFeatureMapFeatureKey,
  parseScenarioEditorFeatureMap,
  SCENARIO_EDITOR_FEATURE_MAP_COORDINATE_ORDER,
} from './editor-feature-map.ts';

/**
 * Stage 5.1 `featureMap` contract tests for AI extraction payloads.
 * Parity anchors:
 * - Grid dimensions and indexing follow `WORLD_X=120`, `WORLD_Y=100`, and `Map[x][y]`
 *   x-major layout from `ref/micropolis/src/sim/headers/sim.h` and `s_alloc.c`.
 * - Confidence-ranked feature candidates are editor-only (no direct Micropolis C equivalent).
 */
describe('scenario editor featureMap contract', () => {
  test('parses a valid extraction payload into the Stage 5 contract', () => {
    const result = parseScenarioEditorFeatureMap(createValidFeatureMapPayload());

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('Expected featureMap payload to parse successfully');
    }

    expect(result.featureMap.width).toBe(120);
    expect(result.featureMap.height).toBe(100);
    // Magic number source: `WORLD_X * WORLD_Y = 120 * 100` from
    // `ref/micropolis/src/sim/headers/sim.h`.
    expect(result.featureMap.cells).toHaveLength(12000);
    expect(result.featureMap.coordinateOrder).toBe(SCENARIO_EDITOR_FEATURE_MAP_COORDINATE_ORDER);
    expect(result.featureMap.cells[0]?.features[0]).toEqual({
      feature: 'dirt',
      confidence: 1,
    });
  });

  test('maps x/y coordinates to x-major linear indices', () => {
    expect(getScenarioEditorFeatureMapIndex({ x: 0, y: 0 })).toBe(0);
    expect(getScenarioEditorFeatureMapIndex({ x: 0, y: 1 })).toBe(1);
    // Magic number source: map linearization uses `index = x * WORLD_Y + y`
    // from `Map[i] = auxPtr + i * WORLD_Y` in `ref/micropolis/src/sim/s_alloc.c`.
    expect(getScenarioEditorFeatureMapIndex({ x: 1, y: 0 })).toBe(100);
    expect(getScenarioEditorFeatureMapIndex({ x: 119, y: 99 })).toBe(11999);
  });

  test('rejects payloads with non-parity map dimensions', () => {
    const payload = createValidFeatureMapPayload();
    payload.width = 128;

    const result = parseScenarioEditorFeatureMap(payload);
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('Expected invalid dimensions to fail');
    }

    expect(result.issues.some((issue) => issue.path === 'width')).toBe(true);
  });

  test('rejects payloads with incorrect cell cardinality', () => {
    const payload = createValidFeatureMapPayload();
    payload.cells = payload.cells.slice(0, 100);

    const result = parseScenarioEditorFeatureMap(payload);
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('Expected invalid cell count to fail');
    }

    expect(result.issues.some((issue) => issue.path === 'cells')).toBe(true);
  });

  test('rejects unknown feature keys and unsorted confidences', () => {
    const payload = createValidFeatureMapPayload();
    payload.cells[0] = {
      features: [
        { feature: 'dirt', confidence: 0.4 },
        { feature: 'not-a-real-feature', confidence: 0.3 },
        { feature: 'road', confidence: 0.5 },
      ],
    };

    const result = parseScenarioEditorFeatureMap(payload);
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('Expected feature validation to fail');
    }

    expect(result.issues.some((issue) => issue.path === 'cells.0.features.1.feature')).toBe(true);
    expect(result.issues.some((issue) => issue.path === 'cells.0.features.2.confidence')).toBe(
      true,
    );
  });

  test('guards feature keys through runtime helper', () => {
    expect(isScenarioEditorFeatureMapFeatureKey('dirt')).toBe(true);
    expect(isScenarioEditorFeatureMapFeatureKey('river')).toBe(true);
    expect(isScenarioEditorFeatureMapFeatureKey('unknown')).toBe(false);
  });

  test('compiles deterministic tile-words map from one fixed featureMap fixture', () => {
    const featureMap = parseOrThrowFeatureMap(createValidFeatureMapPayload());

    const compiledA = compileScenarioEditorFeatureMapToTileWordsMap(featureMap);
    const compiledB = compileScenarioEditorFeatureMapToTileWordsMap(featureMap);

    expect(compiledA).toEqual(compiledB);
    expect(compiledA.kind).toBe('tile-words');
    expect(compiledA.width).toBe(120);
    expect(compiledA.height).toBe(100);
    // Magic number source: `WORLD_X * WORLD_Y = 12000` from
    // `ref/micropolis/src/sim/headers/sim.h`.
    expect(compiledA.tileWords).toHaveLength(12000);
    expect(compiledA.tileWords[0]).toBe(0);
  });

  test('applies deterministic pass precedence: terrain -> network -> zone/structure', () => {
    const payload = createValidFeatureMapPayload();
    payload.cells[0] = {
      features: [
        { feature: 'river', confidence: 0.95 },
        { feature: 'road', confidence: 0.9 },
        { feature: 'residential-zone', confidence: 0.85 },
      ],
    };
    payload.cells[1] = {
      features: [
        { feature: 'river', confidence: 0.9 },
        { feature: 'road', confidence: 0.8 },
      ],
    };
    payload.cells[2] = {
      features: [
        { feature: 'rail', confidence: 0.7 },
        { feature: 'road', confidence: 0.7 },
      ],
    };
    payload.cells[3] = {
      features: [
        { feature: 'seaport', confidence: 0.6 },
        { feature: 'airport', confidence: 0.6 },
      ],
    };
    const featureMap = parseOrThrowFeatureMap(payload);
    const compiled = compileScenarioEditorFeatureMapToTileWordsMap(featureMap);

    // Magic number source: `check3x3` center write in `ref/micropolis/src/sim/w_tool.c`
    // is `base + 4 + BNCNBIT + ZONEBIT` for `RESBASE=240`.
    expect(compiled.tileWords[0]).toBe(240 + 4 + 0x6000 + 0x0400);
    // Magic number source: `_LayRoad` in `ref/micropolis/src/sim/w_con.c` writes
    // `ROADS | BULLBIT | BURNBIT` on dirt (`ROADS=66` from `sim.h`).
    expect(compiled.tileWords[1]).toBe(66 + 0x1000 + 0x2000);
    // Magic number source: `_LayRoad`/`_LayRail` choose deterministic defaults in
    // `w_con.c`; tie is broken by compiler feature priority (`road` before `rail`).
    expect(compiled.tileWords[2]).toBe(66 + 0x1000 + 0x2000);
    // Magic number source: `check4x4` center write in `ref/micropolis/src/sim/w_tool.c`
    // is `base + 5 + BNCNBIT + ZONEBIT`; `PORTBASE=693` yields `PORT` center tile.
    expect(compiled.tileWords[3]).toBe(693 + 5 + 0x6000 + 0x0400);
  });
});

/**
 * Build one valid Stage 5.1 extraction payload fixture.
 * Mirrors fixed map cardinality from `WORLD_X * WORLD_Y` in `sim.h`; parity difference:
 * feature confidence rows are editor-only intermediate artifacts.
 */
function createValidFeatureMapPayload(): {
  width: number;
  height: number;
  coordinateOrder: string;
  source: {
    provider: string;
    model: string;
    extractedAtIso: string;
  };
  cells: Array<{
    features: Array<{
      feature: string;
      confidence: number;
    }>;
  }>;
} {
  return {
    width: 120,
    height: 100,
    coordinateOrder: SCENARIO_EDITOR_FEATURE_MAP_COORDINATE_ORDER,
    source: {
      provider: 'openrouter',
      model: 'vision-model-v1',
      extractedAtIso: '2026-02-15T00:00:00.000Z',
    },
    // Magic number source: `WORLD_X * WORLD_Y = 12000` in
    // `ref/micropolis/src/sim/headers/sim.h`.
    cells: Array.from({ length: 12000 }, () => ({
      features: [
        { feature: 'dirt', confidence: 1 },
        { feature: 'tree', confidence: 0.25 },
      ],
    })),
  };
}

/**
 * Parse one fixture payload and fail fast if contract validation rejects it.
 * Not from Micropolis C: test-only helper for Stage 5 editor contract fixtures.
 */
function parseOrThrowFeatureMap(payload: ReturnType<typeof createValidFeatureMapPayload>) {
  const result = parseScenarioEditorFeatureMap(payload);
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(`Expected featureMap fixture parse success: ${JSON.stringify(result.issues)}`);
  }
  return result.featureMap;
}
