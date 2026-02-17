import { createCityFile, encodeCityFile } from '@city/sim-core';
import { describe, expect, test } from 'vitest';

import {
  getScenarioEditorStockScenarioOptions,
  loadScenarioEditorStockScenarioBundle,
} from './editor-stock-scenarios.ts';

/**
 * Stock scenario open-flow tests for Export menu integration.
 * Parity anchors:
 * - Metadata/file ids mirror `LoadScenario(short s)` rows in `ref/micropolis/src/sim/s_fileio.c`.
 * - Map decode mirrors `_load_short(... WORLD_X * WORLD_Y ...)` scenario file ingest in `s_fileio.c`.
 */
describe('scenario editor stock scenarios', () => {
  test('exposes all classic stock scenarios for selection', () => {
    const options = getScenarioEditorStockScenarioOptions();

    expect(options).toHaveLength(8);
    expect(options[0]).toEqual({
      id: 1,
      key: 'builtin/dullsville',
      name: 'Dullsville',
      fileName: 'snro.111',
      startYear: 1900,
      startFunds: 5000,
    });
    expect(options[7]?.key).toBe('builtin/rio-de-janeiro');
  });

  test('loads one stock scenario into tile-word bundle form', async () => {
    const city = createCityFile({ width: 120, height: 100 });
    city.map[0] = 123;
    city.map[1] = 456;
    const scenarioBytes = encodeCityFile(city);
    const loadedFileNames: string[] = [];

    const bundle = await loadScenarioEditorStockScenarioBundle(2, {
      loadScenarioResourceBytes: async (fileName) => {
        loadedFileNames.push(fileName);
        return scenarioBytes;
      },
    });

    expect(loadedFileNames).toEqual(['snro.222']);
    expect(bundle.key).toBe('builtin/san-francisco');
    expect(bundle.name).toBe('San Francisco');
    expect(bundle.start).toEqual({
      // Magic numbers source: case-2 constants in `LoadScenario` in `ref/micropolis/src/sim/s_fileio.c`.
      startYear: 1906,
      startFunds: 20000,
    });
    expect(bundle.map.kind).toBe('tile-words');
    if (bundle.map.kind !== 'tile-words') {
      throw new Error('expected tile-words map payload');
    }
    // Magic number source: classic map geometry `WORLD_X=120`, `WORLD_Y=100`
    // from `ref/micropolis/src/sim/headers/sim.h` consumed by `LoadScenario`.
    expect(bundle.map.tileWords).toHaveLength(12000);
    expect(bundle.map.tileWords[0]).toBe(123);
    expect(bundle.map.tileWords[1]).toBe(456);
  });

  test('imports stock objective and converts countdown-equals rules to atTick triggers', async () => {
    const city = createCityFile({ width: 120, height: 100 });
    const scenarioBytes = encodeCityFile(city);
    const bundle = await loadScenarioEditorStockScenarioBundle(2, {
      loadScenarioResourceBytes: async () => scenarioBytes,
    });

    expect(bundle.objective).toEqual({
      kind: 'metric',
      metric: 'city-class',
      op: 'gte',
      value: 4,
    });
    expect(bundle.script).toEqual([
      {
        trigger: { atTick: 1 },
        actions: [{ kind: 'make-earthquake' }],
      },
    ]);
  });

  test('converts stock always-trigger disaster rules to everyTicks=1 script events', async () => {
    const city = createCityFile({ width: 120, height: 100 });
    const scenarioBytes = encodeCityFile(city);
    const bundle = await loadScenarioEditorStockScenarioBundle(3, {
      loadScenarioResourceBytes: async () => scenarioBytes,
    });

    expect(bundle.script).toEqual([
      {
        trigger: { everyTicks: 1 },
        actions: [{ kind: 'drop-fire-bombs' }],
      },
    ]);
  });

  test('omits script payload when stock runtime has no disaster rules', async () => {
    const city = createCityFile({ width: 120, height: 100 });
    const scenarioBytes = encodeCityFile(city);
    const bundle = await loadScenarioEditorStockScenarioBundle(1, {
      loadScenarioResourceBytes: async () => scenarioBytes,
    });

    expect(bundle.script).toBeUndefined();
  });
});
