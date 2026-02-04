import { describe, expect, it, vi } from 'vitest';

import { Tile, TileFlag, TileMask, World } from '../core/constants.ts';
import { indexFor } from './helpers.ts';
import { QueueTerrainRng } from './rng.ts';
import { doTrees, treeSplash, treeSplashCount, treeSplashDistance } from './trees.ts';

/**
 * Tree terrain generation.
 *
 * Source of truth:
 * - `TreeSplash` / `DoTrees` in `ref/micropolis/src/sim/s_gen.c`
 * - `ref/micropolis/spec/terrain/SPEC.md` ("Trees")
 *
 * Magic numbers in this file are taken directly from the C implementation:
 * - `DoTrees`: `Amount = Rand(100) + 50` when `TreeLevel < 0`, else `TreeLevel + 3`
 * - `TreeSplash`: `dis = Rand(150) + 50` when `TreeLevel < 0`, else `Rand(100 + TreeLevel*2) + 50`
 * - Tile write: `WOODS + BLBNBIT` where `WOODS` is 37 and `BLBNBIT` is 12288.
 */
describe('terrain trees', () => {
  it('computes DoTrees() splash count (Amount) with the same TreeLevel rules as C', () => {
    {
      const rng = new QueueTerrainRng({
        // C: Amount = Rand(100) + 50 when TreeLevel < 0.
        // Use the inclusive extremes of Rand(100): 0 and 100.
        randValues: [0, 100],
      });

      expect(treeSplashCount(rng, -1)).toBe(50);
      expect(treeSplashCount(rng, -1)).toBe(150);
    }

    {
      const rng = new QueueTerrainRng({ randValues: [] });

      // C: Amount = TreeLevel + 3 when TreeLevel >= 0 (no RNG).
      expect(treeSplashCount(rng, 0)).toBe(3);
      expect(treeSplashCount(rng, 7)).toBe(10);
    }
  });

  it('computes TreeSplash() path length (dis) with the same TreeLevel rules as C', () => {
    {
      const rng = new QueueTerrainRng({
        // C: dis = Rand(150) + 50 when TreeLevel < 0.
        // Use the inclusive extremes of Rand(150): 0 and 150.
        randValues: [0, 150],
      });

      expect(treeSplashDistance(rng, -1)).toBe(50);
      expect(treeSplashDistance(rng, -1)).toBe(200);
    }

    {
      const rng = new QueueTerrainRng({
        // C: dis = Rand(100 + TreeLevel*2) + 50 when TreeLevel >= 0.
        // With TreeLevel=0, range is 100 (inclusive), so 100 => 150.
        randValues: [100],
      });

      expect(treeSplashDistance(rng, 0)).toBe(150);
    }
  });

  it('TreeSplash only writes on masked DIRT tiles, and writes WOODS + BLBNBIT', () => {
    const map = new Uint16Array(World.WORLD_X * World.WORLD_Y).fill(Tile.DIRT);

    // Arrange a deterministic short walk:
    // - Start at (1,1)
    // - First move dir=6 (west) => (0,1) (in bounds)
    // - Second move dir=6 (west) => (-1,1) (out of bounds, returns)
    //
    // We choose dis=50 (the minimum possible) by returning 0 from Rand(150).
    const rng = new QueueTerrainRng({
      randValues: [
        0, // dis = Rand(150) + 50 => 50 when TreeLevel < 0 (C behavior)
        6, // dir = Rand(7) => 6 (west)
        6, // dir = Rand(7) => 6 (west, triggers out-of-bounds return)
      ],
    });

    // Non-DIRT should not be overwritten.
    map[indexFor(0, 1)] = Tile.RIVER;

    treeSplash(map, rng, 1, 1, -1);

    expect(map[indexFor(0, 1)]).toBe(Tile.RIVER);
  });

  it('TreeSplash treats flagged DIRT as DIRT (masked compare), overwriting it with WOODS + BLBNBIT', () => {
    const map = new Uint16Array(World.WORLD_X * World.WORLD_Y).fill(Tile.DIRT);

    const rng = new QueueTerrainRng({
      randValues: [
        0, // dis = Rand(150) + 50 => 50
        6, // move into (0,1)
        6, // then out of bounds
      ],
    });

    // Masked DIRT but with a high-bit flag set; C checks `(tile & LOMASK) == DIRT`.
    map[indexFor(0, 1)] = Tile.DIRT + TileFlag.BULLBIT;

    treeSplash(map, rng, 1, 1, -1);

    // C writes `WOODS + BLBNBIT`.
    const expected = Tile.WOODS + TileFlag.BLBNBIT;
    expect(map[indexFor(0, 1)]).toBe(expected);
    expect(map[indexFor(0, 1)]! & TileMask.LOMASK).toBe(Tile.WOODS);
  });

  it('DoTrees calls SmoothTrees() twice (C behavior)', () => {
    const map = new Uint16Array(World.WORLD_X * World.WORLD_Y).fill(Tile.DIRT);

    const smoothTrees = vi.fn<(map: Uint16Array) => void>();
    const splash = vi.fn<(map: Uint16Array, xloc: number, yloc: number) => void>();

    // For TreeLevel >= 0, C sets Amount = TreeLevel + 3, so TreeLevel=0 => 3 splashes.
    // Each splash draws (xloc, yloc) using inclusive:
    // - Rand(WORLD_X - 1) == Rand(119)
    // - Rand(WORLD_Y - 1) == Rand(99)
    const rng = new QueueTerrainRng({
      randValues: [0, 0, 1, 1, 2, 2],
    });

    doTrees(map, rng, 0, {
      smoothTrees,
      treeSplash: (_map, xloc, yloc) => splash(_map, xloc, yloc),
    });

    expect(splash).toHaveBeenCalledTimes(3);
    expect(smoothTrees).toHaveBeenCalledTimes(2);
  });
});
