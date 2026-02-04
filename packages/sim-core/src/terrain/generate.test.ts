import { describe, expect, it } from 'vitest';

import { Tile, World } from '../core/constants.ts';
import { MicropolisRng } from '../core/rng.ts';
import { createSimContext } from '../core/sim-context.ts';
import { createSimState } from '../core/sim-state.ts';
import { generateMap } from './generate.ts';
import { indexFor } from './helpers.ts';
import { isTree } from './is-tree.ts';

const assertIsUint16Array = (value: unknown): Uint16Array => {
  expect(value).toBeInstanceOf(Uint16Array);
  return value as Uint16Array;
};

const hasAnyTreeTile = (map: Uint16Array): boolean => {
  for (let i = 0; i < map.length; i += 1) {
    const cell = map[i];
    if (cell !== undefined && isTree(cell)) {
      return true;
    }
  }
  return false;
};

/**
 * Pick a seed that triggers the 10% "random island" early-return branch.
 *
 * C reference:
 * - `GenerateMap(int r)` in `ref/micropolis/src/sim/s_gen.c`:
 *     `if (CreateIsland < 0) if (Rand(100) < 10) { MakeIsland(); return; }`
 */
const findSeedThatTriggersRandomIsland = (): number => {
  for (let seed = 1; seed < 50_000; seed += 1) {
    // This is exactly the RNG draw that gates the early-return island branch.
    // In `GenerateMap`, it happens immediately after `SeedRand(r)`.
    const rng = new MicropolisRng(seed);
    if (rng.rand(100) < 10) {
      return seed;
    }
  }
  throw new Error('Unable to find a seed that triggers the random-island branch');
};

/**
 * Pick a seed that:
 * - triggers the 10% random-island early return, and
 * - results in at least one tree tile being written by `MakeIsland()` even when
 *   `TreeLevel == 0`.
 *
 * Why we need this:
 * - In the early-return path, C calls `MakeIsland()` which calls `DoTrees()`
 *   unconditionally (TreeLevel still affects density, but is not used as a gate).
 * - In the non-early-return paths, C only calls `DoTrees()` when `TreeLevel != 0`.
 *
 * C reference:
 * - `GenerateMap(int r)` in `ref/micropolis/src/sim/s_gen.c`
 * - `MakeIsland()` in `ref/micropolis/src/sim/s_gen.c` (`MakeNakedIsland; SmoothRiver; DoTrees`)
 */
const findSeedForRandomIslandThatPlantsTreesAtTreeLevel0 = (): number => {
  for (let seed = 1; seed < 5_000; seed += 1) {
    const rngProbe = new MicropolisRng(seed);
    if (rngProbe.rand(100) >= 10) {
      continue;
    }

    const state = createSimState();
    const context = createSimContext({ rng: new MicropolisRng(1) });
    generateMap(state, context, {
      seed,
      treeLevel: 0,
      lakeLevel: 0,
      curveLevel: 0,
      createIsland: -1,
      reseedAfter: false,
    });

    const map = assertIsUint16Array(context.store.snapshot('map'));
    if (hasAnyTreeTile(map)) {
      return seed;
    }
  }

  throw new Error(
    'Unable to find a seed that both triggers island and plants trees at TreeLevel=0',
  );
};

describe('terrain/generateMap (GenerateMap pipeline)', () => {
  it('mirrors `CreateIsland == 1` forced-island path by creating a water border', () => {
    const state = createSimState();
    const context = createSimContext();

    // C reference: `GenerateMap` in `ref/micropolis/src/sim/s_gen.c`:
    //   if (CreateIsland == 1) { MakeNakedIsland(); } else { ClearMap(); }
    generateMap(state, context, {
      seed: 123,
      treeLevel: 0,
      lakeLevel: 0,
      curveLevel: 0,
      createIsland: 1,
      reseedAfter: false,
    });

    const map = assertIsUint16Array(context.store.snapshot('map'));

    // `MakeNakedIsland()` begins by filling every tile with `RIVER` (tile id 2),
    // then punches out a large DIRT interior. The corner is guaranteed to remain
    // water in the C implementation.
    //
    // C reference: `MakeNakedIsland()` in `ref/micropolis/src/sim/s_gen.c`.
    expect(map[indexFor(0, 0)]).toBe(Tile.RIVER);
  });

  it('mirrors `CreateIsland == 0` path by clearing to all DIRT when levels are 0', () => {
    const state = createSimState();
    const context = createSimContext();

    // With all levels == 0, the C pipeline shape is:
    //   ClearMap(); GetRandStart(); SmoothRiver(); RandomlySeedRand();
    // and no rivers/lakes/trees run. Since `ClearMap` sets every tile to DIRT
    // and `SmoothRiver` only touches raw `REDGE` tiles, the final result is
    // exactly all DIRT.
    //
    // C reference: `GenerateMap`, `ClearMap`, `SmoothRiver` in
    // `ref/micropolis/src/sim/s_gen.c`.
    generateMap(state, context, {
      seed: 123,
      treeLevel: 0,
      lakeLevel: 0,
      curveLevel: 0,
      createIsland: 0,
      reseedAfter: false,
    });

    const map = assertIsUint16Array(context.store.snapshot('map'));
    expect(map).toHaveLength(World.WORLD_X * World.WORLD_Y);
    for (let i = 0; i < map.length; i += 1) {
      expect(map[i]).toBe(Tile.DIRT);
    }
  });

  it('mirrors the early-return random-island branch (trees are not gated by TreeLevel)', () => {
    const seed = findSeedForRandomIslandThatPlantsTreesAtTreeLevel0();

    const state = createSimState();
    const context = createSimContext();

    // The "magic number" 10 comes from C:
    //   `if (Rand(100) < 10) { MakeIsland(); return; }`
    //
    // We chose `seed` such that the first `Rand(100)` draw is < 10, so this
    // path is guaranteed to take the early return.
    generateMap(state, context, {
      seed,
      treeLevel: 0,
      lakeLevel: 0,
      curveLevel: 0,
      createIsland: -1,
      reseedAfter: false,
    });

    const map = assertIsUint16Array(context.store.snapshot('map'));

    // `DoTrees()` writes `WOODS + BLBNBIT` and then smooths trees into other
    // tree variants. We just assert that at least one tree-range tile exists.
    //
    // C reference:
    // - `TreeSplash` and `DoTrees` in `ref/micropolis/src/sim/s_gen.c`
    // - Tile ranges in `ref/micropolis/spec/terrain/SPEC.md`
    expect(hasAnyTreeTile(map)).toBe(true);

    // Sanity: even if `treeLevel == 0`, the *non*-early-return forced-island
    // path does not run `DoTrees()` at all (it is gated by `TreeLevel != 0`).
    const forcedState = createSimState();
    const forcedContext = createSimContext();
    generateMap(forcedState, forcedContext, {
      seed,
      treeLevel: 0,
      lakeLevel: 0,
      curveLevel: 0,
      createIsland: 1,
      reseedAfter: false,
    });
    const forcedMap = assertIsUint16Array(forcedContext.store.snapshot('map'));
    expect(hasAnyTreeTile(forcedMap)).toBe(false);
  });

  it('skips reseeding in the early-return random-island branch', () => {
    const seed = findSeedThatTriggersRandomIsland();
    const reseedTo = 0x1234_5678;

    const state = createSimState();
    const context = createSimContext();

    generateMap(state, context, {
      seed,
      treeLevel: -1,
      lakeLevel: 0,
      curveLevel: 0,
      createIsland: -1,
      reseedAfter: { seed: reseedTo },
    });

    // If the early-return path reseeded, the next random sequence would match a
    // PRNG freshly seeded with `reseedTo`. We compare several `next16()` values
    // to make accidental collisions vanishingly unlikely.
    const expected = (() => {
      const rng = new MicropolisRng(reseedTo);
      return [rng.next16(), rng.next16(), rng.next16()];
    })();

    const actual = [context.rng.next16(), context.rng.next16(), context.rng.next16()];
    expect(actual).not.toEqual(expected);
  });

  it('applies reseeding in the non-early-return paths', () => {
    const reseedTo = 0x1234_5678;

    const state = createSimState();
    const context = createSimContext();

    generateMap(state, context, {
      seed: 123,
      treeLevel: 0,
      lakeLevel: 0,
      curveLevel: 0,
      createIsland: 0,
      reseedAfter: { seed: reseedTo },
    });

    const expected = (() => {
      const rng = new MicropolisRng(reseedTo);
      return [rng.next16(), rng.next16(), rng.next16()];
    })();

    const actual = [context.rng.next16(), context.rng.next16(), context.rng.next16()];
    expect(actual).toEqual(expected);

    // Additional sanity: `next16()` is still 16-bit (0..65535).
    for (const value of actual) {
      expect(value & 0xffff).toBe(value);
    }
  });
});
