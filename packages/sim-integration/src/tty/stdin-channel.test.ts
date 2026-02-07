import { describe, expect, it } from 'vitest';

import { StdinChannel } from './stdin-channel.ts';

describe('StdinChannel startup prompt parity', () => {
  it('emits the exact initial tty prompt when the channel starts', () => {
    // Mirrors `tk_main` startup behavior in ref/micropolis/src/sim/w_tk.c:
    // `if (sim_tty) printf("sim:\\n");`
    const stdoutChunks: string[] = [];
    const channel = new StdinChannel({
      isTty: true,
      evaluateCommand() {
        return {
          ok: true,
          result: '',
        };
      },
      onWriteStdout(chunk) {
        stdoutChunks.push(chunk);
      },
    });

    channel.start();
    channel.start();

    expect(stdoutChunks).toEqual(['sim:\n']);
  });
});

describe('StdinChannel StdinProc EOF parity', () => {
  it('triggers exit callback on EOF with no partial command in tty mode', () => {
    // Mirrors `StdinProc` in ref/micropolis/src/sim/w_tk.c:
    // `if (fgets(...) == NULL && !gotPartial && sim_tty) sim_exit(0);`
    // so exit code `0` is parity with Micropolis `sim_exit(0)`.
    const exitCodes: number[] = [];
    const evaluatedCommands: string[] = [];
    const channel = new StdinChannel({
      isTty: true,
      evaluateCommand(command) {
        evaluatedCommands.push(command);
        return {
          ok: true,
          result: '',
        };
      },
      onExit(exitCode) {
        exitCodes.push(exitCode);
      },
    });

    channel.consumeLine(null);

    expect(exitCodes).toEqual([0]);
    expect(evaluatedCommands).toEqual([]);
  });

  it('disables further reads on EOF with no partial command in non-tty mode', () => {
    // Mirrors `StdinProc` in ref/micropolis/src/sim/w_tk.c:
    // `if (fgets(...) == NULL && !gotPartial && !sim_tty) Tk_DeleteFileHandler(0);`
    // so non-tty EOF removes the stdin readable handler and later reads do nothing.
    const evaluatedCommands: string[] = [];
    const disableReadEvents: string[] = [];
    const exitCodes: number[] = [];
    const channel = new StdinChannel({
      isTty: false,
      evaluateCommand(command) {
        evaluatedCommands.push(command);
        return {
          ok: true,
          result: '',
        };
      },
      onDisableReads() {
        disableReadEvents.push('disabled');
      },
      onExit(exitCode) {
        exitCodes.push(exitCode);
      },
    });

    channel.consumeLine(null);
    channel.consumeLine('puts hello');

    expect(channel.isReadEnabled()).toBe(false);
    expect(disableReadEvents).toEqual(['disabled']);
    expect(exitCodes).toEqual([]);
    expect(evaluatedCommands).toEqual([]);
  });

  it('treats EOF with a partial command as an empty line and continues', () => {
    // Mirrors `StdinProc` in ref/micropolis/src/sim/w_tk.c:
    // `if (fgets(...) == NULL && gotPartial) line[0] = 0;`
    // followed by `cmd = Tcl_AssembleCmd(buffer, line);` and eval.
    const evaluatedCommands: string[] = [];
    const disableReadEvents: string[] = [];
    const exitCodes: number[] = [];
    const channel = new StdinChannel({
      isTty: false,
      evaluateCommand(command) {
        evaluatedCommands.push(command);
        return {
          ok: true,
          result: '',
        };
      },
      onDisableReads() {
        disableReadEvents.push('disabled');
      },
      onExit(exitCode) {
        exitCodes.push(exitCode);
      },
    });

    // No newline means command is still partial, matching Tcl_AssembleCmd(NULL) path.
    channel.consumeLine('puts hello');
    channel.consumeLine(null);

    expect(evaluatedCommands).toEqual(['puts hello']);
    expect(channel.isReadEnabled()).toBe(true);
    expect(disableReadEvents).toEqual([]);
    expect(exitCodes).toEqual([]);
  });
});

describe('StdinChannel StdinProc result printing parity', () => {
  it('does not print successful non-tty results', () => {
    // Mirrors `StdinProc` in ref/micropolis/src/sim/w_tk.c:
    // non-empty `tk_mainInterp->result` is printed only when
    // `(result != TCL_OK) || sim_tty` is true.
    const stdoutChunks: string[] = [];
    const channel = new StdinChannel({
      isTty: false,
      evaluateCommand() {
        return {
          ok: true,
          result: 'ok output',
        };
      },
      onWriteStdout(chunk) {
        stdoutChunks.push(chunk);
      },
    });

    channel.consumeLine('puts ok output\n');

    expect(stdoutChunks).toEqual([]);
  });

  it('prints error results in non-tty mode', () => {
    // Mirrors the `(result != TCL_OK)` side of the print condition in
    // `StdinProc` from ref/micropolis/src/sim/w_tk.c.
    const stdoutChunks: string[] = [];
    const channel = new StdinChannel({
      isTty: false,
      evaluateCommand() {
        return {
          ok: false,
          result: 'command failed',
        };
      },
      onWriteStdout(chunk) {
        stdoutChunks.push(chunk);
      },
    });

    channel.consumeLine('bad command\n');

    expect(stdoutChunks).toEqual(['command failed\n']);
  });

  it('prints successful results in tty mode', () => {
    // Mirrors the `|| sim_tty` side of the print condition in
    // `StdinProc` from ref/micropolis/src/sim/w_tk.c.
    const stdoutChunks: string[] = [];
    const channel = new StdinChannel({
      isTty: true,
      evaluateCommand() {
        return {
          ok: true,
          result: 'command output',
        };
      },
      onWriteStdout(chunk) {
        stdoutChunks.push(chunk);
      },
    });

    channel.consumeLine('puts command output\n');

    expect(stdoutChunks).toContain('command output\n');
  });

  it('emits the exact tty prompt after each completed command', () => {
    // Mirrors `StdinProc` in ref/micropolis/src/sim/w_tk.c:
    // `if (sim_tty) { printf("sim:\\n"); fflush(stdout); }`
    // after every successful `Tcl_RecordAndEval` command completion.
    const stdoutChunks: string[] = [];
    const channel = new StdinChannel({
      isTty: true,
      evaluateCommand() {
        return {
          ok: true,
          result: '',
        };
      },
      onWriteStdout(chunk) {
        stdoutChunks.push(chunk);
      },
    });

    channel.consumeLine('puts one\n');
    channel.consumeLine('puts two\n');

    expect(stdoutChunks).toEqual(['sim:\n', 'sim:\n']);
  });
});
