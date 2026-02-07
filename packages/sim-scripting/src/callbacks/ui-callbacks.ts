import type { ScriptRuntimeResult } from '../runtime/result-code.ts';
import type { ScriptRuntime } from '../runtime/script-runtime.ts';
import type { ScriptingCallbackReference, ScriptingState } from '../state/scripting-state.ts';

/**
 * One callback registration tuple (`<CallbackName> -> <ProcedureName>`).
 * Mirrors hard-coded C callback command strings that call `Eval("UI...")`
 * across `ref/micropolis/src/sim/w_tk.c`, `w_util.c`, `w_update.c`, and peers.
 * Difference from C: callback names can be remapped explicitly in state.
 */
export type UiCallbackRegistrationEntry<TCallback extends ScriptingCallbackReference> = readonly [
  callbackName: string,
  callbackReference: TCallback,
];

/**
 * Options for callback dispatch helpers.
 * Mirrors Tcl command evaluation in `Eval` (`ref/micropolis/src/sim/w_tk.c`).
 * Difference from C: dispatch is explicit and uses `ScriptRuntime` argv invocation.
 */
export interface UiCallbackDispatchOptions<
  TSim = unknown,
  TView = unknown,
  TSprite = unknown,
  TWidget = unknown,
  TCallback extends ScriptingCallbackReference = ScriptingCallbackReference,
> {
  runtime: ScriptRuntime;
  state: ScriptingState<TSim, TView, TSprite, TWidget, TCallback>;
}

/**
 * Callback dispatcher signature used by bridge-side callback wrappers.
 * Mirrors C call sites that emit Tcl callback procedure names plus argv payloads
 * via `Eval(...)` in `ref/micropolis/src/sim/w_tk.c` and related modules.
 */
export type UiCallbackDispatcher = (
  callbackName: string,
  callbackArgv?: readonly string[],
) => ScriptRuntimeResult;

/**
 * Registers or replaces one callback mapping in scripting state.
 * Mirrors C behavior where later script definitions replace earlier procedures,
 * while preserving case-sensitive callback command names.
 */
export function registerUiCallback<
  TSim = unknown,
  TView = unknown,
  TSprite = unknown,
  TWidget = unknown,
  TCallback extends ScriptingCallbackReference = ScriptingCallbackReference,
>(
  state: ScriptingState<TSim, TView, TSprite, TWidget, TCallback>,
  callbackName: string,
  callbackReference: TCallback,
): void {
  state.callbacks.set(callbackName, callbackReference);
}

/**
 * Registers a batch of callback mappings in insertion order.
 * Mirrors ordered Tcl script loading where procedure bindings can be overwritten
 * by later definitions (`source` flow in `ref/micropolis/src/sim/w_tk.c`).
 */
export function registerUiCallbacks<
  TSim = unknown,
  TView = unknown,
  TSprite = unknown,
  TWidget = unknown,
  TCallback extends ScriptingCallbackReference = ScriptingCallbackReference,
>(
  state: ScriptingState<TSim, TView, TSprite, TWidget, TCallback>,
  entries: Iterable<UiCallbackRegistrationEntry<TCallback>>,
): void {
  for (const [callbackName, callbackReference] of entries) {
    state.callbacks.set(callbackName, callbackReference);
  }
}

/**
 * Dispatches one UI callback by callback name and argv payload.
 * Mirrors C callback emission where procedures like `UISetFunds` are evaluated
 * by name with positional arguments (`Eval("UI...")` across `w_*.c`).
 * Parity note: if no remap exists, `callbackName` is invoked directly.
 */
export function dispatchUiCallback<
  TSim = unknown,
  TView = unknown,
  TSprite = unknown,
  TWidget = unknown,
  TCallback extends ScriptingCallbackReference = ScriptingCallbackReference,
>(
  options: UiCallbackDispatchOptions<TSim, TView, TSprite, TWidget, TCallback>,
  callbackName: string,
  callbackArgv: readonly string[] = [],
): ScriptRuntimeResult {
  const callbackReference = options.state.callbacks.get(callbackName) ?? callbackName;
  return options.runtime.invoke([callbackReference, ...callbackArgv]);
}

/**
 * Creates a reusable callback dispatcher bound to one runtime/state bundle.
 * Mirrors global bridge callback routing through `Eval` in
 * `ref/micropolis/src/sim/w_tk.c`.
 * Difference from C: dispatch closure is explicit and test-friendly.
 */
export function createUiCallbackDispatcher<
  TSim = unknown,
  TView = unknown,
  TSprite = unknown,
  TWidget = unknown,
  TCallback extends ScriptingCallbackReference = ScriptingCallbackReference,
>(
  options: UiCallbackDispatchOptions<TSim, TView, TSprite, TWidget, TCallback>,
): UiCallbackDispatcher {
  return (callbackName: string, callbackArgv: readonly string[] = []) => {
    return dispatchUiCallback(options, callbackName, callbackArgv);
  };
}
