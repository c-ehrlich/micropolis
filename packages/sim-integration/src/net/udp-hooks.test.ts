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
      },
    });

    const socket = runtime.listenTo(1234);

    expect(socket).toBe(17);
    expect(calls).toEqual([
      'socket AF_INET SOCK_DGRAM 0',
      'setsockopt 17 1',
      'bind 17 1234',
      'fcntl-get 17',
      'fcntl-set 17 6',
      'open-file 17 1 1',
    ]);
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
    expect(calls).toEqual(['socket', 'setsockopt 21 1', 'bind 21 3333', 'fcntl-get 21']);
    expect(listenErrors).toEqual([{ message: 'fcntl F_GETFL', phase: 'listen' }]);
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
    ...overrides,
  };
}
