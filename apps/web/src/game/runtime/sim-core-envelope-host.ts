import { SimCoreRuntimeState } from '../sim-core-runtime-state.ts';
import type { PlayableRuntimeHostOptions } from './playable-runtime-host-options.ts';
import type {
  ClientEnvelope,
  CoreHost,
  CoreHostConnection,
  HostEnvelope,
  HostSnapshotPayload,
} from './protocol.ts';

/**
 * Sim-core-authoritative envelope host for the route `/` migration path.
 * Mirrors host-side command/update loop ownership from
 * `ref/micropolis/src/sim/w_sim.c` and `ref/micropolis/src/sim/w_update.c`.
 * Parity note: this phase establishes the deterministic envelope lifecycle and
 * authoritative snapshot surface; full command semantics are migrated in
 * subsequent checklist tasks. It also accepts `createPlayableRuntimeHost(...)`
 * compatibility options so route call sites/tests can migrate without option-surface churn.
 */
export class SimCoreEnvelopeHost implements CoreHost {
  private onEnvelope: ((envelope: HostEnvelope) => void) | undefined;
  private lifecycle:
    | {
        phase: 'disconnected';
      }
    | {
        phase: 'awaiting-hello';
        sessionId: number;
      }
    | {
        phase: 'ready';
        sessionId: number;
        roomId: string;
        clientId: string;
      } = { phase: 'disconnected' };
  private nextSessionId = 0;
  private readonly authorityState: SimCoreRuntimeState;
  private readonly mapWidth: number;
  private readonly mapHeight: number;
  private serverSeq = 0;
  private tick = 0;

  public constructor(_options: PlayableRuntimeHostOptions = {}) {
    this.authorityState = new SimCoreRuntimeState();
    const mapLayerInfo = this.authorityState.store.layerInfo('map');
    this.mapWidth = mapLayerInfo.width;
    this.mapHeight = mapLayerInfo.height;
  }

  public connect(onEnvelope: (envelope: HostEnvelope) => void): CoreHostConnection {
    const sessionId = this.beginSession(onEnvelope);

    return {
      send: (envelope) => {
        this.routeClientEnvelope(sessionId, envelope);
      },
      disconnect: () => {
        this.routeDisconnect(sessionId);
      },
    };
  }

  /**
   * Routes client envelopes through one deterministic host lifecycle.
   * Mirrors top-level command/update dispatch structure in
   * `ref/micropolis/src/sim/w_sim.c`.
   */
  private routeClientEnvelope(sessionId: number, envelope: ClientEnvelope): void {
    if (!this.isSessionActive(sessionId)) {
      return;
    }

    if (envelope.kind === 'hello') {
      this.handleHelloEnvelope(sessionId, envelope);
      return;
    }

    if (envelope.kind === 'request_snapshot') {
      this.handleSnapshotRequestEnvelope(sessionId, envelope);
      return;
    }

    this.handleCommandEnvelope(sessionId, envelope);
  }

  private beginSession(onEnvelope: (envelope: HostEnvelope) => void): number {
    this.nextSessionId += 1;
    const sessionId = this.nextSessionId;
    this.onEnvelope = onEnvelope;
    this.lifecycle = {
      phase: 'awaiting-hello',
      sessionId,
    };
    return sessionId;
  }

  private routeDisconnect(sessionId: number): void {
    if (!this.isSessionActive(sessionId)) {
      return;
    }

    this.onEnvelope = undefined;
    this.lifecycle = { phase: 'disconnected' };
  }

  private handleHelloEnvelope(
    sessionId: number,
    envelope: Extract<ClientEnvelope, { kind: 'hello' }>,
  ): void {
    if (!this.isSessionActive(sessionId) || this.onEnvelope === undefined) {
      return;
    }

    this.lifecycle = {
      phase: 'ready',
      sessionId,
      roomId: envelope.roomId,
      clientId: envelope.clientId,
    };
    this.onEnvelope({
      kind: 'hello',
      roomId: envelope.roomId,
      clientId: envelope.clientId,
      protocolVersion: envelope.protocolVersion,
      coreVersion: envelope.coreVersion,
      accepted: true,
    });
    this.emitSnapshot(envelope.roomId, envelope.clientId);
  }

  private handleSnapshotRequestEnvelope(
    sessionId: number,
    envelope: Extract<ClientEnvelope, { kind: 'request_snapshot' }>,
  ): void {
    if (!this.isReadySessionEnvelope(sessionId, envelope.roomId, envelope.clientId)) {
      return;
    }

    this.emitSnapshot(envelope.roomId, envelope.clientId);
  }

  private handleCommandEnvelope(
    sessionId: number,
    envelope: Extract<ClientEnvelope, { kind: 'command' }>,
  ): void {
    if (!this.isReadySessionEnvelope(sessionId, envelope.roomId, envelope.clientId)) {
      return;
    }

    if (this.onEnvelope === undefined) {
      return;
    }

    this.tick += 1;
    this.serverSeq += 1;
    this.onEnvelope({
      kind: 'reject',
      roomId: envelope.roomId,
      clientId: envelope.clientId,
      tick: this.tick,
      serverSeq: this.serverSeq,
      commandId: envelope.commandId,
      reason: 'invalid-command',
    });
  }

  private isSessionActive(sessionId: number): boolean {
    if (this.onEnvelope === undefined || this.lifecycle.phase === 'disconnected') {
      return false;
    }

    return this.lifecycle.sessionId === sessionId;
  }

  private isReadySessionEnvelope(sessionId: number, roomId: string, clientId: string): boolean {
    if (!this.isSessionActive(sessionId) || this.lifecycle.phase !== 'ready') {
      return false;
    }

    return this.lifecycle.roomId === roomId && this.lifecycle.clientId === clientId;
  }

  /**
   * Emits one authoritative snapshot from sim-core map state.
   * Mirrors full update refresh behavior in `ref/micropolis/src/sim/w_update.c`.
   */
  private emitSnapshot(roomId: string, clientId: string): void {
    if (this.onEnvelope === undefined) {
      return;
    }

    this.serverSeq += 1;
    this.onEnvelope({
      kind: 'snapshot',
      roomId,
      clientId,
      tick: this.tick,
      serverSeq: this.serverSeq,
      payload: this.buildSnapshotPayload(),
    });
  }

  /**
   * Builds the host snapshot payload from the authoritative sim-core map layer.
   * Mirrors contiguous `Map[x][y]` ownership in
   * `ref/micropolis/src/sim/s_alloc.c` and map snapshot serialization shape from
   * `ref/micropolis/src/sim/s_fileio.c`.
   * Parity note: snapshot tile words are copied directly from
   * `SimCoreRuntimeState` `map` storage (`x * WORLD_Y + y` ordering), preserving
   * Micropolis contiguous map semantics at the envelope boundary.
   */
  private buildSnapshotPayload(): HostSnapshotPayload {
    const mapLayer = this.authorityState.store.snapshot('map');
    if (!(mapLayer instanceof Uint16Array)) {
      throw new Error(`expected Uint16Array map layer; got ${mapLayer.constructor.name}`);
    }

    const tileWords = Uint16Array.from(mapLayer);
    return {
      map: {
        width: this.mapWidth,
        height: this.mapHeight,
        tileWords,
      },
    };
  }
}
