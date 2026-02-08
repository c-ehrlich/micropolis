import { describe, expect, it } from 'vitest';

import { getHostCommandOutcome, isHostCommandOutcomeEnvelope } from './command-outcome.ts';
import {
  LOCAL_HOST_DEFAULT_CLIENT_ID,
  LOCAL_HOST_DEFAULT_CORE_VERSION,
  LOCAL_HOST_DEFAULT_PROTOCOL_VERSION,
  LOCAL_HOST_DEFAULT_ROOM_ID,
  LocalHost,
} from './local-host.ts';
import type { ClientCommandEnvelope, ClientHelloEnvelope, CoreHostEnvelope } from './types.ts';
import { HOST_REJECT_REASON } from './types.ts';

const makeHello = (overrides: Partial<ClientHelloEnvelope> = {}): ClientHelloEnvelope => ({
  kind: 'hello',
  roomId: LOCAL_HOST_DEFAULT_ROOM_ID,
  clientId: LOCAL_HOST_DEFAULT_CLIENT_ID,
  protocolVersion: LOCAL_HOST_DEFAULT_PROTOCOL_VERSION,
  coreVersion: LOCAL_HOST_DEFAULT_CORE_VERSION,
  ...overrides,
});

const makeCommand = (commandId: string, mockToolResultCode: number): ClientCommandEnvelope => ({
  kind: 'command',
  roomId: 'ignored-room',
  clientId: 'ignored-client',
  commandId,
  command: {
    type: 'tool.place',
    payload: {
      // Tool return parity comes from `DoTool` branches in
      // `ref/micropolis/src/sim/w_tool.c`:
      //  1 => success, -2 => no-funds rejection.
      mockToolResultCode,
    },
  },
});

const collectEvents = (host: LocalHost): CoreHostEnvelope[] => {
  const events: CoreHostEnvelope[] = [];
  host.subscribe((event) => {
    events.push(event);
  });
  return events;
};

describe('command outcome helpers', () => {
  it('correlates successful command lifecycle to ack settlement', () => {
    const host = new LocalHost();
    const events = collectEvents(host);

    host.connect();
    host.hello(makeHello());
    host.sendCommand(makeCommand('cmd-ok', 1));

    const outcomes = events.flatMap((event) => {
      const outcome = getHostCommandOutcome(event, 'cmd-ok');
      return outcome === undefined ? [] : [outcome];
    });

    expect(outcomes).toHaveLength(1);
    const ackOutcome = outcomes[0];
    if (ackOutcome === undefined) {
      throw new Error('expected ack outcome');
    }
    expect(ackOutcome).toMatchObject({
      status: 'acked',
      commandId: 'cmd-ok',
      rollbackPendingVisual: false,
    });
    expect(events.some((event) => event.kind === 'patch')).toBe(true);
  });

  it('correlates reject lifecycle to rollback signal without emitting host error', () => {
    const host = new LocalHost();
    const events = collectEvents(host);

    host.connect();
    host.hello(makeHello());
    host.sendCommand(makeCommand('cmd-reject', -2));

    const outcomes = events.flatMap((event) => {
      const outcome = getHostCommandOutcome(event, 'cmd-reject');
      return outcome === undefined ? [] : [outcome];
    });

    expect(outcomes).toHaveLength(1);
    const rejectOutcome = outcomes[0];
    if (rejectOutcome === undefined) {
      throw new Error('expected reject outcome');
    }
    expect(rejectOutcome).toMatchObject({
      status: 'rejected',
      commandId: 'cmd-reject',
      rollbackPendingVisual: true,
      rejectReason: HOST_REJECT_REASON.INSUFFICIENT_FUNDS,
    });
    expect(events.some((event) => event.kind === 'error' && event.commandId === 'cmd-reject')).toBe(
      false,
    );
  });

  it('keeps duplicate command outcomes idempotent with ack replay and no patch reapply', () => {
    const host = new LocalHost();
    const events = collectEvents(host);

    host.connect();
    host.hello(makeHello());
    host.sendCommand(makeCommand('cmd-dup', 1));
    host.sendCommand(makeCommand('cmd-dup', 1));

    const duplicateOutcomes = events.flatMap((event) => {
      const outcome = getHostCommandOutcome(event, 'cmd-dup');
      return outcome === undefined ? [] : [outcome];
    });
    const duplicatePatches = events.filter((event) => event.kind === 'patch');

    expect(duplicateOutcomes).toHaveLength(2);
    expect(duplicateOutcomes.every((outcome) => outcome.status === 'acked')).toBe(true);
    expect(duplicatePatches).toHaveLength(1);
  });

  it('exposes only ack/reject events as command outcomes', () => {
    const host = new LocalHost();
    const events = collectEvents(host);

    host.connect();
    host.hello(makeHello());
    host.sendCommand(makeCommand('cmd-outcome-guard', 1));

    const nonOutcomeKinds = events
      .filter((event) => !isHostCommandOutcomeEnvelope(event))
      .map((event) => event.kind);
    expect(nonOutcomeKinds).toEqual(['hello', 'patch']);
  });
});
