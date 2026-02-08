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

interface ScriptedHostOptions {
  readonly mode: HostMode;
  readonly onConnect?: (host: ScriptedHost) => void;
  readonly onRequestSnapshot?: (
    host: ScriptedHost,
    lastAppliedServerSeq: number | undefined,
  ) => void;
}

/**
 * Deterministic scripted host used for Stage 4 ordering/resync runtime tests.
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
 * Mirrors Stage 4 `tick + serverSeq` ordering invariants from
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
