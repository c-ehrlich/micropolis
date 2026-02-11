import { describe, expect, it } from 'vitest';

import {
  type ClientEnvelope,
  type CoreHost,
  type CoreHostConnection,
  DEFAULT_CORE_VERSION,
  DEFAULT_LOCAL_CLIENT_ID,
  DEFAULT_LOCAL_ROOM_ID,
  DEFAULT_PROTOCOL_VERSION,
  type HostEnvelope,
  type HostPatchPayload,
  type HostSoundDeltaPayload,
} from './protocol.ts';
import { createWebHostRuntime } from './runtime.ts';

/**
 * In-memory test host that captures outbound envelopes and emits host events.
 * Mirrors local deterministic command/update orchestration intent from
 * `ref/micropolis/src/sim/w_sim.c`, adapted for Playable Runtime runtime tests.
 */
class FakeLocalHost implements CoreHost {
  public readonly sent: ClientEnvelope[] = [];

  private onEnvelope: ((envelope: HostEnvelope) => void) | undefined;

  public connect(onEnvelope: (envelope: HostEnvelope) => void): CoreHostConnection {
    this.onEnvelope = onEnvelope;
    return {
      send: (envelope) => {
        this.sent.push(envelope);
      },
      disconnect: () => {
        this.onEnvelope = undefined;
      },
    };
  }

  public emit(envelope: HostEnvelope): void {
    if (this.onEnvelope === undefined) {
      throw new Error('host is not connected');
    }

    this.onEnvelope(envelope);
  }
}

describe('createWebHostRuntime', () => {
  it('sends mandatory hello on connect and transitions to ready on accepted hello', () => {
    const host = new FakeLocalHost();
    const runtime = createWebHostRuntime({ host });

    runtime.connect();

    expect(host.sent).toHaveLength(1);
    expect(host.sent[0]).toEqual({
      kind: 'hello',
      roomId: DEFAULT_LOCAL_ROOM_ID,
      clientId: DEFAULT_LOCAL_CLIENT_ID,
      protocolVersion: DEFAULT_PROTOCOL_VERSION,
      coreVersion: DEFAULT_CORE_VERSION,
    });
    expect(runtime.getState().phase).toBe('negotiating');

    host.emit({
      kind: 'hello',
      roomId: DEFAULT_LOCAL_ROOM_ID,
      clientId: DEFAULT_LOCAL_CLIENT_ID,
      protocolVersion: DEFAULT_PROTOCOL_VERSION,
      coreVersion: DEFAULT_CORE_VERSION,
      accepted: true,
    });

    expect(runtime.getState().phase).toBe('ready');
    expect(runtime.getState().handshakeComplete).toBe(true);
  });

  it('routes envelopes and requests snapshot when a sequence gap is detected', () => {
    const host = new FakeLocalHost();
    const runtime = createWebHostRuntime({ host });
    const outcomes: string[] = [];
    runtime.subscribe((event) => {
      const envelopeKind = event.envelope?.kind ?? 'none';
      outcomes.push(`${event.outcome}:${envelopeKind}`);
    });

    runtime.connect();
    host.emit({
      kind: 'hello',
      roomId: DEFAULT_LOCAL_ROOM_ID,
      clientId: DEFAULT_LOCAL_CLIENT_ID,
      protocolVersion: DEFAULT_PROTOCOL_VERSION,
      coreVersion: DEFAULT_CORE_VERSION,
      accepted: true,
    });
    host.emit({
      kind: 'patch',
      roomId: DEFAULT_LOCAL_ROOM_ID,
      clientId: DEFAULT_LOCAL_CLIENT_ID,
      tick: 4,
      serverSeq: 1,
      payload: { funds: 5000 },
    });
    host.emit({
      kind: 'patch',
      roomId: DEFAULT_LOCAL_ROOM_ID,
      clientId: DEFAULT_LOCAL_CLIENT_ID,
      tick: 4,
      // Sequence jump intentionally mirrors out-of-order/drop conditions that
      // must resync in Playable Runtime ordering rules mapped to `w_sim.c`/`w_update.c`.
      serverSeq: 3,
      payload: { funds: 5100 },
    });
    host.emit({
      kind: 'patch',
      roomId: DEFAULT_LOCAL_ROOM_ID,
      clientId: DEFAULT_LOCAL_CLIENT_ID,
      tick: 3,
      serverSeq: 1,
      payload: { stale: true },
    });

    expect(outcomes).toContain('applied:hello');
    expect(outcomes).toContain('applied:patch');
    expect(outcomes).toContain('gap-detected:patch');
    expect(outcomes).toContain('dropped-stale:patch');

    expect(host.sent).toContainEqual({
      kind: 'request_snapshot',
      roomId: DEFAULT_LOCAL_ROOM_ID,
      clientId: DEFAULT_LOCAL_CLIENT_ID,
      reason: 'sequence-gap',
      fromServerSeq: 2,
    });
  });

  it('keeps sound transport data on runtime events regardless of reducer outcome', () => {
    const host = new FakeLocalHost();
    const runtime = createWebHostRuntime({ host });
    const routed: Array<{
      outcome: string;
      kind: HostEnvelope['kind'];
      soundDeltas: readonly HostSoundDeltaPayload[] | null;
    }> = [];

    runtime.subscribe((event) => {
      if (event.envelope === undefined || event.envelope.kind === 'hello') {
        return;
      }
      routed.push({
        outcome: event.outcome,
        kind: event.envelope.kind,
        soundDeltas: event.envelope.soundDeltas ?? null,
      });
    });

    runtime.connect();
    host.emit({
      kind: 'hello',
      roomId: DEFAULT_LOCAL_ROOM_ID,
      clientId: DEFAULT_LOCAL_CLIENT_ID,
      protocolVersion: DEFAULT_PROTOCOL_VERSION,
      coreVersion: DEFAULT_CORE_VERSION,
      accepted: true,
    });

    host.emit({
      kind: 'snapshot',
      roomId: DEFAULT_LOCAL_ROOM_ID,
      clientId: DEFAULT_LOCAL_CLIENT_ID,
      tick: 1,
      serverSeq: 1,
      payload: {
        map: { width: 1, height: 1, tileWords: [5] },
      },
      soundDeltas: [{ channel: 'city', soundSpec: 'Siren' }],
    });
    host.emit({
      kind: 'patch',
      roomId: DEFAULT_LOCAL_ROOM_ID,
      clientId: DEFAULT_LOCAL_CLIENT_ID,
      tick: 2,
      serverSeq: 3,
      payload: {
        map: { tileWordDeltas: [{ x: 0, y: 0, tileWord: 6 }] },
      },
      soundDeltas: [{ channel: 'warning', soundSpec: 'Explosion High' }],
    });
    host.emit({
      kind: 'patch',
      roomId: DEFAULT_LOCAL_ROOM_ID,
      clientId: DEFAULT_LOCAL_CLIENT_ID,
      tick: 1,
      serverSeq: 1,
      payload: {
        map: { tileWordDeltas: [{ x: 0, y: 0, tileWord: 4 }] },
      },
      soundDeltas: [{ channel: 'edit', soundSpec: 'UhUh' }],
    });

    expect(routed).toEqual([
      {
        outcome: 'applied',
        kind: 'snapshot',
        soundDeltas: [{ channel: 'city', soundSpec: 'Siren' }],
      },
      {
        outcome: 'gap-detected',
        kind: 'patch',
        soundDeltas: [{ channel: 'warning', soundSpec: 'Explosion High' }],
      },
      {
        outcome: 'dropped-stale',
        kind: 'patch',
        soundDeltas: [{ channel: 'edit', soundSpec: 'UhUh' }],
      },
    ]);
  });

  it('creates pending visuals on sendCommand and settles them on ack/reject', () => {
    const host = new FakeLocalHost();
    const runtime = createWebHostRuntime({ host });
    runtime.connect();
    host.emit({
      kind: 'hello',
      roomId: DEFAULT_LOCAL_ROOM_ID,
      clientId: DEFAULT_LOCAL_CLIENT_ID,
      protocolVersion: DEFAULT_PROTOCOL_VERSION,
      coreVersion: DEFAULT_CORE_VERSION,
      accepted: true,
    });

    runtime.sendCommand('cmd-road', {
      kind: 'tool',
      tool: 'road',
      x: 8,
      y: 8,
    });

    expect(runtime.getState().pendingTools.map((pending) => pending.commandId)).toEqual([
      'cmd-road',
    ]);
    host.emit({
      kind: 'ack',
      roomId: DEFAULT_LOCAL_ROOM_ID,
      clientId: DEFAULT_LOCAL_CLIENT_ID,
      tick: 1,
      serverSeq: 1,
      commandId: 'cmd-road',
    });
    expect(runtime.getState().pendingTools).toHaveLength(0);

    runtime.sendCommand('cmd-reject', {
      kind: 'tool',
      tool: 'res',
      x: 0,
      y: 0,
    });
    expect(runtime.getState().pendingTools).toHaveLength(1);

    host.emit({
      kind: 'reject',
      roomId: DEFAULT_LOCAL_ROOM_ID,
      clientId: DEFAULT_LOCAL_CLIENT_ID,
      tick: 2,
      serverSeq: 2,
      commandId: 'cmd-reject',
      reason: 'out-of-bounds',
    });
    expect(runtime.getState().pendingTools).toHaveLength(0);
    expect(runtime.getState().lastRejectReason).toBe('out-of-bounds');
  });

  it('reconnects by requesting a resync snapshot and then applies patch tail ordering', () => {
    const host = new FakeLocalHost();
    const runtime = createWebHostRuntime({ host });

    runtime.connect();
    host.emit({
      kind: 'hello',
      roomId: DEFAULT_LOCAL_ROOM_ID,
      clientId: DEFAULT_LOCAL_CLIENT_ID,
      protocolVersion: DEFAULT_PROTOCOL_VERSION,
      coreVersion: DEFAULT_CORE_VERSION,
      accepted: true,
    });
    host.emit({
      kind: 'snapshot',
      roomId: DEFAULT_LOCAL_ROOM_ID,
      clientId: DEFAULT_LOCAL_CLIENT_ID,
      tick: 1,
      serverSeq: 1,
      payload: {
        map: { width: 1, height: 1, tileWords: [5] },
      },
    });
    runtime.disconnect();

    runtime.connect();
    expect(runtime.getState().phase).toBe('reconnecting');

    host.emit({
      kind: 'hello',
      roomId: DEFAULT_LOCAL_ROOM_ID,
      clientId: DEFAULT_LOCAL_CLIENT_ID,
      protocolVersion: DEFAULT_PROTOCOL_VERSION,
      coreVersion: DEFAULT_CORE_VERSION,
      accepted: true,
    });
    expect(runtime.getState().phase).toBe('resyncing');
    expect(host.sent).toContainEqual({
      kind: 'request_snapshot',
      roomId: DEFAULT_LOCAL_ROOM_ID,
      clientId: DEFAULT_LOCAL_CLIENT_ID,
      reason: 'resync',
      fromServerSeq: 2,
    });

    host.emit({
      kind: 'snapshot',
      roomId: DEFAULT_LOCAL_ROOM_ID,
      clientId: DEFAULT_LOCAL_CLIENT_ID,
      tick: 4,
      // Reconnect snapshot can jump to latest authority sequence.
      serverSeq: 8,
      payload: {
        map: { width: 1, height: 1, tileWords: [9] },
      },
    });
    host.emit({
      kind: 'patch',
      roomId: DEFAULT_LOCAL_ROOM_ID,
      clientId: DEFAULT_LOCAL_CLIENT_ID,
      tick: 5,
      serverSeq: 9,
      payload: {
        map: { tileWordDeltas: [{ x: 0, y: 0, tileWord: 11 }] },
      },
    });
    host.emit({
      kind: 'patch',
      roomId: DEFAULT_LOCAL_ROOM_ID,
      clientId: DEFAULT_LOCAL_CLIENT_ID,
      tick: 5,
      serverSeq: 8,
      payload: {
        map: { tileWordDeltas: [{ x: 0, y: 0, tileWord: 13 }] },
      },
    });

    expect(runtime.getState().phase).toBe('ready');
    expect(runtime.getState().lastAppliedServerSeq).toBe(9);
    expect(runtime.getState().mapState.tiles[0]).toBe(11);
  });

  it('treats a serverSeq=0 snapshot as applied ordering state for reconnect resync', () => {
    const host = new FakeLocalHost();
    const runtime = createWebHostRuntime({ host });

    runtime.connect();
    host.emit({
      kind: 'hello',
      roomId: DEFAULT_LOCAL_ROOM_ID,
      clientId: DEFAULT_LOCAL_CLIENT_ID,
      protocolVersion: DEFAULT_PROTOCOL_VERSION,
      coreVersion: DEFAULT_CORE_VERSION,
      accepted: true,
    });
    host.emit({
      kind: 'snapshot',
      roomId: DEFAULT_LOCAL_ROOM_ID,
      clientId: DEFAULT_LOCAL_CLIENT_ID,
      // Baseline at seq 0 is valid for first applied replay state.
      tick: 0,
      serverSeq: 0,
      payload: {
        map: { width: 1, height: 1, tileWords: [5] },
      },
    });
    runtime.disconnect();

    runtime.connect();
    expect(runtime.getState().phase).toBe('reconnecting');

    host.emit({
      kind: 'hello',
      roomId: DEFAULT_LOCAL_ROOM_ID,
      clientId: DEFAULT_LOCAL_CLIENT_ID,
      protocolVersion: DEFAULT_PROTOCOL_VERSION,
      coreVersion: DEFAULT_CORE_VERSION,
      accepted: true,
    });

    expect(runtime.getState().phase).toBe('resyncing');
    expect(host.sent).toContainEqual({
      kind: 'request_snapshot',
      roomId: DEFAULT_LOCAL_ROOM_ID,
      clientId: DEFAULT_LOCAL_CLIENT_ID,
      reason: 'resync',
      fromServerSeq: 1,
    });
  });

  it('clears pending visuals and requests snapshot when server emits resync directive', () => {
    const host = new FakeLocalHost();
    const runtime = createWebHostRuntime({ host });
    const outcomes: string[] = [];
    runtime.subscribe((event) => {
      if (event.envelope !== undefined) {
        outcomes.push(`${event.outcome}:${event.envelope.kind}`);
      }
    });

    runtime.connect();
    host.emit({
      kind: 'hello',
      roomId: DEFAULT_LOCAL_ROOM_ID,
      clientId: DEFAULT_LOCAL_CLIENT_ID,
      protocolVersion: DEFAULT_PROTOCOL_VERSION,
      coreVersion: DEFAULT_CORE_VERSION,
      accepted: true,
    });

    runtime.sendCommand('cmd-pending', {
      kind: 'tool',
      tool: 'road',
      x: 7,
      y: 7,
    });
    expect(runtime.getState().pendingTools).toHaveLength(1);

    host.emit({
      kind: 'resync',
      roomId: DEFAULT_LOCAL_ROOM_ID,
      clientId: DEFAULT_LOCAL_CLIENT_ID,
      tick: 1,
      serverSeq: 2,
      reason: 'server-gap',
    });
    expect(runtime.getState().phase).toBe('resyncing');
    expect(runtime.getState().pendingTools).toHaveLength(0);
    expect(host.sent).toContainEqual({
      kind: 'request_snapshot',
      roomId: DEFAULT_LOCAL_ROOM_ID,
      clientId: DEFAULT_LOCAL_CLIENT_ID,
      reason: 'resync',
      fromServerSeq: 3,
    });

    host.emit({
      kind: 'snapshot',
      roomId: DEFAULT_LOCAL_ROOM_ID,
      clientId: DEFAULT_LOCAL_CLIENT_ID,
      tick: 3,
      serverSeq: 10,
      payload: {
        map: { width: 1, height: 1, tileWords: [21] },
      },
    });
    host.emit({
      kind: 'patch',
      roomId: DEFAULT_LOCAL_ROOM_ID,
      clientId: DEFAULT_LOCAL_CLIENT_ID,
      tick: 4,
      serverSeq: 11,
      payload: {
        map: { tileWordDeltas: [{ x: 0, y: 0, tileWord: 22 }] },
      },
    });
    host.emit({
      kind: 'patch',
      roomId: DEFAULT_LOCAL_ROOM_ID,
      clientId: DEFAULT_LOCAL_CLIENT_ID,
      tick: 4,
      serverSeq: 10,
      payload: {
        map: { tileWordDeltas: [{ x: 0, y: 0, tileWord: 23 }] },
      },
    });

    expect(runtime.getState().phase).toBe('ready');
    expect(runtime.getState().lastAppliedServerSeq).toBe(11);
    expect(runtime.getState().mapState.tiles[0]).toBe(22);
    expect(outcomes).toContain('applied:resync');
    expect(outcomes).toContain('dropped-stale:patch');
  });

  it('projects HUD state from snapshot/patch host events', () => {
    const host = new FakeLocalHost();
    const runtime = createWebHostRuntime({ host });
    runtime.connect();
    host.emit({
      kind: 'hello',
      roomId: DEFAULT_LOCAL_ROOM_ID,
      clientId: DEFAULT_LOCAL_CLIENT_ID,
      protocolVersion: DEFAULT_PROTOCOL_VERSION,
      coreVersion: DEFAULT_CORE_VERSION,
      accepted: true,
    });

    host.emit({
      kind: 'snapshot',
      roomId: DEFAULT_LOCAL_ROOM_ID,
      clientId: DEFAULT_LOCAL_CLIENT_ID,
      tick: 1,
      serverSeq: 1,
      payload: {
        map: {
          width: 1,
          height: 1,
          tileWords: [0],
        },
        hud: {
          funds: 19_850,
          fundsLabel: 'Funds: $19,850',
          date: { label: 'Mar 1900', month: 2, year: 1900 },
          demand: { r: 4, c: -2, i: 1 },
          speed: 3,
          options: {
            autoBudget: true,
            autoGo: true,
            autoBulldoze: true,
            disasters: true,
            userSoundOn: true,
            doAnimation: true,
            doMessages: true,
            doNotices: true,
          },
        },
        messages: [{ id: 14, text: 'Residents demand police stations.' }],
      },
    });

    host.emit({
      kind: 'patch',
      roomId: DEFAULT_LOCAL_ROOM_ID,
      clientId: DEFAULT_LOCAL_CLIENT_ID,
      tick: 2,
      serverSeq: 2,
      payload: {
        hud: {
          speed: 0,
          options: {
            optionAutoGo: false,
          },
        },
        messageDeltas: [
          {
            // C `SendMes`/`SendMesAt` ids are integer message indexes.
            id: 16,
            text: 'Taxes are too high.',
          },
        ],
      } as unknown as HostPatchPayload,
    });

    expect(runtime.getState().hudState.fundsLabel).toBe('Funds: $19,850');
    expect(runtime.getState().hudState.dateLabel).toBe('Mar 1900');
    expect(runtime.getState().hudState.demandR).toBe(4);
    expect(runtime.getState().hudState.demandC).toBe(-2);
    expect(runtime.getState().hudState.demandI).toBe(1);
    expect(runtime.getState().hudState.speed).toBe(0);
    expect(runtime.getState().hudState.options.autoGo).toBe(false);
    expect(runtime.getState().hudState.messages.map((message) => message.id)).toEqual([14, 16]);
  });

  it('routes sim-control commands through host without creating pending tool overlays', () => {
    const host = new FakeLocalHost();
    const runtime = createWebHostRuntime({ host });
    runtime.connect();
    host.emit({
      kind: 'hello',
      roomId: DEFAULT_LOCAL_ROOM_ID,
      clientId: DEFAULT_LOCAL_CLIENT_ID,
      protocolVersion: DEFAULT_PROTOCOL_VERSION,
      coreVersion: DEFAULT_CORE_VERSION,
      accepted: true,
    });

    runtime.sendCommand('cmd-pause', {
      kind: 'sim-control',
      control: 'pause',
    });
    runtime.sendCommand('cmd-speed', {
      kind: 'sim-control',
      control: 'set-speed',
      // `setSpeed` in `w_util.c` accepts integer speed values in the playable 1..3 range.
      speed: 2,
    });

    expect(runtime.getState().pendingTools).toHaveLength(0);
    expect(host.sent).toContainEqual({
      kind: 'command',
      roomId: DEFAULT_LOCAL_ROOM_ID,
      clientId: DEFAULT_LOCAL_CLIENT_ID,
      commandId: 'cmd-pause',
      command: {
        kind: 'sim-control',
        control: 'pause',
      },
    });
    expect(host.sent).toContainEqual({
      kind: 'command',
      roomId: DEFAULT_LOCAL_ROOM_ID,
      clientId: DEFAULT_LOCAL_CLIENT_ID,
      commandId: 'cmd-speed',
      command: {
        kind: 'sim-control',
        control: 'set-speed',
        speed: 2,
      },
    });
  });
});
