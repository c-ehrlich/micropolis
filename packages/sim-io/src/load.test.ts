import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import {
  SCENARIO_BUNDLE_V1_MAP_HEIGHT,
  SCENARIO_BUNDLE_V1_MAP_WIDTH,
  SCENARIO_BUNDLE_V1_TILE_COUNT,
  SCENARIO_BUNDLE_V1_VERSION,
  type ScenarioBundleV1,
} from '../../scenario-core/src/scenario-bundle-v1.ts';
import {
  applyLoadNormalization,
  createClassicMapStore,
  createSimContext,
  createSimState,
  decodeCityFileForMap,
  readCityMeta,
  World,
} from '../../sim-core/src/index.ts';
import {
  assertClassicMapSize,
  deriveCityNameFromPath,
  loadCityLikeC,
  loadFileLikeC,
  loadScenarioBundleLikeC,
  loadScenarioLikeC,
} from './load.ts';

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE_CITY = path.join(PACKAGE_ROOT, '..', 'sim-core', 'fixtures', 'cities', 'about.cty');
const FIXTURE_SCENARIO = path.join(
  PACKAGE_ROOT,
  '..',
  '..',
  'ref',
  'micropolis',
  'res',
  'snro.222',
);
const CLASSIC_MAP = { width: World.WORLD_X, height: World.WORLD_Y };

/**
 * Read a fixture as `Uint8Array` for load tests.
 * Test helper; binary shape is interpreted by `decodeCityFileForMap` from sim-core.
 */
function readFixture(filePath: string): Uint8Array {
  return new Uint8Array(readFileSync(filePath));
}

/**
 * Build one deterministic user-scenario bundle fixture for load-orchestration tests.
 * Mirrors Stage 0 `ScenarioBundleV1` map/start contracts; map words use classic
 * x-major ordering from `ref/micropolis/src/sim/s_fileio.c`.
 */
function createUserScenarioBundleFixture(): ScenarioBundleV1 {
  const tileWords = Array.from({ length: SCENARIO_BUNDLE_V1_TILE_COUNT }, () => 0);
  tileWords[0] = 7;
  tileWords[SCENARIO_BUNDLE_V1_MAP_HEIGHT] = 13;

  return {
    version: SCENARIO_BUNDLE_V1_VERSION,
    key: 'user/test-harbor',
    name: 'Test Harbor',
    description: 'Fixture scenario bundle for sim-io load orchestration tests.',
    tags: ['test'],
    start: {
      startYear: 1930,
      startFunds: 12345,
    },
    map: {
      kind: 'tile-words',
      width: SCENARIO_BUNDLE_V1_MAP_WIDTH,
      height: SCENARIO_BUNDLE_V1_MAP_HEIGHT,
      tileWords,
    },
  };
}

describe('load orchestration', () => {
  it('mirrors C loadFile sequencing on loaded city bytes', () => {
    const bytes = readFixture(FIXTURE_CITY);
    const city = decodeCityFileForMap(bytes, CLASSIC_MAP);
    const rawMeta = readCityMeta(city.misc);
    const normalized = applyLoadNormalization(rawMeta);

    const hooks = {
      changeCensus: vi.fn(),
    };
    const store = createClassicMapStore();
    const context = createSimContext({ store, hooks });
    const state = createSimState();

    const result = loadFileLikeC(state, context, bytes);

    expect(Array.from(result.city.map)).toEqual(Array.from(city.map));
    expect(state.CityTime).toBe(normalized.cityTime);
    expect(state.CityTax).toBe(normalized.cityTax);
    expect(state.SimSpeed).toBe(normalized.simSpeed);
    expect(state.SimMetaSpeed).toBe(normalized.simSpeed);
    expect(state.TotalFunds).toBe(normalized.totalFunds);
    expect(state.policePercent).toBe(1);
    expect(state.firePercent).toBe(1);
    expect(state.roadPercent).toBe(1);
    expect(state.ScenarioID).toBe(0);
    expect(state.Spdcycle).toBe(0);
    expect(state.InitSimLoad).toBe(0);
    expect(state.DoInitialEval).toBe(1);
    expect(hooks.changeCensus).toHaveBeenCalledOnce();

    const map = context.store.snapshot('map') as Uint16Array;
    expect(Array.from(map)).toEqual(Array.from(city.map));
  });

  it('mirrors C LoadCity naming behavior', () => {
    const bytes = readFixture(FIXTURE_CITY);
    const store = createClassicMapStore();
    const context = createSimContext({ store });
    const state = createSimState();

    const fileName = '/tmp/city.with.dots/alpha.beta.cty';
    const loaded = loadCityLikeC(state, context, fileName, bytes);

    expect(loaded.cityFileName).toBe(fileName);
    expect(loaded.cityName).toBe('alpha.beta');
  });

  it('matches C path truncation quirk when dots are only in directory segments', () => {
    // C `LoadCity` truncates at the last '.' in the full string before it strips path.
    // With `/tmp/a.b/city` this yields `/tmp/a` and then basename `a`.
    expect(deriveCityNameFromPath('/tmp/a.b/city')).toBe('a');
  });

  it('mirrors C LoadScenario constants and init ordering', () => {
    const scenarioBytes = readFixture(FIXTURE_SCENARIO);
    const scenarioCity = decodeCityFileForMap(scenarioBytes, CLASSIC_MAP);

    const store = createClassicMapStore();
    const context = createSimContext({ store });
    const state = createSimState();

    const loaded = loadScenarioLikeC(state, context, 2, scenarioBytes);

    // Magic numbers from `LoadScenario` in `ref/micropolis/src/sim/s_fileio.c`:
    // - CityTime for scenario 2: ((1906 - 1900) * 48) + 2 = 290
    // - funds: 20000
    // - setSpeed(3), CityTax = 7
    expect(loaded.scenario.id).toBe(2);
    expect(state.CityTime).toBe(290);
    expect(state.TotalFunds).toBe(20000);
    expect(state.SimSpeed).toBe(3);
    expect(state.SimMetaSpeed).toBe(3);
    expect(state.CityTax).toBe(7);

    // `simLoadInit` in `packages/sim-core/src/systems/init.ts` assigns scenario timers.
    expect(state.ScenarioID).toBe(2);
    expect(state.DisasterEvent).toBe(2);
    expect(state.DisasterWait).toBe(10);
    expect(state.ScoreType).toBe(2);
    expect(state.ScoreWait).toBe(240);

    expect(state.policePercent).toBe(1);
    expect(state.firePercent).toBe(1);
    expect(state.roadPercent).toBe(1);
    expect(state.InitSimLoad).toBe(0);
    expect(state.DoInitialEval).toBe(1);

    // `DoSimInit` runs map scans and can rewrite tiles (for example zone power bits),
    // so the live map is not expected to remain byte-identical to raw `snro.*`.
    expect(Array.from(loaded.city.map)).toEqual(Array.from(scenarioCity.map));
    const map = context.store.snapshot('map') as Uint16Array;
    expect(map.length).toBe(scenarioCity.map.length);
  });

  it('clamps out-of-range scenario ids like C', () => {
    const scenarioBytes = readFixture(FIXTURE_SCENARIO);

    const store = createClassicMapStore();
    const context = createSimContext({ store });
    const state = createSimState();

    const loaded = loadScenarioLikeC(state, context, 99, scenarioBytes);

    expect(loaded.scenario.id).toBe(1);
    expect(state.ScenarioID).toBe(1);
    expect(state.TotalFunds).toBe(5000);
  });

  it('loads Stage 0 user bundles through LoadScenario-equivalent init sequencing', () => {
    const bundle = createUserScenarioBundleFixture();
    const store = createClassicMapStore();
    const context = createSimContext({ store });
    const state = createSimState();

    const loaded = loadScenarioBundleLikeC(state, context, bundle);

    expect(loaded.scenarioKey).toBe(bundle.key);
    expect(loaded.scenarioName).toBe(bundle.name);
    // Magic numbers source: `CityTime = ((year - 1900) * 48) + 2`,
    // `setSpeed(3)`, and `CityTax = 7` in `ref/micropolis/src/sim/s_fileio.c` `LoadScenario`.
    expect(state.CityTime).toBe(1442);
    expect(state.TotalFunds).toBe(bundle.start.startFunds);
    expect(state.SimSpeed).toBe(3);
    expect(state.SimMetaSpeed).toBe(3);
    expect(state.CityTax).toBe(7);
    // No legacy builtin scenario id is associated with `user/*` bundles.
    expect(state.ScenarioID).toBe(0);
    expect(state.policePercent).toBe(1);
    expect(state.firePercent).toBe(1);
    expect(state.roadPercent).toBe(1);
    expect(loaded.city.map[0]).toBe(7);
    expect(loaded.city.map[SCENARIO_BUNDLE_V1_MAP_HEIGHT]).toBe(13);
  });

  it('rejects unsupported orchestration map sizes', () => {
    expect(() => assertClassicMapSize({ width: 10, height: 10 })).toThrow(
      'unsupported map size for load orchestration',
    );
  });
});
