import { getOrThrow } from '../core/assert.ts';

/**
 * Move the terrain-generation cursor one step in an 8-way direction.
 *
 * 1:1 port of `MoveMap(short dir)` from `ref/micropolis/src/sim/s_gen.c`.
 *
 * Note: the C version mutates the `MapX`/`MapY` globals; in sim-core we model
 * that cursor as `(mapX, mapY)` arguments and return the updated coordinates.
 *
 * C behavior:
 * - `dir` is masked with `dir & 7` (wraps into the 0..7 range).
 * - `(MapX, MapY)` are incremented by a small lookup table (`DirTab`).
 *
 * Spec reference: `ref/micropolis/spec/terrain/SPEC.md` ("MoveMap(dir)").
 */
export function moveMap(mapX: number, mapY: number, dir: number): { mapX: number; mapY: number } {
  // Matches C:
  //   dir = dir & 7;
  //   MapX += DirTab[0][dir];
  //   MapY += DirTab[1][dir];
  const masked = dir & 7;

  const dx = getOrThrow(DIR_TAB_X[masked], `Expected DIR_TAB_X[${masked}] to exist`);
  const dy = getOrThrow(DIR_TAB_Y[masked], `Expected DIR_TAB_Y[${masked}] to exist`);

  return { mapX: mapX + dx, mapY: mapY + dy };
}

/**
 * `DirTab` from `MoveMap` in `ref/micropolis/src/sim/s_gen.c` (1:1).
 *
 * Indexed by `dir & 7`.
 */
const DIR_TAB_X = [0, 1, 1, 1, 0, -1, -1, -1] as const;
const DIR_TAB_Y = [-1, -1, 0, 1, 1, 1, 0, -1] as const;
