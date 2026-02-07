import { describe, expect, it } from 'vitest';

import { makeScriptSuccess, ScriptRuntimeError, ScriptRuntimeErrorCode } from './errors.ts';
import { ScriptResultCode } from './result-code.ts';
import { ScriptRuntime } from './script-runtime.ts';

describe('script runtime kernel', () => {
  it('registers command handlers and dispatches argv invocations', () => {
    // Mirrors command lookup and invocation in `SimCmd` (`ref/micropolis/src/sim/w_sim.c`),
    // where a hash-table hit calls the mapped command function.
    const runtime = new ScriptRuntime();
    runtime.registerCommand('sim', (argv) => makeScriptSuccess(`${argv[1]}=${argv[2]}`));

    const result = runtime.invoke(['sim', 'Speed', '3']);

    expect(result).toEqual({
      code: ScriptResultCode.Ok,
      value: 'Speed=3',
    });
  });

  it('returns an unknown-command error when argv[0] is not registered', () => {
    // Mirrors the `TCL_ERROR` branch in `SimCmd` when `Tcl_FindHashEntry` misses.
    const runtime = new ScriptRuntime();

    expect(runtime.invoke(['SIM'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.UnknownCommand,
      message: 'unknown command: SIM',
    });
  });

  it('normalizes thrown handler errors into runtime failures', () => {
    const runtime = new ScriptRuntime();
    runtime.registerCommand('sim', () => {
      throw new ScriptRuntimeError(ScriptRuntimeErrorCode.InvalidInteger, 'expected int');
    });

    expect(runtime.invoke(['sim', 'Speed', 'oops'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.InvalidInteger,
      message: 'expected int',
    });
  });
});
