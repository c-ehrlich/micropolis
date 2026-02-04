import { makeNakedIsland } from './make-naked-island.ts';
import type { TerrainRng } from './rng.ts';
import { smoothRiver } from './smooth-river.ts';
import { doTrees } from './trees.ts';

export interface MakeIslandDeps {
  /**
   * Optional override for the island base generation step.
   *
   * Defaults to {@link makeNakedIsland}, a 1:1 port of `MakeNakedIsland()` in
   * `ref/micropolis/src/sim/s_gen.c`.
   */
  makeNakedIsland?: (map: Uint16Array, rng: TerrainRng) => void;

  /**
   * Optional override for the river edge smoothing step.
   *
   * Defaults to {@link smoothRiver}, a 1:1 port of `SmoothRiver()` in
   * `ref/micropolis/src/sim/s_gen.c`.
   */
  smoothRiver?: (map: Uint16Array, rng: TerrainRng) => void;

  /**
   * Optional override for the tree population step.
   *
   * Defaults to {@link doTrees}, a 1:1 port of `DoTrees()` in
   * `ref/micropolis/src/sim/s_gen.c`.
   */
  doTrees?: (map: Uint16Array, rng: TerrainRng, treeLevel: number) => void;
}

/**
 * Generate a random island: create an island base, smooth shoreline edges, then
 * plant trees.
 *
 * 1:1 port of `MakeIsland(void)` in `ref/micropolis/src/sim/s_gen.c`, as
 * described by `ref/micropolis/spec/terrain/SPEC.md` ("MakeIsland()").
 *
 * C behavior:
 * - `MakeIsland()` is just orchestration:
 *     `MakeNakedIsland(); SmoothRiver(); DoTrees();`
 * - It intentionally does *not* call `DoRivers()` or `MakeLakes()`.
 *
 * sim-core adaptation:
 * - The C code uses globals (including `TreeLevel` and the RNG state). We pass
 *   `treeLevel` explicitly and accept an explicit {@link TerrainRng}.
 */
export function makeIsland(
  map: Uint16Array,
  rng: TerrainRng,
  treeLevel: number,
  deps: MakeIslandDeps = {},
): void {
  const makeNakedIslandImpl = deps.makeNakedIsland ?? makeNakedIsland;
  const smoothRiverImpl = deps.smoothRiver ?? smoothRiver;
  const doTreesImpl =
    deps.doTrees ?? ((targetMap, targetRng, level) => doTrees(targetMap, targetRng, level, {}));

  // C:
  //   MakeNakedIsland();
  //   SmoothRiver();
  //   DoTrees();
  makeNakedIslandImpl(map, rng);
  smoothRiverImpl(map, rng);
  doTreesImpl(map, rng, treeLevel);
}
