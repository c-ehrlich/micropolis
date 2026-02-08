import type { BridgeClientId, BridgeRoomId } from '@city/core-bridge';

import { DoHost, type DoHostOptions } from './do-host.ts';

/**
 * Deterministic default room id for local-mode host wiring.
 * Mirrors local deterministic identity decision from bridge planning over
 * Micropolis single-authority runtime behavior in `ref/micropolis/src/sim/s_sim.c`.
 * Parity note: explicit room identifiers are additive bridge-v1 metadata.
 */
export const DEFAULT_LOCAL_HOST_ROOM_ID: BridgeRoomId = 'local-room';

/**
 * Deterministic default client id for local-mode host wiring.
 * Mirrors local deterministic identity decision from bridge planning over
 * Micropolis command ownership in `ref/micropolis/src/sim/w_sim.c`.
 * Parity note: explicit client identifiers are additive bridge-v1 metadata.
 */
export const DEFAULT_LOCAL_HOST_CLIENT_ID: BridgeClientId = 'local-client';

/**
 * Construction options for `LocalHost`.
 * Mirrors `DoHost` transport wiring, while defaulting to deterministic local
 * identity values.
 * Parity note: this wraps bridge-v1 host contracts and is intentionally not a
 * direct Tcl/Tk process bootstrap surface.
 */
export type LocalHostOptions<
  TCommandPayload = unknown,
  TPatchPayload = unknown,
  TSnapshotPayload = unknown,
  TPresencePayload = unknown,
> = Omit<
  DoHostOptions<TCommandPayload, TPatchPayload, TSnapshotPayload, TPresencePayload>,
  'roomId' | 'clientId'
> & {
  roomId?: BridgeRoomId;
  clientId?: BridgeClientId;
};

/**
 * Local in-process host with deterministic room/client defaults.
 * Mirrors single-authority local runtime intent from `ref/micropolis/src/sim/s_sim.c`
 * while reusing bridge-v1 transport/event contracts.
 * Parity note: this intentionally composes `DoHost` rather than exposing
 * Micropolis globals directly.
 */
export class LocalHost<
  TCommandPayload = unknown,
  TPatchPayload = unknown,
  TSnapshotPayload = unknown,
  TPresencePayload = unknown,
> extends DoHost<TCommandPayload, TPatchPayload, TSnapshotPayload, TPresencePayload> {
  constructor(
    options: LocalHostOptions<TCommandPayload, TPatchPayload, TSnapshotPayload, TPresencePayload>,
  ) {
    super({
      ...options,
      roomId: options.roomId ?? DEFAULT_LOCAL_HOST_ROOM_ID,
      clientId: options.clientId ?? DEFAULT_LOCAL_HOST_CLIENT_ID,
    });
  }
}
