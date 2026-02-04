import { describe, expect, it, vi } from 'vitest';

import { World } from '../core/constants.ts';
import type { DoRiversDeps, RiverCursorState } from './do-rivers.ts';
import { doBRiv, doRivers, riverCurvinessParams, stepRiverDirection } from './do-rivers.ts';
import type { TerrainRng } from './rng.ts';
import { QueueTerrainRng } from './rng.ts';

/**
 * These tests cover the river-walking logic in Micropolis terrain generation.
 *
 * Source of truth:
 * - `DoRivers`, `DoBRiv`, `DoSRiv` in `ref/micropolis/src/sim/s_gen.c`
 * - `ref/micropolis/spec/terrain/SPEC.md` ("Rivers")
 *
 * The "magic numbers" here come directly from the C code:
 * - Big-river loop bounds: `TestBounds(MapX + 4, MapY + 4)`
 * - Direction reset chance: `if (Rand(r1) < 10)`
 * - Direction drift threshold: `if (Rand(r2) > 90) Dir++/Dir--`
 * - Small-river loop bounds: `TestBounds(MapX + 3, MapY + 3)` (not exercised here)
 */
describe('terrain river walking (DoRivers/DoBRiv/DoSRiv)', () => {
  it('computes r1/r2 from CurveLevel like the C code', () => {
    // In C (`DoBRiv` / `DoSRiv`):
    //   if (CurveLevel < 0) { r1 = 100; r2 = 200; }
    //   else { r1 = CurveLevel + 10; r2 = CurveLevel + 100; }
    expect(riverCurvinessParams(-1)).toEqual({ r1: 100, r2: 200 });
    expect(riverCurvinessParams(0)).toEqual({ r1: 10, r2: 100 });
    expect(riverCurvinessParams(25)).toEqual({ r1: 35, r2: 125 });
  });

  it('resets Dir to LastDir when `Rand(r1) < 10` (and does not draw Rand(r2))', () => {
    const params = { r1: 100, r2: 200 };
    const rng = new QueueTerrainRng({
      // Only one draw should occur in this branch: `Rand(r1)`.
      randValues: [0], // < 10 => reset to LastDir
    });

    expect(stepRiverDirection(rng, params, { dir: 7, lastDir: 3 })).toBe(3);
  });

  it('increments/decrements Dir when `Rand(r2) > 90` (C drift rule)', () => {
    const params = { r1: 100, r2: 200 };

    {
      const rng = new QueueTerrainRng({
        // Rand(r1)=10 => not < 10 so take drift branch.
        // First Rand(r2)=91 => >90 so Dir++.
        // Second Rand(r2)=0 => not >90 so no Dir--.
        randValues: [10, 91, 0],
      });
      expect(stepRiverDirection(rng, params, { dir: 1, lastDir: 0 })).toBe(2);
    }

    {
      const rng = new QueueTerrainRng({
        // First Rand(r2)=0 => no Dir++.
        // Second Rand(r2)=91 => Dir--.
        randValues: [10, 0, 91],
      });
      expect(stepRiverDirection(rng, params, { dir: 1, lastDir: 0 })).toBe(0);
    }
  });

  it('relies on MoveMap masking (`dir & 7`) rather than clamping Dir in DoBRiv', () => {
    const map = new Uint16Array(World.WORLD_X * World.WORLD_Y);

    // Choose a start position where one east-ish move will end the big-river loop:
    // - Initial loop condition: TestBounds(MapX+4, MapY+4) must be true.
    // - After moving east by +1, MapX becomes 116 and MapX+4 == 120 is out of bounds,
    //   so the loop terminates after a single iteration.
    const startX = World.WORLD_X - 5; // 115
    const startY = World.WORLD_Y - 5; // 95

    const bRivPlopSpy = vi.fn<(map: Uint16Array, mapX: number, mapY: number) => void>();

    const rng = new QueueTerrainRng({
      // Force the reset branch so Dir becomes LastDir immediately.
      // Here LastDir is intentionally outside 0..7 to ensure MoveMap's `& 7` is what matters.
      randValues: [0],
    });

    const end = doBRiv(
      map,
      rng,
      -1, // CurveLevel < 0 => r1=100,r2=200 (values from C)
      { mapX: startX, mapY: startY, dir: 9, lastDir: 9 },
      { bRivPlop: bRivPlopSpy },
    );

    expect(bRivPlopSpy).toHaveBeenCalledTimes(1);
    expect(bRivPlopSpy).toHaveBeenCalledWith(map, startX, startY);

    // `MoveMap(dir)` masks with `dir & 7`, so `dir=9` behaves like `dir=1`:
    // dx=+1, dy=-1 (see `DirTab` in `s_gen.c`).
    expect(end.mapX).toBe(startX + 1);
    expect(end.mapY).toBe(startY - 1);

    // Parity check: C does not modify `Dir` when masking for movement; it stays 9.
    expect(end.dir).toBe(9);
  });

  it('implements the exact three-river sequence, including the DoSRiv Dir carryover quirk', () => {
    const map = new Uint16Array(World.WORLD_X * World.WORLD_Y);

    const rng = new QueueTerrainRng({
      // `DoRivers` consumes exactly two `Rand(3)` values:
      // - one for the first river `LastDir`,
      // - one for the third river `LastDir`.
      randValues: [2, 1],
    });

    const doBRivSpy = vi.fn<
      (
        map: Uint16Array,
        rng: TerrainRng,
        curveLevel: number,
        state: RiverCursorState,
        deps: Pick<DoRiversDeps, 'bRivPlop'>,
      ) => RiverCursorState
    >((_map, _rng, _curveLevel, state, _deps) => ({
      ...state,
      // Force an obvious, out-of-range carryover Dir value.
      dir: 123,
    }));

    const doSRivSpy = vi.fn<
      (
        map: Uint16Array,
        rng: TerrainRng,
        curveLevel: number,
        state: RiverCursorState,
        deps: Pick<DoRiversDeps, 'sRivPlop'>,
      ) => RiverCursorState
    >((_map, _rng, _curveLevel, state, _deps) => state);

    doRivers(map, rng, -1, 40, 33, {
      doBRiv: doBRivSpy,
      doSRiv: doSRivSpy,
    });

    // First big river: LastDir=Rand(3)=2, Dir=2.
    expect(doBRivSpy).toHaveBeenNthCalledWith(
      1,
      map,
      rng,
      -1,
      { mapX: 40, mapY: 33, dir: 2, lastDir: 2 },
      expect.anything(),
    );

    // Second big river: reset MapX/MapY; LastDir = 2 ^ 4 = 6; Dir = 6.
    expect(doBRivSpy).toHaveBeenNthCalledWith(
      2,
      map,
      rng,
      -1,
      { mapX: 40, mapY: 33, dir: 6, lastDir: 6 },
      expect.anything(),
    );

    // Third small river: reset MapX/MapY; LastDir=Rand(3)=1; **Dir is not set**.
    // It carries over from the end of the second `DoBRiv` (forced to 123 above).
    expect(doSRivSpy).toHaveBeenCalledWith(
      map,
      rng,
      -1,
      { mapX: 40, mapY: 33, dir: 123, lastDir: 1 },
      expect.anything(),
    );
  });
});
