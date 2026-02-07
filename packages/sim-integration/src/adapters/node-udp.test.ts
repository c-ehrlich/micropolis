import { describe, expect, it, vi, beforeEach } from 'vitest';

const { createSocketMock } = vi.hoisted(() => ({
  createSocketMock: vi.fn(),
}));

vi.mock('node:dgram', () => ({
  createSocket: createSocketMock,
}));

import { createNodeUdpPlatform } from './node-udp.ts';

type MessageListener = (message: Buffer, remoteInfo: { address: string }) => void;
type ErrorListener = (error: Error) => void;
type CloseListener = () => void;

type SocketEventMap = {
  message: MessageListener[];
  error: ErrorListener[];
  close: CloseListener[];
};

class FakeDgramSocket {
  readonly bindCalls: Array<{ port: number; address: string; exclusive: boolean }> = [];
  readonly removeAllListenersCalls: string[] = [];
  closeCallCount = 0;
  throwOnBind = false;

  private readonly listeners: SocketEventMap = {
    message: [],
    error: [],
    close: [],
  };

  on(event: 'message', listener: MessageListener): this;
  on(event: 'error', listener: ErrorListener): this;
  on(event: 'close', listener: CloseListener): this;
  on(event: keyof SocketEventMap, listener: MessageListener | ErrorListener | CloseListener): this {
    if (event === 'message') {
      this.listeners.message.push(listener as MessageListener);
    } else if (event === 'error') {
      this.listeners.error.push(listener as ErrorListener);
    } else {
      this.listeners.close.push(listener as CloseListener);
    }

    return this;
  }

  removeAllListeners(event: 'message' | 'error' | 'close'): this {
    this.removeAllListenersCalls.push(event);
    this.listeners[event] = [];
    return this;
  }

  bind(options: { port: number; address: string; exclusive: boolean }): void {
    if (this.throwOnBind) {
      throw new Error('bind failed');
    }

    this.bindCalls.push(options);
  }

  close(): void {
    this.closeCallCount += 1;
    for (const listener of this.listeners.close) {
      listener();
    }
  }

  emitPacket(bytes: ReadonlyArray<number>, sourceIp: string): void {
    const message = Buffer.from(bytes);
    for (const listener of this.listeners.message) {
      listener(message, { address: sourceIp });
    }
  }

  emitError(code: string): void {
    const error = Object.assign(new Error(code), { code });
    for (const listener of this.listeners.error) {
      listener(error);
    }
  }
}

describe('createNodeUdpPlatform', () => {
  beforeEach(() => {
    createSocketMock.mockReset();
  });

  it('creates udp4 sockets with reuseAddr enabled and increments adapter socket ids', () => {
    const socketOne = new FakeDgramSocket();
    const socketTwo = new FakeDgramSocket();
    createSocketMock.mockReturnValueOnce(socketOne).mockReturnValueOnce(socketTwo);

    const platform = createNodeUdpPlatform();

    const firstSocketId = platform.createSocket('AF_INET', 'SOCK_DGRAM', 0);
    const secondSocketId = platform.createSocket('AF_INET', 'SOCK_DGRAM', 0);

    expect(firstSocketId).toBe(1);
    expect(secondSocketId).toBe(2);
    expect(createSocketMock).toHaveBeenNthCalledWith(1, { type: 'udp4', reuseAddr: true });
    expect(createSocketMock).toHaveBeenNthCalledWith(2, { type: 'udp4', reuseAddr: true });
  });

  it('rejects unsupported socket tuples before touching node:dgram', () => {
    const platform = createNodeUdpPlatform();
    const platformWithLooseTuple = platform as unknown as {
      createSocket(domain: string, type: string, protocol: number): number;
    };

    expect(platformWithLooseTuple.createSocket('AF_UNIX', 'SOCK_DGRAM', 0)).toBe(-1);
    expect(platformWithLooseTuple.createSocket('AF_INET', 'SOCK_STREAM', 0)).toBe(-1);
    expect(platformWithLooseTuple.createSocket('AF_INET', 'SOCK_DGRAM', 1)).toBe(-1);
    expect(createSocketMock).not.toHaveBeenCalled();
  });

  it('normalizes bind ports to unsigned 16-bit values and binds to INADDR_ANY', () => {
    const socket = new FakeDgramSocket();
    createSocketMock.mockReturnValue(socket);
    const platform = createNodeUdpPlatform();
    const sock = platform.createSocket('AF_INET', 'SOCK_DGRAM', 0);

    expect(platform.bindAny(sock, 70000.9)).toBe(true);
    expect(socket.bindCalls).toEqual([
      {
        port: normalizeUdpPortForBind(70000.9),
        address: '0.0.0.0',
        exclusive: false,
      },
    ]);
  });

  it('maps queued packet and errno events to recvFrom parity outcomes', () => {
    const socket = new FakeDgramSocket();
    createSocketMock.mockReturnValue(socket);
    const platform = createNodeUdpPlatform();
    const sock = platform.createSocket('AF_INET', 'SOCK_DGRAM', 0);

    expect(platform.recvFrom(sock, undefined)).toEqual({ kind: 'wouldBlock' });

    socket.emitPacket([0, 16, 255], '10.1.2.3');
    expect(platform.recvFrom(sock, undefined)).toEqual({
      kind: 'packet',
      sourceIp: '10.1.2.3',
      bytes: [0, 16, 255],
    });

    socket.emitError('EINTR');
    expect(platform.recvFrom(sock, undefined)).toEqual({ kind: 'eintr' });

    socket.emitError('EAGAIN');
    expect(platform.recvFrom(sock, undefined)).toEqual({ kind: 'wouldBlock' });

    socket.emitError('EWOULDBLOCK');
    expect(platform.recvFrom(sock, undefined)).toEqual({ kind: 'wouldBlock' });

    socket.emitError('ECONNRESET');
    expect(platform.recvFrom(sock, undefined)).toEqual({ kind: 'error' });
  });

  it('tracks file status flags and tears down sockets via closeSocket and closeAll', () => {
    const socketOne = new FakeDgramSocket();
    const socketTwo = new FakeDgramSocket();
    createSocketMock.mockReturnValueOnce(socketOne).mockReturnValueOnce(socketTwo);
    const platform = createNodeUdpPlatform();

    const sockOne = platform.createSocket('AF_INET', 'SOCK_DGRAM', 0);
    const sockTwo = platform.createSocket('AF_INET', 'SOCK_DGRAM', 0);

    // Mirrors `udp_listen` in ref/micropolis/src/sim/w_net.c where
    // `fcntl(F_SETFL, flags | O_NDELAY)` mutates fd status flags.
    expect(platform.getFileStatusFlags(sockOne)).toBe(0);
    expect(platform.setFileStatusFlags(sockOne, 6)).toBe(true);
    expect(platform.getFileStatusFlags(sockOne)).toBe(6);

    platform.closeSocket(sockOne);

    expect(socketOne.removeAllListenersCalls).toEqual(['message', 'error', 'close']);
    expect(socketOne.closeCallCount).toBe(1);
    expect(platform.getFileStatusFlags(sockOne)).toBe(-1);
    expect(platform.recvFrom(sockOne, undefined)).toEqual({ kind: 'error' });

    platform.closeAll();

    expect(socketTwo.removeAllListenersCalls).toEqual(['message', 'error', 'close']);
    expect(socketTwo.closeCallCount).toBe(1);
    expect(platform.getFileStatusFlags(sockTwo)).toBe(-1);
  });

  it('returns -1 when node:dgram socket creation throws', () => {
    createSocketMock.mockImplementation(() => {
      throw new Error('socket failed');
    });

    const platform = createNodeUdpPlatform();

    expect(platform.createSocket('AF_INET', 'SOCK_DGRAM', 0)).toBe(-1);
  });

  it('returns false from bindAny when bind throws', () => {
    const socket = new FakeDgramSocket();
    socket.throwOnBind = true;
    createSocketMock.mockReturnValue(socket);
    const platform = createNodeUdpPlatform();
    const sock = platform.createSocket('AF_INET', 'SOCK_DGRAM', 0);

    expect(platform.bindAny(sock, 4321)).toBe(false);
  });
});

function normalizeUdpPortForBind(port: number): number {
  return truncateTowardZero(port) & 0xffff;
}

function truncateTowardZero(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return value < 0 ? Math.ceil(value) : Math.floor(value);
}
