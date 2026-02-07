import { describe, expect, it } from 'vitest';

import { createIntegrationRuntime } from './runtime.ts';

describe('runtime mixed-feature integration scenarios', () => {
  it('records deterministic sugar-only events', () => {
    const events: string[] = [];
    const runtime = createIntegrationRuntime({
      features: {
        sugar: true,
      },
      hooks: {
        onSoundToken(soundName) {
          events.push(`sound:${soundName}`);
        },
        onSugarCommand(command) {
          events.push(`sugar:${JSON.stringify(command)}`);
        },
      },
    });

    // Mirrors `_stdout_thread_function` command dispatch in
    // `ref/micropolis/micropolisactivity.py`.
    runtime.handleOutputLine('PlaySound Bulldozer');

    runtime.share();
    runtime.focusIn();
    runtime.focusOut();
    runtime.quit();
    runtime.buddyAppeared({
      key: 'k-1',
      nick: 'n-1',
      color: '#00A0FF,#F0F0F0',
      address: '10.0.0.1',
    });
    runtime.buddyDisappeared({
      key: 'k-2',
      nick: 'n-2',
      color: '#FF0000,#FFFFFF',
      address: '10.0.0.2',
    });

    // TTY and NET paths must remain no-ops when not enabled.
    events.push(`tty:${String(runtime.handleInputLine('puts ignored\\n'))}`);
    events.push(`listen:${runtime.listenTo(1234)}`);
    runtime.hearFrom('file11');

    expect(events).toEqual([
      'sound:bulldozer',
      'sugar:"SugarShare\\n"',
      'sugar:"SugarActivate\\n"',
      'sugar:"SugarDeactivate\\n"',
      'sugar:"SugarQuit\\n"',
      'sugar:"SugarBuddyAdd \\"k-1\\" \\"n-1\\" \\"#00A0FF,#F0F0F0\\" \\"10.0.0.1\\"\\n"',
      'sugar:"SugarBuddyDel \\"k-2\\" \\"n-2\\" \\"#FF0000,#FFFFFF\\" \\"10.0.0.2\\"\\n"',
      'tty:undefined',
      'listen:0',
    ]);
  });

  it('records deterministic tty-only events', () => {
    const events: string[] = [];
    const runtime = createIntegrationRuntime({
      features: {
        tty: true,
      },
      hooks: {
        evaluateTtyCommand(command) {
          events.push(`eval:${JSON.stringify(command)}`);
          return {
            ok: true,
            result: `tty:${command.trimEnd()}`,
          };
        },
        tty: {
          isTty: true,
          onWriteStdout(chunk) {
            events.push(`stdout:${JSON.stringify(chunk)}`);
          },
          onExit(exitCode) {
            events.push(`exit:${exitCode}`);
          },
        },
      },
    });

    // Startup/post-command prompts mirror `printf("sim:\\n")` from
    // `tk_main`/`StdinProc` in `ref/micropolis/src/sim/w_tk.c`.
    const partial = runtime.handleInputLine('puts hello');
    const complete = runtime.handleInputLine(' world\n');
    events.push(`partial:${String(partial)}`);
    events.push(`complete:${JSON.stringify(complete)}`);
    runtime.handleInputLine(null);

    // Sugar and NET paths must remain no-ops when not enabled.
    runtime.share();
    runtime.handleOutputLine('PlaySound Siren');
    events.push(`listen:${runtime.listenTo(3456)}`);
    runtime.hearFrom('file9');

    expect(events).toEqual([
      'stdout:"sim:\\n"',
      'eval:"puts hello world\\n"',
      'stdout:"tty:puts hello world\\n"',
      'stdout:"sim:\\n"',
      'partial:undefined',
      'complete:{"ok":true,"result":"tty:puts hello world"}',
      'exit:0',
      'listen:0',
    ]);
  });

  it('records deterministic net-only events', () => {
    const events: string[] = [];
    let recvCount = 0;

    const runtime = createIntegrationRuntime({
      features: {
        net: true,
      },
      hooks: {
        udp: {
          onPacketCommand(command) {
            events.push(`packet:${command}`);
          },
        },
        udpPlatform: {
          nonBlockingFlag: 4,
          createSocket(domain, type, protocol) {
            events.push(`platform:socket ${domain} ${type} ${protocol}`);
            return 11;
          },
          setReuseAddress(sock, enabled) {
            events.push(`platform:setsockopt ${sock} ${enabled}`);
            return true;
          },
          bindAny(sock, port) {
            events.push(`platform:bind ${sock} ${port}`);
            return true;
          },
          getFileStatusFlags(sock) {
            events.push(`platform:fcntl-get ${sock}`);
            return 2;
          },
          setFileStatusFlags(sock, flags) {
            events.push(`platform:fcntl-set ${sock} ${flags}`);
            return true;
          },
          makeOpenFile(sock, readable, writable) {
            events.push(`platform:open-file ${sock} ${readable} ${writable}`);
          },
          recvFrom(sock, addrLength) {
            events.push(`platform:recv ${sock} addr=${String(addrLength)}`);
            if (recvCount === 0) {
              recvCount += 1;
              return {
                kind: 'packet' as const,
                sourceIp: '203.0.113.7',
                bytes: [4, 5],
              };
            }

            return { kind: 'wouldBlock' as const };
          },
        },
      },
    });

    // Strict bind-port expectation mirrors `udp_listen` quirk in
    // `ref/micropolis/src/sim/w_net.c` where `sin_port` is assigned directly.
    const socket = runtime.listenTo(1234);
    events.push(`listen:${socket}`);
    runtime.hearFrom('file11');

    // Sugar and TTY paths must remain no-ops when not enabled.
    runtime.share();
    runtime.handleOutputLine('PlaySound Monster');
    events.push(`tty:${String(runtime.handleInputLine('puts ignored\\n'))}`);

    expect(events).toEqual([
      'platform:socket AF_INET SOCK_DGRAM 0',
      'platform:setsockopt 11 1',
      `platform:bind 11 ${expectedStrictBindPort(1234)}`,
      'platform:fcntl-get 11',
      'platform:fcntl-set 11 6',
      'platform:open-file 11 1 1',
      'listen:11',
      'platform:recv 11 addr=undefined',
      'packet:HandlePacket 11 {203.0.113.7} {  4   5 }',
      'platform:recv 11 addr=undefined',
      'tty:undefined',
    ]);
  });

  it('records deterministic sugar+tty+net events', () => {
    const events: string[] = [];
    let recvCount = 0;

    const runtime = createIntegrationRuntime({
      features: {
        sugar: true,
        tty: true,
        net: true,
      },
      hooks: {
        onSoundToken(soundName) {
          events.push(`sound:${soundName}`);
        },
        onSugarCommand(command) {
          events.push(`sugar:${JSON.stringify(command)}`);
        },
        evaluateTtyCommand(command) {
          events.push(`eval:${JSON.stringify(command)}`);
          return {
            ok: true,
            result: 'tty:ok',
          };
        },
        tty: {
          isTty: true,
          onWriteStdout(chunk) {
            events.push(`stdout:${JSON.stringify(chunk)}`);
          },
          onExit(exitCode) {
            events.push(`exit:${exitCode}`);
          },
        },
        udp: {
          onPacketCommand(command) {
            events.push(`packet:${command}`);
          },
        },
        udpPlatform: {
          nonBlockingFlag: 4,
          createSocket(domain, type, protocol) {
            events.push(`platform:socket ${domain} ${type} ${protocol}`);
            return 21;
          },
          setReuseAddress(sock, enabled) {
            events.push(`platform:setsockopt ${sock} ${enabled}`);
            return true;
          },
          bindAny(sock, port) {
            events.push(`platform:bind ${sock} ${port}`);
            return true;
          },
          getFileStatusFlags(sock) {
            events.push(`platform:fcntl-get ${sock}`);
            return 2;
          },
          setFileStatusFlags(sock, flags) {
            events.push(`platform:fcntl-set ${sock} ${flags}`);
            return true;
          },
          makeOpenFile(sock, readable, writable) {
            events.push(`platform:open-file ${sock} ${readable} ${writable}`);
          },
          recvFrom(sock, addrLength) {
            events.push(`platform:recv ${sock} addr=${String(addrLength)}`);
            if (recvCount === 0) {
              recvCount += 1;
              return {
                kind: 'packet' as const,
                sourceIp: '198.51.100.9',
                bytes: [1, 2, 3],
              };
            }

            return { kind: 'wouldBlock' as const };
          },
        },
      },
    });

    runtime.handleOutputLine('PlaySound Siren');
    runtime.share();
    runtime.buddyAppeared({
      key: 'all-1',
      nick: 'all-2',
      color: '#1,#2',
      address: '10.0.0.9',
    });

    const ttyResult = runtime.handleInputLine('status\n');
    events.push(`tty-result:${JSON.stringify(ttyResult)}`);

    const socket = runtime.listenTo(9000);
    events.push(`listen:${socket}`);
    runtime.hearFrom(`file${socket}`);

    runtime.focusOut();
    runtime.handleInputLine(null);

    expect(events).toEqual([
      'stdout:"sim:\\n"',
      'sound:siren',
      'sugar:"SugarShare\\n"',
      'sugar:"SugarBuddyAdd \\"all-1\\" \\"all-2\\" \\"#1,#2\\" \\"10.0.0.9\\"\\n"',
      'eval:"status\\n"',
      'stdout:"tty:ok\\n"',
      'stdout:"sim:\\n"',
      'tty-result:{"ok":true,"result":"tty:ok"}',
      'platform:socket AF_INET SOCK_DGRAM 0',
      'platform:setsockopt 21 1',
      `platform:bind 21 ${expectedStrictBindPort(9000)}`,
      'platform:fcntl-get 21',
      'platform:fcntl-set 21 6',
      'platform:open-file 21 1 1',
      'listen:21',
      'platform:recv 21 addr=undefined',
      'packet:HandlePacket 21 {198.51.100.9} {  1   2   3 }',
      'platform:recv 21 addr=undefined',
      'sugar:"SugarDeactivate\\n"',
      'exit:0',
    ]);
  });
});

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
