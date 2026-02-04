import { World } from '../core/constants.ts';
import { bRivPlop, sRivPlop } from './river-plops.ts';
import type { TerrainRng } from './rng.ts';

/**
 * Compute the number of lake "clusters" (`Lim1`) created by `MakeLakes`.
 *
 * 1:1 port of the `Lim1` selection in `MakeLakes(void)` from:
 * - `ref/micropolis/src/sim/s_gen.c` (`MakeLakes`)
 * - `ref/micropolis/spec/terrain/SPEC.md` ("MakeLakes()")
 *
 * C behavior:
 * - If `LakeLevel < 0`: `Lim1 = Rand(10)` (inclusive => 0..10).
 * - Else: `Lim1 = LakeLevel / 2` using C integer division (truncate toward 0).
 *
 * Note: In the overall pipeline (`GenerateMap`), `MakeLakes` is gated by
 * `if (LakeLevel != 0)`. This helper does not implement that gate; the caller
 * should mirror the C pipeline shape.
 */
export function lakeClusterCount(rng: TerrainRng, lakeLevel: number): number {
  if (lakeLevel < 0) {
    return rng.rand(10);
  }

  // Micropolis C uses integer division for `LakeLevel / 2`. In JS/TS, `/` is
  // floating point, so we must truncate for parity.
  return Math.trunc(lakeLevel / 2);
}

export interface MakeLakesDeps {
  /**
   * Optional hook for the "small river" plop applied by `MakeLakes`.
   *
   * Defaults to {@link sRivPlop} which is a 1:1 port of `SRivPlop()` in
   * `ref/micropolis/src/sim/s_gen.c`.
   */
  sRivPlop?: (map: Uint16Array, mapX: number, mapY: number) => void;

  /**
   * Optional hook for the "big river" plop applied by `MakeLakes`.
   *
   * Defaults to {@link bRivPlop} which is a 1:1 port of `BRivPlop()` in
   * `ref/micropolis/src/sim/s_gen.c`.
   */
  bRivPlop?: (map: Uint16Array, mapX: number, mapY: number) => void;
}

/**
 * Place random lake clusters on the map by applying SRiv/BRiv "plops".
 *
 * 1:1 port of `MakeLakes(void)` in `ref/micropolis/src/sim/s_gen.c`, as
 * described in `ref/micropolis/spec/terrain/SPEC.md` ("MakeLakes()").
 *
 * C behavior (mirrored exactly):
 * - Determines cluster count (`Lim1`) based on `LakeLevel` (see
 *   {@link lakeClusterCount}).
 * - For each cluster:
 *   - Picks a "center-ish" `(x, y)` with hard-coded offsets:
 *       `x = Rand(WORLD_X - 21) + 10`
 *       `y = Rand(WORLD_Y - 20) + 10`
 *   - Picks cluster size:
 *       `Lim2 = Rand(12) + 2` (inclusive => 2..14)
 *   - For each plop within the cluster, jitters around the center:
 *       `MapX = x - 6 + Rand(12)`
 *       `MapY = y - 6 + Rand(12)`
 *     and chooses plop type:
 *       `if (Rand(4)) SRivPlop(); else BRivPlop();`
 *
 * Overwrite rules and bounds clipping are handled inside the plop routines via
 * `putOnMap(...)` (Micropolis `PutOnMap`).
 */
export function makeLakes(
  map: Uint16Array,
  rng: TerrainRng,
  lakeLevel: number,
  deps: MakeLakesDeps,
): void {
  const sRivPlopImpl = deps.sRivPlop ?? sRivPlop;
  const bRivPlopImpl = deps.bRivPlop ?? bRivPlop;

  const lim1 = lakeClusterCount(rng, lakeLevel);

  for (let t = 0; t < lim1; t += 1) {
    const x = rng.rand(World.WORLD_X - 21) + 10;
    const y = rng.rand(World.WORLD_Y - 20) + 10;
    const lim2 = rng.rand(12) + 2;

    for (let z = 0; z < lim2; z += 1) {
      const mapX = x - 6 + rng.rand(12);
      const mapY = y - 6 + rng.rand(12);

      // In C: `if (Rand(4)) SRivPlop(); else BRivPlop();`
      // `Rand(4)` is inclusive (0..4), so only `0` chooses BRiv.
      if (rng.rand(4) !== 0) {
        sRivPlopImpl(map, mapX, mapY);
      } else {
        bRivPlopImpl(map, mapX, mapY);
      }
    }
  }
}
