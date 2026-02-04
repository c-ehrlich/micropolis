import { getOrThrow } from '../core/assert.ts';
import { Tile, TileMask, World } from '../core/constants.ts';
import { indexFor } from './helpers.ts';
import { isTree } from './is-tree.ts';

/**
 * Smooths raw water and woods tiles into shoreline edges.
 *
 * 1:1 port of `SmoothWater()` in `ref/micropolis/src/sim/s_gen.c`, as described
 * by `ref/micropolis/spec/terrain/SPEC.md` ("SmoothWater()").
 *
 * This routine is intentionally *not* symmetric with `SmoothRiver()`:
 * - It uses masked-range checks for "is water" (`tile & LOMASK` in [2..20]).
 * - It uses masked-range checks for "is woods" (`tile & LOMASK` in [21..39]).
 * - But it uses raw equality (`== RIVER` or `== CHANNEL`) in pass 3 when
 *   detecting water-adjacent woods. This means flagged water tiles (high bits)
 *   do not count as exact `RIVER`/`CHANNEL` in that pass, matching C.
 *
 * Behavior (mirrors C exactly), in three passes:
 * 1) For each water tile, if any *in-bounds* 4-neighbor is not water, set the
 *    tile to `REDGE`.
 * 2) For each non-channel water tile, if all *in-bounds* 4-neighbors are water,
 *    set the tile to `RIVER`.
 * 3) For each woods-range tile, if any *in-bounds* 4-neighbor is exactly
 *    `RIVER` or `CHANNEL` (raw equality), set the tile to `REDGE`.
 *
 * C reference:
 * - `SmoothWater()` in `ref/micropolis/src/sim/s_gen.c`
 */
export function smoothWater(map: Uint16Array): void {
  // C uses:
  //   WATER_LOW = RIVER (2)
  //   WATER_HIGH = LASTRIVEDGE (20)
  const WATER_LOW = Tile.RIVER;
  const WATER_HIGH = Tile.LASTRIVEDGE;

  // Pass 1: water next to non-water becomes `REDGE`.
  for (let x = 0; x < World.WORLD_X; x += 1) {
    for (let y = 0; y < World.WORLD_Y; y += 1) {
      const index = indexFor(x, y);
      const cell = getOrThrow(map[index], 'Expected in-bounds map access');
      const tileId = cell & TileMask.LOMASK;

      if (tileId < WATER_LOW || tileId > WATER_HIGH) {
        continue;
      }

      // This is a line-for-line port of the C structure (including the
      // boundary checks that skip missing neighbors rather than treating them
      // as non-water).
      if (x > 0) {
        const leftId =
          getOrThrow(map[indexFor(x - 1, y)], 'Expected in-bounds map access') & TileMask.LOMASK;
        if (leftId < WATER_LOW || leftId > WATER_HIGH) {
          map[index] = Tile.REDGE;
          continue;
        }
      }
      if (x < World.WORLD_X - 1) {
        const rightId =
          getOrThrow(map[indexFor(x + 1, y)], 'Expected in-bounds map access') & TileMask.LOMASK;
        if (rightId < WATER_LOW || rightId > WATER_HIGH) {
          map[index] = Tile.REDGE;
          continue;
        }
      }
      if (y > 0) {
        const upId =
          getOrThrow(map[indexFor(x, y - 1)], 'Expected in-bounds map access') & TileMask.LOMASK;
        if (upId < WATER_LOW || upId > WATER_HIGH) {
          map[index] = Tile.REDGE;
          continue;
        }
      }
      if (y < World.WORLD_Y - 1) {
        const downId =
          getOrThrow(map[indexFor(x, y + 1)], 'Expected in-bounds map access') & TileMask.LOMASK;
        if (downId < WATER_LOW || downId > WATER_HIGH) {
          map[index] = Tile.REDGE;
          continue;
        }
      }
    }
  }

  // Pass 2: interior non-channel water becomes `RIVER`.
  for (let x = 0; x < World.WORLD_X; x += 1) {
    for (let y = 0; y < World.WORLD_Y; y += 1) {
      const index = indexFor(x, y);
      const cell = getOrThrow(map[index], 'Expected in-bounds map access');
      const tileId = cell & TileMask.LOMASK;

      if (tileId === Tile.CHANNEL) {
        continue;
      }
      if (tileId < WATER_LOW || tileId > WATER_HIGH) {
        continue;
      }

      if (x > 0) {
        const leftId =
          getOrThrow(map[indexFor(x - 1, y)], 'Expected in-bounds map access') & TileMask.LOMASK;
        if (leftId < WATER_LOW || leftId > WATER_HIGH) {
          continue;
        }
      }
      if (x < World.WORLD_X - 1) {
        const rightId =
          getOrThrow(map[indexFor(x + 1, y)], 'Expected in-bounds map access') & TileMask.LOMASK;
        if (rightId < WATER_LOW || rightId > WATER_HIGH) {
          continue;
        }
      }
      if (y > 0) {
        const upId =
          getOrThrow(map[indexFor(x, y - 1)], 'Expected in-bounds map access') & TileMask.LOMASK;
        if (upId < WATER_LOW || upId > WATER_HIGH) {
          continue;
        }
      }
      if (y < World.WORLD_Y - 1) {
        const downId =
          getOrThrow(map[indexFor(x, y + 1)], 'Expected in-bounds map access') & TileMask.LOMASK;
        if (downId < WATER_LOW || downId > WATER_HIGH) {
          continue;
        }
      }

      map[index] = Tile.RIVER;
    }
  }

  // Pass 3: woods next to exact `RIVER`/`CHANNEL` becomes `REDGE`.
  smoothWaterPass3(map);
}

/**
 * Pass 3 of `SmoothWater()`: woods adjacent to exact `RIVER`/`CHANNEL` becomes `REDGE`.
 *
 * This is a 1:1 extraction of the third loop in `SmoothWater()` from
 * `ref/micropolis/src/sim/s_gen.c`. It is kept as a separate exported function
 * so tests can validate the exact raw-equality behavior without coupling to
 * passes 1/2 setup.
 *
 * Parity-critical detail:
 * - The "is woods" check is masked (`tile & LOMASK` in [21..39]).
 * - The neighbor checks are raw equality: `neighbor == RIVER || neighbor == CHANNEL`.
 */
export function smoothWaterPass3(map: Uint16Array): void {
  for (let x = 0; x < World.WORLD_X; x += 1) {
    for (let y = 0; y < World.WORLD_Y; y += 1) {
      const index = indexFor(x, y);
      const cell = getOrThrow(map[index], 'Expected in-bounds map access');

      // C checks `WOODS_LOW..WOODS_HIGH` via `(cell & LOMASK)`; `isTree` is a
      // 1:1 port of that predicate.
      if (!isTree(cell)) {
        continue;
      }

      if (x > 0) {
        const left = getOrThrow(map[indexFor(x - 1, y)], 'Expected in-bounds map access');
        if (left === Tile.RIVER || left === Tile.CHANNEL) {
          map[index] = Tile.REDGE;
          continue;
        }
      }
      if (x < World.WORLD_X - 1) {
        const right = getOrThrow(map[indexFor(x + 1, y)], 'Expected in-bounds map access');
        if (right === Tile.RIVER || right === Tile.CHANNEL) {
          map[index] = Tile.REDGE;
          continue;
        }
      }
      if (y > 0) {
        const up = getOrThrow(map[indexFor(x, y - 1)], 'Expected in-bounds map access');
        if (up === Tile.RIVER || up === Tile.CHANNEL) {
          map[index] = Tile.REDGE;
          continue;
        }
      }
      if (y < World.WORLD_Y - 1) {
        const down = getOrThrow(map[indexFor(x, y + 1)], 'Expected in-bounds map access');
        if (down === Tile.RIVER || down === Tile.CHANNEL) {
          map[index] = Tile.REDGE;
          continue;
        }
      }
    }
  }
}
