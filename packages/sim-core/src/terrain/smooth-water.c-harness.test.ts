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
import { indexFor } from './helpers.ts';
import { smoothWater } from './smooth-water.ts';

/**
 * `UNUSED_TRASH2` (39) from `ref/micropolis/src/sim/headers/sim.h`.
 *
 * `SmoothWater` in `ref/micropolis/src/sim/s_gen.c` uses this as the upper
 * woods bound (`WOODS_HIGH`) via masked checks.
 */
const WOODS_TILE_HIGH = 39;

/**
 * Representative non-water terrain states for branch-biased `SmoothWater` maps.
 *
 * C reference:
 * - `SmoothWater` in `ref/micropolis/src/sim/s_gen.c` checks water by masked
 *   range `[WATER_LOW..WATER_HIGH]` where `WATER_LOW=RIVER (2)` and
 *   `WATER_HIGH=LASTRIVEDGE (20)`.
 */
const LAND_TILES = [Tile.DIRT, Tile.ROADBASE, Tile.RAILBASE, Tile.POWERBASE] as const;
const TILE_FLAGS = [0, TileFlag.BULLBIT, TileFlag.BURNBIT, TileFlag.BLBNBIT] as const;

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
 * Runs C `SmoothWater(void)` from `ref/micropolis/src/sim/s_gen.c` in op mode.
 */
const runSmoothWaterHarness = (inputMap: Uint16Array): Uint16Array => {
  const caseDir = mkdtempSync(path.join(tmpdir(), 'city-terrain-smooth-water-'));
  const inputPath = path.join(caseDir, 'input.u16le');

  try {
    writeTerrainMapU16LE(inputPath, inputMap);
    return decodeTerrainMapU16LE(
      runTerrainHarness(['--op=smoothWater', `--input-map=${inputPath}`, '--format=u16le']),
    );
  } finally {
    rmSync(caseDir, { force: true, recursive: true });
  }
};

/**
 * Builds a branch-biased terrain map for `SmoothWater` parity cases.
 *
 * C references:
 * - `SmoothWater` in `ref/micropolis/src/sim/s_gen.c`
 * - `WATER_LOW/WATER_HIGH` and `WOODS_LOW/WOODS_HIGH` range checks in that
 *   function (`2..20` and `21..39`, both via `cell & LOMASK`).
 */
const makeBranchBiasedSmoothWaterMap = (
  seed: number,
  waterWeightPercent: number,
  woodsWeightPercent: number,
): Uint16Array => {
  let state = seed >>> 0;
  const map = new Uint16Array(World.WORLD_X * World.WORLD_Y);

  for (let i = 0; i < map.length; i += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const bucket = state % 100;

    if (bucket < waterWeightPercent) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      const waterTileId = Tile.RIVER + (state % (Tile.LASTRIVEDGE - Tile.RIVER + 1));
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      const maybeFlagged = (state & 3) !== 0;
      if (maybeFlagged) {
        const flag = TILE_FLAGS[(state >>> 3) % TILE_FLAGS.length];
        assertDefined(flag, 'Expected TILE_FLAGS lookup to succeed');
        map[i] = waterTileId + flag;
      } else {
        map[i] = waterTileId;
      }
      continue;
    }

    if (bucket < waterWeightPercent + woodsWeightPercent) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      const treeTileId = Tile.TREEBASE + (state % (WOODS_TILE_HIGH - Tile.TREEBASE + 1));
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      const flag = TILE_FLAGS[(state >>> 5) % TILE_FLAGS.length];
      assertDefined(flag, 'Expected TILE_FLAGS lookup to succeed');
      map[i] = treeTileId + flag;
      continue;
    }

    const landTile = LAND_TILES[state % LAND_TILES.length];
    assertDefined(landTile, 'Expected LAND_TILES lookup to succeed');
    map[i] = landTile;
  }

  // Pass-1 target: water next to non-water should become REDGE.
  map[indexFor(18, 18)] = Tile.RIVER | TileFlag.BULLBIT;
  map[indexFor(17, 18)] = Tile.DIRT;

  // Pass-2 target: interior non-channel water should become RIVER.
  map[indexFor(36, 52)] = Tile.REDGE;
  map[indexFor(35, 52)] = Tile.RIVER;
  map[indexFor(37, 52)] = Tile.CHANNEL;
  map[indexFor(36, 51)] = Tile.LASTRIVEDGE;
  map[indexFor(36, 53)] = Tile.RIVER | TileFlag.BLBNBIT;

  // Pass-3 target condition exercise: woods with flagged water neighbors should
  // not be considered adjacent to exact RIVER/CHANNEL by raw equality.
  map[indexFor(70, 44)] = Tile.WOODS + TileFlag.BULLBIT;
  map[indexFor(71, 44)] = Tile.RIVER | TileFlag.BURNBIT;
  map[indexFor(70, 45)] = Tile.CHANNEL | TileFlag.BULLBIT;

  return map;
};

describe('terrain/smoothWater parity against C harness (env-gated)', () => {
  if (process.env.CITY_TEST_PARITY !== '1') {
    it.skip('run `pnpm test-parity` to enable C parity tests', () => {});
    return;
  }

  it('matches C SmoothWater for a deterministic branch-biased fixture map', () => {
    const input = makeBranchBiasedSmoothWaterMap(0x2468_ace1, 52, 30);
    const expected = runSmoothWaterHarness(input);

    const actual = new Uint16Array(input);
    smoothWater(actual);

    expectMapsEqual(actual, expected);
  });

  it('matches C SmoothWater across property-generated branch-biased maps', () => {
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
          waterWeightPercent: fc.integer({ min: 35, max: 70 }),
          woodsWeightPercent: fc.integer({ min: 15, max: 40 }),
        }),
        ({ seed, waterWeightPercent, woodsWeightPercent }) => {
          const input = makeBranchBiasedSmoothWaterMap(
            seed,
            waterWeightPercent,
            woodsWeightPercent,
          );
          const expected = runSmoothWaterHarness(input);

          const actual = new Uint16Array(input);
          smoothWater(actual);

          expectMapsEqual(actual, expected);
        },
      ),
      { numRuns: Number.isFinite(numRuns) && numRuns > 0 ? numRuns : 25, seed: fcSeed },
    );
  });
});
