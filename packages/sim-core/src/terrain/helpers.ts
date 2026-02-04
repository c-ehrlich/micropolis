import { World } from '../core/constants.ts';

/**
 * Tile bounds check used by terrain generation.
 *
 * 1:1 port of the `TestBounds(x, y)` macro from
 * `ref/micropolis/src/sim/headers/macros.h`:
 *
 *   `((x) >= 0) && ((x) < WORLD_X) && ((y) >= 0) && ((y) < WORLD_Y)`
 *
 * Terrain generation uses this for loop termination and for clipping writes
 * (e.g. `PutOnMap`, river walking, and smoothing).
 */
export function testBounds(x: number, y: number): boolean {
  return x >= 0 && x < World.WORLD_X && y >= 0 && y < World.WORLD_Y;
}

/**
 * Computes a column-major linear index for the classic Micropolis map layout.
 *
 * Micropolis stores the map as `Map[x][y]`, where `y` is the contiguous inner
 * dimension of the backing array. This matches sim-core’s convention:
 *
 *   `index = x * WORLD_Y + y`
 *
 * Spec reference: `ref/micropolis/spec/terrain/SPEC.md` ("Map storage").
 */
export function indexFor(x: number, y: number): number {
  return x * World.WORLD_Y + y;
}
