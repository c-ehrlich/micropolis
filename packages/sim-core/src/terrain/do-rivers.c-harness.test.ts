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
import { doRivers } from './do-rivers.ts';

/**
 * `UNUSED_TRASH2` (39) from `ref/micropolis/src/sim/headers/sim.h`.
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

interface DoRiversHarnessArgs {
  curveLevel: number;
  opSeed: number;
  xStart: number;
  yStart: number;
}

/**
 * Runs C `DoRivers(void)` from `ref/micropolis/src/sim/s_gen.c` in op mode.
 *
 * Op wiring mirrors C globals:
 * - `CurveLevel` from `--curveLevel`
 * - `XStart`/`YStart` from `--x-start`/`--y-start`
 * - `SeedRand(seed)` immediately before `DoRivers()`
 */
const runDoRiversHarness = (inputMap: Uint16Array, args: DoRiversHarnessArgs): Uint16Array => {
  const caseDir = mkdtempSync(path.join(tmpdir(), 'city-terrain-do-rivers-'));
  const inputPath = path.join(caseDir, 'input.u16le');

  try {
    writeTerrainMapU16LE(inputPath, inputMap);
    return decodeTerrainMapU16LE(
      runTerrainHarness([
        '--op=doRivers',
        `--input-map=${inputPath}`,
        `--seed=${args.opSeed}`,
        `--curveLevel=${args.curveLevel}`,
        `--x-start=${args.xStart}`,
        `--y-start=${args.yStart}`,
        '--format=u16le',
      ]),
    );
  } finally {
    rmSync(caseDir, { force: true, recursive: true });
  }
};

/**
 * Builds a branch-biased input map for `DoRivers` parity tests.
 *
 * C references:
 * - `DoRivers`, `DoBRiv`, `DoSRiv` in `ref/micropolis/src/sim/s_gen.c`
 * - overwrite guards in `PutOnMap` in the same file
 *
 * Design intent:
 * - include existing river/channel cells so `PutOnMap` overwrite guards run,
 * - include woods and flagged cells to keep inputs terrain-realistic,
 * - keep enough dirt to allow visible river-walk painting.
 */
const makeDoRiversBiasedMap = (seed: number): Uint16Array => {
  let state = seed >>> 0;
  const map = new Uint16Array(World.WORLD_X * World.WORLD_Y);

  for (let i = 0; i < map.length; i += 1) {
    state = (Math.imul(state, 214013) + 2531011) >>> 0;
    const bucket = state % 100;

    if (bucket < 18) {
      map[i] = Tile.RIVER;
      continue;
    }

    if (bucket < 28) {
      map[i] = Tile.CHANNEL;
      continue;
    }

    if (bucket < 45) {
      const landTile = LAND_TILES[state % LAND_TILES.length];
      assertDefined(landTile, 'Expected LAND_TILES lookup to succeed');
      map[i] = landTile;
      continue;
    }

    if (bucket < 62) {
      map[i] = Tile.REDGE;
      continue;
    }

    if (bucket < 82) {
      state = (Math.imul(state, 214013) + 2531011) >>> 0;
      const treeTile = Tile.TREEBASE + (state % (WOODS_TILE_HIGH - Tile.TREEBASE + 1));
      state = (Math.imul(state, 214013) + 2531011) >>> 0;
      const flag = TILE_FLAGS[(state >>> 5) % TILE_FLAGS.length];
      assertDefined(flag, 'Expected TILE_FLAGS lookup to succeed');
      map[i] = treeTile + flag;
      continue;
    }

    map[i] = Tile.DIRT;
  }

  return map;
};

interface FixedDoRiversCase {
  curveLevel: number;
  mapSeed: number;
  name: string;
  opSeed: number;
  xStart: number;
  yStart: number;
}

describe('terrain/doRivers parity against C harness (env-gated)', () => {
  if (process.env.CITY_TEST_PARITY !== '1') {
    it.skip('run `pnpm test-parity` to enable C parity tests', () => {});
    return;
  }

  const fixedCases: readonly FixedDoRiversCase[] = [
    {
      name: 'default curviness branch (CurveLevel < 0) from a central start',
      mapSeed: 0x0102_0304,
      opSeed: 0x9988_7766,
      curveLevel: -1,
      xStart: 40,
      yStart: 33,
    },
    {
      name: 'positive curviness branch with near-edge start position',
      mapSeed: 0xa1b2_c3d4,
      opSeed: 0x4455_6677,
      // Magic number source: `r1 = CurveLevel + 10`, `r2 = CurveLevel + 100`
      // in C `DoBRiv`/`DoSRiv`.
      curveLevel: 7,
      xStart: 114,
      yStart: 94,
    },
  ];

  for (const testCase of fixedCases) {
    it(`matches C for fixed case: ${testCase.name}`, () => {
      const input = makeDoRiversBiasedMap(testCase.mapSeed);
      const expected = runDoRiversHarness(input, {
        curveLevel: testCase.curveLevel,
        opSeed: testCase.opSeed,
        xStart: testCase.xStart,
        yStart: testCase.yStart,
      });

      const actual = new Uint16Array(input);
      const rng = createRng(testCase.opSeed);
      doRivers(actual, rng, testCase.curveLevel, testCase.xStart, testCase.yStart, {});

      expectMapsEqual(actual, expected);
    });
  }

  it('matches C DoRivers across randomized starts, seeds, and curve levels', () => {
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
          curveLevel: fc.constantFrom(-1, 0, 1, 10, 40),
          mapSeed: fc.integer({ min: 0, max: 0xffff_ffff }),
          opSeed: fc.integer({ min: 0, max: 0xffff_ffff }),
          xStart: fc.integer({ min: 0, max: World.WORLD_X - 1 }),
          yStart: fc.integer({ min: 0, max: World.WORLD_Y - 1 }),
        }),
        ({ curveLevel, mapSeed, opSeed, xStart, yStart }) => {
          const input = makeDoRiversBiasedMap(mapSeed);
          const expected = runDoRiversHarness(input, {
            curveLevel,
            opSeed,
            xStart,
            yStart,
          });

          const actual = new Uint16Array(input);
          const rng = createRng(opSeed);
          doRivers(actual, rng, curveLevel, xStart, yStart, {});

          expectMapsEqual(actual, expected);
        },
      ),
      { numRuns: Number.isFinite(numRuns) && numRuns > 0 ? numRuns : 25, seed: fcSeed },
    );
  });
});
