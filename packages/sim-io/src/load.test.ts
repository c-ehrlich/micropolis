import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

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

  it('rejects unsupported orchestration map sizes', () => {
    expect(() => assertClassicMapSize({ width: 10, height: 10 })).toThrow(
      'unsupported map size for load orchestration',
    );
  });
});
