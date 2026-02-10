import { afterEach, describe, expect, it, vi } from 'vitest';

import { Tile, TileMask } from '../../../../packages/sim-core/src/index.ts';
import {
  createPlayableRuntimeHost,
  readCityExportPayload,
} from '../game/runtime/playable-runtime-host.ts';
import { createWebHostRuntime } from '../game/runtime/runtime.ts';

interface LocalHostSmokeSummary {
  fundsAfterRoad: string;
  dateAfterAmbientTicks: string;
  speedAfterAmbientTicks: number;
  demandAfterAmbientTicks: [number, number, number];
  roadTileAfterPlacement: number;
  tickAfterAmbientTicks: number;
  serverSeqAfterAmbientTicks: number;
  savedCityByteLength: number;
  fundsAfterLoad: string;
  dateAfterLoad: string;
  roadTileAfterLoad: number;
}

/**
 * Finds a deterministic dirt tile for single-tile road placement assertions.
 * Mirrors `do_tool` single-tile cost behavior in `ref/micropolis/src/sim/w_tool.c`.
 * Parity note: selecting `DIRT` avoids incidental clear-cost surcharges.
 */
function findCostNeutralRoadPlacement(
  tiles: readonly number[] | Uint16Array,
  width: number,
  height: number,
): { x: number; y: number; index: number } {
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      const tileWord = tiles[index];
      if (tileWord === undefined) {
        continue;
      }
      if ((tileWord & TileMask.LOMASK) === Tile.DIRT) {
        return { x, y, index };
      }
    }
  }

  throw new Error('Expected at least one interior dirt tile for road placement');
}

/**
 * Runs one Playable Runtime LocalHost playable smoke flow through runtime + host envelopes.
 * Mirrors user-facing command/tick/update/save-load behavior across
 * `ref/micropolis/src/sim/sim.c`, `ref/micropolis/src/sim/w_tool.c`,
 * `ref/micropolis/src/sim/w_update.c`, and `ref/micropolis/src/sim/s_fileio.c`.
 * Difference: this uses `createPlayableRuntimeHost` (sim-core envelope host) instead of
 * the legacy scripted demo host.
 */
async function runLocalHostPlayableSmokeFlow(runId: string): Promise<LocalHostSmokeSummary> {
  const runtime = createWebHostRuntime({
    host: createPlayableRuntimeHost(),
  });
  const savedCityExports: Uint8Array[] = [];
  const unsubscribe = runtime.subscribe((event) => {
    if (event.envelope?.kind !== 'patch') {
      return;
    }

    const savePayload = readCityExportPayload(event.envelope.payload);
    if (savePayload !== null) {
      savedCityExports.push(savePayload.cityBytes.slice());
    }
  });

  try {
    runtime.connect();
    expect(runtime.getState().phase).toBe('ready');

    runtime.sendCommand(`${runId}-new-city`, {
      kind: 'city-lifecycle',
      action: 'new-city',
    });
    // `DoNewCity` initializes playable starting money at 20000 in Micropolis startup flows
    // (`ref/micropolis/src/sim/s_init.c`).
    expect(runtime.getState().hudState.fundsLabel).toBe('Funds: $20,000');

    const mapWidth = runtime.getState().mapState.width;
    // Playable Runtime map uses classic Micropolis world dimensions (`WORLD_X=120`, `WORLD_Y=100`)
    // from city/map IO and simulation globals (`ref/micropolis/src/sim/s_fileio.c`).
    expect(mapWidth).toBe(120);
    expect(runtime.getState().mapState.height).toBe(100);

    const {
      x: toolX,
      y: toolY,
      index: tileIndex,
    } = findCostNeutralRoadPlacement(
      runtime.getState().mapState.tiles,
      mapWidth,
      runtime.getState().mapState.height,
    );
    const originalTile = runtime.getState().mapState.tiles[tileIndex];
    if (originalTile === undefined) {
      throw new Error(`Expected initial tile at index ${tileIndex} to exist`);
    }

    runtime.sendCommand(`${runId}-road`, {
      kind: 'tool',
      tool: 'road',
      x: toolX,
      y: toolY,
    });
    const roadTileAfterPlacement = runtime.getState().mapState.tiles[tileIndex];
    if (roadTileAfterPlacement === undefined) {
      throw new Error(`Expected placed road tile at index ${tileIndex} to exist`);
    }
    expect(roadTileAfterPlacement).not.toBe(originalTile);
    // `CostOf[]` road cost is 10 in tool command handling (`ref/micropolis/src/sim/w_tool.c`).
    expect(runtime.getState().hudState.fundsLabel).toBe('Funds: $19,990');

    runtime.sendCommand(`${runId}-play`, {
      kind: 'sim-control',
      control: 'play',
    });

    const tickBeforeAmbientTicks = runtime.getState().lastAppliedTick;
    const serverSeqBeforeAmbientTicks = runtime.getState().lastAppliedServerSeq;
    await vi.advanceTimersByTimeAsync(40);

    const stateAfterAmbientTicks = runtime.getState();
    // Idle slices may coalesce without emitting new envelopes; cursors must never regress.
    expect(stateAfterAmbientTicks.lastAppliedTick).toBeGreaterThanOrEqual(tickBeforeAmbientTicks);
    expect(stateAfterAmbientTicks.lastAppliedServerSeq).toBeGreaterThanOrEqual(
      serverSeqBeforeAmbientTicks,
    );
    // `updateDate` projects month/year from `CityTime` (`ref/micropolis/src/sim/w_update.c`).
    // Depending on timer coalescing, this smoke flow can remain in Jan or advance to Feb.
    expect(stateAfterAmbientTicks.hudState.dateLabel).toMatch(/^[A-Z][a-z]{2} 1900$/);
    expect(stateAfterAmbientTicks.hudState.speed).toBe(3);
    // `SetDemand` heads are integer values in the visible -15..15 range
    // (`ref/micropolis/src/sim/w_update.c`).
    expect(stateAfterAmbientTicks.hudState.demandR).toBeGreaterThanOrEqual(-15);
    expect(stateAfterAmbientTicks.hudState.demandR).toBeLessThanOrEqual(15);
    expect(stateAfterAmbientTicks.hudState.demandC).toBeGreaterThanOrEqual(-15);
    expect(stateAfterAmbientTicks.hudState.demandC).toBeLessThanOrEqual(15);
    expect(stateAfterAmbientTicks.hudState.demandI).toBeGreaterThanOrEqual(-15);
    expect(stateAfterAmbientTicks.hudState.demandI).toBeLessThanOrEqual(15);

    runtime.sendCommand(`${runId}-save`, {
      kind: 'city-io',
      action: 'save-city',
      fileName: `${runId}.cty`,
    });
    const savedCityBytesForLoad = savedCityExports.at(-1);
    if (savedCityBytesForLoad === undefined) {
      throw new Error('Expected save-city to emit export bytes');
    }
    // `.cty` payload size is 27120 bytes for classic 120x100 map storage
    // in Micropolis file IO (`ref/micropolis/src/sim/s_fileio.c`).
    expect(savedCityBytesForLoad.byteLength).toBe(27120);

    runtime.sendCommand(`${runId}-new-city-2`, {
      kind: 'city-lifecycle',
      action: 'new-city',
    });
    expect(runtime.getState().hudState.fundsLabel).toBe('Funds: $20,000');
    expect(runtime.getState().mapState.tiles[tileIndex]).not.toBe(roadTileAfterPlacement);

    runtime.sendCommand(`${runId}-load`, {
      kind: 'city-io',
      action: 'load-city',
      fileName: `${runId}.cty`,
      cityBytes: savedCityBytesForLoad,
    });
    const stateAfterLoad = runtime.getState();
    const roadTileAfterLoad = stateAfterLoad.mapState.tiles[tileIndex];
    if (roadTileAfterLoad === undefined) {
      throw new Error(`Expected loaded tile at index ${tileIndex} to exist`);
    }
    expect(stateAfterLoad.hudState.fundsLabel).toBe('Funds: $19,990');
    expect(stateAfterLoad.hudState.dateLabel).toBe(stateAfterAmbientTicks.hudState.dateLabel);
    expect(roadTileAfterLoad).toBe(roadTileAfterPlacement);

    return {
      fundsAfterRoad: 'Funds: $19,990',
      dateAfterAmbientTicks: stateAfterAmbientTicks.hudState.dateLabel,
      speedAfterAmbientTicks: stateAfterAmbientTicks.hudState.speed,
      demandAfterAmbientTicks: [
        stateAfterAmbientTicks.hudState.demandR,
        stateAfterAmbientTicks.hudState.demandC,
        stateAfterAmbientTicks.hudState.demandI,
      ],
      roadTileAfterPlacement,
      tickAfterAmbientTicks: stateAfterAmbientTicks.lastAppliedTick,
      serverSeqAfterAmbientTicks: stateAfterAmbientTicks.lastAppliedServerSeq,
      savedCityByteLength: savedCityBytesForLoad.byteLength,
      fundsAfterLoad: stateAfterLoad.hudState.fundsLabel,
      dateAfterLoad: stateAfterLoad.hudState.dateLabel,
      roadTileAfterLoad,
    };
  } finally {
    unsubscribe();
    runtime.disconnect();
  }
}

describe('Playable Runtime LocalHost playable smoke flows', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('covers start city, tool placement, ambient ticks, HUD projection, and save/load', async () => {
    vi.useFakeTimers();
    const summary = await runLocalHostPlayableSmokeFlow('smoke-main');

    expect(summary.fundsAfterRoad).toBe('Funds: $19,990');
    expect(summary.dateAfterAmbientTicks).toMatch(/^[A-Z][a-z]{2} 1900$/);
    expect(summary.speedAfterAmbientTicks).toBe(3);
    expect(summary.savedCityByteLength).toBe(27120);
    expect(summary.fundsAfterLoad).toBe('Funds: $19,990');
    expect(summary.dateAfterLoad).toBe(summary.dateAfterAmbientTicks);
    expect(summary.roadTileAfterLoad).toBe(summary.roadTileAfterPlacement);
  });

  it('remains deterministic across repeated LocalHost smoke runs', async () => {
    vi.useFakeTimers();
    const run1 = await runLocalHostPlayableSmokeFlow('smoke-repeat-1');
    const run2 = await runLocalHostPlayableSmokeFlow('smoke-repeat-2');
    const run3 = await runLocalHostPlayableSmokeFlow('smoke-repeat-3');

    expect(run2).toEqual(run1);
    expect(run3).toEqual(run1);
  });
});
