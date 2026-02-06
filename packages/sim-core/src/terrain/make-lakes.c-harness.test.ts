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
import { makeLakes } from './make-lakes.ts';

/**
 * `UNUSED_TRASH2` (39) from `ref/micropolis/src/sim/headers/sim.h`.
 *
 * `IsTree` in `ref/micropolis/src/sim/s_gen.c` uses this as `WOODS_HIGH`.
 */
const WOODS_TILE_HIGH = 39;
const TILE_FLAGS = [0, TileFlag.BULLBIT, TileFlag.BURNBIT, TileFlag.BLBNBIT] as const;
const LAND_TILES = [Tile.DIRT, Tile.ROADBASE, Tile.RAILBASE, Tile.POWERBASE] as const;

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

interface MakeLakesHarnessArgs {
  lakeLevel: number;
  seed: number;
}

/**
 * Runs C `MakeLakes(void)` from `ref/micropolis/src/sim/s_gen.c` in op mode.
 *
 * In op mode, `--seed` mirrors `SeedRand(seed)` directly before `MakeLakes()`.
 */
const runMakeLakesHarness = (inputMap: Uint16Array, args: MakeLakesHarnessArgs): Uint16Array => {
  const caseDir = mkdtempSync(path.join(tmpdir(), 'city-terrain-make-lakes-'));
  const inputPath = path.join(caseDir, 'input.u16le');

  try {
    writeTerrainMapU16LE(inputPath, inputMap);
    return decodeTerrainMapU16LE(
      runTerrainHarness([
        '--op=makeLakes',
        `--input-map=${inputPath}`,
        `--seed=${args.seed}`,
        `--lakeLevel=${args.lakeLevel}`,
        '--format=u16le',
      ]),
    );
  } finally {
    rmSync(caseDir, { force: true, recursive: true });
  }
};

/**
 * Builds a terrain-relevant base map for `MakeLakes` parity tests.
 *
 * C references:
 * - `MakeLakes` in `ref/micropolis/src/sim/s_gen.c`
 * - overwrite guards in `PutOnMap` in the same file
 *
 * Design intent:
 * - include existing water/channel cells to stress overwrite guards,
 * - include woods and flagged cells to keep inputs terrain-realistic.
 */
const makeLakesBiasedMap = (seed: number): Uint16Array => {
  let state = seed >>> 0;
  const map = new Uint16Array(World.WORLD_X * World.WORLD_Y);

  for (let i = 0; i < map.length; i += 1) {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    const bucket = state % 100;

    if (bucket < 22) {
      map[i] = Tile.RIVER;
      continue;
    }

    if (bucket < 34) {
      map[i] = Tile.CHANNEL;
      continue;
    }

    if (bucket < 56) {
      const landTile = LAND_TILES[state % LAND_TILES.length];
      assertDefined(landTile, 'Expected LAND_TILES lookup to succeed');
      map[i] = landTile;
      continue;
    }

    if (bucket < 78) {
      state = (Math.imul(state, 1103515245) + 12345) >>> 0;
      const treeTile = Tile.TREEBASE + (state % (WOODS_TILE_HIGH - Tile.TREEBASE + 1));
      state = (Math.imul(state, 1103515245) + 12345) >>> 0;
      const flag = TILE_FLAGS[(state >>> 6) % TILE_FLAGS.length];
      assertDefined(flag, 'Expected TILE_FLAGS lookup to succeed');
      map[i] = treeTile + flag;
      continue;
    }

    map[i] = Tile.DIRT;
  }

  return map;
};

interface FixedMakeLakesCase {
  lakeLevel: number;
  mapSeed: number;
  name: string;
  opSeed: number;
}

describe('terrain/makeLakes parity against C harness (env-gated)', () => {
  if (process.env.CITY_TEST_PARITY !== '1') {
    it.skip('run `pnpm test-parity` to enable C parity tests', () => {});
    return;
  }

  const fixedCases: readonly FixedMakeLakesCase[] = [
    {
      name: 'LakeLevel < 0 uses Rand(10) cluster count path',
      mapSeed: 0x1337_9001,
      opSeed: 0x0bad_f00d,
      lakeLevel: -1,
    },
    {
      name: 'odd LakeLevel uses C integer truncation for LakeLevel / 2',
      mapSeed: 0x99aa_bbcc,
      opSeed: 0x1234_5678,
      // Magic number source: `Lim1 = LakeLevel / 2` in C `MakeLakes`.
      lakeLevel: 5,
    },
  ];

  for (const testCase of fixedCases) {
    it(`matches C for fixed case: ${testCase.name}`, () => {
      const input = makeLakesBiasedMap(testCase.mapSeed);
      const expected = runMakeLakesHarness(input, {
        seed: testCase.opSeed,
        lakeLevel: testCase.lakeLevel,
      });

      const actual = new Uint16Array(input);
      const rng = createRng(testCase.opSeed);
      makeLakes(actual, rng, testCase.lakeLevel, {});

      expectMapsEqual(actual, expected);
    });
  }

  it('matches C MakeLakes across randomized maps, seeds, and odd LakeLevel values', () => {
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
          lakeLevel: fc.constantFrom(-1, 1, 3, 5, 7, 9),
          mapSeed: fc.integer({ min: 0, max: 0xffff_ffff }),
          opSeed: fc.integer({ min: 0, max: 0xffff_ffff }),
        }),
        ({ lakeLevel, mapSeed, opSeed }) => {
          const input = makeLakesBiasedMap(mapSeed);
          const expected = runMakeLakesHarness(input, { seed: opSeed, lakeLevel });

          const actual = new Uint16Array(input);
          const rng = createRng(opSeed);
          makeLakes(actual, rng, lakeLevel, {});

          expectMapsEqual(actual, expected);
        },
      ),
      { numRuns: Number.isFinite(numRuns) && numRuns > 0 ? numRuns : 25, seed: fcSeed },
    );
  });
});
