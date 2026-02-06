import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  decodeTerrainMapU16LE,
  findTerrainMapMismatch,
  formatTerrainMapMismatch,
  readTerrainMapU16LE,
  runTerrainGenerateHarnessBatch,
  runTerrainHarness,
  TERRAIN_TILE_COUNT,
  type TerrainGenerateHarnessCase,
} from '@city/micropolis-c-harness/terrain-parity';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { assertDefined } from '../core/assert.ts';
import { World } from '../core/constants.ts';
import { MicropolisRng } from '../core/rng.ts';
import { createSimContext } from '../core/sim-context.ts';
import { createSimState } from '../core/sim-state.ts';
import { generateMap } from './generate.ts';

/**
 * Asserts byte-for-byte equality of two classic Micropolis maps.
 *
 * C reference:
 * - World size constants in `ref/micropolis/src/sim/headers/sim.h` (`WORLD_X/WORLD_Y`).
 */
const expectMapsEqual = (actual: Uint16Array, expected: Uint16Array): void => {
  expect(actual).toHaveLength(World.WORLD_X * World.WORLD_Y);
  expect(expected).toHaveLength(TERRAIN_TILE_COUNT);
  const mismatch = findTerrainMapMismatch(actual, expected);
  if (mismatch !== null) {
    throw new Error(formatTerrainMapMismatch(mismatch));
  }
};

const SIM_CORE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FIXTURE_DIR = path.join(SIM_CORE_ROOT, 'fixtures', 'terrain');
const LEVEL_MATRIX = [-1, 0, 1] as const;

describe('terrain/generateMap parity against C fixtures', () => {
  const manifestPath = path.join(FIXTURE_DIR, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    fixtures: Array<{
      seed: number;
      treeLevel: number;
      lakeLevel: number;
      curveLevel: number;
      createIsland: number;
      file: string;
    }>;
  };

  /**
   * Classifies the random-island branch gate in `GenerateMap`.
   *
   * The "magic numbers" 100 and 10 come directly from C:
   * - `if (CreateIsland < 0) if (Rand(100) < 10) { MakeIsland(); return; }`
   *   in `ref/micropolis/src/sim/s_gen.c`.
   */
  const randomIslandBranchTaken = (seed: number): boolean => {
    const rng = new MicropolisRng(seed);
    return rng.rand(100) < 10;
  };

  it('fixture matrix covers Phase 4 level grid and island branch modes', () => {
    const stageGateCombos = new Set<string>();
    for (const fixture of manifest.fixtures) {
      if (fixture.createIsland === 0) {
        stageGateCombos.add(`${fixture.treeLevel}|${fixture.lakeLevel}|${fixture.curveLevel}`);
      }
    }

    for (const treeLevel of LEVEL_MATRIX) {
      for (const lakeLevel of LEVEL_MATRIX) {
        for (const curveLevel of LEVEL_MATRIX) {
          expect(stageGateCombos.has(`${treeLevel}|${lakeLevel}|${curveLevel}`)).toBe(true);
        }
      }
    }

    expect(manifest.fixtures.some((fixture) => fixture.createIsland === 1)).toBe(true);

    const randomIslandFixtures = manifest.fixtures.filter((fixture) => fixture.createIsland < 0);
    expect(randomIslandFixtures.length).toBeGreaterThan(0);
    expect(randomIslandFixtures.some((fixture) => randomIslandBranchTaken(fixture.seed))).toBe(
      true,
    );
    expect(randomIslandFixtures.some((fixture) => !randomIslandBranchTaken(fixture.seed))).toBe(
      true,
    );
  });

  for (const fixture of manifest.fixtures) {
    it(`matches ${fixture.file}`, () => {
      const expected = readTerrainMapU16LE(path.join(FIXTURE_DIR, fixture.file));

      const state = createSimState();
      const context = createSimContext();
      generateMap(state, context, {
        seed: fixture.seed,
        treeLevel: fixture.treeLevel,
        lakeLevel: fixture.lakeLevel,
        curveLevel: fixture.curveLevel,
        createIsland: fixture.createIsland,
        reseedAfter: false,
      });

      const actual = context.store.snapshot('map');
      expect(actual).toBeInstanceOf(Uint16Array);
      expectMapsEqual(actual as Uint16Array, expected);
    });
  }
});

describe('terrain/generateMap property parity against C harness (env-gated)', () => {
  if (process.env.CITY_TEST_PARITY !== '1') {
    it.skip('run `pnpm test-parity` to enable C parity tests', () => {});
    return;
  }

  /**
   * Runs the terrain harness and returns the generated map as a `Uint16Array`.
   *
   * C reference:
   * - `GenerateMap(int r)` in `ref/micropolis/src/sim/s_gen.c`.
   */
  const runHarness = (opts: TerrainGenerateHarnessCase): Uint16Array => {
    const args = [
      `--seed=${opts.seed}`,
      `--treeLevel=${opts.treeLevel}`,
      `--lakeLevel=${opts.lakeLevel}`,
      `--curveLevel=${opts.curveLevel}`,
      `--createIsland=${opts.createIsland}`,
      '--format=u16le',
    ];
    if (opts.runSmoothWater) {
      args.push('--runSmoothWater');
    }
    return decodeTerrainMapU16LE(runTerrainHarness(args));
  };

  const CASE_ARBITRARY = fc.record({
    seed: fc.integer({ min: 0, max: 0xffff_ffff }),
    treeLevel: fc.constantFrom(-1, 0, 1, 5, 10),
    lakeLevel: fc.constantFrom(-1, 0, 1, 10),
    curveLevel: fc.constantFrom(-1, 0, 1, 10),
    createIsland: fc.constantFrom(-1, 0, 1),
  });

  const resolvedNumRuns = (() => {
    const rawNumRuns = process.env.CITY_TEST_PARITY_RUNS
      ? Math.trunc(Number(process.env.CITY_TEST_PARITY_RUNS))
      : 25;
    return Number.isFinite(rawNumRuns) && rawNumRuns > 0 ? rawNumRuns : 25;
  })();

  const resolvedFcSeed = (() => {
    const rawSeed = process.env.CITY_TEST_PARITY_FC_SEED
      ? Math.trunc(Number(process.env.CITY_TEST_PARITY_FC_SEED))
      : 123456789;
    // `fast-check` seed must be a finite integer.
    return Number.isFinite(rawSeed) ? rawSeed : 123456789;
  })();

  const sampleGenerateCases = (numRuns: number, seed: number): TerrainGenerateHarnessCase[] =>
    fc.sample(CASE_ARBITRARY, { numRuns, seed });

  it('batch GenerateMap mode matches per-case harness execution', () => {
    const cases = sampleGenerateCases(16, 0x5eed_cafe).map((entry, index) => {
      // Alternate post-generation water smoothing to exercise both batch codepaths.
      return { ...entry, runSmoothWater: index % 2 === 0 };
    });
    const expectedBatch = runTerrainGenerateHarnessBatch(cases);
    expect(expectedBatch).toHaveLength(cases.length);

    for (let index = 0; index < cases.length; index += 1) {
      const caseInput = cases[index];
      const batchMap = expectedBatch[index];
      assertDefined(caseInput, `expected case at index ${index}`);
      assertDefined(batchMap, `expected batch map at index ${index}`);

      const perCaseMap = runHarness(caseInput);
      expectMapsEqual(batchMap, perCaseMap);
    }
  });

  it('matches C for many sampled seeds/knobs', () => {
    const sampledCases = sampleGenerateCases(resolvedNumRuns, resolvedFcSeed);

    const batchModeEnv = process.env.CITY_TEST_PARITY_BATCH;
    const shouldUseBatch = batchModeEnv === '1' || (batchModeEnv !== '0' && resolvedNumRuns >= 40);

    const expectedMaps = shouldUseBatch
      ? runTerrainGenerateHarnessBatch(sampledCases)
      : sampledCases.map((entry) => runHarness(entry));

    expect(expectedMaps).toHaveLength(sampledCases.length);

    for (let index = 0; index < sampledCases.length; index += 1) {
      const opts = sampledCases[index];
      const expected = expectedMaps[index];
      assertDefined(opts, `expected sampled case at index ${index}`);
      assertDefined(expected, `expected expected-map at index ${index}`);

      const state = createSimState();
      const context = createSimContext();
      generateMap(state, context, { ...opts, reseedAfter: false });

      const actual = context.store.snapshot('map') as Uint16Array;
      expectMapsEqual(actual, expected);
    }
  });
});
