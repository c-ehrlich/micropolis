import { describe, expect, it } from 'vitest';

import { DemoMapHost, readDemoCityExportPayload } from './demo-map-host.ts';
import { createWebHostRuntime } from './runtime.ts';

describe('DemoMapHost city lifecycle and persistence flows', () => {
  it('round-trips save/export bytes through load/import in the web runtime', () => {
    const runtime = createWebHostRuntime({
      host: new DemoMapHost({ enableAmbientTicks: false }),
    });
    const exportCapture: { cityBytes: Uint8Array | null } = { cityBytes: null };

    runtime.subscribe((event) => {
      if (event.envelope?.kind !== 'patch') {
        return;
      }

      const savePayload = readDemoCityExportPayload(event.envelope.payload);
      if (savePayload !== null) {
        exportCapture.cityBytes = savePayload.cityBytes;
      }
    });

    runtime.connect();
    runtime.sendCommand('tool-1', {
      kind: 'tool',
      tool: 'road',
      x: 6,
      y: 6,
    });

    const changedTileIndex = 6 + 6 * 120;
    const savedFundsLabel = runtime.getState().hudState.fundsLabel;
    const savedTile = runtime.getState().mapState.tiles[changedTileIndex];

    runtime.sendCommand('save-1', {
      kind: 'city-io',
      action: 'save-city',
      fileName: 'runtime-roundtrip.cty',
    });

    const exportedCityBytes = exportCapture.cityBytes;
    if (exportedCityBytes === null) {
      throw new Error('expected save-city to emit export bytes');
    }
    // `.cty` classic map payload size is 27120 bytes in Micropolis file IO
    // (`WORLD_X=120`, `WORLD_Y=100`) from `ref/micropolis/src/sim/s_fileio.c`.
    expect(exportedCityBytes.byteLength).toBe(27120);

    runtime.sendCommand('new-1', {
      kind: 'city-lifecycle',
      action: 'new-city',
    });
    expect(runtime.getState().hudState.fundsLabel).toBe('Funds: $20,000');
    expect(runtime.getState().mapState.tiles[changedTileIndex]).not.toBe(savedTile);

    runtime.sendCommand('load-1', {
      kind: 'city-io',
      action: 'load-city',
      fileName: 'runtime-roundtrip.cty',
      cityBytes: exportedCityBytes,
    });

    expect(runtime.getState().hudState.fundsLabel).toBe(savedFundsLabel);
    expect(runtime.getState().mapState.tiles[changedTileIndex]).toBe(savedTile);
  });

  it('boots scenarios using C LoadScenario start funds and date constants', () => {
    const runtime = createWebHostRuntime({
      host: new DemoMapHost({ enableAmbientTicks: false }),
    });
    runtime.connect();

    runtime.sendCommand('scenario-1', {
      kind: 'scenario',
      action: 'load-scenario',
      scenarioId: 1,
    });
    // Scenario 1 starts with 5000 funds in `LoadScenario` switch table
    // (`ref/micropolis/src/sim/s_fileio.c` case 1).
    expect(runtime.getState().hudState.fundsLabel).toBe('Funds: $5,000');

    runtime.sendCommand('scenario-2', {
      kind: 'scenario',
      action: 'load-scenario',
      scenarioId: 2,
    });

    // Scenario 2 starts with 20000 funds and year 1906 in `LoadScenario`
    // (`ref/micropolis/src/sim/s_fileio.c` case 2), and month remains Jan because
    // `CityTime=((1906-1900)*48)+2` => `month=(CityTime%48)>>2=0`.
    expect(runtime.getState().hudState.fundsLabel).toBe('Funds: $20,000');
    expect(runtime.getState().hudState.dateLabel).toBe('Jan 1906');
    expect(runtime.getState().hudState.speed).toBe(3);
  });

  it('rejects invalid import bytes with deterministic reason', () => {
    const runtime = createWebHostRuntime({
      host: new DemoMapHost({ enableAmbientTicks: false }),
    });
    runtime.connect();

    runtime.sendCommand('load-invalid', {
      kind: 'city-io',
      action: 'load-city',
      fileName: 'broken.cty',
      cityBytes: new Uint8Array([1, 2, 3]),
    });

    expect(runtime.getState().lastRejectReason).toBe('invalid-city-file');
  });
});
