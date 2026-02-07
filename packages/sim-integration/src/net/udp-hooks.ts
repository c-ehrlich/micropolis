import type { UdpHooks } from '../types.ts';

/**
 * Platform adapter for `udp_listen` system calls.
 * Mirrors the syscall sequence in `ref/micropolis/src/sim/w_net.c`:
 * `socket` -> `setsockopt(SO_REUSEADDR)` -> `bind` -> `fcntl(F_GETFL)` ->
 * `fcntl(F_SETFL, flags | O_NDELAY)` -> `Tcp_MakeOpenFile`.
 * Parity note: this is intentionally adapter-based so Node/browser specifics
 * remain outside integration logic.
 */
export interface UdpListenPlatform {
  readonly nonBlockingFlag: number;
  createSocket(domain: 'AF_INET', type: 'SOCK_DGRAM', protocol: 0): number;
  setReuseAddress(sock: number, enabled: 1): boolean;
  bindAny(sock: number, port: number): boolean;
  getFileStatusFlags(sock: number): number;
  setFileStatusFlags(sock: number, flags: number): boolean;
  makeOpenFile(sock: number, readable: 1, writable: 1): void;
}

/**
 * Options for creating NET UDP hooks.
 * Mirrors the `udp_listen` error surface in `ref/micropolis/src/sim/w_net.c`
 * where failures call `perror(...)` and return `0`.
 */
export interface CreateUdpHookRuntimeOptions {
  platform: UdpListenPlatform;
  hooks?: Pick<UdpHooks, 'onError'>;
}

/**
 * NET UDP hook surface.
 * Mirrors Tcl-facing NET commands in `ref/micropolis/src/sim/w_sim.c`.
 * Parity note: this phase includes only `listenTo(port)`; `hearFrom(fileSock)`
 * is added in a later task.
 */
export interface UdpHookRuntime {
  listenTo(port: number): number;
}

/**
 * Create parity-first UDP NET hooks runtime.
 * Mirrors `udp_listen(int port)` in `ref/micropolis/src/sim/w_net.c`:
 * - stores `net_listen_port`
 * - creates/listens on one socket
 * - returns the socket fd on success
 * - returns `0` on any setup failure.
 * Parity note: this keeps Micropolis failure semantics (including not closing
 * partially initialized sockets when a later step fails).
 */
export function createUdpHookRuntime(options: CreateUdpHookRuntimeOptions): UdpHookRuntime {
  const { platform } = options;
  const onError = options.hooks?.onError;

  let netListenPort = 0;
  let netListenSocket = 0;

  return {
    listenTo(port) {
      netListenPort = port;

      netListenSocket = platform.createSocket('AF_INET', 'SOCK_DGRAM', 0);
      if (netListenSocket < 0) {
        return reportListenFailure('socket()');
      }

      if (!platform.setReuseAddress(netListenSocket, 1)) {
        return reportListenFailure('setsockopt SO_REUSEADDR');
      }

      if (!platform.bindAny(netListenSocket, netListenPort)) {
        return reportListenFailure('bind()');
      }

      const flags = platform.getFileStatusFlags(netListenSocket);
      if (flags < 0) {
        return reportListenFailure('fcntl F_GETFL');
      }

      if (!platform.setFileStatusFlags(netListenSocket, flags | platform.nonBlockingFlag)) {
        return reportListenFailure('fcntl F_SETFL');
      }

      platform.makeOpenFile(netListenSocket, 1, 1);
      return netListenSocket;
    },
  };

  function reportListenFailure(message: string): 0 {
    onError?.(new Error(message), 'listen');
    return 0;
  }
}
