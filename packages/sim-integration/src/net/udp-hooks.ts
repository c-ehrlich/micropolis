import type { ParityMode, UdpHooks } from '../types.ts';

/**
 * One `recvfrom` attempt outcome for `udp_hear`.
 * Mirrors error branches in `ref/micropolis/src/sim/w_net.c`:
 * data packet, `EINTR` retry, `EWOULDBLOCK` stop, or other error return.
 */
type UdpReceiveResult =
  | { kind: 'packet'; sourceIp: string; bytes: ReadonlyArray<number> }
  | { kind: 'eintr' }
  | { kind: 'wouldBlock' }
  | { kind: 'error' };

/**
 * Platform adapter for `udp_listen` system calls.
 * Mirrors the syscall sequence in `ref/micropolis/src/sim/w_net.c`:
 * `socket` -> `setsockopt(SO_REUSEADDR)` -> `bind` -> `fcntl(F_GETFL)` ->
 * `fcntl(F_SETFL, flags | O_NDELAY)` -> `Tcp_MakeOpenFile`; and
 * `udp_hear` nonblocking `recvfrom` loop control (`EINTR` retry,
 * `EWOULDBLOCK` stop).
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
  recvFrom(sock: number, addrLength: number | undefined): UdpReceiveResult;
}

/**
 * Options for creating NET UDP hooks.
 * Mirrors the `udp_listen` error surface in `ref/micropolis/src/sim/w_net.c`
 * where failures call `perror(...)` and return `0`.
 */
export interface CreateUdpHookRuntimeOptions {
  /**
   * UDP parity mode for strict Micropolis quirks vs safe hardening.
   * Mirrors `udp_listen`/`udp_hear` in `ref/micropolis/src/sim/w_net.c`:
   * strict preserves no-`htons` port behavior plus uninitialized `addr_len`,
   * while safe fixes both with normalized ports and initialized addr length.
   */
  mode?: ParityMode;
  platform: UdpListenPlatform;
  hooks?: Pick<UdpHooks, 'onError' | 'onPacketCommand'>;
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
  const mode = options.mode ?? 'strict';
  const { platform } = options;
  const onError = options.hooks?.onError;
  const onPacketCommand = options.hooks?.onPacketCommand;
  const recvAddressLength = mode === 'safe' ? SOCKADDR_IN_BYTE_LENGTH : undefined;

  let netListenPort = 0;
  let netListenSocket = 0;

  return {
    listenTo(port) {
      netListenPort = resolveUdpListenPort(port, mode);

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

      while (true) {
        const receiveResult = platform.recvFrom(sock, recvAddressLength);

        if (receiveResult.kind === 'packet') {
          onPacketCommand?.(
            formatHandlePacketCommand(sock, receiveResult.sourceIp, receiveResult.bytes),
          );
          continue;
        }

        if (receiveResult.kind === 'eintr') {
          continue;
        }

        if (receiveResult.kind === 'wouldBlock') {
          break;
        }

        reportHearFailure('recvfrom');
        return;
      }
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

/**
 * Format one UDP packet callback command.
 * Mirrors `udp_hear` in `ref/micropolis/src/sim/w_net.c` where received
 * packets execute `Eval("HandlePacket <sock> {<ip>} {<bytes>}")`.
 * Parity note: byte formatting is a direct `%3d ` parity port from the C loop
 * (`sprintf(cp, "%3d ", buf[i]); cp += 4;`) including fixed width and trailing
 * space for each byte.
 */
function formatHandlePacketCommand(
  sock: number,
  sourceIp: string,
  bytes: ReadonlyArray<number>,
): string {
  return `HandlePacket ${sock} {${sourceIp}} {${formatUdpPacketBytes(bytes)}}`;
}

function formatUdpPacketBytes(bytes: ReadonlyArray<number>): string {
  return bytes.map((byte) => `${byte.toString().padStart(3, ' ')} `).join('');
}

const SOCKADDR_IN_BYTE_LENGTH = 16;
const UINT16_MASK = 0xffff;
const HOST_IS_LITTLE_ENDIAN = detectHostLittleEndian();

/**
 * Resolve the listening port argument for `bind`.
 * Mirrors `udp_listen` in `ref/micropolis/src/sim/w_net.c` where strict mode
 * preserves `sin_port = net_listen_port` (no `htons`) behavior, while safe
 * mode intentionally normalizes to canonical 16-bit port numbers.
 */
function resolveUdpListenPort(port: number, mode: ParityMode): number {
  const normalizedPort = normalizeUdpPort(port);
  if (mode === 'safe') {
    return normalizedPort;
  }

  return HOST_IS_LITTLE_ENDIAN ? byteSwap16(normalizedPort) : normalizedPort;
}

function normalizeUdpPort(port: number): number {
  return truncateTowardZero(port) & UINT16_MASK;
}

function truncateTowardZero(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return value < 0 ? Math.ceil(value) : Math.floor(value);
}

function byteSwap16(value: number): number {
  return ((value & 0xff) << 8) | ((value >> 8) & 0xff);
}

function detectHostLittleEndian(): boolean {
  const view = new Uint16Array([1]);
  return new Uint8Array(view.buffer)[0] === 1;
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
