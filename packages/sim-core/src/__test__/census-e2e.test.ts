import { describe, expect, it } from 'vitest';

import { Tile, TileFlag, World } from '../core/constants.ts';
import { createClassicMapStore } from '../core/map-store.ts';
import { MicropolisRng } from '../core/rng.ts';
import { createSimContext } from '../core/sim-context.ts';
import { createSimState } from '../core/sim-state.ts';
import { dispatchSimPhase } from '../sim/simulate.ts';
import { clearCensus, take2Census, takeCensus } from '../systems/census.ts';
import { mapScanSlice } from '../systems/map-scan.ts';
import { createZoneHandler } from '../systems/zones.ts';

const { WORLD_Y } = World;
const indexFor = (x: number, y: number) => x * WORLD_Y + y;

class StubRng extends MicropolisRng {
  override next16(): number {
    return 0;
  }

  override next16Signed(): number {
    return 0;
  }

  override rand(_range: number): number {
    return 0;
  }
}

describe('Census E2E', () => {
  it('collects population from map scan and updates both census graphs', () => {
    const store = createClassicMapStore();
    const rng = new StubRng(1);
    const changeCensusCalls: number[] = [];
    const context = createSimContext({
      store,
      rng,
      hooks: {
        changeCensus: () => changeCensusCalls.push(1),
      },
    });
    const state = createSimState();
    // CityTime increments in phase 0; start at 47 so phase 0 lands on 48,
    // triggering both 10-year (CityTime % 4) and 120-year (CityTime % 48) census.
    state.CityTime = 47;

    // Any in-bounds zoned tile will do; we use (2,2) for a deterministic seed.
    const zoneX = 2;
    const zoneY = 2;

    store.beginTick();
    store.write('map', indexFor(zoneX, zoneY), Tile.RZB | TileFlag.ZONEBIT);

    const zoneHandler = createZoneHandler(state, context, {
      makeTraf: () => 1,
    });

    const systems = {
      clearCensus,
      takeCensus,
      take2Census,
      mapScan: (phase: number, scanState: typeof state, scanContext: typeof context) => {
        if (phase === 1) {
          // Phase 1 scans the first 1/8 of WORLD_X (120 / 8 = 15).
          mapScanSlice(scanState, scanContext, 0, 15, { onZone: zoneHandler });
        }
      },
    };

    dispatchSimPhase(0, state, context, systems);
    dispatchSimPhase(1, state, context, systems);

    expect(state.ResPop).toBeGreaterThan(0);

    // Res history uses ResPop / 8 in `TakeCensus` and `Take2Census`.
    const expectedResHis = Math.trunc(state.ResPop / 8);

    dispatchSimPhase(9, state, context, systems);

    expect(state.ResHis[0]).toBe(expectedResHis);
    // Long-term graph history starts at index 120 in Micropolis.
    expect(state.ResHis[120]).toBe(expectedResHis);
    expect(changeCensusCalls).toHaveLength(2);

    store.commitTick();
  });
});
