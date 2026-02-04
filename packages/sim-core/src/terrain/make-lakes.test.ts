import { describe, expect, it } from 'vitest';

import { World } from '../core/constants.ts';
import { makeLakes } from './make-lakes.ts';
import { QueueTerrainRng } from './rng.ts';

/**
 * `MakeLakes()` places clusters of small/big river "plops" to form lakes.
 *
 * Source of truth:
 * - `MakeLakes(void)` in `ref/micropolis/src/sim/s_gen.c`
 * - `ref/micropolis/spec/terrain/SPEC.md` ("MakeLakes()")
 *
 * "Magic numbers" in this algorithm are directly from the C implementation:
 * - Cluster center: `x = Rand(WORLD_X - 21) + 10`, `y = Rand(WORLD_Y - 20) + 10`
 * - Cluster size: `Lim2 = Rand(12) + 2`
 * - Per-plop jitter: `MapX = x - 6 + Rand(12)`, `MapY = y - 6 + Rand(12)`
 * - Plop type: `if (Rand(4)) SRivPlop(); else BRivPlop();`
 *
 * Note: `Rand(range)` is inclusive in Micropolis, returning values in `[0..range]`.
 */
describe('terrain MakeLakes', () => {
  it('uses `Rand(10)` for cluster count when `LakeLevel < 0`, and selects SRiv vs BRiv by `Rand(4)` truthiness (C behavior)', () => {
    const rng = new QueueTerrainRng({
      // This queue corresponds 1:1 to the sequence of `Rand(...)` calls in
      // `MakeLakes(void)` (see `ref/micropolis/src/sim/s_gen.c`).
      //
      // Lim1 = Rand(10) => 2 clusters.
      // Cluster 0:
      // - x = Rand(WORLD_X - 21) + 10 => 5 + 10 = 15
      // - y = Rand(WORLD_Y - 20) + 10 => 7 + 10 = 17
      // - Lim2 = Rand(12) + 2 => 1 + 2 = 3 plops
      //   - plop 0: MapX = 15 - 6 + 2 = 11, MapY = 17 - 6 + 3 = 14, Rand(4)=0 => BRiv
      //   - plop 1: MapX = 15 - 6 + 4 = 13, MapY = 17 - 6 + 5 = 16, Rand(4)=1 => SRiv
      //   - plop 2: MapX = 15 - 6 + 6 = 15, MapY = 17 - 6 + 7 = 18, Rand(4)=4 => SRiv
      // Cluster 1:
      // - x = 10 + 10 = 20
      // - y = 0 + 10 = 10
      // - Lim2 = 0 + 2 = 2 plops
      //   - plop 0: MapX = 20 - 6 + 12 = 26, MapY = 10 - 6 + 0 = 4, Rand(4)=0 => BRiv
      //   - plop 1: MapX = 20 - 6 + 0 = 14, MapY = 10 - 6 + 12 = 16, Rand(4)=2 => SRiv
      randValues: [2, 5, 7, 1, 2, 3, 0, 4, 5, 1, 6, 7, 4, 10, 0, 0, 12, 0, 0, 0, 12, 2],
    });

    const map = new Uint16Array(World.WORLD_X * World.WORLD_Y);

    const calls: Array<{ kind: 'S' | 'B'; mapX: number; mapY: number }> = [];

    makeLakes(map, rng, -1, {
      sRivPlop: (_map, mapX, mapY) => calls.push({ kind: 'S', mapX, mapY }),
      bRivPlop: (_map, mapX, mapY) => calls.push({ kind: 'B', mapX, mapY }),
    });

    expect(calls).toEqual([
      { kind: 'B', mapX: 11, mapY: 14 },
      { kind: 'S', mapX: 13, mapY: 16 },
      { kind: 'S', mapX: 15, mapY: 18 },
      { kind: 'B', mapX: 26, mapY: 4 },
      { kind: 'S', mapX: 14, mapY: 16 },
    ]);
  });

  it('uses integer division for `LakeLevel / 2` when `LakeLevel >= 0` (C behavior)', () => {
    const rng = new QueueTerrainRng({
      // If the implementation incorrectly uses `Lim1 = Rand(10)` even when
      // `LakeLevel >= 0`, it would call `rand(10)` first and reject 50 as out of
      // range. In C, for `LakeLevel=5`, `Lim1 = LakeLevel / 2 = 2`.
      randValues: [
        // Cluster 0 (2 plops):
        50, // x: Rand(WORLD_X - 21) => 50 + 10 = 60
        20, // y: Rand(WORLD_Y - 20) => 20 + 10 = 30
        0, // Lim2: Rand(12) => 0 + 2 = 2
        0,
        0,
        1, // Rand(4)=1 => SRiv
        12,
        12,
        0, // Rand(4)=0 => BRiv
        // Cluster 1 (2 plops):
        0, // x => 10
        80, // y => 90
        0, // Lim2 => 2
        6,
        6,
        4, // SRiv
        0,
        12,
        0, // BRiv
      ],
    });

    const map = new Uint16Array(World.WORLD_X * World.WORLD_Y);
    const calls: Array<'S' | 'B'> = [];

    makeLakes(map, rng, 5, {
      sRivPlop: () => calls.push('S'),
      bRivPlop: () => calls.push('B'),
    });

    expect(calls).toEqual(['S', 'B', 'S', 'B']);
  });
});
