import type { IntegrationClientId } from '@city/sim-integration';

import type { DoHostTransport } from './do-host.ts';
import type {
  DoWebSocketLike,
  DoWebSocketMessage,
  DoWebSocketOutboundMessage,
  RoomDoAdapter,
} from './room-do-adapter.ts';

/**
 * Options for creating an in-memory host transport bound to one room adapter.
 * Mirrors client socket registration/dispatch intent from NET pathways in
 * `ref/micropolis/src/sim/w_net.c`.
 * Parity note: this is a test/local composition utility and intentionally not
 * a network socket transport.
 */
export interface InMemoryDoHostTransportOptions<
  TCommandPayload = unknown,
  TPatchPayload = unknown,
  TSnapshotPayload = unknown,
  TPresencePayload = unknown,
> {
  adapter: RoomDoAdapter<TCommandPayload, TPatchPayload, TSnapshotPayload, TPresencePayload>;
  clientId: IntegrationClientId;
}

/**
 * Create a `DoHostTransport` backed by direct in-process `RoomDoAdapter` calls.
 * Mirrors message flow intent from `SimCmd` + NET packet handlers in
 * `ref/micropolis/src/sim/w_sim.c` and `ref/micropolis/src/sim/w_net.c`.
 * Parity note: this intentionally removes network nondeterminism for
 * conformance/local tests while preserving envelope-level behavior.
 */
export function createInMemoryDoHostTransport<
  TCommandPayload = unknown,
  TPatchPayload = unknown,
  TSnapshotPayload = unknown,
  TPresencePayload = unknown,
>(
  options: InMemoryDoHostTransportOptions<
    TCommandPayload,
    TPatchPayload,
    TSnapshotPayload,
    TPresencePayload
  >,
): DoHostTransport {
  let isConnected = false;
  let onMessage: ((message: DoWebSocketOutboundMessage) => void) | undefined;

  return {
    async connect(handleMessage) {
      if (isConnected) {
        return;
      }
      isConnected = true;
      onMessage = handleMessage;
      const socket: DoWebSocketLike = {
        send(message) {
          onMessage?.(message);
        },
      };
      await options.adapter.handleWebSocketOpen(options.clientId, socket);
    },
    async send(message: DoWebSocketMessage) {
      assertConnected(isConnected);
      await options.adapter.handleWebSocketMessage(options.clientId, message);
    },
    async disconnect() {
      if (!isConnected) {
        return;
      }
      isConnected = false;
      onMessage = undefined;
      await options.adapter.handleWebSocketClose(options.clientId);
    },
  };
}

function assertConnected(isConnected: boolean): void {
  if (!isConnected) {
    throw new Error('in-memory DO host transport is not connected');
  }
}
