import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  decodeTerrainMapU16LE,
  findTerrainMapMismatch,
  formatTerrainMapMismatch,
  readTerrainMapU16LE,
  runTerrainHarness,
  TERRAIN_TILE_COUNT,
} from '@city/micropolis-c-harness/terrain-parity';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { World } from '../core/constants.ts';
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
  const runHarness = (opts: {
    seed: number;
    treeLevel: number;
    lakeLevel: number;
    curveLevel: number;
    createIsland: number;
  }): Uint16Array => {
    return decodeTerrainMapU16LE(
      runTerrainHarness([
        `--seed=${opts.seed}`,
        `--treeLevel=${opts.treeLevel}`,
        `--lakeLevel=${opts.lakeLevel}`,
        `--curveLevel=${opts.curveLevel}`,
        `--createIsland=${opts.createIsland}`,
        '--format=u16le',
      ]),
    );
  };

  it('matches C for many random seeds/knobs', () => {
    const numRuns = process.env.CITY_TEST_PARITY_RUNS
      ? Math.trunc(Number(process.env.CITY_TEST_PARITY_RUNS))
      : 25;
    const rawSeed = process.env.CITY_TEST_PARITY_FC_SEED
      ? Math.trunc(Number(process.env.CITY_TEST_PARITY_FC_SEED))
      : 123456789;

    // `fast-check` seed must be a finite integer.
    const fcSeed = Number.isFinite(rawSeed) ? rawSeed : 123456789;

    fc.assert(
      fc.property(
        fc.record({
          seed: fc.integer({ min: 0, max: 0xffff_ffff }),
          treeLevel: fc.constantFrom(-1, 0, 1, 5, 10),
          lakeLevel: fc.constantFrom(-1, 0, 1, 10),
          curveLevel: fc.constantFrom(-1, 0, 1, 10),
          createIsland: fc.constantFrom(-1, 0, 1),
        }),
        (opts) => {
          const expected = runHarness(opts);

          const state = createSimState();
          const context = createSimContext();
          generateMap(state, context, { ...opts, reseedAfter: false });

          const actual = context.store.snapshot('map') as Uint16Array;
          expectMapsEqual(actual, expected);
        },
      ),
      { numRuns: Number.isFinite(numRuns) && numRuns > 0 ? numRuns : 25, seed: fcSeed },
    );
  });
});
