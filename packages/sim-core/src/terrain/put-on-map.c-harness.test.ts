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
import { indexFor, testBounds } from './helpers.ts';
import { putOnMap } from './put-on-map.ts';

/**
 * `UNUSED_TRASH2` (39) from `ref/micropolis/src/sim/headers/sim.h`.
 *
 * Included here so deterministic parity maps can include the full tree range
 * used by `IsTree` in `ref/micropolis/src/sim/s_gen.c`.
 */
const TERRAIN_TREE_HIGH = 39;
const BASE_WATER_TILES = [Tile.DIRT, Tile.RIVER, Tile.REDGE, Tile.CHANNEL] as const;

/**
 * Representative pre-write target states for `PutOnMap`.
 *
 * C reference:
 * - `PutOnMap` in `ref/micropolis/src/sim/s_gen.c` checks current tile using
 *   `temp = temp & LOMASK` and then applies special behavior for `RIVER` and
 *   `CHANNEL`.
 */
const TARGET_STATE_OPTIONS = [
  Tile.DIRT,
  Tile.RIVER,
  Tile.RIVER | TileFlag.BULLBIT,
  Tile.CHANNEL,
  Tile.CHANNEL | TileFlag.BURNBIT,
  Tile.REDGE | TileFlag.BLBNBIT,
] as const;

/**
 * Write candidates for `Mchar` in `PutOnMap`.
 *
 * Magic number note:
 * - `0` is deliberate and comes from `if (Mchar == 0) return;` in
 *   `ref/micropolis/src/sim/s_gen.c`.
 */
const MCHAR_OPTIONS = [
  0,
  Tile.RIVER,
  Tile.REDGE,
  Tile.CHANNEL,
  Tile.RIVER | TileFlag.BULLBIT,
  Tile.CHANNEL | TileFlag.BURNBIT,
] as const;

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

interface PutOnMapOpArgs {
  mapX: number;
  mapY: number;
  mchar: number;
  xoff: number;
  yoff: number;
}

/**
 * Runs C `PutOnMap(Mchar, Xoff, Yoff)` from `ref/micropolis/src/sim/s_gen.c`
 * in harness op mode.
 */
const runPutOnMapHarness = (inputMap: Uint16Array, args: PutOnMapOpArgs): Uint16Array => {
  const caseDir = mkdtempSync(path.join(tmpdir(), 'city-terrain-put-on-map-'));
  const inputPath = path.join(caseDir, 'input.u16le');

  try {
    writeTerrainMapU16LE(inputPath, inputMap);
    return decodeTerrainMapU16LE(
      runTerrainHarness([
        '--op=putOnMap',
        `--input-map=${inputPath}`,
        `--map-x=${args.mapX}`,
        `--map-y=${args.mapY}`,
        `--mchar=${args.mchar}`,
        `--xoff=${args.xoff}`,
        `--yoff=${args.yoff}`,
        '--format=u16le',
      ]),
    );
  } finally {
    rmSync(caseDir, { force: true, recursive: true });
  }
};

/**
 * Deterministic terrain-relevant map for `PutOnMap` parity tests.
 *
 * C references:
 * - `PutOnMap` in `ref/micropolis/src/sim/s_gen.c`
 * - tree classification bounds from `IsTree`/`WOODS_HIGH` in the same file
 */
const makeDeterministicMap = (seed: number): Uint16Array => {
  let state = seed >>> 0;
  const map = new Uint16Array(World.WORLD_X * World.WORLD_Y);

  for (let i = 0; i < map.length; i += 1) {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    const bucket = state % 100;

    if (bucket < 25) {
      const base = BASE_WATER_TILES[state % BASE_WATER_TILES.length];
      assertDefined(base, 'Expected BASE_WATER_TILES lookup to succeed');
      map[i] = base;
      continue;
    }

    if (bucket < 70) {
      map[i] = Tile.DIRT;
      continue;
    }

    const treeId = Tile.TREEBASE + (state % (TERRAIN_TREE_HIGH - Tile.TREEBASE + 1));
    map[i] = treeId;
  }

  return map;
};

interface FixedCase {
  args: PutOnMapOpArgs;
  name: string;
  seed: number;
  setup: (map: Uint16Array) => void;
}

describe('terrain/putOnMap parity against C harness (env-gated)', () => {
  if (process.env.CITY_TEST_PARITY !== '1') {
    it.skip('run `pnpm test-parity` to enable C parity tests', () => {});
    return;
  }

  const fixedCases: readonly FixedCase[] = [
    {
      name: 'channel overwrites an existing river tile',
      seed: 0x1020_3040,
      args: { mapX: 40, mapY: 30, mchar: Tile.CHANNEL, xoff: 0, yoff: 0 },
      setup: (map) => {
        map[indexFor(40, 30)] = Tile.RIVER | TileFlag.BULLBIT;
      },
    },
    {
      name: 'non-channel write cannot overwrite an existing river tile',
      seed: 0x2030_4050,
      args: { mapX: 27, mapY: 21, mchar: Tile.REDGE, xoff: 0, yoff: 0 },
      setup: (map) => {
        map[indexFor(27, 21)] = Tile.RIVER | TileFlag.BURNBIT;
      },
    },
    {
      name: 'existing channel tile cannot be overwritten',
      seed: 0x3040_5060,
      args: { mapX: 81, mapY: 45, mchar: Tile.RIVER, xoff: 0, yoff: 0 },
      setup: (map) => {
        map[indexFor(81, 45)] = Tile.CHANNEL | TileFlag.BULLBIT;
      },
    },
    {
      name: 'Mchar=0 is a no-op even when target is in-bounds',
      seed: 0x4050_6070,
      args: { mapX: 58, mapY: 76, mchar: 0, xoff: 0, yoff: 0 },
      setup: (map) => {
        map[indexFor(58, 76)] = Tile.REDGE | TileFlag.BLBNBIT;
      },
    },
    {
      name: 'out-of-bounds writes are clipped by TestBounds',
      seed: 0x5060_7080,
      args: { mapX: 0, mapY: 0, mchar: Tile.CHANNEL, xoff: -1, yoff: 0 },
      setup: (_map) => {},
    },
  ];

  for (const testCase of fixedCases) {
    it(`matches C PutOnMap for fixed case: ${testCase.name}`, () => {
      const input = makeDeterministicMap(testCase.seed);
      testCase.setup(input);
      const expected = runPutOnMapHarness(input, testCase.args);

      const actual = new Uint16Array(input);
      putOnMap(
        actual,
        testCase.args.mapX,
        testCase.args.mapY,
        testCase.args.mchar,
        testCase.args.xoff,
        testCase.args.yoff,
      );

      expectMapsEqual(actual, expected);
    });
  }

  it('matches C PutOnMap across randomized target-cell states', () => {
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
          baseSeed: fc.integer({ min: 0, max: 0xffff_ffff }),
          mapX: fc.integer({ min: 0, max: World.WORLD_X - 1 }),
          mapY: fc.integer({ min: 0, max: World.WORLD_Y - 1 }),
          xoff: fc.integer({ min: -4, max: 4 }),
          yoff: fc.integer({ min: -4, max: 4 }),
          mchar: fc.constantFrom(...MCHAR_OPTIONS),
          targetState: fc.constantFrom(...TARGET_STATE_OPTIONS),
        }),
        ({ baseSeed, mapX, mapY, xoff, yoff, mchar, targetState }) => {
          const input = makeDeterministicMap(baseSeed);
          const xloc = mapX + xoff;
          const yloc = mapY + yoff;
          if (testBounds(xloc, yloc)) {
            input[indexFor(xloc, yloc)] = targetState;
          }

          const expected = runPutOnMapHarness(input, { mapX, mapY, mchar, xoff, yoff });

          const actual = new Uint16Array(input);
          putOnMap(actual, mapX, mapY, mchar, xoff, yoff);

          expectMapsEqual(actual, expected);
        },
      ),
      { numRuns: Number.isFinite(numRuns) && numRuns > 0 ? numRuns : 25, seed: fcSeed },
    );
  });
});
