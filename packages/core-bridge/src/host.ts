import type {
  BridgeClientId,
  BridgeCommandId,
  BridgeHelloPayload,
  BridgeRoomId,
  BridgeServerEnvelope,
} from './types.ts';

/**
 * Listener signature for host-to-client bridge envelopes.
 * Mirrors ordered outbound event delivery intent from Micropolis command
 * routing and transport fanout paths in `ref/micropolis/src/sim/w_sim.c` and
 * `ref/micropolis/src/sim/w_net.c`.
 * Parity note: this is intentionally callback-based in TypeScript, not Tcl
 * callback registration.
 */
export type CoreHostEventListener<
  TPatchPayload = unknown,
  TSnapshotPayload = unknown,
  TPresencePayload = unknown,
> = (event: BridgeServerEnvelope<TPatchPayload, TSnapshotPayload, TPresencePayload>) => void;

/**
 * Stable client-facing host API consumed by UI/runtime layers.
 * Mirrors the authoritative command intake and event fanout intent from
 * `ref/micropolis/src/sim/w_sim.c` and `ref/micropolis/src/sim/w_net.c`.
 * Parity note: this is intentionally transport-agnostic and bridge-envelope
 * driven rather than a 1:1 C function surface.
 */
export interface CoreHost<
  TCommandPayload = unknown,
  TPatchPayload = unknown,
  TSnapshotPayload = unknown,
  TPresencePayload = unknown,
> {
  readonly roomId: BridgeRoomId;
  readonly clientId: BridgeClientId;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  sendHello(payload?: BridgeHelloPayload): Promise<void>;
  sendCommand(command: {
    commandId: BridgeCommandId;
    payload: TCommandPayload;
    sentAtMs?: number;
  }): Promise<void>;
  requestSnapshot(): Promise<void>;
  ping(sentAtMs?: number): Promise<void>;
  subscribe(
    listener: CoreHostEventListener<TPatchPayload, TSnapshotPayload, TPresencePayload>,
  ): () => void;
}
