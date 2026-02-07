import {
  makeScriptFailure,
  mapThrownToScriptResult,
  ScriptRuntimeError,
  ScriptRuntimeErrorCode,
} from './errors.ts';
import type { ScriptRuntimeResult } from './result-code.ts';

/**
 * Script command handler signature for Tcl-like command dispatch.
 * Mirrors command entrypoints registered with `Tcl_CreateCommand` in
 * `ref/micropolis/src/sim/w_tk.c`, where each command receives argv-style data.
 * Difference from C: handlers return explicit typed results instead of mutating `interp->result`.
 */
export type ScriptCommandHandler = (argv: readonly string[]) => ScriptRuntimeResult;

/**
 * Minimal command runtime used to register and invoke Tcl-like commands.
 * Mirrors the hash-based dispatch flow in `SimCmd` at `ref/micropolis/src/sim/w_sim.c`
 * (`Tcl_FindHashEntry` -> invoke command function -> return `TCL_OK`/`TCL_ERROR`).
 * Difference from C: this kernel dispatches top-level command names and normalizes
 * failures into structured TypeScript result objects.
 */
export class ScriptRuntime {
  readonly #commands = new Map<string, ScriptCommandHandler>();

  /**
   * Registers or replaces a command handler by exact command name.
   * Mirrors `Tcl_CreateCommand` behavior in `ref/micropolis/src/sim/w_tk.c`,
   * where command names are case-sensitive and later registrations replace previous ones.
   */
  registerCommand(name: string, handler: ScriptCommandHandler): void {
    this.#commands.set(name, handler);
  }

  /**
   * Evaluates one argv command invocation against the runtime registry.
   * Mirrors `SimCmd` argument/lookup behavior in `ref/micropolis/src/sim/w_sim.c`:
   * missing command input or unknown command name returns a command error.
   */
  invoke(argv: readonly string[]): ScriptRuntimeResult {
    const [commandName] = argv;
    if (commandName === undefined) {
      return makeScriptFailure(
        new ScriptRuntimeError(
          ScriptRuntimeErrorCode.InvalidArgCount,
          'command invocation requires at least one argv item',
        ),
      );
    }

    const handler = this.#commands.get(commandName);
    if (handler === undefined) {
      return makeScriptFailure(
        new ScriptRuntimeError(
          ScriptRuntimeErrorCode.UnknownCommand,
          `unknown command: ${commandName}`,
        ),
      );
    }

    try {
      return handler(argv);
    } catch (thrown) {
      return mapThrownToScriptResult(thrown);
    }
  }
}
