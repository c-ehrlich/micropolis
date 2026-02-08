import { ScriptRuntime } from '../runtime/script-runtime.ts';
import {
  createScriptingState,
  type CreateScriptingStateOptions,
  type ScriptingCallbackReference,
  type ScriptingState,
} from '../state/scripting-state.ts';

/**
 * Bootstrapped runtime/state bundle for the scripting bridge.
 * Mirrors interpreter + command-table + bridge-state setup spanning
 * `tk_main`/`sim_command_init` in `ref/micropolis/src/sim/w_tk.c` and
 * `ref/micropolis/src/sim/w_sim.c`.
 * Difference from C: bootstrap products are returned explicitly instead of
 * being stored in process-global variables.
 */
export interface SimScriptingRuntimeBundle<
  TSim = unknown,
  TView = unknown,
  TSprite = unknown,
  TWidget = unknown,
  TCallback extends ScriptingCallbackReference = ScriptingCallbackReference,
> {
  readonly runtime: ScriptRuntime;
  readonly state: ScriptingState<TSim, TView, TSprite, TWidget, TCallback>;
}

/**
 * Hook used to register baseline top-level commands during bootstrap.
 * Mirrors ordered command registration in `tk_main` (`sim_command_init`,
 * `map_command_init`, `editor_command_init`, etc.) in
 * `ref/micropolis/src/sim/w_tk.c`.
 * Difference from C: registration is injected through a callback instead of
 * hard-coded interpreter setup calls.
 */
export type RegisterBaseCommandsHook<
  TSim = unknown,
  TView = unknown,
  TSprite = unknown,
  TWidget = unknown,
  TCallback extends ScriptingCallbackReference = ScriptingCallbackReference,
> = (bundle: SimScriptingRuntimeBundle<TSim, TView, TSprite, TWidget, TCallback>) => void;

/**
 * Constructor options for `createSimScriptingRuntime`.
 * Mirrors C bootstrap inputs passed implicitly through globals and setup order
 * in `ref/micropolis/src/sim/w_tk.c`.
 * Difference from C: callers can inject an existing runtime instance for tests.
 */
export interface CreateSimScriptingRuntimeOptions<
  TSim = unknown,
  TView = unknown,
  TSprite = unknown,
  TWidget = unknown,
  TCallback extends ScriptingCallbackReference = ScriptingCallbackReference,
> extends CreateScriptingStateOptions<TSim, TCallback> {
  runtime?: ScriptRuntime;
  registerBaseCommands?: RegisterBaseCommandsHook<TSim, TView, TSprite, TWidget, TCallback>;
}

/**
 * Creates a ready-to-wire scripting runtime from one API entrypoint.
 * Mirrors command/bootstrap sequencing around `sim_command_init` and related
 * command initializers in `ref/micropolis/src/sim/w_tk.c`.
 * Parity note: command names remain case-sensitive because registration and
 * lookup continue to use `ScriptRuntime`'s exact-key map behavior.
 */
export function createSimScriptingRuntime<
  TSim = unknown,
  TView = unknown,
  TSprite = unknown,
  TWidget = unknown,
  TCallback extends ScriptingCallbackReference = ScriptingCallbackReference,
>(
  options: CreateSimScriptingRuntimeOptions<TSim, TView, TSprite, TWidget, TCallback> = {},
): SimScriptingRuntimeBundle<TSim, TView, TSprite, TWidget, TCallback> {
  const runtime = options.runtime ?? new ScriptRuntime();
  const state = createScriptingState<TSim, TView, TSprite, TWidget, TCallback>({
    sim: options.sim,
    callbackEntries: options.callbackEntries,
  });
  const bundle = {
    runtime,
    state,
  };

  options.registerBaseCommands?.(bundle);
  return bundle;
}
