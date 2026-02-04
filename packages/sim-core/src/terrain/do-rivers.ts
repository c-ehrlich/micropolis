import { testBounds } from './helpers.ts';
import { moveMap } from './move-map.ts';
import { bRivPlop, sRivPlop } from './river-plops.ts';
import type { TerrainRng } from './rng.ts';

/**
 * Mutable cursor state used by Micropolis terrain river routines.
 *
 * In the original C implementation (`ref/micropolis/src/sim/s_gen.c`), these are
 * globals:
 * - `short MapX, MapY;`
 * - `short Dir, LastDir;`
 *
 * We represent them explicitly so the port is testable and so we don't need
 * global state in sim-core.
 */
export interface RiverCursorState {
  mapX: number;
  mapY: number;
  dir: number;
  lastDir: number;
}

export interface RiverCurvinessParams {
  r1: number;
  r2: number;
}

/**
 * Curviness parameters (`r1`, `r2`) used by `DoBRiv` / `DoSRiv`.
 *
 * Intended as a 1:1 port of the `r1` / `r2` initialization in:
 * - `DoBRiv(void)` in `ref/micropolis/src/sim/s_gen.c`
 * - `DoSRiv(void)` in `ref/micropolis/src/sim/s_gen.c`
 */
export function riverCurvinessParams(curveLevel: number): RiverCurvinessParams {
  // In C (`DoBRiv` / `DoSRiv`):
  //   if (CurveLevel < 0) { r1 = 100; r2 = 200; }
  //   else { r1 = CurveLevel + 10; r2 = CurveLevel + 100; }
  //
  // The specific constants (100/200/10/100) are "magic numbers" from
  // `ref/micropolis/src/sim/s_gen.c`.
  if (curveLevel < 0) {
    return { r1: 100, r2: 200 };
  }
  return { r1: curveLevel + 10, r2: curveLevel + 100 };
}

/**
 * Direction drift update used by both big and small rivers.
 *
 * Intended as a 1:1 port of this C snippet in `DoBRiv` / `DoSRiv`:
 *
 * ```c
 * if (Rand(r1) < 10) {
 *   Dir = LastDir;
 * } else {
 *   if (Rand(r2) > 90) Dir++;
 *   if (Rand(r2) > 90) Dir--;
 * }
 * ```
 *
 * Important parity note:
 * - `Dir` is *not* masked to 0..7 here; only `MoveMap(Dir)` masks via `dir & 7`.
 */
export function stepRiverDirection(
  rng: TerrainRng,
  params: RiverCurvinessParams,
  state: Pick<RiverCursorState, 'dir' | 'lastDir'>,
): number {
  let dir = state.dir;

  if (rng.rand(params.r1) < 10) {
    // In C: `Dir = LastDir;`
    dir = state.lastDir;
  } else {
    // In C:
    //   if (Rand(r2) > 90) Dir++;
    //   if (Rand(r2) > 90) Dir--;
    //
    // Note the two independent draws: they are not mutually exclusive.
    if (rng.rand(params.r2) > 90) {
      dir += 1;
    }
    if (rng.rand(params.r2) > 90) {
      dir -= 1;
    }
  }

  // Do *not* clamp/mask `dir` here: in C, masking happens inside `MoveMap(Dir)`
  // via `dir & 7`. Preserving the unmasked `Dir` value is part of parity.
  return dir;
}

export interface DoRiversDeps {
  /**
   * Optional hook for the "big river" plop routine used by `DoBRiv`.
   *
   * Defaults to {@link bRivPlop} which is a 1:1 port of `BRivPlop()` in
   * `ref/micropolis/src/sim/s_gen.c`.
   */
  bRivPlop?: (map: Uint16Array, mapX: number, mapY: number) => void;

  /**
   * Optional hook for the "small river" plop routine used by `DoSRiv`.
   *
   * Defaults to {@link sRivPlop} which is a 1:1 port of `SRivPlop()` in
   * `ref/micropolis/src/sim/s_gen.c`.
   */
  sRivPlop?: (map: Uint16Array, mapX: number, mapY: number) => void;

  /**
   * Optional override for `DoBRiv`, primarily to make `DoRivers` unit-testable
   * without depending on the walk loop.
   */
  doBRiv?: (
    map: Uint16Array,
    rng: TerrainRng,
    curveLevel: number,
    state: RiverCursorState,
    deps: Pick<DoRiversDeps, 'bRivPlop'>,
  ) => RiverCursorState;

  /**
   * Optional override for `DoSRiv`, primarily to make `DoRivers` unit-testable
   * without depending on the walk loop.
   */
  doSRiv?: (
    map: Uint16Array,
    rng: TerrainRng,
    curveLevel: number,
    state: RiverCursorState,
    deps: Pick<DoRiversDeps, 'sRivPlop'>,
  ) => RiverCursorState;
}

/**
 * Create three rivers starting from `(xStart, yStart)`.
 *
 * Intended as a 1:1 port of `DoRivers(void)` in `ref/micropolis/src/sim/s_gen.c`.
 *
 * C behavior (exact):
 * 1) Big river: `LastDir = Rand(3); Dir = LastDir; DoBRiv();`
 * 2) Big river: reset cursor, flip direction: `LastDir = LastDir ^ 4; Dir = LastDir; DoBRiv();`
 * 3) Small river: reset cursor, pick new `LastDir = Rand(3); DoSRiv();`
 *
 * Note the subtlety in step (3): the C code does **not** assign `Dir = LastDir`
 * before calling `DoSRiv()`. `Dir` carries over from the end of the second
 * `DoBRiv()` run. This is surprising, but it is the behavior in
 * `ref/micropolis/src/sim/s_gen.c` and is required for parity.
 */
export function doRivers(
  map: Uint16Array,
  rng: TerrainRng,
  curveLevel: number,
  xStart: number,
  yStart: number,
  deps: DoRiversDeps,
): RiverCursorState {
  const bRivPlopImpl = deps.bRivPlop ?? bRivPlop;
  const sRivPlopImpl = deps.sRivPlop ?? sRivPlop;

  const doBRivImpl =
    deps.doBRiv ??
    ((targetMap, targetRng, targetCurveLevel, state, innerDeps) =>
      doBRiv(targetMap, targetRng, targetCurveLevel, state, innerDeps));

  const doSRivImpl =
    deps.doSRiv ??
    ((targetMap, targetRng, targetCurveLevel, state, innerDeps) =>
      doSRiv(targetMap, targetRng, targetCurveLevel, state, innerDeps));

  // In C:
  //   LastDir = Rand(3);
  //   Dir = LastDir;
  let lastDir = rng.rand(3);
  let dir = lastDir;

  doBRivImpl(
    map,
    rng,
    curveLevel,
    { mapX: xStart, mapY: yStart, dir, lastDir },
    { bRivPlop: bRivPlopImpl },
  );

  // In C:
  //   MapX = XStart; MapY = YStart;
  //   LastDir = LastDir ^ 4;
  //   Dir = LastDir;
  lastDir = lastDir ^ 4;
  dir = lastDir;

  const afterSecond = doBRivImpl(
    map,
    rng,
    curveLevel,
    { mapX: xStart, mapY: yStart, dir, lastDir },
    { bRivPlop: bRivPlopImpl },
  );

  // In C:
  //   MapX = XStart; MapY = YStart;
  //   LastDir = Rand(3);
  //   DoSRiv();
  //
  // Parity note: the C code *does not* assign `Dir = LastDir` here, so `Dir`
  // carries over from the end of the second big river.
  lastDir = rng.rand(3);

  return doSRivImpl(
    map,
    rng,
    curveLevel,
    { mapX: xStart, mapY: yStart, dir: afterSecond.dir, lastDir },
    { sRivPlop: sRivPlopImpl },
  );
}

export interface DoBRivDeps {
  bRivPlop?: (map: Uint16Array, mapX: number, mapY: number) => void;
}

/**
 * Walk and paint a "big river" using `BRivPlop` and direction drift rules.
 *
 * Intended as a 1:1 port of `DoBRiv(void)` from `ref/micropolis/src/sim/s_gen.c`,
 * as documented in `ref/micropolis/spec/terrain/SPEC.md` ("DoBRiv()").
 */
export function doBRiv(
  map: Uint16Array,
  rng: TerrainRng,
  curveLevel: number,
  state: RiverCursorState,
  deps: DoBRivDeps,
): RiverCursorState {
  const bRivPlopImpl = deps.bRivPlop ?? bRivPlop;
  const params = riverCurvinessParams(curveLevel);

  // `LastDir` is a stable preferred direction for the entire river.
  const lastDir = state.lastDir;

  let { mapX, mapY, dir } = state;

  // In C:
  //   while (TestBounds(MapX + 4, MapY + 4)) { ... }
  while (testBounds(mapX + 4, mapY + 4)) {
    bRivPlopImpl(map, mapX, mapY);

    dir = stepRiverDirection(rng, params, { dir, lastDir });

    // In C: `MoveMap(Dir);` (masks `dir` with `dir & 7` internally).
    ({ mapX, mapY } = moveMap(mapX, mapY, dir));
  }

  return { mapX, mapY, dir, lastDir };
}

export interface DoSRivDeps {
  sRivPlop?: (map: Uint16Array, mapX: number, mapY: number) => void;
}

/**
 * Walk and paint a "small river" using `SRivPlop` and direction drift rules.
 *
 * Intended as a 1:1 port of `DoSRiv(void)` from `ref/micropolis/src/sim/s_gen.c`,
 * as documented in `ref/micropolis/spec/terrain/SPEC.md` ("DoSRiv()").
 */
export function doSRiv(
  map: Uint16Array,
  rng: TerrainRng,
  curveLevel: number,
  state: RiverCursorState,
  deps: DoSRivDeps,
): RiverCursorState {
  const sRivPlopImpl = deps.sRivPlop ?? sRivPlop;
  const params = riverCurvinessParams(curveLevel);

  const lastDir = state.lastDir;
  let { mapX, mapY, dir } = state;

  // In C:
  //   while (TestBounds(MapX + 3, MapY + 3)) { ... }
  while (testBounds(mapX + 3, mapY + 3)) {
    sRivPlopImpl(map, mapX, mapY);

    dir = stepRiverDirection(rng, params, { dir, lastDir });

    ({ mapX, mapY } = moveMap(mapX, mapY, dir));
  }

  return { mapX, mapY, dir, lastDir };
}
