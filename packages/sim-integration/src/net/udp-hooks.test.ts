import { describe, expect, it } from 'vitest';

import { createUdpHookRuntime, type UdpListenPlatform } from './udp-hooks.ts';

describe('createUdpHookRuntime listenTo parity', () => {
  it('follows udp_listen setup order and returns the socket on success', () => {
    const calls: string[] = [];
    const runtime = createUdpHookRuntime({
      platform: {
        nonBlockingFlag: 4,
        createSocket(domain, type, protocol) {
          calls.push(`socket ${domain} ${type} ${protocol}`);
          return 17;
        },
        setReuseAddress(sock, enabled) {
          calls.push(`setsockopt ${sock} ${enabled}`);
          return true;
        },
        bindAny(sock, port) {
          calls.push(`bind ${sock} ${port}`);
          return true;
        },
        getFileStatusFlags(sock) {
          calls.push(`fcntl-get ${sock}`);
          return 2;
        },
        setFileStatusFlags(sock, flags) {
          calls.push(`fcntl-set ${sock} ${flags}`);
          return true;
        },
        makeOpenFile(sock, readable, writable) {
          calls.push(`open-file ${sock} ${readable} ${writable}`);
        },
        recvFrom(sock) {
          calls.push(`recv ${sock}`);
          return { kind: 'wouldBlock' };
        },
      },
    });

    const socket = runtime.listenTo(1234);

    expect(socket).toBe(17);
    expect(calls).toEqual([
      'socket AF_INET SOCK_DGRAM 0',
      'setsockopt 17 1',
      `bind 17 ${expectedStrictBindPort(1234)}`,
      'fcntl-get 17',
      'fcntl-set 17 6',
      'open-file 17 1 1',
    ]);
  });

  it('normalizes listen port in safe mode before bind', () => {
    const calls: string[] = [];
    const runtime = createUdpHookRuntime({
      mode: 'safe',
      platform: createPlatform({
        createSocket() {
          calls.push('socket');
          return 23;
        },
        setReuseAddress(sock, enabled) {
          calls.push(`setsockopt ${sock} ${enabled}`);
          return true;
        },
        bindAny(sock, port) {
          calls.push(`bind ${sock} ${port}`);
          return true;
        },
      }),
    });

    // Safe-mode hardening intentionally normalizes to unsigned 16-bit range.
    // `70000` normalized to `4464` comes from modulo 2^16 behavior.
    expect(runtime.listenTo(70000)).toBe(23);
    expect(calls).toEqual(['socket', 'setsockopt 23 1', 'bind 23 4464']);
  });

  it('returns 0 when socket creation fails and reports listen-phase error', () => {
    const calls: string[] = [];
    const listenErrors: Array<{ message: string; phase: 'listen' | 'hear' }> = [];
    const runtime = createUdpHookRuntime({
      hooks: {
        onError(error, phase) {
          listenErrors.push({ message: error.message, phase });
        },
      },
      platform: createPlatform({
        createSocket() {
          calls.push('socket');
          return -1;
        },
      }),
    });

    // Mirrors `udp_listen` in ref/micropolis/src/sim/w_net.c:
    // failure returns integer `0`.
    expect(runtime.listenTo(2222)).toBe(0);
    expect(calls).toEqual(['socket']);
    expect(listenErrors).toEqual([{ message: 'socket()', phase: 'listen' }]);
  });

  it('returns 0 when fcntl F_GETFL fails and does not continue setup', () => {
    const calls: string[] = [];
    const listenErrors: Array<{ message: string; phase: 'listen' | 'hear' }> = [];
    const runtime = createUdpHookRuntime({
      hooks: {
        onError(error, phase) {
          listenErrors.push({ message: error.message, phase });
        },
      },
      platform: createPlatform({
        createSocket() {
          calls.push('socket');
          return 21;
        },
        setReuseAddress(sock, enabled) {
          calls.push(`setsockopt ${sock} ${enabled}`);
          return true;
        },
        bindAny(sock, port) {
          calls.push(`bind ${sock} ${port}`);
          return true;
        },
        getFileStatusFlags(sock) {
          calls.push(`fcntl-get ${sock}`);
          return -1;
        },
        setFileStatusFlags() {
          calls.push('fcntl-set');
          return true;
        },
        makeOpenFile() {
          calls.push('open-file');
        },
      }),
    });

    // Mirrors `udp_listen` in ref/micropolis/src/sim/w_net.c:
    // any setup failure returns integer `0`.
    expect(runtime.listenTo(3333)).toBe(0);
    expect(calls).toEqual([
      'socket',
      'setsockopt 21 1',
      `bind 21 ${expectedStrictBindPort(3333)}`,
      'fcntl-get 21',
    ]);
    expect(listenErrors).toEqual([{ message: 'fcntl F_GETFL', phase: 'listen' }]);
  });
});

describe('createUdpHookRuntime hearFrom parsing parity', () => {
  it('parses file<sock> and keeps strict-mode addr length uninitialized', () => {
    const recvCalls: Array<{ sock: number; addrLength: number | undefined }> = [];
    const runtime = createUdpHookRuntime({
      platform: createPlatform({
        recvFrom(sock, addrLength) {
          recvCalls.push({ sock, addrLength });
          return { kind: 'wouldBlock' };
        },
      }),
    });

    // Mirrors `SimCmdHearFrom` in ref/micropolis/src/sim/w_sim.c:
    // `argv[2]` must begin with `file`, then parse int from `argv[2] + 4`.
    runtime.hearFrom('file27');

    expect(recvCalls).toEqual([{ sock: 27, addrLength: undefined }]);
  });

  it('passes initialized sockaddr length to recvfrom in safe mode', () => {
    const recvCalls: Array<{ sock: number; addrLength: number | undefined }> = [];
    const runtime = createUdpHookRuntime({
      mode: 'safe',
      platform: createPlatform({
        recvFrom(sock, addrLength) {
          recvCalls.push({ sock, addrLength });
          return { kind: 'wouldBlock' };
        },
      }),
    });

    // Safe mode intentionally fixes `udp_hear` undefined-behavior by passing
    // `sizeof(struct sockaddr_in)`; on IPv4 this is 16 bytes.
    runtime.hearFrom('file27');

    expect(recvCalls).toEqual([{ sock: 27, addrLength: 16 }]);
  });

  it('continues on EINTR and packet, then stops on EWOULDBLOCK', () => {
    const recvCalls: number[] = [];
    const sequence: Array<'eintr' | 'packet' | 'wouldBlock'> = [
      'eintr',
      'packet',
      'packet',
      'wouldBlock',
    ];
    const runtime = createUdpHookRuntime({
      platform: createPlatform({
        recvFrom(sock) {
          recvCalls.push(sock);
          const next = sequence.shift() ?? 'wouldBlock';
          if (next === 'packet') {
            return { kind: 'packet', sourceIp: '127.0.0.1', bytes: [1] };
          }

          return { kind: next };
        },
      }),
    });

    // Mirrors `udp_hear` in ref/micropolis/src/sim/w_net.c:
    // `EINTR` retries the loop and `EWOULDBLOCK` terminates it.
    runtime.hearFrom('file9');

    expect(recvCalls).toEqual([9, 9, 9, 9]);
    expect(sequence).toEqual([]);
  });

  it('emits HandlePacket callback command with C %3d byte formatting parity', () => {
    const packetCommands: string[] = [];
    const runtime = createUdpHookRuntime({
      hooks: {
        onPacketCommand(command) {
          packetCommands.push(command);
        },
      },
      platform: createPlatform({
        recvFrom() {
          if (packetCommands.length === 0) {
            return { kind: 'packet', sourceIp: '10.1.2.3', bytes: [0, 16, 255] };
          }

          return { kind: 'wouldBlock' };
        },
      }),
    });

    // Mirrors `udp_hear` command assembly shape in ref/micropolis/src/sim/w_net.c
    // and ref/micropolis/spec/integration/SPEC.md.
    runtime.hearFrom('file37');

    expect(packetCommands).toEqual(['HandlePacket 37 {10.1.2.3} {  0  16 255 }']);
  });

  it('reports recvfrom error on non-EINTR and non-EWOULDBLOCK failure', () => {
    const hearErrors: Array<{ message: string; phase: 'listen' | 'hear' }> = [];
    const recvCalls: number[] = [];
    const runtime = createUdpHookRuntime({
      hooks: {
        onError(error, phase) {
          hearErrors.push({ message: error.message, phase });
        },
      },
      platform: createPlatform({
        recvFrom(sock) {
          recvCalls.push(sock);
          return { kind: 'error' };
        },
      }),
    });

    // Mirrors `udp_hear`: unexpected recvfrom error calls perror("recvfrom")
    // and returns immediately.
    runtime.hearFrom('file12');

    expect(recvCalls).toEqual([12]);
    expect(hearErrors).toEqual([{ message: 'recvfrom', phase: 'hear' }]);
  });

  it('requires exact lowercase file prefix and reports hear-phase errors otherwise', () => {
    const recvCalls: number[] = [];
    const hearErrors: Array<{ message: string; phase: 'listen' | 'hear' }> = [];
    const runtime = createUdpHookRuntime({
      hooks: {
        onError(error, phase) {
          hearErrors.push({ message: error.message, phase });
        },
      },
      platform: createPlatform({
        recvFrom(sock) {
          recvCalls.push(sock);
          return { kind: 'wouldBlock' };
        },
      }),
    });

    // `SimCmdHearFrom` hard-checks `f`, `i`, `l`, `e` at indices 0..3.
    runtime.hearFrom('File27');
    runtime.hearFrom('socket27');
    runtime.hearFrom('file');
    runtime.hearFrom('file27suffix');

    expect(recvCalls).toEqual([]);
    expect(hearErrors).toEqual([
      { message: 'HearFrom expects file<sock>', phase: 'hear' },
      { message: 'HearFrom expects file<sock>', phase: 'hear' },
      { message: 'HearFrom expects file<sock>', phase: 'hear' },
      { message: 'HearFrom expects file<sock>', phase: 'hear' },
    ]);
  });
});

function createPlatform(overrides: Partial<UdpListenPlatform>): UdpListenPlatform {
  return {
    nonBlockingFlag: 4,
    createSocket: () => 10,
    setReuseAddress: () => true,
    bindAny: () => true,
    getFileStatusFlags: () => 0,
    setFileStatusFlags: () => true,
    makeOpenFile: () => undefined,
    recvFrom: () => ({ kind: 'wouldBlock' }),
    ...overrides,
  };
}

function expectedStrictBindPort(port: number): number {
  const normalizedPort = normalizeSafePort(port);
  if (!isLittleEndianHost()) {
    return normalizedPort;
  }

  return ((normalizedPort & 0xff) << 8) | ((normalizedPort >> 8) & 0xff);
}

function normalizeSafePort(port: number): number {
  return truncateTowardZero(port) & 0xffff;
}

function truncateTowardZero(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return value < 0 ? Math.ceil(value) : Math.floor(value);
}

function isLittleEndianHost(): boolean {
  const view = new Uint16Array([1]);
  return new Uint8Array(view.buffer)[0] === 1;
}
