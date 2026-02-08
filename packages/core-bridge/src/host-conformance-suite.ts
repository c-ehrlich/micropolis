import { describe, expect, it } from 'vitest';

import type { CoreHost, CoreHostResult } from './core-host.ts';
import type {
  BridgeEnvelopeIdentity,
  ClientCommandEnvelope,
  ClientHelloEnvelope,
  ClientRequestSnapshotEnvelope,
  CoreHostEnvelope,
  HostHelloEnvelope,
  HostPatchEnvelope,
  HostResyncEnvelope,
} from './types.ts';

const WAIT_TIMEOUT_MS = 1000;
const WAIT_INTERVAL_MS = 5;

/**
 * Host construction options consumed by the reusable conformance suite.
 * Mirrors snapshot baseline cadence concerns from
 * `ref/micropolis/src/sim/s_sim.c` simulation progression and reconnect
 * checkpoint behavior proxied through `ref/micropolis/src/sim/w_net.c`.
 * Parity note: this typed hook is intentionally test-harness-level and does
 * not imply a 1:1 C runtime constructor shape.
 */
export interface HostConformanceCreateOptions {
  snapshotCadenceTicks?: number;
}

/**
 * Adapter contract for running the shared `CoreHost` conformance suite.
 * Mirrors common command/network lifecycle expectations from
 * `ref/micropolis/src/sim/w_sim.c` and `ref/micropolis/src/sim/w_net.c`.
 * Parity note: adapter factories are intentionally different from C globals so
 * multiple host implementations (LocalHost/DoHost) can share one suite.
 */
export interface HostConformanceSuiteAdapter {
  suiteName: string;
  identity: BridgeEnvelopeIdentity;
  protocolVersion: string;
  coreVersion: string;
  createHost(options?: HostConformanceCreateOptions): CoreHost;
}

/**
 * Define reusable `CoreHost` behavior tests for any host adapter.
 * Mirrors deterministic authority/lifecycle expectations drawn from
 * `ref/micropolis/src/sim/s_sim.c` (ordered simulation steps) and
 * `ref/micropolis/src/sim/w_net.c` (ordered message delivery loops).
 * Parity note: this suite enforces bridge contract invariants, not C ABI/API.
 */
export function defineCoreHostConformanceSuite(adapter: HostConformanceSuiteAdapter): void {
  describe(`${adapter.suiteName} CoreHost conformance`, () => {
    it('enforces strict hello handshake before command processing', async () => {
      const host = adapter.createHost();
      const events = subscribeEvents(host);

      await invoke(host.connect());
      await invoke(
        host.hello(
          makeHello(adapter, {
            protocolVersion: `${adapter.protocolVersion}-mismatch`,
          }),
        ),
      );
      await invoke(host.sendCommand(makeCommand('cmd-handshake-blocked', 1)));

      await waitForCondition(
        () =>
          hasHelloResponse(events) &&
          events.some(
            (event) =>
              event.kind === 'error' &&
              event.commandId === 'cmd-handshake-blocked' &&
              event.code === 'host/handshake-required',
          ),
        'hello refusal and post-refusal handshake error',
      );

      const helloEvent = events.find((event): event is HostHelloEnvelope => event.kind === 'hello');
      expect(helloEvent).toBeDefined();
      expect(helloEvent?.accepted).toBe(false);
      expect(helloEvent?.roomId).toBe(adapter.identity.roomId);
      expect(helloEvent?.clientId).toBe(adapter.identity.clientId);

      const commandOutcome = events.find(
        (event) =>
          (event.kind === 'ack' || event.kind === 'reject') &&
          event.commandId === 'cmd-handshake-blocked',
      );
      expect(commandOutcome).toBeUndefined();

      await invoke(host.disconnect());
    });

    it('keeps outbound sequencing deterministic (strict serverSeq, non-decreasing tick)', async () => {
      const host = adapter.createHost();
      const events = subscribeEvents(host);

      await connectAndHello(host, events, adapter);
      await invoke(host.sendCommand(makeCommand('cmd-order-accept-a', 1)));
      await invoke(host.sendCommand(makeCommand('cmd-order-reject', -2)));
      await invoke(host.sendCommand(makeCommand('cmd-order-accept-b', 1)));

      await waitForCondition(
        () =>
          countEvents(events, 'ack') >= 2 &&
          countEvents(events, 'reject') >= 1 &&
          countEvents(events, 'patch') >= 2,
        'ack/reject/patch sequence after mixed command outcomes',
      );

      const sequencedEvents = events.filter(isSequencedEvent);
      assertStrictlyIncreasing(sequencedEvents.map((event) => event.serverSeq));
      assertNonDecreasing(sequencedEvents.map((event) => event.tick));

      const firstAckIndex = events.findIndex(
        (event) => event.kind === 'ack' && event.commandId === 'cmd-order-accept-a',
      );
      const firstPatchIndex = events.findIndex((event) => event.kind === 'patch');
      expect(firstAckIndex).toBeGreaterThanOrEqual(0);
      expect(firstPatchIndex).toBeGreaterThanOrEqual(0);
      expect(firstAckIndex).toBeLessThan(firstPatchIndex);

      await invoke(host.disconnect());
    });

    it('enforces commandId idempotency (duplicate ack/reject without reapply patch)', async () => {
      const host = adapter.createHost();
      const events = subscribeEvents(host);

      await connectAndHello(host, events, adapter);

      await invoke(host.sendCommand(makeCommand('cmd-idempotent-accept', 1)));
      await waitForCondition(
        () =>
          countCommandEvents(events, 'ack', 'cmd-idempotent-accept') >= 1 &&
          countEvents(events, 'patch') >= 1,
        'initial applied command ack+patch',
      );

      const patchCountAfterFirstAccept = countEvents(events, 'patch');
      await invoke(host.sendCommand(makeCommand('cmd-idempotent-accept', 1)));
      await waitForCondition(
        () => countCommandEvents(events, 'ack', 'cmd-idempotent-accept') >= 2,
        'duplicate applied command ack replay',
      );
      expect(countEvents(events, 'patch')).toBe(patchCountAfterFirstAccept);

      await invoke(host.sendCommand(makeCommand('cmd-idempotent-reject', -1)));
      await waitForCondition(
        () => countCommandEvents(events, 'reject', 'cmd-idempotent-reject') >= 1,
        'initial rejected command outcome',
      );

      const patchCountAfterFirstReject = countEvents(events, 'patch');
      await invoke(host.sendCommand(makeCommand('cmd-idempotent-reject', -1)));
      await waitForCondition(
        () => countCommandEvents(events, 'reject', 'cmd-idempotent-reject') >= 2,
        'duplicate rejected command replay',
      );
      expect(countEvents(events, 'patch')).toBe(patchCountAfterFirstReject);

      await invoke(host.disconnect());
    });

    it('supports snapshot bootstrap, patch-tail replay, and deterministic resync for gap/ahead cursors', async () => {
      const host = adapter.createHost({
        snapshotCadenceTicks: 2,
      });
      const events = subscribeEvents(host);

      await connectAndHello(host, events, adapter);
      await invoke(host.sendCommand(makeCommand('cmd-snapshot-a', 1)));
      await invoke(host.sendCommand(makeCommand('cmd-snapshot-b', 1)));
      await invoke(host.sendCommand(makeCommand('cmd-snapshot-c', 1)));

      await waitForCondition(
        () => countEvents(events, 'patch') >= 3,
        'three applied command patches',
      );

      const patchEvents = events.filter(
        (event): event is HostPatchEnvelope => event.kind === 'patch',
      );
      const firstPatchServerSeq = patchEvents[0]?.serverSeq;
      const latestPatchServerSeq = patchEvents[patchEvents.length - 1]?.serverSeq;
      expect(firstPatchServerSeq).toBeDefined();
      expect(latestPatchServerSeq).toBeDefined();
      if (firstPatchServerSeq === undefined || latestPatchServerSeq === undefined) {
        throw new Error('expected patch server sequence values to be recorded');
      }

      await invoke(host.requestSnapshot(makeSnapshotRequest(adapter)));
      await waitForCondition(
        () => countEvents(events, 'snapshot') >= 1,
        'snapshot bootstrap event',
      );

      const patchCountBeforeReplayRequest = countEvents(events, 'patch');
      await invoke(
        host.requestSnapshot(
          makeSnapshotRequest(adapter, {
            afterServerSeq: latestPatchServerSeq - 1,
          }),
        ),
      );
      await waitForCondition(
        () => countEvents(events, 'patch') > patchCountBeforeReplayRequest,
        'patch-tail replay event',
      );

      const replayedPatchEvents = events
        .filter((event): event is HostPatchEnvelope => event.kind === 'patch')
        .slice(patchCountBeforeReplayRequest);
      expect(replayedPatchEvents.length).toBeGreaterThan(0);
      assertStrictlyIncreasing(replayedPatchEvents.map((event) => event.serverSeq));

      const resyncCountBeforeGap = countEvents(events, 'resync');
      await invoke(
        host.requestSnapshot(
          makeSnapshotRequest(adapter, {
            afterServerSeq: firstPatchServerSeq - 1,
          }),
        ),
      );
      await waitForCondition(
        () => countEvents(events, 'resync') > resyncCountBeforeGap,
        'gap-triggered resync event',
      );
      const gapResync = latestResyncEvent(events);
      expect(gapResync?.reason.length).toBeGreaterThan(0);

      const latestKnownServerSeq = maxServerSeq(events);
      const resyncCountBeforeAhead = countEvents(events, 'resync');
      await invoke(
        host.requestSnapshot(
          makeSnapshotRequest(adapter, {
            afterServerSeq: latestKnownServerSeq + 1000,
          }),
        ),
      );
      await waitForCondition(
        () => countEvents(events, 'resync') > resyncCountBeforeAhead,
        'ahead-triggered resync event',
      );
      const aheadResync = latestResyncEvent(events);
      expect(aheadResync?.reason.length).toBeGreaterThan(0);
      expect(aheadResync?.reason).not.toBe(gapResync?.reason);

      await invoke(host.disconnect());
    });
  });
}

const makeHello = (
  adapter: HostConformanceSuiteAdapter,
  overrides: Partial<ClientHelloEnvelope> = {},
): ClientHelloEnvelope => ({
  kind: 'hello',
  roomId: adapter.identity.roomId,
  clientId: adapter.identity.clientId,
  protocolVersion: adapter.protocolVersion,
  coreVersion: adapter.coreVersion,
  ...overrides,
});

const makeCommand = (
  commandId: string,
  toolResultCode: number,
  overrides: Partial<ClientCommandEnvelope> = {},
): ClientCommandEnvelope => ({
  kind: 'command',
  roomId: 'client-room-placeholder',
  clientId: 'client-id-placeholder',
  commandId,
  command: {
    type: 'tool.place',
    payload: {
      // Micropolis tool return codes in `ref/micropolis/src/sim/w_tool.c`:
      //  1 => success, -1 => reject/out-of-bounds class, -2 => no-funds class.
      mockToolResultCode: toolResultCode,
    },
  },
  ...overrides,
});

const makeSnapshotRequest = (
  adapter: HostConformanceSuiteAdapter,
  overrides: Partial<ClientRequestSnapshotEnvelope> = {},
): ClientRequestSnapshotEnvelope => ({
  kind: 'request_snapshot',
  roomId: adapter.identity.roomId,
  clientId: adapter.identity.clientId,
  ...overrides,
});

const subscribeEvents = (host: CoreHost): CoreHostEnvelope[] => {
  const events: CoreHostEnvelope[] = [];
  host.subscribe((event) => {
    events.push(event);
  });
  return events;
};

const connectAndHello = async (
  host: CoreHost,
  events: CoreHostEnvelope[],
  adapter: HostConformanceSuiteAdapter,
): Promise<void> => {
  await invoke(host.connect());
  await invoke(host.hello(makeHello(adapter)));

  await waitForCondition(
    () => events.some((event) => event.kind === 'hello' && event.accepted),
    'accepted hello response',
  );
};

const invoke = async (result: CoreHostResult): Promise<void> => {
  await result;
};

const waitForCondition = async (condition: () => boolean, description: string): Promise<void> => {
  const startedAt = Date.now();
  while (!condition()) {
    if (Date.now() - startedAt > WAIT_TIMEOUT_MS) {
      throw new Error(`timed out waiting for ${description}`);
    }
    await sleep(WAIT_INTERVAL_MS);
  }
};

const sleep = async (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const hasHelloResponse = (events: ReadonlyArray<CoreHostEnvelope>): boolean =>
  events.some((event) => event.kind === 'hello');

const isSequencedEvent = (
  event: CoreHostEnvelope,
): event is Exclude<CoreHostEnvelope, HostHelloEnvelope> => event.kind !== 'hello';

const countEvents = <Kind extends CoreHostEnvelope['kind']>(
  events: ReadonlyArray<CoreHostEnvelope>,
  kind: Kind,
): number => events.filter((event) => event.kind === kind).length;

const countCommandEvents = (
  events: ReadonlyArray<CoreHostEnvelope>,
  kind: 'ack' | 'reject',
  commandId: string,
): number => events.filter((event) => event.kind === kind && event.commandId === commandId).length;

const latestResyncEvent = (
  events: ReadonlyArray<CoreHostEnvelope>,
): HostResyncEnvelope | undefined => {
  const resyncEvents = events.filter(
    (event): event is HostResyncEnvelope => event.kind === 'resync',
  );
  return resyncEvents[resyncEvents.length - 1];
};

const maxServerSeq = (events: ReadonlyArray<CoreHostEnvelope>): number =>
  events.filter(isSequencedEvent).reduce((max, event) => Math.max(max, event.serverSeq), 0);

const assertStrictlyIncreasing = (values: ReadonlyArray<number>): void => {
  values.forEach((value, index) => {
    const previous = values[index - 1];
    if (previous === undefined) {
      return;
    }
    expect(value).toBeGreaterThan(previous);
  });
  expect(values.length).toBeGreaterThan(0);
};

const assertNonDecreasing = (values: ReadonlyArray<number>): void => {
  values.forEach((value, index) => {
    const previous = values[index - 1];
    if (previous === undefined) {
      return;
    }
    expect(value).toBeGreaterThanOrEqual(previous);
  });
  expect(values.length).toBeGreaterThan(0);
};
