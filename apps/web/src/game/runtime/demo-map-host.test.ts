import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import {
  ANI_TILE,
  createClassicMapStore,
  createRng,
  createSimContext,
  createSimState,
  resetForNewCityFromSeed,
  Tile,
  TileFlag,
  TileMask,
  World,
} from '../../../../../packages/sim-core/src/index.ts';
import { decodeCityFileForMap } from '../../../../../packages/sim-core/src/io/cty.ts';
import { sendMes, sendMesAt } from '../../../../../packages/sim-core/src/systems/messages.ts';
import {
  getScenarioDefinition,
  SCENARIO_TABLE,
} from '../../../../../packages/sim-io/src/scenarios.ts';
import { DemoMapHost, readDemoCityExportPayload } from './demo-map-host.ts';
import { createWebHostRuntime } from './runtime.ts';

const SCENARIO_222_FIXTURE_URL = new URL(
  '../../../../../ref/micropolis/res/snro.222',
  import.meta.url,
);

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

  it('advances ANIMBIT tiles only when DoAnimation is enabled', () => {
    vi.useFakeTimers();
    const host = new DemoMapHost({ enableAmbientTicks: true, patchIntervalMs: 10 });
    const runtime = createWebHostRuntime({ host });

    try {
      runtime.connect();

      const authority = host as unknown as {
        simState: { doAnimation: boolean };
        simContext: { store: ReturnType<typeof createClassicMapStore> };
      };

      const tileX = 10;
      const tileY = 10;
      const tileIndex = tileX * World.WORLD_Y + tileY;
      authority.simContext.store.beginTick();
      try {
        authority.simContext.store.write('map', tileIndex, Tile.FIRE | TileFlag.ANIMBIT);
      } finally {
        authority.simContext.store.commitTick();
      }

      authority.simState.doAnimation = false;
      vi.advanceTimersByTime(20);

      const mapAfterDisabled = authority.simContext.store.snapshot('map') as Uint16Array;
      const disabledTileWord = mapAfterDisabled[tileIndex];
      if (disabledTileWord === undefined) {
        throw new Error('expected disabled animation tile to exist');
      }
      // `DoUpdateEditor` only calls `animateTiles()` when `DoAnimation && SimSpeed`
      // (`ref/micropolis/src/sim/w_editor.c`), so this must stay at FIRE.
      expect(disabledTileWord & TileMask.LOMASK).toBe(Tile.FIRE);

      authority.simState.doAnimation = true;
      vi.advanceTimersByTime(10);

      const mapAfterEnabled = authority.simContext.store.snapshot('map') as Uint16Array;
      const enabledTileWord = mapAfterEnabled[tileIndex];
      if (enabledTileWord === undefined) {
        throw new Error('expected enabled animation tile to exist');
      }
      // `g_ani.c` rewrites animated tiles via `aniTile[id]`, preserving high bits.
      expect(enabledTileWord & TileMask.LOMASK).toBe(ANI_TILE[Tile.FIRE]);
    } finally {
      runtime.disconnect();
      vi.useRealTimers();
    }
  });

  it('seeds a moving realtime copter while ambient simulation runs', () => {
    vi.useFakeTimers();
    const host = new DemoMapHost({ enableAmbientTicks: true, patchIntervalMs: 10 });
    const runtime = createWebHostRuntime({ host });
    const copterSnapshots: Array<{ x: number; y: number; frame: number }> = [];

    try {
      runtime.subscribe((event) => {
        if (event.envelope?.kind !== 'patch') {
          return;
        }
        const objects = event.envelope.payload.realtime?.objects;
        if (objects === undefined) {
          return;
        }
        const copter = objects.find((object) => object.type === 2);
        if (copter !== undefined) {
          copterSnapshots.push({ x: copter.x, y: copter.y, frame: copter.frame ?? 0 });
        }
      });

      runtime.connect();

      // Type `2` is copter (`COP`) from `sim.h`/`w_sprite.c`; Stage 7 host seeding
      // now primes snapshot payloads so overlay entities appear immediately when
      // the simulation is running.
      expect(runtime.getState().realtimeState.objects.some((object) => object.type === 2)).toBe(
        true,
      );

      vi.advanceTimersByTime(140);

      expect(copterSnapshots.length).toBeGreaterThan(1);
      // `DoCopterSprite` mutates x/y/frame in `w_sprite.c`; payload snapshots must
      // reflect multiple distinct movement frames while the sim runs.
      expect(
        new Set(copterSnapshots.map((snapshot) => `${snapshot.x}:${snapshot.y}:${snapshot.frame}`))
          .size,
      ).toBeGreaterThan(1);
      expect(runtime.getState().realtimeState.objects.some((object) => object.type === 2)).toBe(
        true,
      );
    } finally {
      runtime.disconnect();
      vi.useRealTimers();
    }
  });

  it('seeds realtime overlays on resume/set-speed patches before ambient ticks', () => {
    const host = new DemoMapHost({ enableAmbientTicks: false });
    const runtime = createWebHostRuntime({ host });
    runtime.connect();

    runtime.sendCommand('stage7-seed-pause-1', {
      kind: 'sim-control',
      control: 'pause',
    });

    const authority = host as unknown as {
      realtimeContext: {
        globalSprites: Array<{ frame: number } | null>;
      };
    };
    const copterSprite = authority.realtimeContext.globalSprites[2];
    if (copterSprite == null) {
      throw new Error('expected active copter sprite after snapshot seeding');
    }
    copterSprite.frame = 0;

    runtime.sendCommand('stage7-seed-play-1', {
      kind: 'sim-control',
      control: 'play',
    });

    // Magic-number source: type `2` is copter (`COP`) from `sim.h`/`w_sprite.c`.
    expect(runtime.getState().realtimeState.objects.some((object) => object.type === 2)).toBe(true);
    // Magic-number source: `Resume()` restores the remembered playable speed in
    // `ref/micropolis/src/sim/w_util.c` (`setSpeed(sim_paused_speed)` branch).
    expect(runtime.getState().hudState.speed).toBe(3);
  });

  it('emits realtime object payload updates on ambient ticks', () => {
    vi.useFakeTimers();
    const host = new DemoMapHost({ enableAmbientTicks: true, patchIntervalMs: 10 });
    const runtime = createWebHostRuntime({ host });
    const tornadoSnapshots: Array<{ x: number; y: number; frame: number }> = [];
    let sawRealtimeSnapshot = false;
    let sawRealtimeDelta = false;

    try {
      runtime.subscribe((event) => {
        if (event.envelope?.kind === 'snapshot') {
          if (event.envelope.payload.realtime?.snapshot !== undefined) {
            sawRealtimeSnapshot = true;
          }
          return;
        }

        if (event.envelope?.kind !== 'patch') {
          return;
        }
        const objects = event.envelope.payload.realtime?.objects;
        if (objects === undefined) {
          return;
        }
        const tornado = objects.find((object) => object.type === 6);
        if (tornado !== undefined) {
          tornadoSnapshots.push({ x: tornado.x, y: tornado.y, frame: tornado.frame ?? 0 });
        }

        const deltas = event.envelope.payload.realtime?.deltas;
        if (deltas !== undefined && deltas.length > 0) {
          sawRealtimeDelta = true;
        }
      });

      runtime.connect();

      const authority = host as unknown as {
        simContext: {
          rng: { seed: (value: number) => void };
          hooks: { makeTornado: () => void };
        };
      };

      authority.simContext.rng.seed(0x1234);
      // Sprite type 6 is `TOR` in `sim.h`; creation path matches `makeTornado` in `w_sprite.c`.
      authority.simContext.hooks.makeTornado();
      vi.advanceTimersByTime(120);

      expect(tornadoSnapshots.length).toBeGreaterThan(1);
      // `MoveObjects` updates active tornado position/frame each cycle in `w_sprite.c`.
      expect(
        new Set(tornadoSnapshots.map((snapshot) => `${snapshot.x}:${snapshot.y}:${snapshot.frame}`))
          .size,
      ).toBeGreaterThan(1);
      expect(runtime.getState().realtimeState.objects.some((object) => object.type === 6)).toBe(
        true,
      );
      expect(sawRealtimeSnapshot).toBe(true);
      expect(sawRealtimeDelta).toBe(true);
    } finally {
      runtime.disconnect();
      vi.useRealTimers();
    }
  });

  it('routes repeated realtime tornado picture events into message feed deltas', () => {
    vi.useFakeTimers();
    const host = new DemoMapHost({ enableAmbientTicks: true, patchIntervalMs: 10 });
    const runtime = createWebHostRuntime({ host });
    const tornadoPictureMessages: Array<{
      id: number;
      x: number | undefined;
      y: number | undefined;
    }> = [];

    try {
      runtime.subscribe((event) => {
        if (event.envelope?.kind !== 'patch') {
          return;
        }
        const deltas = event.envelope.payload.messageDeltas;
        if (deltas === undefined) {
          return;
        }
        for (const message of deltas) {
          if (message.id === -22) {
            tornadoPictureMessages.push({ id: message.id, x: message.x, y: message.y });
          }
        }
      });

      runtime.connect();

      const authority = host as unknown as {
        simContext: {
          rng: { seed: (value: number) => void };
          hooks: { makeTornado: () => void };
        };
        realtimeContext: {
          globalSprites: Array<{ frame: number } | null>;
        };
      };

      authority.simContext.rng.seed(0x1234);
      authority.simContext.hooks.makeTornado();
      vi.advanceTimersByTime(30);

      const tornadoSprite = authority.realtimeContext.globalSprites[6];
      if (tornadoSprite == null) {
        throw new Error('expected active tornado sprite after initial makeTornado');
      }
      tornadoSprite.frame = 0;

      authority.simContext.hooks.makeTornado();
      vi.advanceTimersByTime(30);

      // w_sprite.c `MakeTornado` calls `ClearMes(); SendMesAt(-22, ...)`, so each
      // new tornado event should emit a fresh picture message to the feed.
      expect(tornadoPictureMessages.length).toBeGreaterThanOrEqual(2);
      expect(tornadoPictureMessages.every((message) => message.x !== undefined)).toBe(true);
      expect(tornadoPictureMessages.every((message) => message.y !== undefined)).toBe(true);
      expect(
        runtime
          .getState()
          .hudState.messages.filter(
            (message) => message.id === -22 && message.dispatch === 'sendMesAt',
          ).length,
      ).toBeGreaterThanOrEqual(2);
    } finally {
      runtime.disconnect();
      vi.useRealTimers();
    }
  });

  it('emits SendMesAt hook deliveries as coordinate message deltas', () => {
    vi.useFakeTimers();
    const host = new DemoMapHost({ enableAmbientTicks: true, patchIntervalMs: 10 });
    const runtime = createWebHostRuntime({ host });
    const coordinateMessages: Array<{ id: number; x: number | undefined; y: number | undefined }> =
      [];

    try {
      runtime.subscribe((event) => {
        if (event.envelope?.kind !== 'patch') {
          return;
        }
        const deltas = event.envelope.payload.messageDeltas;
        if (deltas === undefined) {
          return;
        }

        for (const message of deltas) {
          coordinateMessages.push({ id: message.id, x: message.x, y: message.y });
        }
      });

      runtime.connect();

      const authority = host as unknown as {
        simState: Parameters<typeof sendMesAt>[0];
        simContext: Parameters<typeof sendMesAt>[1];
      };
      // Message id 14 is one of the classic demand-warning ids from the
      // `doMessage`/resource table flow in `ref/micropolis/src/sim/s_msg.c`.
      expect(sendMesAt(authority.simState, authority.simContext, 14, 7, 9)).toBe(true);

      vi.advanceTimersByTime(20);

      expect(coordinateMessages).toContainEqual({ id: 14, x: 7, y: 9 });
      expect(runtime.getState().hudState.messages).toContainEqual(
        expect.objectContaining({
          id: 14,
          dispatch: 'sendMesAt',
          x: 7,
          y: 9,
        }),
      );
    } finally {
      runtime.disconnect();
      vi.useRealTimers();
    }
  });

  it('requeues picture messages as text deltas on the following heads tick', () => {
    vi.useFakeTimers();
    const host = new DemoMapHost({ enableAmbientTicks: true, patchIntervalMs: 10 });
    const runtime = createWebHostRuntime({ host });
    const messageIds: number[] = [];

    try {
      runtime.subscribe((event) => {
        if (event.envelope?.kind !== 'patch') {
          return;
        }
        const deltas = event.envelope.payload.messageDeltas;
        if (deltas === undefined) {
          return;
        }

        for (const message of deltas) {
          messageIds.push(message.id);
        }
      });

      runtime.connect();

      const authority = host as unknown as {
        simState: Parameters<typeof sendMes>[0];
        simContext: Parameters<typeof sendMes>[1];
      };
      // s_msg.c doMessage: picture ids dispatch first, then enqueue positive id
      // through `MessagePort = pictId` for next heads tick text delivery.
      expect(sendMes(authority.simState, authority.simContext, -10)).toBe(true);

      vi.advanceTimersByTime(30);

      expect(messageIds).toContain(-10);
      expect(messageIds).toContain(10);
      expect(messageIds.indexOf(-10)).toBeLessThan(messageIds.indexOf(10));
    } finally {
      runtime.disconnect();
      vi.useRealTimers();
    }
  });

  it('uses wall-clock TickCount timing for message expiry (~30 seconds)', () => {
    vi.useFakeTimers();
    const host = new DemoMapHost({ enableAmbientTicks: true, patchIntervalMs: 180 });
    const runtime = createWebHostRuntime({ host });
    let message12DispatchCount = 0;

    try {
      runtime.subscribe((event) => {
        if (event.envelope?.kind !== 'patch') {
          return;
        }
        const deltas = event.envelope.payload.messageDeltas;
        if (deltas === undefined) {
          return;
        }
        for (const message of deltas) {
          if (message.id === 12) {
            message12DispatchCount += 1;
          }
        }
      });
      runtime.connect();

      const authority = host as unknown as {
        simState: Parameters<typeof sendMes>[0];
        simContext: Parameters<typeof sendMes>[1];
      };
      // Keep ambient SendMessages() thresholds quiet so MesNum lifetime is driven by
      // the explicit test message only (s_msg.c SendMessages case gates).
      authority.simState.ResZPop = 1;
      authority.simState.ComZPop = 1;
      authority.simState.IndZPop = 1;
      authority.simState.TotalPop = 0;
      authority.simState.ResPop = 0;
      authority.simState.ComPop = 0;
      authority.simState.IndPop = 0;
      authority.simState.RoadTotal = 0;
      authority.simState.RailTotal = 0;
      authority.simState.CityTax = 7;
      authority.simState.CrimeAverage = 0;
      authority.simState.PolluteAverage = 0;
      authority.simState.TrafficAverage = 0;

      // s_msg.c doMessage: active text messages expire only when
      // `TickCount() - LastMesTime > (60 * 30)`.
      expect(sendMes(authority.simState, authority.simContext, 12)).toBe(true);

      vi.advanceTimersByTime(500);
      expect(authority.simState.MesNum).toBe(12);
      expect(message12DispatchCount).toBe(1);

      vi.advanceTimersByTime(29_000);
      expect(authority.simState.MesNum).toBe(12);

      vi.advanceTimersByTime(2_000);
      expect(authority.simState.MesNum).toBe(0);

      // After expiry, the same id can be enqueued and dispatched again.
      // This mirrors `doMessage` + `SetMessageField` behavior in
      // `ref/micropolis/src/sim/s_msg.c`, where expiry clears the active message.
      expect(sendMes(authority.simState, authority.simContext, 12)).toBe(true);
      vi.advanceTimersByTime(500);
      expect(message12DispatchCount).toBe(2);
    } finally {
      runtime.disconnect();
      vi.useRealTimers();
    }
  });

  it('round-trips save/export bytes through load/import in the web runtime', () => {
    const host = new DemoMapHost({ enableAmbientTicks: false });
    const runtime = createWebHostRuntime({
      host,
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
    const authority = host as unknown as {
      simState: {
        CityTime: number;
        TotalFunds: number;
        SimSpeed: number;
        SimMetaSpeed: number;
        CityTax: number;
        autoBulldoze: boolean;
        autoBudget: boolean;
        autoGo: boolean;
        userSoundOn: boolean;
      };
    };
    authority.simState.CityTime = 4321;
    authority.simState.CityTax = 11;
    authority.simState.autoBulldoze = false;
    authority.simState.autoBudget = false;
    authority.simState.autoGo = false;
    authority.simState.userSoundOn = false;
    authority.simState.SimSpeed = 1;
    authority.simState.SimMetaSpeed = 1;

    runtime.sendCommand('tool-1', {
      kind: 'tool',
      tool: 'road',
      x: 6,
      y: 6,
    });
    runtime.sendCommand('tool-2', {
      kind: 'tool',
      tool: 'wire',
      x: 10,
      y: 12,
    });

    const runtimeStateBeforeSave = runtime.getState();
    const changedTileIndex = 6 + 6 * runtimeStateBeforeSave.mapState.width;
    const savedMapTiles = Uint16Array.from(runtimeStateBeforeSave.mapState.tiles);
    const savedHud = {
      fundsLabel: runtimeStateBeforeSave.hudState.fundsLabel,
      dateLabel: runtimeStateBeforeSave.hudState.dateLabel,
      speed: runtimeStateBeforeSave.hudState.speed,
    };
    const savedScalars = {
      CityTime: authority.simState.CityTime,
      TotalFunds: authority.simState.TotalFunds,
      SimSpeed: authority.simState.SimSpeed,
      SimMetaSpeed: authority.simState.SimMetaSpeed,
      CityTax: authority.simState.CityTax,
      autoBulldoze: authority.simState.autoBulldoze,
      autoBudget: authority.simState.autoBudget,
      autoGo: authority.simState.autoGo,
      userSoundOn: authority.simState.userSoundOn,
    };

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
    expect(runtime.getState().mapState.tiles[changedTileIndex]).not.toBe(
      savedMapTiles[changedTileIndex],
    );

    runtime.sendCommand('load-1', {
      kind: 'city-io',
      action: 'load-city',
      fileName: 'runtime-roundtrip.cty',
      cityBytes: exportedCityBytes,
    });

    // `loadFile` calls `DoSimInit`, which may rewrite non-identity tile bits
    // after `_load_file`; compare `LOMASK` identities to mirror C parity.
    // Sources: `ref/micropolis/src/sim/s_fileio.c` and `ref/micropolis/src/sim/g_bigmap.c`.
    expect(Array.from(runtime.getState().mapState.tiles, (tile) => tile & TileMask.LOMASK)).toEqual(
      Array.from(savedMapTiles, (tile) => tile & TileMask.LOMASK),
    );
    expect(runtime.getState().hudState.fundsLabel).toBe(savedHud.fundsLabel);
    expect(runtime.getState().hudState.dateLabel).toBe(savedHud.dateLabel);
    expect(runtime.getState().hudState.speed).toBe(savedHud.speed);
    expect(authority.simState.CityTime).toBe(savedScalars.CityTime);
    expect(authority.simState.TotalFunds).toBe(savedScalars.TotalFunds);
    expect(authority.simState.SimSpeed).toBe(savedScalars.SimSpeed);
    expect(authority.simState.SimMetaSpeed).toBe(savedScalars.SimMetaSpeed);
    expect(authority.simState.CityTax).toBe(savedScalars.CityTax);
    expect(authority.simState.autoBulldoze).toBe(savedScalars.autoBulldoze);
    expect(authority.simState.autoBudget).toBe(savedScalars.autoBudget);
    expect(authority.simState.autoGo).toBe(savedScalars.autoGo);
    expect(authority.simState.userSoundOn).toBe(savedScalars.userSoundOn);
  });

  it('persists history buffers in save-city export bytes using C save packing', () => {
    const host = new DemoMapHost({ enableAmbientTicks: false });
    const runtime = createWebHostRuntime({ host });
    let exportedCityBytes: Uint8Array | null = null;

    runtime.subscribe((event) => {
      if (event.envelope?.kind !== 'patch') {
        return;
      }
      const savePayload = readDemoCityExportPayload(event.envelope.payload);
      if (savePayload !== null) {
        exportedCityBytes = savePayload.cityBytes;
      }
    });

    runtime.connect();

    const authority = host as unknown as {
      simState: {
        ResHis: Int16Array;
        MoneyHis: Int16Array;
      };
    };
    authority.simState.ResHis[5] = -1234;
    authority.simState.MoneyHis[11] = 2345;

    runtime.sendCommand('save-history-pack-1', {
      kind: 'city-io',
      action: 'save-city',
      fileName: 'history-pack.cty',
    });

    if (exportedCityBytes === null) {
      throw new Error('expected save-city export bytes');
    }

    const decoded = decodeCityFileForMap(exportedCityBytes, { width: 120, height: 100 });
    // `saveFile` writes all six history arrays with `_save_short(..., HISTLEN / 2, ...)`
    // in `ref/micropolis/src/sim/s_fileio.c`.
    expect(decoded.histories.res[5]).toBe(-1234);
    expect(decoded.histories.money[11]).toBe(2345);
  });

  it('applies C loadFile lifecycle init and history restore on load-city', () => {
    const host = new DemoMapHost({ enableAmbientTicks: false });
    const runtime = createWebHostRuntime({ host });
    let exportedCityBytes: Uint8Array | null = null;

    runtime.subscribe((event) => {
      if (event.envelope?.kind !== 'patch') {
        return;
      }
      const savePayload = readDemoCityExportPayload(event.envelope.payload);
      if (savePayload !== null) {
        exportedCityBytes = savePayload.cityBytes;
      }
    });

    runtime.connect();

    const authority = host as unknown as {
      simState: {
        ResHis: Int16Array;
        ScenarioID: number;
        Fcycle: number;
        Scycle: number;
        InitSimLoad: number;
        DoInitialEval: number;
      };
    };

    authority.simState.ResHis[9] = -2222;
    runtime.sendCommand('save-load-orchestration-1', {
      kind: 'city-io',
      action: 'save-city',
      fileName: 'load-orchestration.cty',
    });

    if (exportedCityBytes === null) {
      throw new Error('expected save-city export bytes');
    }

    authority.simState.ResHis[9] = 777;
    authority.simState.ScenarioID = 6;
    authority.simState.Fcycle = 41;
    authority.simState.Scycle = 17;
    authority.simState.InitSimLoad = 9;
    authority.simState.DoInitialEval = 0;

    runtime.sendCommand('load-load-orchestration-1', {
      kind: 'city-io',
      action: 'load-city',
      fileName: 'load-orchestration.cty',
      cityBytes: exportedCityBytes,
    });

    // Magic-number/source notes:
    // - `loadFile` copies all history arrays (`ResHis`, etc.) and clears
    //   `ScenarioID=0` in `ref/micropolis/src/sim/s_fileio.c`.
    // - `loadFile` then runs `DoSimInit`, which resets `Fcycle/Scycle` to `0`,
    //   consumes `InitSimLoad` back to `0`, and sets `DoInitialEval=1`
    //   in `ref/micropolis/src/sim/s_sim.c`.
    expect(authority.simState.ResHis[9]).toBe(-2222);
    expect(authority.simState.ScenarioID).toBe(0);
    expect(authority.simState.Fcycle).toBe(0);
    expect(authority.simState.Scycle).toBe(0);
    expect(authority.simState.InitSimLoad).toBe(0);
    expect(authority.simState.DoInitialEval).toBe(1);
  });

  it('runs InitWillStuff and DoSimInit lifecycle resets on new-city', () => {
    const host = new DemoMapHost({ enableAmbientTicks: false });
    const runtime = createWebHostRuntime({ host });
    runtime.connect();

    const authority = host as unknown as {
      simState: {
        ScenarioID: number;
        CityTime: number;
        CityScore: number;
        RoadEffect: number;
        Fcycle: number;
        Scycle: number;
        InitSimLoad: number;
        DoInitialEval: number;
        TotalPop: number;
      };
    };
    authority.simState.ScenarioID = 4;
    authority.simState.CityTime = 777;
    authority.simState.CityScore = 1;
    authority.simState.RoadEffect = 3;
    authority.simState.Fcycle = 99;
    authority.simState.Scycle = 88;
    authority.simState.InitSimLoad = 0;
    authority.simState.DoInitialEval = 0;
    authority.simState.TotalPop = 1234;

    runtime.sendCommand('new-city-lifecycle-1', {
      kind: 'city-lifecycle',
      action: 'new-city',
    });

    // Magic-number/source notes:
    // - `InitWillStuff` sets `CityScore=500` and `RoadEffect=32` in `s_init.c`.
    // - `DoSimInit` resets `Fcycle/Scycle` to 0, sets `TotalPop=1`, sets `DoInitialEval=1`,
    //   and consumes `InitSimLoad` via `InitSimMemory` in `s_sim.c`.
    expect(authority.simState.ScenarioID).toBe(0);
    expect(authority.simState.CityTime).toBe(0);
    expect(authority.simState.CityScore).toBe(500);
    expect(authority.simState.RoadEffect).toBe(32);
    expect(authority.simState.Fcycle).toBe(0);
    expect(authority.simState.Scycle).toBe(0);
    expect(authority.simState.InitSimLoad).toBe(0);
    expect(authority.simState.DoInitialEval).toBe(1);
    expect(authority.simState.TotalPop).toBe(1);
  });

  it('generates new-city terrain using GenerateMap defaults before lifecycle init', () => {
    const host = new DemoMapHost({ enableAmbientTicks: false });
    const runtime = createWebHostRuntime({ host });
    runtime.connect();

    const authority = host as unknown as {
      simContext: { rng: { seed: (value: number) => void; next16: () => number } };
    };

    // `GenerateNewCity` in `s_gen.c` calls `GenerateSomeCity(Rand16())`.
    const sourceSeed = 0x2468;
    authority.simContext.rng.seed(sourceSeed);
    const expectedTerrainSeed = createRng(sourceSeed).next16();

    const expectedStore = createClassicMapStore();
    const expectedState = createSimState();
    const expectedContext = createSimContext({
      store: expectedStore,
      rng: createRng(1),
    });
    resetForNewCityFromSeed(expectedState, expectedContext, {
      seed: expectedTerrainSeed,
      // `TreeLevel/LakeLevel/CurveLevel/CreateIsland` globals default to `-1` in `s_gen.c`.
      treeLevel: -1,
      lakeLevel: -1,
      curveLevel: -1,
      createIsland: -1,
      // Clock reseeds happen after map generation and do not affect resulting tiles.
      reseedAfter: false,
      initWillStuff: { seed: 1 },
    });

    const expectedMapLayer = expectedStore.snapshot('map');
    if (!(expectedMapLayer instanceof Uint16Array)) {
      throw new Error(
        `expected map layer to be Uint16Array; got ${expectedMapLayer.constructor.name}`,
      );
    }

    runtime.sendCommand('new-city-terrain-1', {
      kind: 'city-lifecycle',
      action: 'new-city',
    });

    expect(runtime.getState().mapState.tiles).toEqual(
      convertClassicXMajorToRuntimeRowMajor(expectedMapLayer, 120, 100),
    );
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

  it('boots scenarios from snro bytes with C LoadScenario metadata constants', async () => {
    const runtime = createWebHostRuntime({
      host: new DemoMapHost({ enableAmbientTicks: false }),
    });
    runtime.connect();

    const scenario222Bytes = new Uint8Array(readFileSync(SCENARIO_222_FIXTURE_URL));
    const decodedScenario222 = decodeCityFileForMap(scenario222Bytes, {
      width: 120,
      height: 100,
    });

    runtime.sendCommand('scenario-1', {
      kind: 'scenario',
      action: 'load-scenario',
      scenarioId: 1,
    });
    await waitForRuntimeState(
      () => runtime.getState().hudState.fundsLabel === 'Funds: $5,000',
      'scenario 1 funds update',
    );
    // Scenario 1 starts with 5000 funds in `LoadScenario` switch table
    // (`ref/micropolis/src/sim/s_fileio.c` case 1).
    expect(runtime.getState().hudState.fundsLabel).toBe('Funds: $5,000');

    runtime.sendCommand('scenario-2', {
      kind: 'scenario',
      action: 'load-scenario',
      scenarioId: 2,
    });
    await waitForRuntimeState(
      () =>
        runtime.getState().hudState.fundsLabel === 'Funds: $20,000' &&
        runtime.getState().hudState.dateLabel === 'Jan 1906',
      'scenario 2 metadata update',
    );

    // Scenario 2 starts with 20000 funds and year 1906 in `LoadScenario`
    // (`ref/micropolis/src/sim/s_fileio.c` case 2), and month remains Jan because
    // `CityTime=((1906-1900)*48)+2` => `month=(CityTime%48)>>2=0`.
    expect(runtime.getState().hudState.fundsLabel).toBe('Funds: $20,000');
    expect(runtime.getState().hudState.dateLabel).toBe('Jan 1906');
    expect(runtime.getState().hudState.speed).toBe(3);
    const expectedScenarioTiles = convertClassicXMajorToRuntimeRowMajor(
      decodedScenario222.map,
      120,
      100,
    );
    // `DoSimInit` can rewrite high-bit tile flags after `_load_file`; compare
    // masked tile identities (`LOMASK`) to assert the loaded `snro.*` map content.
    // Sources: `ref/micropolis/src/sim/s_fileio.c` and `ref/micropolis/src/sim/g_bigmap.c`.
    expect(Array.from(runtime.getState().mapState.tiles, (tile) => tile & TileMask.LOMASK)).toEqual(
      Array.from(expectedScenarioTiles, (tile) => tile & TileMask.LOMASK),
    );
  });

  it('starts every scenario with expected C year/funds/speed baselines', async () => {
    const runtime = createWebHostRuntime({
      host: new DemoMapHost({ enableAmbientTicks: false }),
    });
    runtime.connect();

    runtime.sendCommand('scenario-baseline-pause', {
      kind: 'sim-control',
      control: 'pause',
    });
    expect(runtime.getState().hudState.speed).toBe(0);

    for (const scenario of SCENARIO_TABLE) {
      runtime.sendCommand(`scenario-baseline-${scenario.id}`, {
        kind: 'scenario',
        action: 'load-scenario',
        scenarioId: scenario.id,
      });

      const expectedFundsLabel = formatScenarioFundsLabel(scenario.startFunds);
      await waitForRuntimeState(
        () =>
          runtime.getState().hudState.fundsLabel === expectedFundsLabel &&
          runtime.getState().hudState.dateYear === scenario.startYear &&
          runtime.getState().hudState.dateMonth === 0 &&
          runtime.getState().hudState.speed === 3,
        `scenario ${scenario.id} year/funds/speed baseline`,
      );

      // `LoadScenario` switch cases assign each start year/funds pair, then call
      // `setSpeed(3)`. `updateDate` derives January from
      // `CityTime = ((startYear - 1900) * 48) + 2` -> `(CityTime % 48) >> 2 == 0`.
      // Source: `ref/micropolis/src/sim/s_fileio.c` and `ref/micropolis/src/sim/w_update.c`.
      expect(runtime.getState().hudState.fundsLabel).toBe(expectedFundsLabel);
      expect(runtime.getState().hudState.dateYear).toBe(scenario.startYear);
      expect(runtime.getState().hudState.dateMonth).toBe(0);
      expect(runtime.getState().hudState.speed).toBe(3);
    }
  });

  it('clamps scenario ids before snro resource lookup', async () => {
    const requestedScenarioFiles: string[] = [];
    const runtime = createWebHostRuntime({
      host: new DemoMapHost({
        enableAmbientTicks: false,
        scenarioResourceLoader: (fileName) => {
          requestedScenarioFiles.push(fileName);
          return new Uint8Array(
            readFileSync(new URL(`../../../../../ref/micropolis/res/${fileName}`, import.meta.url)),
          );
        },
      }),
    });
    runtime.connect();

    runtime.sendCommand('scenario-clamp-99', {
      kind: 'scenario',
      action: 'load-scenario',
      scenarioId: 99,
    });
    await waitForRuntimeState(
      () =>
        runtime.getState().hudState.fundsLabel === 'Funds: $5,000' &&
        runtime.getState().hudState.dateLabel === 'Jan 1900',
      'scenario id clamp metadata update',
    );

    // Out-of-range ids clamp to scenario 1 in `LoadScenario`, which uses
    // `snro.111`, year 1900, and funds 5000 in `ref/micropolis/src/sim/s_fileio.c`.
    expect(requestedScenarioFiles).toEqual([getScenarioDefinition(99).fileName]);
    expect(runtime.getState().hudState.fundsLabel).toBe('Funds: $5,000');
    expect(runtime.getState().hudState.dateLabel).toBe('Jan 1900');
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

  it('visibly updates funds/date/demand/speed while simulation is running', () => {
    vi.useFakeTimers();
    const runtime = createWebHostRuntime({
      host: new DemoMapHost({ enableAmbientTicks: true, patchIntervalMs: 10 }),
    });

    try {
      runtime.connect();
      const initialHud = runtime.getState().hudState;
      const initialDate = initialHud.dateLabel;
      const initialDateMonth = initialHud.dateMonth;
      const initialDateYear = initialHud.dateYear;
      const initialDemand = initialHud.demandLabel;

      vi.advanceTimersByTime(50);

      const afterAmbientHud = runtime.getState().hudState;
      // `updateDate` in `w_update.c` updates month/year from CityTime using
      // `(CityTime % 48) >> 2` and `(CityTime / 48) + StartingYear`.
      expect(afterAmbientHud.dateLabel).not.toBe(initialDate);
      expect(
        afterAmbientHud.dateMonth !== initialDateMonth ||
          afterAmbientHud.dateYear !== initialDateYear,
      ).toBe(true);
      expect(afterAmbientHud.demandLabel).not.toBe(initialDemand);

      runtime.sendCommand('stage5-visible-funds-1', {
        kind: 'tool',
        tool: 'road',
        x: 8,
        y: 8,
      });
      // Road tool cost is 10 in `CostOf[]` (`w_tool.c`).
      expect(runtime.getState().hudState.fundsLabel).toBe('Funds: $19,990');

      runtime.sendCommand('stage5-visible-speed-pause-1', {
        kind: 'sim-control',
        control: 'pause',
      });
      // `setSpeed` displays 0 while paused (`sim_paused ? 0 : SimMetaSpeed`) in `w_util.c`.
      expect(runtime.getState().hudState.speed).toBe(0);

      runtime.sendCommand('stage5-visible-speed-play-1', {
        kind: 'sim-control',
        control: 'play',
      });
      // Play resumes the remembered playable speed in `Resume()`/`setSpeed` (`w_util.c`).
      expect(runtime.getState().hudState.speed).toBe(3);
    } finally {
      runtime.disconnect();
      vi.useRealTimers();
    }
  });
});

/**
 * Converts classic Micropolis x-major map tiles (`Map[x][y]`) into runtime row-major
 * order for direct comparison against `RuntimeMapState.tiles`.
 * Mirrors map storage/indexing in `ref/micropolis/src/sim/s_alloc.c` and `s_gen.c`.
 */
function convertClassicXMajorToRuntimeRowMajor(
  source: Uint16Array,
  width: number,
  height: number,
): Uint16Array {
  const rowMajor = new Uint16Array(width * height);
  for (let x = 0; x < width; x += 1) {
    const sourceColumnStart = x * height;
    for (let y = 0; y < height; y += 1) {
      rowMajor[y * width + x] = source[sourceColumnStart + y] ?? 0;
    }
  }
  return rowMajor;
}

function formatScenarioFundsLabel(funds: number): string {
  return `Funds: $${new Intl.NumberFormat('en-US').format(funds)}`;
}

async function waitForRuntimeState(
  predicate: () => boolean,
  label: string,
  timeoutMs = 2_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  }
  throw new Error(`timed out waiting for runtime state: ${label}`);
}
