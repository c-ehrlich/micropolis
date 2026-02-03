import { describe, expect, it } from 'vitest';

import { createToolContext } from '../actions/tool-actions.ts';
import { Tile, World } from '../core/constants.ts';
import { createClassicMapStore } from '../core/map-store.ts';
import { MicropolisRng } from '../core/rng.ts';
import { createSimContext } from '../core/sim-context.ts';
import { createSimState } from '../core/sim-state.ts';
import { createRealtimeContext, generateTrain, getSprite, SPRITE_TYPE } from '../sim/realtime.ts';
import { mapScanSlice } from '../systems/map-scan.ts';
import { createRailHandler } from '../systems/rail.ts';

const { WORLD_Y } = World;
const indexFor = (x: number, y: number) => x * WORLD_Y + y;

describe('Rail E2E', () => {
  it('spawns a train via GenerateTrain hook when rails are scanned', () => {
    const store = createClassicMapStore();
    const rng = new MicropolisRng(11);
    const toolContext = createToolContext({ store, rng, funds: 0 });
    const realtime = createRealtimeContext({
      store,
      rng,
      toolContext,
      totalPop: 21,
      doAnimation: false,
    });

    const context = createSimContext({
      store,
      rng,
      hooks: {
        generateTrain: (x, y) => generateTrain(realtime, x, y),
      },
    });
    const state = createSimState();
    state.RoadEffect = 32;

    const x = 12;
    const y = 10;

    store.beginTick();
    store.write('map', indexFor(x, y), Tile.HRAIL);

    mapScanSlice(state, context, x, x + 1, { onRail: createRailHandler(state, context) });

    const train = getSprite(realtime, SPRITE_TYPE.TRA);
    expect(train).not.toBeNull();
    if (train) {
      expect(train.type).toBe(SPRITE_TYPE.TRA);
    }

    store.commitTick();
  });
});
