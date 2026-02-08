import { createSocket, type Socket } from 'node:dgram';

import type { UdpListenPlatform } from '../net/udp-hooks.ts';

const DEFAULT_NON_BLOCKING_FLAG = 0x04;
const IPV4_ANY_ADDRESS = '0.0.0.0';

interface NodeUdpReceiveError {
  kind: 'error';
  code: string | undefined;
}

interface NodeUdpReceivePacket {
  kind: 'packet';
  sourceIp: string;
  bytes: ReadonlyArray<number>;
}

type NodeUdpReceiveQueueEntry = NodeUdpReceiveError | NodeUdpReceivePacket;

interface NodeUdpSocketState {
  readonly socket: Socket;
  readonly receiveQueue: NodeUdpReceiveQueueEntry[];
  fileStatusFlags: number;
}

/**
 * Node UDP adapter with a `UdpListenPlatform`-compatible contract.
 * Mirrors the syscall roles of `udp_listen` and `udp_hear` in
 * `ref/micropolis/src/sim/w_net.c` (socket setup, nonblocking intent, and
 * receive-loop outcomes), while intentionally adapting Node's event-driven
 * `dgram` API into a polling queue for `recvFrom` parity.
 */
export interface NodeUdpPlatform extends UdpListenPlatform {
  /**
   * Close one adapter-owned UDP socket.
   * Mirrors the lifecycle boundary around `net_listen_socket` from
   * `ref/micropolis/src/sim/w_net.c`, but is intentionally explicit in
   * TypeScript for runtime teardown.
   */
  closeSocket(sock: number): void;
  /**
   * Close all adapter-owned UDP sockets.
   * Mirrors process-level socket cleanup expectations around NET teardown in
   * Micropolis while intentionally exposing an explicit helper for Node.
   */
  closeAll(): void;
}

/**
 * Create a Node UDP adapter for NET hook runtime wiring.
 * Mirrors `ref/micropolis/src/sim/w_net.c` responsibilities:
 * - `socket(AF_INET, SOCK_DGRAM, 0)` is represented by `createSocket`.
 * - `setsockopt(..., SO_REUSEADDR, 1)` is represented by creating sockets
 *   with `reuseAddr: true`.
 * - `recvfrom` loop outcomes are surfaced as queued packet/error events.
 * Parity note: unlike C's blocking syscalls and `fcntl`, Node exposes async
 * socket events; this adapter records messages/errors and lets the runtime
 * poll them through `recvFrom`.
 */
export function createNodeUdpPlatform(
  nonBlockingFlag = DEFAULT_NON_BLOCKING_FLAG,
): NodeUdpPlatform {
  const sockets = new Map<number, NodeUdpSocketState>();
  let nextSocketId = 1;

  const closeSocketById = (sock: number): void => {
    const state = sockets.get(sock);
    if (state === undefined) {
      return;
    }

    state.socket.removeAllListeners('message');
    state.socket.removeAllListeners('error');
    state.socket.removeAllListeners('close');
    state.socket.close();
    sockets.delete(sock);
  };

  return {
    nonBlockingFlag,
    createSocket(domain, type, protocol) {
      if (domain !== 'AF_INET' || type !== 'SOCK_DGRAM' || protocol !== 0) {
        return -1;
      }

      try {
        const socket = createSocket({ type: 'udp4', reuseAddr: true });
        const socketId = nextSocketId;
        nextSocketId += 1;

        const state: NodeUdpSocketState = {
          socket,
          receiveQueue: [],
          fileStatusFlags: 0,
        };

        socket.on('message', (message, remoteInfo) => {
          state.receiveQueue.push({
            kind: 'packet',
            sourceIp: remoteInfo.address,
            bytes: Array.from(message),
          });
        });

        socket.on('error', (error) => {
          state.receiveQueue.push({
            kind: 'error',
            code: extractErrorCode(error),
          });
        });

        socket.on('close', () => {
          sockets.delete(socketId);
        });

        sockets.set(socketId, state);
        return socketId;
      } catch {
        return -1;
      }
    },
    setReuseAddress(sock, enabled) {
      if (enabled !== 1) {
        return false;
      }

      return sockets.has(sock);
    },
    bindAny(sock, port) {
      const state = sockets.get(sock);
      if (state === undefined) {
        return false;
      }

      try {
        state.socket.bind({
          port: normalizePort(port),
          address: IPV4_ANY_ADDRESS,
          exclusive: false,
        });
        return true;
      } catch {
        return false;
      }
    },
    getFileStatusFlags(sock) {
      const state = sockets.get(sock);
      if (state === undefined) {
        return -1;
      }

      return state.fileStatusFlags;
    },
    setFileStatusFlags(sock, flags) {
      const state = sockets.get(sock);
      if (state === undefined) {
        return false;
      }

      state.fileStatusFlags = flags;
      return true;
    },
    makeOpenFile() {
      // Parity boundary: Tcl channel creation is handled outside Node adapters.
    },
    recvFrom(sock) {
      const state = sockets.get(sock);
      if (state === undefined) {
        return { kind: 'error' };
      }

      const next = state.receiveQueue.shift();
      if (next === undefined) {
        return { kind: 'wouldBlock' };
      }

      if (next.kind === 'packet') {
        return next;
      }

      if (next.code === 'EINTR') {
        return { kind: 'eintr' };
      }

      if (next.code === 'EAGAIN' || next.code === 'EWOULDBLOCK') {
        return { kind: 'wouldBlock' };
      }

      return { kind: 'error' };
    },
    closeSocket(sock) {
      closeSocketById(sock);
    },
    closeAll() {
      for (const sock of Array.from(sockets.keys())) {
        closeSocketById(sock);
      }
    },
  };
}

function normalizePort(port: number): number {
  return truncateTowardZero(port) & 0xffff;
}

function truncateTowardZero(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return value < 0 ? Math.ceil(value) : Math.floor(value);
}

function extractErrorCode(error: Error): string | undefined {
  const maybeErrnoException = error as NodeJS.ErrnoException;
  return maybeErrnoException.code;
}
