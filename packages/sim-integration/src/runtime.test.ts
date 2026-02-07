import { describe, expect, it } from 'vitest';

import {
  createIntegrationRuntime,
  DEFAULT_INTEGRATION_FEATURE_FLAGS,
  DEFAULT_PARITY_MODE,
} from './runtime.ts';

describe('integration runtime scaffold defaults', () => {
  it('creates a runtime with strict parity mode and all integration features disabled by default', () => {
    // Parity baseline mirrors `sim.c` startup where optional integration paths
    // (Sugar/TTY/NET) are not enabled unless explicitly configured.
    const runtime = createIntegrationRuntime();

    expect(runtime.mode).toBe(DEFAULT_PARITY_MODE);
    expect(runtime.features).toEqual(DEFAULT_INTEGRATION_FEATURE_FLAGS);
    expect(runtime.features).not.toBe(DEFAULT_INTEGRATION_FEATURE_FLAGS);
  });

  it('applies partial feature overrides while preserving default values for unspecified flags', () => {
    const runtime = createIntegrationRuntime({
      features: {
        tty: true,
      },
    });

    expect(runtime.features).toEqual({
      sugar: false,
      tty: true,
      net: false,
    });
  });
});

describe('integration runtime Sugar stdout handling', () => {
  it('surfaces strict-mode malformed PlaySound parity failure', () => {
    // Mirrors micropolisactivity.py `_stdout_thread_function` behavior where
    // `play_sound(words[1])` on "PlaySound" raises IndexError and aborts loop.
    const runtime = createIntegrationRuntime({
      mode: 'strict',
      features: {
        sugar: true,
      },
    });

    expect(() => runtime.handleOutputLine('PlaySound')).toThrowError(
      new RangeError('list index out of range'),
    );
  });

  it('passes through valid PlaySound token to the sound hook as lowercase for wav mapping parity', () => {
    const soundTokens: string[] = [];
    const runtime = createIntegrationRuntime({
      features: {
        sugar: true,
      },
      hooks: {
        onSoundToken(soundName) {
          soundTokens.push(soundName);
        },
      },
    });

    runtime.handleOutputLine('PlaySound Bulldozer');
    expect(soundTokens).toEqual(['bulldozer']);
  });

  it('keeps processing after malformed PlaySound in safe mode', () => {
    const soundTokens: string[] = [];
    const runtime = createIntegrationRuntime({
      mode: 'safe',
      features: {
        sugar: true,
      },
      hooks: {
        onSoundToken(soundName) {
          soundTokens.push(soundName);
        },
      },
    });

    expect(() => runtime.handleOutputLine('PlaySound')).not.toThrow();
    runtime.handleOutputLine('PlaySound Siren');
    expect(soundTokens).toEqual(['siren']);
  });
});

describe('integration runtime Sugar command bridge wiring', () => {
  it('serializes lifecycle and buddy events through the Sugar command hook', () => {
    const sugarCommands: string[] = [];
    const runtime = createIntegrationRuntime({
      features: {
        sugar: true,
      },
      hooks: {
        onSugarCommand(command) {
          sugarCommands.push(command);
        },
      },
    });

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

    expect(sugarCommands).toEqual([
      'SugarShare\n',
      'SugarActivate\n',
      'SugarDeactivate\n',
      'SugarQuit\n',
      'SugarBuddyAdd "k-1" "n-1" "#00A0FF,#F0F0F0" "10.0.0.1"\n',
      'SugarBuddyDel "k-2" "n-2" "#FF0000,#FFFFFF" "10.0.0.2"\n',
    ]);
  });
});

describe('integration runtime TTY module wiring', () => {
  it('assembles partial input lines and returns evaluator results for complete commands', () => {
    const evaluatedCommands: string[] = [];
    const runtime = createIntegrationRuntime({
      features: {
        tty: true,
      },
      hooks: {
        evaluateTtyCommand(command) {
          evaluatedCommands.push(command);
          return {
            ok: true,
            result: `eval:${command}`,
          };
        },
      },
    });

    const partialResult = runtime.handleInputLine('puts hello');
    const completeResult = runtime.handleInputLine(' world\n');

    expect(partialResult).toBeUndefined();
    expect(completeResult).toEqual({
      ok: true,
      result: 'eval:puts hello world\n',
    });
    expect(evaluatedCommands).toEqual(['puts hello world\n']);
  });

  it('emits tty prompt output through StdinChannel hooks when tty mode is enabled', () => {
    const stdoutChunks: string[] = [];
    const runtime = createIntegrationRuntime({
      features: {
        tty: true,
      },
      hooks: {
        evaluateTtyCommand() {
          return {
            ok: true,
            result: '',
          };
        },
        tty: {
          isTty: true,
          onWriteStdout(chunk) {
            stdoutChunks.push(chunk);
          },
        },
      },
    });

    runtime.handleInputLine('puts ready\n');

    expect(stdoutChunks).toEqual(['sim:\n', 'sim:\n']);
  });

  it('passes EOF through handleInputLine to trigger tty exit parity behavior', () => {
    const exitCodes: number[] = [];
    const runtime = createIntegrationRuntime({
      features: {
        tty: true,
      },
      hooks: {
        evaluateTtyCommand() {
          throw new Error('evaluateTtyCommand should not be called on EOF with no partial input');
        },
        tty: {
          isTty: true,
          onExit(exitCode) {
            exitCodes.push(exitCode);
          },
        },
      },
    });

    expect(runtime.handleInputLine(null)).toBeUndefined();
    expect(exitCodes).toEqual([0]);
  });

  it('passes EOF through handleInputLine to disable non-tty reads', () => {
    const evaluatedCommands: string[] = [];
    const disableReadCalls: string[] = [];
    const runtime = createIntegrationRuntime({
      features: {
        tty: true,
      },
      hooks: {
        evaluateTtyCommand(command) {
          evaluatedCommands.push(command);
          return {
            ok: true,
            result: '',
          };
        },
        tty: {
          isTty: false,
          onDisableReads() {
            disableReadCalls.push('disabled');
          },
        },
      },
    });

    expect(runtime.handleInputLine(null)).toBeUndefined();
    expect(disableReadCalls).toEqual(['disabled']);

    // Mirrors `Tk_DeleteFileHandler(0)` behavior in `StdinProc`: no more reads
    // should be processed once non-tty EOF is reached.
    expect(runtime.handleInputLine('puts ignored\n')).toBeUndefined();
    expect(evaluatedCommands).toEqual([]);
  });
});

describe('integration runtime NET module wiring', () => {
  it('delegates listen/hear calls through the UDP hook runtime when a platform is provided', () => {
    const platformCalls: string[] = [];
    const packetCommands: string[] = [];
    let recvCount = 0;
    const runtime = createIntegrationRuntime({
      features: {
        net: true,
      },
      hooks: {
        udp: {
          onPacketCommand(command) {
            packetCommands.push(command);
          },
        },
        udpPlatform: {
          nonBlockingFlag: 4,
          createSocket(domain, type, protocol) {
            platformCalls.push(`socket ${domain} ${type} ${protocol}`);
            return 11;
          },
          setReuseAddress(sock, enabled) {
            platformCalls.push(`setsockopt ${sock} ${enabled}`);
            return true;
          },
          bindAny(sock, port) {
            platformCalls.push(`bind ${sock} ${port}`);
            return true;
          },
          getFileStatusFlags(sock) {
            platformCalls.push(`fcntl-get ${sock}`);
            return 2;
          },
          setFileStatusFlags(sock, flags) {
            platformCalls.push(`fcntl-set ${sock} ${flags}`);
            return true;
          },
          makeOpenFile(sock, readable, writable) {
            platformCalls.push(`open-file ${sock} ${readable} ${writable}`);
          },
          recvFrom(sock) {
            platformCalls.push(`recv ${sock}`);
            if (recvCount === 0) {
              recvCount += 1;
              return {
                kind: 'packet',
                sourceIp: '203.0.113.7',
                bytes: [4, 5],
              };
            }

            return { kind: 'wouldBlock' };
          },
        },
      },
    });

    expect(runtime.listenTo(1234)).toBe(11);
    runtime.hearFrom('file11');

    expect(platformCalls).toEqual([
      'socket AF_INET SOCK_DGRAM 0',
      'setsockopt 11 1',
      `bind 11 ${expectedStrictBindPort(1234)}`,
      'fcntl-get 11',
      'fcntl-set 11 6',
      'open-file 11 1 1',
      'recv 11',
      'recv 11',
    ]);
    expect(packetCommands).toEqual(['HandlePacket 11 {203.0.113.7} {  4   5 }']);
  });

  it('keeps NET runtime methods as no-ops when no UDP platform is wired', () => {
    const runtime = createIntegrationRuntime({
      features: {
        net: true,
      },
    });

    expect(runtime.listenTo(5000)).toBe(0);
    expect(() => runtime.hearFrom('file5')).not.toThrow();
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
