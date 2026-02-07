import { describe, expect, it } from 'vitest';

import { makeScriptSuccess, ScriptRuntimeErrorCode } from '../runtime/errors.ts';
import { ScriptResultCode } from '../runtime/result-code.ts';
import { ScriptRuntime } from '../runtime/script-runtime.ts';
import { createSimCommandDispatcher, registerSimCommand } from './sim-command.ts';

describe('sim command dispatcher', () => {
  it('dispatches `sim <Subcommand>` using a case-sensitive subcommand table', () => {
    // Mirrors `SimCmd` + `Tcl_FindHashEntry(&SimCmds, argv[1])` dispatch in
    // `ref/micropolis/src/sim/w_sim.c`, where keys are registered by exact case.
    const runtime = new ScriptRuntime();
    registerSimCommand(
      runtime,
      new Map([
        [
          'Speed',
          (argv) => {
            return makeScriptSuccess(`Speed=${argv[2] ?? ''}`);
          },
        ],
      ]),
    );

    expect(runtime.invoke(['sim', 'Speed', '3'])).toEqual({
      code: ScriptResultCode.Ok,
      value: 'Speed=3',
    });
  });

  it('returns an arg-count error when `sim` is invoked without argv[1]', () => {
    const simDispatcher = createSimCommandDispatcher(new Map());

    expect(simDispatcher(['sim'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.InvalidArgCount,
      message: 'sim command requires a subcommand in argv[1]',
    });
  });

  it('returns a typed unknown-subcommand error when lookup misses', () => {
    const runtime = new ScriptRuntime();
    registerSimCommand(runtime, new Map([['Speed', () => makeScriptSuccess('3')]]));

    expect(runtime.invoke(['sim', 'speed'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.UnknownSubcommand,
      message: 'unknown sim subcommand: speed',
    });
  });
});
