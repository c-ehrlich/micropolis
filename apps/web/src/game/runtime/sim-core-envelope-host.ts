import { World } from '../../../../../packages/sim-core/src/index.ts';
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
 * subsequent checklist tasks.
 */
export class SimCoreEnvelopeHost implements CoreHost {
  private onEnvelope: ((envelope: HostEnvelope) => void) | undefined;
  private activeRoomId: string | undefined;
  private activeClientId: string | undefined;
  private readonly mapWidth = World.WORLD_X;
  private readonly mapHeight = World.WORLD_Y;
  private readonly initialMapTileWords = new Uint16Array(this.mapWidth * this.mapHeight);
  private serverSeq = 0;
  private tick = 0;

  public connect(onEnvelope: (envelope: HostEnvelope) => void): CoreHostConnection {
    this.onEnvelope = onEnvelope;

    return {
      send: (envelope) => {
        this.handleClientEnvelope(envelope);
      },
      disconnect: () => {
        this.onEnvelope = undefined;
        this.activeRoomId = undefined;
        this.activeClientId = undefined;
      },
    };
  }

  /**
   * Routes client envelopes through one deterministic host lifecycle.
   * Mirrors top-level command/update dispatch structure in
   * `ref/micropolis/src/sim/w_sim.c`.
   */
  private handleClientEnvelope(envelope: ClientEnvelope): void {
    if (this.onEnvelope === undefined) {
      return;
    }

    if (envelope.kind === 'hello') {
      this.activeRoomId = envelope.roomId;
      this.activeClientId = envelope.clientId;
      this.onEnvelope({
        kind: 'hello',
        roomId: envelope.roomId,
        clientId: envelope.clientId,
        protocolVersion: envelope.protocolVersion,
        coreVersion: envelope.coreVersion,
        accepted: true,
      });
      this.emitSnapshot(envelope.roomId, envelope.clientId);
      return;
    }

    if (
      this.activeRoomId === undefined ||
      this.activeClientId === undefined ||
      envelope.roomId !== this.activeRoomId ||
      envelope.clientId !== this.activeClientId
    ) {
      return;
    }

    if (envelope.kind === 'request_snapshot') {
      this.emitSnapshot(envelope.roomId, envelope.clientId);
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
   * Parity note: this phase emits a protocol-valid baseline map payload with
   * canonical Micropolis world dimensions; subsequent tasks migrate full
   * authoritative tile backing from `SimCoreRuntimeState`.
   */
  private buildSnapshotPayload(): HostSnapshotPayload {
    const tileWords = Uint16Array.from(this.initialMapTileWords);
    return {
      map: {
        width: this.mapWidth,
        height: this.mapHeight,
        tileWords,
      },
    };
  }
}
