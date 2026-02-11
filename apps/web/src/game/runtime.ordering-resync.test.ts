import { describe, expect, test } from 'vitest';

import type {
  CoreHost,
  CoreHostCommand,
  CoreHostEvent,
  CoreHostEventListener,
  CoreHostPatchEvent,
  CoreHostSnapshotEvent,
  HostMode,
} from './core-host';
import { createHelloPayload } from './handshake';
import { createGameRuntime } from './runtime';
import {
  type ClientEnvelope as PlayableClientEnvelope,
  type CoreHost as PlayableCoreHost,
  type CoreHostConnection as PlayableCoreHostConnection,
  DEFAULT_CORE_VERSION as DEFAULT_CORE_VERSION,
  DEFAULT_LOCAL_CLIENT_ID as DEFAULT_LOCAL_CLIENT_ID,
  DEFAULT_LOCAL_ROOM_ID as DEFAULT_LOCAL_ROOM_ID,
  DEFAULT_PROTOCOL_VERSION as DEFAULT_PROTOCOL_VERSION,
  type HostEnvelope as PlayableHostEnvelope,
  type HostSoundDeltaPayload,
} from './runtime/protocol.ts';
import { createWebHostRuntime, type WebRuntimeState } from './runtime/runtime.ts';

interface ScriptedHostOptions {
  readonly mode: HostMode;
  readonly onConnect?: (host: ScriptedHost) => void;
  readonly onRequestSnapshot?: (
    host: ScriptedHost,
    lastAppliedServerSeq: number | undefined,
  ) => void;
}

/**
 * Deterministic scripted host used for Authoritative Runtime ordering/resync runtime tests.
 * Mirrors bridge black-box sequencing/recovery coverage mapped from
 * `ref/micropolis/spec/integration/SPEC.md`.
 * Parity note: this is a TypeScript-only test double, not a 1:1 Micropolis runtime.
 */
class ScriptedHost implements CoreHost {
  public readonly mode: HostMode;
  public readonly requestSnapshotCalls: Array<number | undefined> = [];
  private readonly listeners = new Set<CoreHostEventListener>();

  public constructor(private readonly options: ScriptedHostOptions) {
    this.mode = options.mode;
  }

  public connect(): void {
    this.emit({ type: 'connected', mode: this.mode });
    this.emit({
      type: 'hello',
      mode: this.mode,
      payload: createHelloPayload({
        roomId: `${this.mode}-room`,
        clientId: `${this.mode}-client`,
      }),
    });
    this.options.onConnect?.(this);
  }

  public disconnect(): void {
    this.emit({ type: 'disconnected', mode: this.mode });
  }

  public sendCommand(_command: CoreHostCommand): void {}

  public requestSnapshot(lastAppliedServerSeq?: number): void {
    this.requestSnapshotCalls.push(lastAppliedServerSeq);
    this.options.onRequestSnapshot?.(this, lastAppliedServerSeq);
  }

  public subscribe(listener: CoreHostEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public pushEvents(events: ReadonlyArray<CoreHostEvent>): void {
    for (const event of events) {
      this.emit(event);
    }
  }

  private emit(event: CoreHostEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

/**
 * Build one synthetic patch envelope for runtime ordering tests.
 * Mirrors Authoritative Runtime `tick + serverSeq` ordering invariants from
 * `ref/micropolis/spec/integration/SPEC.md`.
 * Parity note: numeric `serverSeq`/`tick` fixtures are bridge test vectors.
 */
function patchEvent(
  mode: HostMode,
  commandId: string,
  serverSeq: number,
  tick: number,
  tool: CoreHostPatchEvent['placements'][number]['tool'],
  x: number,
  y: number,
): CoreHostPatchEvent {
  return {
    type: 'patch',
    mode,
    commandId,
    serverSeq,
    tick,
    placements: [{ tool, x, y }],
  };
}

/**
 * Build one synthetic snapshot envelope for runtime resync/reconnect tests.
 * Mirrors snapshot baseline semantics from `ref/micropolis/spec/integration/SPEC.md`.
 * Parity note: synthetic placements intentionally model bridge-level recoverable state.
 */
function snapshotEvent(
  mode: HostMode,
  tick: number,
  baseServerSeq: number,
  placements: CoreHostSnapshotEvent['placements'],
): CoreHostSnapshotEvent {
  return {
    type: 'snapshot',
    mode,
    tick,
    baseServerSeq,
    placements,
  };
}

interface ScriptedPlayableHostOptions {
  readonly onClientEnvelope?: (
    host: ScriptedPlayableHost,
    envelope: PlayableClientEnvelope,
  ) => void;
}

/**
 * Deterministic Playable Runtime host script harness for runtime ordering/resync tests.
 * Mirrors ordered host/client envelope exchange requirements in
 * `ref/micropolis/spec/integration/SPEC.md`.
 * Parity note: this is a TypeScript test adapter and not a 1:1 Micropolis
 * socket/event loop implementation from `ref/micropolis/src/sim/w_sim.c`.
 */
class ScriptedPlayableHost implements PlayableCoreHost {
  public readonly sent: PlayableClientEnvelope[] = [];
  private onEnvelope: ((envelope: PlayableHostEnvelope) => void) | undefined;

  public constructor(private readonly options: ScriptedPlayableHostOptions = {}) {}

  public connect(onEnvelope: (envelope: PlayableHostEnvelope) => void): PlayableCoreHostConnection {
    this.onEnvelope = onEnvelope;
    return {
      send: (envelope) => {
        this.sent.push(envelope);
        this.options.onClientEnvelope?.(this, envelope);
      },
      disconnect: () => {
        this.onEnvelope = undefined;
      },
    };
  }

  public emit(envelope: PlayableHostEnvelope): void {
    if (this.onEnvelope === undefined) {
      throw new Error('ScriptedPlayableHost.emit called before connect()');
    }

    this.onEnvelope(envelope);
  }
}

/**
 * Build a deterministic accepted Playable Runtime hello envelope for ordering tests.
 * Mirrors startup hello gating in `ref/micropolis/src/sim/w_sim.c`.
 */
function createAcceptedPlayableHelloEnvelope(): PlayableHostEnvelope {
  return {
    kind: 'hello',
    roomId: DEFAULT_LOCAL_ROOM_ID,
    clientId: DEFAULT_LOCAL_CLIENT_ID,
    protocolVersion: DEFAULT_PROTOCOL_VERSION,
    coreVersion: DEFAULT_CORE_VERSION,
    accepted: true,
  };
}

describe('runtime ordering/resync/reconnect invariants', () => {
  test.each(['local', 'do'] as const)(
    'applies same-tick events by serverSeq via snapshot replay in %s mode',
    (mode) => {
      const host = new ScriptedHost({
        mode,
        onConnect(scriptHost) {
          scriptHost.pushEvents([patchEvent(mode, 'cmd-b', 2, 7, 'wire', 2, 2)]);
        },
        onRequestSnapshot(scriptHost, lastAppliedServerSeq) {
          expect(lastAppliedServerSeq).toBe(0);
          scriptHost.pushEvents([
            snapshotEvent(mode, 0, 0, []),
            patchEvent(mode, 'cmd-a', 1, 7, 'road', 1, 1),
            patchEvent(mode, 'cmd-b', 2, 7, 'wire', 2, 2),
          ]);
        },
      });
      const runtime = createGameRuntime(host);

      runtime.start();

      const state = runtime.getState();
      expect(host.requestSnapshotCalls).toEqual([0]);
      expect(state.lastAppliedServerSeq).toBe(2);
      expect(state.lastAppliedTick).toBe(7);
      expect(state.committedPlacements).toEqual([
        { commandId: 'cmd-a', tool: 'road', x: 1, y: 1 },
        { commandId: 'cmd-b', tool: 'wire', x: 2, y: 2 },
      ]);
      expect(state.commandLifecycleLog).toEqual([
        'resync-request:gap:expected=1:received=2',
        'snapshot:0@0',
        'patch:cmd-a:road@1,1',
        'patch:cmd-b:wire@2,2',
      ]);
    },
  );

  test.each(['local', 'do'] as const)(
    'drops stale sequenced events without mutating authoritative state in %s mode',
    (mode) => {
      const host = new ScriptedHost({
        mode,
        onConnect(scriptHost) {
          scriptHost.pushEvents([
            patchEvent(mode, 'cmd-a', 1, 5, 'road', 3, 3),
            patchEvent(mode, 'cmd-b', 2, 5, 'rail', 4, 4),
            patchEvent(mode, 'cmd-stale', 1, 5, 'wire', 8, 8),
          ]);
        },
      });
      const runtime = createGameRuntime(host);

      runtime.start();

      const state = runtime.getState();
      expect(host.requestSnapshotCalls).toEqual([]);
      expect(state.committedPlacements).toEqual([
        { commandId: 'cmd-a', tool: 'road', x: 3, y: 3 },
        { commandId: 'cmd-b', tool: 'rail', x: 4, y: 4 },
      ]);
      expect(state.commandLifecycleLog).toEqual([
        'patch:cmd-a:road@3,3',
        'patch:cmd-b:rail@4,4',
        'stale-drop:patch:1@5',
      ]);
    },
  );

  test.each(['local', 'do'] as const)(
    'requests resync on serverSeq gaps and recovers from snapshot + tail in %s mode',
    (mode) => {
      const host = new ScriptedHost({
        mode,
        onConnect(scriptHost) {
          scriptHost.pushEvents([
            patchEvent(mode, 'cmd-a', 1, 9, 'road', 10, 10),
            patchEvent(mode, 'cmd-c', 3, 9, 'wire', 12, 12),
          ]);
        },
        onRequestSnapshot(scriptHost, lastAppliedServerSeq) {
          expect(lastAppliedServerSeq).toBe(1);
          scriptHost.pushEvents([
            snapshotEvent(mode, 9, 1, [{ commandId: 'cmd-a', tool: 'road', x: 10, y: 10 }]),
            patchEvent(mode, 'cmd-b', 2, 9, 'rail', 11, 11),
            patchEvent(mode, 'cmd-c', 3, 9, 'wire', 12, 12),
          ]);
        },
      });
      const runtime = createGameRuntime(host);

      runtime.start();

      const state = runtime.getState();
      expect(host.requestSnapshotCalls).toEqual([1]);
      expect(state.lastAppliedServerSeq).toBe(3);
      expect(state.lastAppliedTick).toBe(9);
      expect(state.committedPlacements).toEqual([
        { commandId: 'cmd-a', tool: 'road', x: 10, y: 10 },
        { commandId: 'cmd-b', tool: 'rail', x: 11, y: 11 },
        { commandId: 'cmd-c', tool: 'wire', x: 12, y: 12 },
      ]);
      expect(state.commandLifecycleLog).toEqual([
        'patch:cmd-a:road@10,10',
        'resync-request:gap:expected=2:received=3',
        'snapshot:1@9',
        'patch:cmd-b:rail@11,11',
        'patch:cmd-c:wire@12,12',
      ]);
    },
  );

  test.each(['local', 'do'] as const)(
    'requests resync on tick regression and replays snapshot + ordered tail in %s mode',
    (mode) => {
      const host = new ScriptedHost({
        mode,
        onConnect(scriptHost) {
          scriptHost.pushEvents([
            patchEvent(mode, 'cmd-a', 1, 15, 'road', 14, 14),
            patchEvent(mode, 'cmd-b', 2, 14, 'rail', 15, 15),
          ]);
        },
        onRequestSnapshot(scriptHost, lastAppliedServerSeq) {
          expect(lastAppliedServerSeq).toBe(1);
          scriptHost.pushEvents([
            snapshotEvent(mode, 15, 1, [{ commandId: 'cmd-a', tool: 'road', x: 14, y: 14 }]),
            patchEvent(mode, 'cmd-b', 2, 15, 'rail', 15, 15),
          ]);
        },
      });
      const runtime = createGameRuntime(host);

      runtime.start();

      const state = runtime.getState();
      expect(host.requestSnapshotCalls).toEqual([1]);
      expect(state.lastAppliedServerSeq).toBe(2);
      expect(state.lastAppliedTick).toBe(15);
      expect(state.committedPlacements).toEqual([
        { commandId: 'cmd-a', tool: 'road', x: 14, y: 14 },
        { commandId: 'cmd-b', tool: 'rail', x: 15, y: 15 },
      ]);
      expect(state.commandLifecycleLog).toEqual([
        'patch:cmd-a:road@14,14',
        'resync-request:tick-regression:last=15:received=14',
        'snapshot:1@15',
        'patch:cmd-b:rail@15,15',
      ]);
    },
  );

  test.each(['local', 'do'] as const)(
    'rebuilds reconnect state from snapshot baseline plus patch tail in %s mode',
    (mode) => {
      let connectCount = 0;
      const host = new ScriptedHost({
        mode,
        onConnect(scriptHost) {
          connectCount += 1;
          if (connectCount === 1) {
            scriptHost.pushEvents([
              patchEvent(mode, 'cmd-a', 1, 12, 'road', 20, 20),
              patchEvent(mode, 'cmd-b', 2, 12, 'wire', 21, 21),
            ]);
            return;
          }

          scriptHost.pushEvents([
            snapshotEvent(mode, 12, 1, [{ commandId: 'cmd-a', tool: 'road', x: 20, y: 20 }]),
            patchEvent(mode, 'cmd-b', 2, 12, 'wire', 21, 21),
          ]);
        },
      });
      const runtime = createGameRuntime(host);

      runtime.start();
      host.disconnect();
      host.connect();

      const state = runtime.getState();
      expect(state.committedPlacements).toEqual([
        { commandId: 'cmd-a', tool: 'road', x: 20, y: 20 },
        { commandId: 'cmd-b', tool: 'wire', x: 21, y: 21 },
      ]);
      expect(state.commandLifecycleLog).toEqual([
        'patch:cmd-a:road@20,20',
        'patch:cmd-b:wire@21,21',
        'snapshot:1@12',
        'patch:cmd-b:wire@21,21',
      ]);
    },
  );
});

describe('playable ordering/resync with expanded payload projection', () => {
  test('recovers map/hud/messages/realtime from sequence-gap resync snapshots plus ordered patch tail', () => {
    const sentSnapshotRequests: PlayableClientEnvelope[] = [];
    const replaySnapshotSoundDeltas: readonly HostSoundDeltaPayload[] = [
      {
        channel: 'city',
        soundSpec: 'Siren',
        scope: { kind: 'view', target: '.playMap' },
      },
    ];
    const replayTailSoundDeltas: readonly HostSoundDeltaPayload[] = [
      {
        channel: 'warning',
        soundSpec: 'Explosion High',
        scope: { kind: 'global' },
      },
    ];
    const host = new ScriptedPlayableHost({
      onClientEnvelope(scriptHost, envelope) {
        if (envelope.kind !== 'request_snapshot' || envelope.reason !== 'sequence-gap') {
          return;
        }

        sentSnapshotRequests.push(envelope);
        expect(envelope.roomId).toBe(DEFAULT_LOCAL_ROOM_ID);
        expect(envelope.clientId).toBe(DEFAULT_LOCAL_CLIENT_ID);
        expect(envelope.fromServerSeq).toBe(3);

        scriptHost.emit({
          kind: 'snapshot',
          roomId: DEFAULT_LOCAL_ROOM_ID,
          clientId: DEFAULT_LOCAL_CLIENT_ID,
          // C simulation tick progression is monotonic (`CityTime` in `s_sim.c`),
          // so resync replay checkpoints and tails preserve non-decreasing ticks.
          tick: 102,
          serverSeq: 4,
          payload: {
            map: { width: 2, height: 1, tileWords: [7, 10] },
            hud: {
              funds: 18_500,
              date: { month: 1, year: 1900 },
              demand: { r: 1, c: 0, i: -1 },
              speed: 2,
              options: {
                autoBudget: true,
                autoGo: false,
                autoBulldoze: true,
                disasters: true,
                userSoundOn: true,
                doAnimation: true,
                doMessages: false,
                doNotices: true,
              },
            },
            messages: [
              { id: 14, text: 'Residents demand police stations.', tick: 100, serverSeq: 1 },
              { id: 16, text: 'Taxes are too high.', tick: 101, serverSeq: 2 },
              { id: 18, text: 'Power demand is increasing.', tick: 102, serverSeq: 4 },
            ],
            realtime: {
              objects: [{ name: 'TRA', type: 1, x: 96, y: 112, frame: 4 }],
            },
          },
          soundDeltas: replaySnapshotSoundDeltas,
        });
        scriptHost.emit({
          kind: 'patch',
          roomId: DEFAULT_LOCAL_ROOM_ID,
          clientId: DEFAULT_LOCAL_CLIENT_ID,
          tick: 103,
          serverSeq: 5,
          payload: {
            map: { tileWordDeltas: [{ x: 1, y: 0, tileWord: 12 }] },
            hud: { speed: 3 },
            messageDeltas: [{ id: 19, text: 'Traffic congestion reported.' }],
            realtime: {
              objects: [{ name: 'TRA', type: 1, x: 112, y: 128, frame: 5 }],
            },
          },
          soundDeltas: replayTailSoundDeltas,
        });
      },
    });
    const runtime = createWebHostRuntime({ host });
    const sequencedEvents: Array<{
      outcome: string;
      kind: PlayableHostEnvelope['kind'];
      serverSeq: number;
      soundDeltas: readonly HostSoundDeltaPayload[] | null;
      state: WebRuntimeState;
    }> = [];
    runtime.subscribe((event) => {
      if (event.envelope === undefined || event.envelope.kind === 'hello') {
        return;
      }

      sequencedEvents.push({
        outcome: event.outcome,
        kind: event.envelope.kind,
        serverSeq: event.envelope.serverSeq,
        soundDeltas: event.envelope.soundDeltas ?? null,
        state: event.state,
      });
    });

    runtime.connect();
    host.emit(createAcceptedPlayableHelloEnvelope());
    host.emit({
      kind: 'snapshot',
      roomId: DEFAULT_LOCAL_ROOM_ID,
      clientId: DEFAULT_LOCAL_CLIENT_ID,
      tick: 100,
      serverSeq: 1,
      payload: {
        map: { width: 2, height: 1, tileWords: [5, 6] },
        hud: {
          funds: 20_000,
          date: { month: 0, year: 1900 },
          demand: { r: 0, c: 0, i: 0 },
          speed: 1,
        },
        messages: [{ id: 14, text: 'Residents demand police stations.' }],
        realtime: {
          objects: [{ name: 'TRA', type: 1, x: 64, y: 80, frame: 1 }],
        },
      },
    });
    host.emit({
      kind: 'patch',
      roomId: DEFAULT_LOCAL_ROOM_ID,
      clientId: DEFAULT_LOCAL_CLIENT_ID,
      tick: 101,
      serverSeq: 2,
      payload: {
        map: { tileWordDeltas: [{ x: 1, y: 0, tileWord: 8 }] },
        hud: { speed: 2 },
        messageDeltas: [{ id: 16, text: 'Taxes are too high.' }],
        realtime: {
          objects: [{ name: 'TRA', type: 1, x: 80, y: 96, frame: 2 }],
        },
      },
    });
    host.emit({
      kind: 'patch',
      roomId: DEFAULT_LOCAL_ROOM_ID,
      clientId: DEFAULT_LOCAL_CLIENT_ID,
      tick: 102,
      // Intentional serverSeq gap (expected seq=3) must trigger snapshot recovery.
      serverSeq: 4,
      payload: {
        map: { tileWordDeltas: [{ x: 0, y: 0, tileWord: 99 }] },
        hud: { speed: 3 },
        messageDeltas: [{ id: 18, text: 'Power demand is increasing.' }],
        realtime: {
          objects: [{ name: 'TRA', type: 1, x: 96, y: 112, frame: 3 }],
        },
      },
    });

    const gapEvent = sequencedEvents.find(
      (entry) => entry.outcome === 'gap-detected' && entry.kind === 'patch',
    );
    expect(gapEvent).toBeDefined();
    expect(Array.from(gapEvent?.state.mapState.tiles ?? [])).toEqual([5, 8]);
    expect(gapEvent?.state.hudState.speed).toBe(2);
    expect(gapEvent?.state.hudState.messages.map((message) => message.id)).toEqual([14, 16]);
    expect(gapEvent?.state.realtimeState.objects).toEqual([
      { name: 'TRA', type: 1, x: 80, y: 96, frame: 2 },
    ]);
    expect(gapEvent?.state.phase).toBe('resyncing');

    const state = runtime.getState();
    expect(state.phase).toBe('ready');
    expect(state.lastAppliedServerSeq).toBe(5);
    expect(state.lastAppliedTick).toBe(103);
    expect(Array.from(state.mapState.tiles)).toEqual([7, 12]);
    expect(state.hudState.fundsLabel).toBe('Funds: $18,500');
    expect(state.hudState.speed).toBe(3);
    expect(state.hudState.options).toEqual({
      autoBudget: true,
      autoGo: false,
      autoBulldoze: true,
      disasters: true,
      userSoundOn: true,
      doAnimation: true,
      doMessages: false,
      doNotices: true,
    });
    expect(state.hudState.messages).toEqual([
      {
        id: 14,
        text: 'Residents demand police stations.',
        dispatch: 'sendMes',
        x: null,
        y: null,
        tick: 100,
        serverSeq: 1,
      },
      {
        id: 16,
        text: 'Taxes are too high.',
        dispatch: 'sendMes',
        x: null,
        y: null,
        tick: 101,
        serverSeq: 2,
      },
      {
        id: 18,
        text: 'Power demand is increasing.',
        dispatch: 'sendMes',
        x: null,
        y: null,
        tick: 102,
        serverSeq: 4,
      },
      {
        id: 19,
        text: 'Traffic congestion reported.',
        dispatch: 'sendMes',
        x: null,
        y: null,
        tick: 103,
        serverSeq: 5,
      },
    ]);
    expect(state.realtimeState.objects).toEqual([
      { name: 'TRA', type: 1, x: 112, y: 128, frame: 5 },
    ]);
    expect(sentSnapshotRequests).toEqual([
      {
        kind: 'request_snapshot',
        roomId: DEFAULT_LOCAL_ROOM_ID,
        clientId: DEFAULT_LOCAL_CLIENT_ID,
        reason: 'sequence-gap',
        fromServerSeq: 3,
      },
    ]);
    expect(host.sent.map((envelope) => envelope.kind)).toEqual(['hello', 'request_snapshot']);

    const replaySnapshotEvent = sequencedEvents.find(
      (entry) => entry.outcome === 'applied' && entry.kind === 'snapshot' && entry.serverSeq === 4,
    );
    expect(replaySnapshotEvent?.soundDeltas).toEqual(replaySnapshotSoundDeltas);

    const replayTailPatchEvent = sequencedEvents.find(
      (entry) => entry.outcome === 'applied' && entry.kind === 'patch' && entry.serverSeq === 5,
    );
    expect(replayTailPatchEvent?.soundDeltas).toEqual(replayTailSoundDeltas);
  });
});
