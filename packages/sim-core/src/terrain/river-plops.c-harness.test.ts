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
import { bRivPlop, sRivPlop } from './river-plops.ts';

/**
 * `UNUSED_TRASH2` (39) from `ref/micropolis/src/sim/headers/sim.h`.
 *
 * `IsTree` in `ref/micropolis/src/sim/s_gen.c` uses `TREEBASE..UNUSED_TRASH2`
 * as the tree tile range in several map-transform routines.
 */
const WOODS_TILE_HIGH = 39;
const TILE_FLAGS = [0, TileFlag.BULLBIT, TileFlag.BURNBIT, TileFlag.BLBNBIT] as const;
const TERRAIN_BASE_TILES = [
  Tile.DIRT,
  Tile.RIVER,
  Tile.REDGE,
  Tile.CHANNEL,
  Tile.ROADBASE,
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

/**
 * Runs C `BRivPlop`/`SRivPlop` in harness op mode.
 *
 * C references:
 * - `BRivPlop` and `SRivPlop` in `ref/micropolis/src/sim/s_gen.c`
 */
const runRiverPlopHarness = (
  inputMap: Uint16Array,
  op: 'brivPlop' | 'srivPlop',
  mapX: number,
  mapY: number,
): Uint16Array => {
  const caseDir = mkdtempSync(path.join(tmpdir(), 'city-terrain-river-plops-'));
  const inputPath = path.join(caseDir, 'input.u16le');

  try {
    writeTerrainMapU16LE(inputPath, inputMap);
    return decodeTerrainMapU16LE(
      runTerrainHarness([
        `--op=${op}`,
        `--input-map=${inputPath}`,
        `--map-x=${mapX}`,
        `--map-y=${mapY}`,
        '--format=u16le',
      ]),
    );
  } finally {
    rmSync(caseDir, { force: true, recursive: true });
  }
};

/**
 * Builds a terrain-relevant input map for river-plop parity tests.
 *
 * C references:
 * - `PutOnMap` overwrite behavior in `ref/micropolis/src/sim/s_gen.c`
 * - matrix values in `BRivPlop`/`SRivPlop` (`0/2/3/4` in the same file)
 *
 * Design intent:
 * - include existing river/channel cells so overwrite guards are exercised,
 * - include woods-range cells with flags so masked-vs-raw branches are covered.
 */
const makePlopBiasedMap = (seed: number): Uint16Array => {
  let state = seed >>> 0;
  const map = new Uint16Array(World.WORLD_X * World.WORLD_Y);

  for (let i = 0; i < map.length; i += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const bucket = state % 100;

    if (bucket < 30) {
      const baseTile = TERRAIN_BASE_TILES[state % TERRAIN_BASE_TILES.length];
      assertDefined(baseTile, 'Expected TERRAIN_BASE_TILES lookup to succeed');
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      const flag = TILE_FLAGS[(state >>> 4) % TILE_FLAGS.length];
      assertDefined(flag, 'Expected TILE_FLAGS lookup to succeed');
      map[i] = baseTile + flag;
      continue;
    }

    if (bucket < 55) {
      map[i] = Tile.RIVER;
      continue;
    }

    if (bucket < 70) {
      map[i] = Tile.CHANNEL;
      continue;
    }

    if (bucket < 85) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      const treeTile = Tile.TREEBASE + (state % (WOODS_TILE_HIGH - Tile.TREEBASE + 1));
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      const flag = TILE_FLAGS[(state >>> 9) % TILE_FLAGS.length];
      assertDefined(flag, 'Expected TILE_FLAGS lookup to succeed');
      map[i] = treeTile + flag;
      continue;
    }

    map[i] = Tile.DIRT;
  }

  return map;
};

interface FixedRiverPlopCase {
  mapSeed: number;
  mapX: number;
  mapY: number;
  name: string;
  op: 'brivPlop' | 'srivPlop';
}

describe('terrain/river plops parity against C harness (env-gated)', () => {
  if (process.env.CITY_TEST_PARITY !== '1') {
    it.skip('run `pnpm test-parity` to enable C parity tests', () => {});
    return;
  }

  const fixedCases: readonly FixedRiverPlopCase[] = [
    {
      name: 'BRivPlop interior placement uses the same 9x9 matrix shape',
      op: 'brivPlop',
      mapSeed: 0x1020_3040,
      mapX: 34,
      mapY: 21,
    },
    {
      name: 'SRivPlop interior placement uses the same 6x6 matrix shape',
      op: 'srivPlop',
      mapSeed: 0x2030_4050,
      mapX: 56,
      mapY: 42,
    },
    {
      name: 'BRivPlop clips writes at negative cursor offsets',
      op: 'brivPlop',
      mapSeed: 0x3040_5060,
      mapX: -5,
      mapY: -4,
    },
    {
      name: 'SRivPlop clips writes at lower-right map bounds',
      op: 'srivPlop',
      mapSeed: 0x4050_6070,
      mapX: World.WORLD_X - 2,
      mapY: World.WORLD_Y - 1,
    },
  ];

  for (const testCase of fixedCases) {
    it(`matches C for fixed case: ${testCase.name}`, () => {
      const input = makePlopBiasedMap(testCase.mapSeed);
      const expected = runRiverPlopHarness(input, testCase.op, testCase.mapX, testCase.mapY);

      const actual = new Uint16Array(input);
      if (testCase.op === 'brivPlop') {
        bRivPlop(actual, testCase.mapX, testCase.mapY);
      } else {
        sRivPlop(actual, testCase.mapX, testCase.mapY);
      }

      expectMapsEqual(actual, expected);
    });
  }

  it('matches C river plops across randomized cursor positions and base maps', () => {
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
          mapX: fc.integer({ min: -9, max: World.WORLD_X + 3 }),
          mapY: fc.integer({ min: -9, max: World.WORLD_Y + 3 }),
          op: fc.constantFrom<'brivPlop' | 'srivPlop'>('brivPlop', 'srivPlop'),
        }),
        ({ mapSeed, mapX, mapY, op }) => {
          const input = makePlopBiasedMap(mapSeed);
          const expected = runRiverPlopHarness(input, op, mapX, mapY);

          const actual = new Uint16Array(input);
          if (op === 'brivPlop') {
            bRivPlop(actual, mapX, mapY);
          } else {
            sRivPlop(actual, mapX, mapY);
          }

          expectMapsEqual(actual, expected);
        },
      ),
      { numRuns: Number.isFinite(numRuns) && numRuns > 0 ? numRuns : 25, seed: fcSeed },
    );
  });
});
