import { describe, expect, it } from 'vitest';

import {
  makeScriptFailure,
  makeScriptSuccess,
  mapThrownToScriptResult,
  ScriptRuntimeError,
  ScriptRuntimeErrorCode,
} from './errors.ts';
import { ScriptResultCode } from './result-code.ts';

describe('script runtime result/error primitives', () => {
  it('maps typed runtime errors into Tcl-style error results', () => {
    // Mirrors `TCL_ERROR` return paths in `SimCmd` (`ref/micropolis/src/sim/w_sim.c`)
    // where unknown commands/subcommands fail dispatch.
    const runtimeError = new ScriptRuntimeError(
      ScriptRuntimeErrorCode.UnknownCommand,
      'unknown command: simx',
    );

    expect(makeScriptFailure(runtimeError)).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.UnknownCommand,
      message: 'unknown command: simx',
    });
  });

  it('creates Tcl-style success results and normalizes unknown throwables', () => {
    expect(makeScriptSuccess('42')).toEqual({
      code: ScriptResultCode.Ok,
      value: '42',
    });

    const thrownResult = mapThrownToScriptResult(new Error('boom'));
    expect(thrownResult).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.Internal,
      message: 'boom',
    });
  });
});
