import {
  makeScriptFailure,
  ScriptRuntimeError,
  ScriptRuntimeErrorCode,
} from '../runtime/errors.ts';
import type { ScriptRuntimeResult } from '../runtime/result-code.ts';
import type { ScriptCommandHandler, ScriptRuntime } from '../runtime/script-runtime.ts';

/**
 * Handler signature for `sim <Subcommand> ...` entries.
 * Mirrors `SimCmd*` function pointer entries inserted into `SimCmds`
 * by `sim_command_init` in `ref/micropolis/src/sim/w_sim.c`.
 * Parity note: handlers receive the full argv list (`sim` + subcommand + args),
 * which is 1:1 with the C command-function calling convention.
 */
export type SimSubcommandHandler = (argv: readonly string[]) => ScriptRuntimeResult;

/**
 * Case-sensitive lookup table for `sim` subcommands.
 * Mirrors the `Tcl_HashTable SimCmds` registration/lookup table in
 * `ref/micropolis/src/sim/w_sim.c`.
 * Difference from C: this table is typed and immutable-by-interface.
 */
export type SimSubcommandTable = ReadonlyMap<string, SimSubcommandHandler>;

/**
 * Default `sim` subcommand table.
 * Mirrors the empty table before `sim_command_init` calls `HASHED_CMD(...)`
 * in `ref/micropolis/src/sim/w_sim.c`.
 * Parity note: this starts empty in P1.1 and is filled by later tasks.
 */
export const SIM_SUBCOMMAND_TABLE: SimSubcommandTable = new Map();

/**
 * Creates the `sim` top-level command dispatcher.
 * Mirrors `SimCmd` in `ref/micropolis/src/sim/w_sim.c`: require `argv[1]`,
 * then hash-lookup the subcommand and invoke its handler.
 * Difference from C: errors are normalized to structured runtime failures
 * (`INVALID_ARG_COUNT` / `UNKNOWN_SUBCOMMAND`) instead of raw `TCL_ERROR`.
 */
export function createSimCommandDispatcher(
  subcommands: SimSubcommandTable = SIM_SUBCOMMAND_TABLE,
): ScriptCommandHandler {
  return (argv: readonly string[]): ScriptRuntimeResult => {
    const subcommandName = argv[1];
    if (subcommandName === undefined) {
      return makeScriptFailure(
        new ScriptRuntimeError(
          ScriptRuntimeErrorCode.InvalidArgCount,
          'sim command requires a subcommand in argv[1]',
        ),
      );
    }

    const subcommandHandler = subcommands.get(subcommandName);
    if (subcommandHandler === undefined) {
      return makeScriptFailure(
        new ScriptRuntimeError(
          ScriptRuntimeErrorCode.UnknownSubcommand,
          `unknown sim subcommand: ${subcommandName}`,
        ),
      );
    }

    return subcommandHandler(argv);
  };
}

/**
 * Registers the top-level `sim` command in a runtime.
 * Mirrors `Tcl_CreateCommand(..., "sim", SimCmd, ...)` in
 * `sim_command_init` (`ref/micropolis/src/sim/w_sim.c`).
 * Parity note: command naming remains case-sensitive via `ScriptRuntime`.
 */
export function registerSimCommand(
  runtime: ScriptRuntime,
  subcommands: SimSubcommandTable = SIM_SUBCOMMAND_TABLE,
): void {
  runtime.registerCommand('sim', createSimCommandDispatcher(subcommands));
}
