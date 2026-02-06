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
import { createRng } from '../core/rng.ts';
import { indexFor } from './helpers.ts';
import { smoothRiver } from './smooth-river.ts';

/**
 * `UNUSED_TRASH2` (39) from `ref/micropolis/src/sim/headers/sim.h`.
 *
 * `SmoothRiver` in `ref/micropolis/src/sim/s_gen.c` excludes woods-range tiles
 * from bitindex contributions using `WOODS_LOW..WOODS_HIGH` (`21..39`).
 */
const WOODS_TILE_HIGH = 39;

/**
 * Non-tree, non-dirt tiles that contribute to `SmoothRiver` bitindex bits.
 *
 * C reference:
 * - Neighbor contributes when `(neighbor & LOMASK) != DIRT` and masked neighbor
 *   is outside woods range in `SmoothRiver()` (`ref/micropolis/src/sim/s_gen.c`).
 */
const BIT_CONTRIBUTOR_TILES = [Tile.RIVER, Tile.CHANNEL, Tile.ROADBASE, Tile.RAILBASE] as const;
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
 * Runs C `SmoothRiver(void)` from `ref/micropolis/src/sim/s_gen.c` in op mode.
 *
 * The op-level seed contract is:
 * - Harness calls `SeedRand(seed)` immediately before running `SmoothRiver()`.
 */
const runSmoothRiverHarness = (inputMap: Uint16Array, seed: number): Uint16Array => {
  const caseDir = mkdtempSync(path.join(tmpdir(), 'city-terrain-smooth-river-'));
  const inputPath = path.join(caseDir, 'input.u16le');

  try {
    writeTerrainMapU16LE(inputPath, inputMap);
    return decodeTerrainMapU16LE(
      runTerrainHarness([
        '--op=smoothRiver',
        `--input-map=${inputPath}`,
        `--seed=${seed}`,
        '--format=u16le',
      ]),
    );
  } finally {
    rmSync(caseDir, { force: true, recursive: true });
  }
};

/**
 * Builds a branch-biased map for `SmoothRiver` parity.
 *
 * C references:
 * - `SmoothRiver()` and `REdTab[16]` in `ref/micropolis/src/sim/s_gen.c`
 *
 * Design intent:
 * - include many exact `REDGE` cells (`Map[x][y] == REDGE` is required),
 * - include both contributing and non-contributing neighbors so we exercise
 *   varied `bitindex` values and both `temp == RIVER` and `temp != RIVER` paths.
 */
const makeBranchBiasedSmoothRiverMap = (
  seed: number,
  redgeWeightPercent: number,
  woodsWeightPercent: number,
): Uint16Array => {
  let state = seed >>> 0;
  const map = new Uint16Array(World.WORLD_X * World.WORLD_Y).fill(Tile.DIRT);

  for (let i = 0; i < map.length; i += 1) {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    const bucket = state % 100;

    if (bucket < redgeWeightPercent) {
      map[i] = Tile.REDGE;
      continue;
    }

    if (bucket < redgeWeightPercent + woodsWeightPercent) {
      state = (Math.imul(state, 1103515245) + 12345) >>> 0;
      const treeTileId = Tile.TREEBASE + (state % (WOODS_TILE_HIGH - Tile.TREEBASE + 1));
      state = (Math.imul(state, 1103515245) + 12345) >>> 0;
      const flag = TILE_FLAGS[(state >>> 3) % TILE_FLAGS.length];
      assertDefined(flag, 'Expected TILE_FLAGS lookup to succeed');
      map[i] = treeTileId + flag;
      continue;
    }

    if (bucket < redgeWeightPercent + woodsWeightPercent + 20) {
      const tile = BIT_CONTRIBUTOR_TILES[state % BIT_CONTRIBUTOR_TILES.length];
      assertDefined(tile, 'Expected BIT_CONTRIBUTOR_TILES lookup to succeed');
      state = (Math.imul(state, 1103515245) + 12345) >>> 0;
      const flag = TILE_FLAGS[(state >>> 7) % TILE_FLAGS.length];
      assertDefined(flag, 'Expected TILE_FLAGS lookup to succeed');
      map[i] = tile + flag;
      continue;
    }
  }

  // Force one `bitindex=5` shape (left=0, down=1, right=0, up=1), where C
  // table entry is exactly `RIVER` (`REdTab[5] == 2`) and no `Rand(1)` is used.
  map[indexFor(30, 30)] = Tile.REDGE;
  map[indexFor(29, 30)] = Tile.DIRT;
  map[indexFor(31, 30)] = Tile.DIRT;
  map[indexFor(30, 29)] = Tile.RIVER;
  map[indexFor(30, 31)] = Tile.CHANNEL;

  // Force one `bitindex=0` shape where `REdTab[0] != RIVER`, so `Rand(1)` is
  // consulted and can trigger the `temp++` variant.
  map[indexFor(45, 62)] = Tile.REDGE;
  map[indexFor(44, 62)] = Tile.DIRT;
  map[indexFor(46, 62)] = Tile.DIRT;
  map[indexFor(45, 61)] = Tile.DIRT;
  map[indexFor(45, 63)] = Tile.DIRT;

  return map;
};

describe('terrain/smoothRiver parity against C harness (env-gated)', () => {
  if (process.env.CITY_TEST_PARITY !== '1') {
    it.skip('run `pnpm test-parity` to enable C parity tests', () => {});
    return;
  }

  it('matches C SmoothRiver for a deterministic branch-biased fixture map with seed', () => {
    const input = makeBranchBiasedSmoothRiverMap(0x3141_5926, 58, 20);
    const opSeed = 0x2718_2818;
    const expected = runSmoothRiverHarness(input, opSeed);

    const actual = new Uint16Array(input);
    const rng = createRng(opSeed);
    smoothRiver(actual, rng);

    expectMapsEqual(actual, expected);
  });

  it('matches C SmoothRiver across property-generated maps and seeds (Rand(1) branch stress)', () => {
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
          mapSeed: fc.integer({ min: 0, max: 0xffff_ffff }),
          opSeed: fc.integer({ min: 0, max: 0xffff_ffff }),
          redgeWeightPercent: fc.integer({ min: 35, max: 75 }),
          woodsWeightPercent: fc.integer({ min: 10, max: 30 }),
        }),
        ({ mapSeed, opSeed, redgeWeightPercent, woodsWeightPercent }) => {
          const input = makeBranchBiasedSmoothRiverMap(
            mapSeed,
            redgeWeightPercent,
            woodsWeightPercent,
          );
          const expected = runSmoothRiverHarness(input, opSeed);

          const actual = new Uint16Array(input);
          const rng = createRng(opSeed);
          smoothRiver(actual, rng);

          expectMapsEqual(actual, expected);
        },
      ),
      { numRuns: Number.isFinite(numRuns) && numRuns > 0 ? numRuns : 25, seed: fcSeed },
    );
  });
});
