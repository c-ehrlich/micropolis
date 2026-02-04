import { describe, expect, it } from 'vitest';

import { getRandStart } from './get-rand-start.ts';
import { QueueTerrainRng } from './rng.ts';

/**
 * `GetRandStart()` chooses the initial river start point.
 *
 * Source of truth:
 * - `GetRandStart(void)` in `ref/micropolis/src/sim/s_gen.c`
 * - Also documented in `ref/micropolis/spec/terrain/SPEC.md` ("GetRandStart()")
 *
 * C code (verbatim logic):
 * - `XStart = 40 + Rand(WORLD_X - 80);`
 * - `YStart = 33 + Rand(WORLD_Y - 67);`
 * - `MapX = XStart; MapY = YStart;`
 *
 * "Magic numbers" (why these literals matter):
 * - 40 and 33 are the base offsets used by Micropolis; they keep the initial
 *   river cursor away from the world edges.
 * - `WORLD_X - 80` and `WORLD_Y - 67` are the inclusive `Rand(range)` upper
 *   bounds passed to the RNG in C.
 * - Micropolis `Rand(range)` is inclusive (`[0..range]`), so with WORLD_X=120
 *   and WORLD_Y=100 the resulting ranges are:
 *   - XStart in [40..80] because `40 + Rand(40)`.
 *   - YStart in [33..66] because `33 + Rand(33)`.
 */
describe('terrain GetRandStart', () => {
  it('applies the C offsets and inclusive Rand ranges', () => {
    const minRng = new QueueTerrainRng({ randValues: [0, 0] });
    expect(getRandStart(minRng)).toEqual({ xStart: 40, yStart: 33, mapX: 40, mapY: 33 });

    const maxRng = new QueueTerrainRng({ randValues: [40, 33] });
    expect(getRandStart(maxRng)).toEqual({ xStart: 80, yStart: 66, mapX: 80, mapY: 66 });
  });
});
