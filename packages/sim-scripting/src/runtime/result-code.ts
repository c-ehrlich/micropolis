/**
 * Tcl command return status codes used by Micropolis scripting commands.
 * Mirrors `TCL_OK`/`TCL_ERROR` usage in `ref/micropolis/src/sim/w_tk.c` and
 * command handlers like `SimCmd` in `ref/micropolis/src/sim/w_sim.c`.
 * This is a direct numeric parity mapping (`0` success, `1` error).
 */
export enum ScriptResultCode {
  Ok = 0,
  Error = 1,
}

/**
 * Successful script command result payload.
 * Mirrors the C pattern where `interp->result` is populated and `TCL_OK` is returned.
 * The TypeScript runtime keeps the same semantics but makes the value explicit.
 */
export interface ScriptRuntimeSuccess {
  readonly code: ScriptResultCode.Ok;
  readonly value: string;
}

/**
 * Failed script command result payload.
 * Mirrors the C pattern where a command returns `TCL_ERROR`.
 * Difference from C: we preserve structured error metadata for tests and callers.
 */
export interface ScriptRuntimeFailure {
  readonly code: ScriptResultCode.Error;
  readonly errorCode: string;
  readonly message: string;
}

/**
 * Union of success/error script command results.
 * Mirrors Tcl command status branching while staying explicit in TypeScript.
 */
export type ScriptRuntimeResult = ScriptRuntimeSuccess | ScriptRuntimeFailure;
