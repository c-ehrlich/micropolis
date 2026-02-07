import {
  ScriptResultCode,
  type ScriptRuntimeFailure,
  type ScriptRuntimeResult,
  type ScriptRuntimeSuccess,
} from './result-code.ts';

/**
 * Structured error kinds for script command evaluation.
 * Mirrors Tcl command failure branches in `SimCmd` and related handlers in
 * `ref/micropolis/src/sim/w_sim.c` (unknown command/subcommand and argument errors).
 */
export enum ScriptRuntimeErrorCode {
  UnknownCommand = 'UNKNOWN_COMMAND',
  UnknownSubcommand = 'UNKNOWN_SUBCOMMAND',
  InvalidArgCount = 'INVALID_ARG_COUNT',
  InvalidInteger = 'INVALID_INTEGER',
  Internal = 'INTERNAL',
}

/**
 * Runtime error object for command handlers and dispatch logic.
 * This is an intentional TypeScript enhancement over the C code to keep failures
 * typed while still mapping back to `TCL_ERROR`-style command results.
 */
export class ScriptRuntimeError extends Error {
  readonly code: ScriptRuntimeErrorCode;

  constructor(code: ScriptRuntimeErrorCode, message: string) {
    super(message);
    this.name = 'ScriptRuntimeError';
    this.code = code;
  }
}

/**
 * Builds a `TCL_OK`-equivalent runtime result.
 * Mirrors successful C command completion where `interp->result` is set.
 */
export function makeScriptSuccess(value = ''): ScriptRuntimeSuccess {
  return {
    code: ScriptResultCode.Ok,
    value,
  };
}

/**
 * Converts a typed runtime error to a `TCL_ERROR`-equivalent result payload.
 * Mirrors command failure returns in the C bridge while retaining error metadata.
 */
export function makeScriptFailure(error: ScriptRuntimeError): ScriptRuntimeFailure {
  return {
    code: ScriptResultCode.Error,
    errorCode: error.code,
    message: error.message,
  };
}

/**
 * Normalizes thrown values into runtime result objects.
 * Mirrors `Eval` error-path handling in `ref/micropolis/src/sim/w_tk.c`.
 * Difference from C: unknown throwables are normalized into a typed internal error.
 */
export function mapThrownToScriptResult(thrown: unknown): ScriptRuntimeResult {
  if (thrown instanceof ScriptRuntimeError) {
    return makeScriptFailure(thrown);
  }

  const internalError =
    thrown instanceof Error
      ? new ScriptRuntimeError(ScriptRuntimeErrorCode.Internal, thrown.message)
      : new ScriptRuntimeError(ScriptRuntimeErrorCode.Internal, String(thrown));
  return makeScriptFailure(internalError);
}
