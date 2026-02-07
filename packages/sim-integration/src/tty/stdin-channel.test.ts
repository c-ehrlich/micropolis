import { describe, expect, it } from 'vitest';

import { StdinChannel } from './stdin-channel.ts';

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
});
