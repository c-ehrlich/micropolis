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
});
