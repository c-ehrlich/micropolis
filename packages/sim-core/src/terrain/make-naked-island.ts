import { Tile, World } from '../core/constants.ts';
import { eRand } from './erand.ts';
import { indexFor } from './helpers.ts';
import { bRivPlop, sRivPlop } from './river-plops.ts';
import type { TerrainRng } from './rng.ts';

const RADIUS = 18;

export interface MakeNakedIslandDeps {
  /**
   * Optional hook for the "big river" plop applied by `MakeNakedIsland`.
   *
   * Defaults to {@link bRivPlop} which is a 1:1 port of `BRivPlop()` in
   * `ref/micropolis/src/sim/s_gen.c`.
   */
  bRivPlop?: (map: Uint16Array, mapX: number, mapY: number) => void;

  /**
   * Optional hook for the "small river" plop applied by `MakeNakedIsland`.
   *
   * Defaults to {@link sRivPlop} which is a 1:1 port of `SRivPlop()` in
   * `ref/micropolis/src/sim/s_gen.c`.
   */
  sRivPlop?: (map: Uint16Array, mapX: number, mapY: number) => void;
}

/**
 * Create an "island base" map: water-filled world with a 5-tile border and
 * perimeter "plops" that shape the shoreline.
 *
 * 1:1 port of `MakeNakedIsland()` in `ref/micropolis/src/sim/s_gen.c`, as
 * described by `ref/micropolis/spec/terrain/SPEC.md` ("MakeNakedIsland()").
 *
 * Important constants (from the C implementation):
 * - `RADIUS = 18` (local macro in `s_gen.c`)
 * - Interior DIRT rectangle: `x=5..WORLD_X-6`, `y=5..WORLD_Y-6`
 *   (`for (x=5; x < WORLD_X-5; x++)`, similarly for `y`)
 * - Perimeter loops: `x < WORLD_X - 5` and `y < WORLD_Y - 5`, stepping by 2
 * - Shoreline offsets: `WORLD_Y - 10`, `WORLD_Y - 6`, `WORLD_X - 10`, `WORLD_X - 6`
 *
 * Notes on structure:
 * - The original C uses globals `MapX`/`MapY` as a cursor that plop routines
 *   read. sim-core is intentionally side-effect-free at that level, so we pass
 *   `(mapX, mapY)` explicitly into {@link bRivPlop} / {@link sRivPlop} instead.
 *   This is a behavioral 1:1 port (same arguments, same call ordering).
 */
export function makeNakedIsland(
  map: Uint16Array,
  rng: TerrainRng,
  deps: MakeNakedIslandDeps = {},
): void {
  const bRivPlopImpl = deps.bRivPlop ?? bRivPlop;
  const sRivPlopImpl = deps.sRivPlop ?? sRivPlop;

  // C:
  //   for (x=0; x < WORLD_X; x++)
  //     for (y=0; y < WORLD_Y; y++)
  //       Map[x][y] = RIVER;
  map.fill(Tile.RIVER);

  // C:
  //   for (x = 5; x < WORLD_X - 5; x++)
  //     for (y = 5; y < WORLD_Y - 5; y++)
  //       Map[x][y] = DIRT;
  //
  // This creates a 5-tile "water border" and a DIRT interior. The subsequent
  // perimeter plops can overwrite parts of the interior to shape the shoreline
  // (they only write water/edge/channel tiles, never DIRT).
  for (let x = 5; x < World.WORLD_X - 5; x += 1) {
    for (let y = 5; y < World.WORLD_Y - 5; y += 1) {
      map[indexFor(x, y)] = Tile.DIRT;
    }
  }

  // C:
  //   for (x = 0; x < WORLD_X - 5; x += 2) { ... }
  for (let x = 0; x < World.WORLD_X - 5; x += 2) {
    const mapX = x;

    let mapY = eRand(rng, RADIUS);
    bRivPlopImpl(map, mapX, mapY);

    mapY = World.WORLD_Y - 10 - eRand(rng, RADIUS);
    bRivPlopImpl(map, mapX, mapY);

    mapY = 0;
    sRivPlopImpl(map, mapX, mapY);

    mapY = World.WORLD_Y - 6;
    sRivPlopImpl(map, mapX, mapY);
  }

  // C:
  //   for (y = 0; y < WORLD_Y - 5; y += 2) { ... }
  for (let y = 0; y < World.WORLD_Y - 5; y += 2) {
    const mapY = y;

    let mapX = eRand(rng, RADIUS);
    bRivPlopImpl(map, mapX, mapY);

    mapX = World.WORLD_X - 10 - eRand(rng, RADIUS);
    bRivPlopImpl(map, mapX, mapY);

    mapX = 0;
    sRivPlopImpl(map, mapX, mapY);

    mapX = World.WORLD_X - 6;
    sRivPlopImpl(map, mapX, mapY);
  }
}
