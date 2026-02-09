import { describe, expect, it, vi } from 'vitest';

import { DemoMapHost, readDemoCityExportPayload } from './demo-map-host.ts';
import { createWebHostRuntime } from './runtime.ts';

describe('DemoMapHost city lifecycle and persistence flows', () => {
  it('keeps ambient patches out of map payload ownership', () => {
    vi.useFakeTimers();
    const runtime = createWebHostRuntime({
      host: new DemoMapHost({ enableAmbientTicks: true, patchIntervalMs: 10 }),
    });

    try {
      let ambientPatchCount = 0;
      let ambientPatchWithMapCount = 0;
      runtime.subscribe((event) => {
        if (event.envelope?.kind !== 'patch') {
          return;
        }

        ambientPatchCount += 1;
        if (event.envelope.payload.map !== undefined) {
          ambientPatchWithMapCount += 1;
        }
      });

      runtime.connect();
      const initialMapState = runtime.getState().mapState;

      vi.advanceTimersByTime(60);

      expect(ambientPatchCount).toBeGreaterThan(0);
      expect(ambientPatchWithMapCount).toBe(0);
      expect(runtime.getState().mapState).toBe(initialMapState);
    } finally {
      runtime.disconnect();
      vi.useRealTimers();
    }
  });

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

  it('keeps snapshot replay message ordering metadata stable after patch emission', () => {
    const runtime = createWebHostRuntime({
      host: new DemoMapHost({ enableAmbientTicks: false }),
    });
    runtime.connect();

    runtime.sendCommand('save-1', {
      kind: 'city-io',
      action: 'save-city',
      fileName: 'snapshot-replay.cty',
    });

    const savedMessageBeforeReplay = runtime
      .getState()
      .hudState.messages.find((message) => message.text.startsWith('Saved '));
    if (savedMessageBeforeReplay === undefined) {
      throw new Error('expected save-city message to exist before replay snapshot');
    }

    runtime.requestSnapshot('manual');

    const savedMessageAfterReplay = runtime
      .getState()
      .hudState.messages.find((message) => message.text.startsWith('Saved '));
    if (savedMessageAfterReplay === undefined) {
      throw new Error('expected save-city message to exist after replay snapshot');
    }

    expect(savedMessageAfterReplay.tick).toBe(savedMessageBeforeReplay.tick);
    expect(savedMessageAfterReplay.serverSeq).toBe(savedMessageBeforeReplay.serverSeq);
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

  it('only updates HUD options after DoUpdateHeads emits option uiSet keys', () => {
    const host = new DemoMapHost({ enableAmbientTicks: false });
    const runtime = createWebHostRuntime({ host });
    runtime.connect();

    expect(runtime.getState().hudState.options.autoBudget).toBe(true);
    expect(runtime.getState().hudState.options.autoGo).toBe(true);

    const simState = (host as unknown as { simState: { autoBudget: boolean; autoGo: boolean } })
      .simState;
    simState.autoBudget = false;
    simState.autoGo = false;
    runtime.requestSnapshot('manual');

    // w_update.c `updateOptions` only emits when MustUpdateOptions is set and
    // `DoUpdateHeads` runs. Snapshot heads should stay on last emitted values.
    expect(runtime.getState().hudState.options.autoBudget).toBe(true);
    expect(runtime.getState().hudState.options.autoGo).toBe(true);

    runtime.sendCommand('new-1', {
      kind: 'city-lifecycle',
      action: 'new-city',
    });

    expect(runtime.getState().hudState.options.autoBudget).toBe(true);
    expect(runtime.getState().hudState.options.autoGo).toBe(true);
  });

  it('mirrors w_util.c Pause/Resume/setSpeed timer gating and visible speed updates', () => {
    vi.useFakeTimers();
    const runtime = createWebHostRuntime({
      host: new DemoMapHost({ enableAmbientTicks: true, patchIntervalMs: 10 }),
    });
    const patchSpeeds: number[] = [];

    try {
      runtime.subscribe((event) => {
        if (event.envelope?.kind !== 'patch') {
          return;
        }

        const speed = event.envelope.payload.hud?.speed;
        if (typeof speed === 'number') {
          patchSpeeds.push(speed);
        }
      });

      runtime.connect();
      vi.advanceTimersByTime(30);
      expect(patchSpeeds.length).toBeGreaterThan(0);

      runtime.sendCommand('pause-1', {
        kind: 'sim-control',
        control: 'pause',
      });

      // Magic-number source: `setSpeed(short)` emits `UISetSpeed 0` while paused
      // (`sim_paused ? 0 : SimMetaSpeed`) in `ref/micropolis/src/sim/w_util.c`.
      expect(runtime.getState().hudState.speed).toBe(0);
      const patchCountAfterPause = patchSpeeds.length;
      vi.advanceTimersByTime(50);
      expect(patchSpeeds.length).toBe(patchCountAfterPause);

      runtime.sendCommand('set-speed-while-paused-1', {
        kind: 'sim-control',
        control: 'set-speed',
        speed: 2,
      });

      // Magic-number source: paused `setSpeed` keeps visible speed at `0` in
      // `ref/micropolis/src/sim/w_util.c` even when `SimMetaSpeed` changes.
      expect(runtime.getState().hudState.speed).toBe(0);
      const patchCountAfterPausedSetSpeed = patchSpeeds.length;
      vi.advanceTimersByTime(50);
      expect(patchSpeeds.length).toBe(patchCountAfterPausedSetSpeed);

      runtime.sendCommand('play-1', {
        kind: 'sim-control',
        control: 'play',
      });

      // Magic-number source: `SimCmdSpeed`/`setSpeed` playable speeds include `2`
      // (`0..3` clamp) in `ref/micropolis/src/sim/w_sim.c` and `w_util.c`.
      expect(runtime.getState().hudState.speed).toBe(2);
      const patchCountAfterPlay = patchSpeeds.length;
      vi.advanceTimersByTime(50);
      expect(patchSpeeds.length).toBeGreaterThan(patchCountAfterPlay);
    } finally {
      runtime.disconnect();
      vi.useRealTimers();
    }
  });

  it('skips redundant HUD speed patches for no-op Pause/Resume branches', () => {
    const runtime = createWebHostRuntime({
      host: new DemoMapHost({ enableAmbientTicks: false }),
    });
    let speedPatchCount = 0;
    let ackCount = 0;

    runtime.subscribe((event) => {
      if (event.envelope?.kind === 'ack') {
        ackCount += 1;
        return;
      }
      if (event.envelope?.kind !== 'patch') {
        return;
      }
      if (typeof event.envelope.payload.hud?.speed === 'number') {
        speedPatchCount += 1;
      }
    });

    runtime.connect();
    expect(runtime.getState().hudState.speed).toBe(3);

    runtime.sendCommand('pause-1', {
      kind: 'sim-control',
      control: 'pause',
    });
    expect(runtime.getState().hudState.speed).toBe(0);
    const speedPatchCountAfterFirstPause = speedPatchCount;

    runtime.sendCommand('pause-2', {
      kind: 'sim-control',
      control: 'pause',
    });

    // `Pause()` only calls `setSpeed(0)` from the `if (!sim_paused)` branch in
    // `ref/micropolis/src/sim/w_util.c`; the second pause is a no-op.
    expect(speedPatchCount).toBe(speedPatchCountAfterFirstPause);

    runtime.sendCommand('play-1', {
      kind: 'sim-control',
      control: 'play',
    });
    expect(runtime.getState().hudState.speed).toBe(3);
    const speedPatchCountAfterFirstPlay = speedPatchCount;

    runtime.sendCommand('play-2', {
      kind: 'sim-control',
      control: 'play',
    });

    // `Resume()` only calls `setSpeed(sim_paused_speed)` from the `if (sim_paused)`
    // branch in `ref/micropolis/src/sim/w_util.c`; the second resume is a no-op.
    expect(speedPatchCount).toBe(speedPatchCountAfterFirstPlay);
    expect(ackCount).toBe(4);
  });
});
