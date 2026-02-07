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
  hearSocket(sock: number): void;
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
 * Parity note: `listenTo(port)` mirrors `sim ListenTo`; `hearFrom(fileSock)`
 * mirrors `sim HearFrom file<sock>` argument validation and socket dispatch.
 */
export interface UdpHookRuntime {
  listenTo(port: number): number;
  hearFrom(fileSock: string): void;
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
    hearFrom(fileSock) {
      const sock = parseHearFromFileSock(fileSock);
      if (sock === undefined) {
        reportHearFailure('HearFrom expects file<sock>');
        return;
      }

      platform.hearSocket(sock);
    },
  };

  function reportListenFailure(message: string): 0 {
    onError?.(new Error(message), 'listen');
    return 0;
  }

  function reportHearFailure(message: string): void {
    onError?.(new Error(message), 'hear');
  }
}

const INT32_MAX = 2_147_483_647;
const INT32_MIN = -2_147_483_648;

/**
 * Parse `sim HearFrom file<sock>` argument into a socket integer.
 * Mirrors `SimCmdHearFrom` in `ref/micropolis/src/sim/w_sim.c` as a parity
 * port: the argument must start with lowercase `file`, and the remainder is
 * parsed as an integer socket id. This is intentionally different from Tcl's
 * `Tcl_GetInt` API shape by returning `undefined` instead of mutating interp.
 */
function parseHearFromFileSock(fileSock: string): number | undefined {
  if (fileSock[0] !== 'f' || fileSock[1] !== 'i' || fileSock[2] !== 'l' || fileSock[3] !== 'e') {
    return undefined;
  }

  const sockToken = fileSock.slice(4);
  if (!/^[+-]?\d+$/.test(sockToken)) {
    return undefined;
  }

  const sock = Number.parseInt(sockToken, 10);
  if (!Number.isSafeInteger(sock)) {
    return undefined;
  }

  if (sock < INT32_MIN || sock > INT32_MAX) {
    return undefined;
  }

  return sock;
}
