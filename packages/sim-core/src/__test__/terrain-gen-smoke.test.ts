import { describe, expect, it } from 'vitest';

import { createSimContext } from '../core/sim-context.ts';
import { createSimState } from '../core/sim-state.ts';
import { generateMap } from '../terrain/generate.ts';

describe('terrain generator (smoke)', () => {
  it('can be imported and invoked without UI hooks', () => {
    const state = createSimState();
    const context = createSimContext();

    // This is a smoke test for the module boundary and function signature of
    // our (future) 1:1 port of `GenerateMap(seed)` in `ref/micropolis/src/sim/s_gen.c`,
    // as specified by `ref/micropolis/spec/terrain/SPEC.md`.
    //
    // Note: the `-1` values mirror Micropolis "default" globals:
    // `TreeLevel/LakeLevel/CurveLevel/CreateIsland` are all `-1` by default in C.
    // (See "Generation parameters" in the terrain spec.)
    expect(() => {
      generateMap(state, context, {
        seed: 123,
        treeLevel: -1,
        lakeLevel: -1,
        curveLevel: -1,
        createIsland: -1,
        reseedAfter: false,
      });
    }).not.toThrow();
  });
});
