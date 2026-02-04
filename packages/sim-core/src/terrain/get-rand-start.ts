import { World } from '../core/constants.ts';
import type { TerrainRng } from './rng.ts';

/**
 * Pick the initial river start point and initialize the terrain cursor.
 *
 * 1:1 port of `GetRandStart(void)` from `ref/micropolis/src/sim/s_gen.c`.
 *
 * C behavior (exact):
 * - `XStart = 40 + Rand(WORLD_X - 80);`
 * - `YStart = 33 + Rand(WORLD_Y - 67);`
 * - `MapX = XStart; MapY = YStart;`
 *
 * Notes:
 * - Micropolis `Rand(range)` is inclusive (`[0..range]`), so this yields:
 *   - `xStart` in `[40..40 + (WORLD_X - 80)]`
 *   - `yStart` in `[33..33 + (WORLD_Y - 67)]`
 *
 * Spec reference: `ref/micropolis/spec/terrain/SPEC.md` ("GetRandStart()").
 */
export function getRandStart(rng: TerrainRng): {
  xStart: number;
  yStart: number;
  mapX: number;
  mapY: number;
} {
  const xStart = 40 + rng.rand(World.WORLD_X - 80);
  const yStart = 33 + rng.rand(World.WORLD_Y - 67);

  return { xStart, yStart, mapX: xStart, mapY: yStart };
}
