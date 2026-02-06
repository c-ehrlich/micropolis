import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  decodeTerrainMapU16LE,
  findTerrainMapMismatch,
  formatTerrainMapMismatch,
  runTerrainHarness,
  writeTerrainMapU16LE,
} from '@city/micropolis-c-harness/terrain-parity';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { assertDefined } from '../core/assert.ts';
import { Tile, TileFlag, World } from '../core/constants.ts';
import { smoothTrees } from './smooth-trees.ts';

/**
 * `UNUSED_TRASH2` (39) from `ref/micropolis/src/sim/headers/sim.h`.
 *
 * `SmoothTrees` in `ref/micropolis/src/sim/s_gen.c` classifies trees with
 * `IsTree(...)`, whose upper bound is this exact tile ID.
 */
const TREE_TILE_HIGH = 39;

const WATER_TILES = [
  Tile.RIVER,
  Tile.REDGE,
  Tile.CHANNEL,
  Tile.FIRSTRIVEDGE,
  Tile.LASTRIVEDGE,
] as const;
const LAND_TILES = [Tile.DIRT, Tile.ROADBASE, Tile.RAILBASE] as const;
const TREE_FLAGS = [0, TileFlag.BULLBIT, TileFlag.BURNBIT, TileFlag.BLBNBIT] as const;

/**
 * Asserts complete map parity for Micropolis `Map[WORLD_X][WORLD_Y]`.
 *
 * C references:
 * - `WORLD_X/WORLD_Y` in `ref/micropolis/src/sim/headers/sim.h`
 * - x-major layout in `ref/micropolis/src/sim/s_gen.c`
 */
const expectMapsEqual = (actual: Uint16Array, expected: Uint16Array): void => {
  expect(actual).toHaveLength(World.WORLD_X * World.WORLD_Y);
  expect(expected).toHaveLength(World.WORLD_X * World.WORLD_Y);
  const mismatch = findTerrainMapMismatch(actual, expected);
  if (mismatch !== null) {
    throw new Error(formatTerrainMapMismatch(mismatch));
  }
};

/**
 * Runs C `SmoothTrees(void)` from `ref/micropolis/src/sim/s_gen.c` in op mode.
 */
const runSmoothTreesHarness = (inputMap: Uint16Array): Uint16Array => {
  const caseDir = mkdtempSync(path.join(tmpdir(), 'city-terrain-smooth-trees-'));
  const inputPath = path.join(caseDir, 'input.u16le');

  try {
    writeTerrainMapU16LE(inputPath, inputMap);
    return decodeTerrainMapU16LE(
      runTerrainHarness(['--op=smoothTrees', `--input-map=${inputPath}`, '--format=u16le']),
    );
  } finally {
    rmSync(caseDir, { force: true, recursive: true });
  }
};

/**
 * Deterministic map generator biased toward tree tiles for `SmoothTrees`.
 *
 * C references:
 * - `SmoothTrees` and `IsTree` in `ref/micropolis/src/sim/s_gen.c`
 * - `WOODS_LOW=TREEBASE` and `WOODS_HIGH=UNUSED_TRASH2` in `s_gen.c`
 */
const makeTreeBiasedMap = (seed: number, treeWeightPercent: number): Uint16Array => {
  let state = seed >>> 0;
  const map = new Uint16Array(World.WORLD_X * World.WORLD_Y);

  for (let i = 0; i < map.length; i += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const roll = state % 100;

    if (roll < treeWeightPercent) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      const treeId = Tile.TREEBASE + (state % (TREE_TILE_HIGH - Tile.TREEBASE + 1));
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      const flag = TREE_FLAGS[state % TREE_FLAGS.length];
      assertDefined(flag, 'Expected TREE_FLAGS lookup to succeed');
      map[i] = treeId + flag;
      continue;
    }

    if (roll < 85) {
      const waterTile = WATER_TILES[state % WATER_TILES.length];
      assertDefined(waterTile, 'Expected WATER_TILES lookup to succeed');
      map[i] = waterTile;
      continue;
    }

    const landTile = LAND_TILES[state % LAND_TILES.length];
    assertDefined(landTile, 'Expected LAND_TILES lookup to succeed');
    map[i] = landTile;
  }

  return map;
};

describe('terrain/smoothTrees parity against C harness (env-gated)', () => {
  if (process.env.CITY_TEST_PARITY !== '1') {
    it.skip('run `pnpm test-parity` to enable C parity tests', () => {});
    return;
  }

  it('matches C SmoothTrees for a deterministic tree-biased fixture map', () => {
    const input = makeTreeBiasedMap(0x1357_9bdf, 60);
    const expected = runSmoothTreesHarness(input);

    const actual = new Uint16Array(input);
    smoothTrees(actual);

    expectMapsEqual(actual, expected);
  });

  it('matches C SmoothTrees across property-generated tree-biased maps', () => {
    const numRuns = process.env.CITY_TEST_PARITY_RUNS
      ? Math.trunc(Number(process.env.CITY_TEST_PARITY_RUNS))
      : 25;
    const rawSeed = process.env.CITY_TEST_PARITY_FC_SEED
      ? Math.trunc(Number(process.env.CITY_TEST_PARITY_FC_SEED))
      : 123456789;
    const fcSeed = Number.isFinite(rawSeed) ? rawSeed : 123456789;

    fc.assert(
      fc.property(
        fc.record({
          seed: fc.integer({ min: 0, max: 0xffff_ffff }),
          treeWeightPercent: fc.integer({ min: 35, max: 80 }),
        }),
        ({ seed, treeWeightPercent }) => {
          const input = makeTreeBiasedMap(seed, treeWeightPercent);
          const expected = runSmoothTreesHarness(input);

          const actual = new Uint16Array(input);
          smoothTrees(actual);

          expectMapsEqual(actual, expected);
        },
      ),
      { numRuns: Number.isFinite(numRuns) && numRuns > 0 ? numRuns : 25, seed: fcSeed },
    );
  });
});
