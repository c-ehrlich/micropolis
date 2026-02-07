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

/**
 * Dispatches the startup bootstrap callback with home/resource/host paths.
 * Mirrors `sprintf("UIStartMicropolis {%s} {%s} {%s}", ...)` in
 * `ref/micropolis/src/sim/w_tk.c`.
 * Difference from C: argv values are passed directly through the dispatcher
 * instead of Tcl string interpolation with braces.
 */
export function dispatchUiStartMicropolis(
  dispatch: UiCallbackDispatcher,
  homeDir: string,
  resourceDir: string,
  hostName: string,
): ScriptRuntimeResult {
  return dispatch('UIStartMicropolis', [homeDir, resourceDir, hostName]);
}

/**
 * Dispatches the new-city lifecycle callback.
 * Mirrors `Eval("UIPlayNewCity")` in `DoPlayNewCity`
 * (`ref/micropolis/src/sim/w_stubs.c`).
 * Difference from C: callback invocation is explicit and testable.
 */
export function dispatchUiPlayNewCity(dispatch: UiCallbackDispatcher): ScriptRuntimeResult {
  return dispatch('UIPlayNewCity');
}

/**
 * Dispatches the "really start game" lifecycle callback.
 * Mirrors `Eval("UIReallyStartGame")` in `DoReallyStartGame`
 * (`ref/micropolis/src/sim/w_stubs.c`).
 * Difference from C: callback invocation is explicit and testable.
 */
export function dispatchUiReallyStartGame(dispatch: UiCallbackDispatcher): ScriptRuntimeResult {
  return dispatch('UIReallyStartGame');
}

/**
 * Dispatches the load-start lifecycle callback.
 * Mirrors `Eval("UIStartLoad")` in `DoStartLoad`
 * (`ref/micropolis/src/sim/w_stubs.c`).
 * Difference from C: callback invocation is explicit and testable.
 */
export function dispatchUiStartLoad(dispatch: UiCallbackDispatcher): ScriptRuntimeResult {
  return dispatch('UIStartLoad');
}

/**
 * Dispatches the scenario-start lifecycle callback with C `%d` integer shape.
 * Mirrors `sprintf("UIStartScenario %d", scenario)` in `DoStartScenario`
 * (`ref/micropolis/src/sim/w_stubs.c`).
 * Difference from C: the scenario comes from a JS number and is truncated
 * toward zero before conversion to argv text.
 */
export function dispatchUiStartScenario(
  dispatch: UiCallbackDispatcher,
  scenario: number,
): ScriptRuntimeResult {
  return dispatch('UIStartScenario', [String(Math.trunc(scenario))]);
}

/**
 * Dispatches the new-game lifecycle callback.
 * Mirrors `Eval("UINewGame")` in `DoNewGame`
 * (`ref/micropolis/src/sim/w_util.c`).
 * Difference from C: callback invocation is explicit and testable.
 */
export function dispatchUiNewGame(dispatch: UiCallbackDispatcher): ScriptRuntimeResult {
  return dispatch('UINewGame');
}

/**
 * Dispatches toolkit-shutdown lifecycle callback.
 * Mirrors `Eval("catch {DoStopMicropolis}")` in `StopToolkit`
 * (`ref/micropolis/src/sim/w_tk.c`), where Tcl then invokes `DoStopMicropolis`.
 * Difference from C: `catch` error suppression is not modeled here.
 */
export function dispatchDoStopMicropolis(dispatch: UiCallbackDispatcher): ScriptRuntimeResult {
  return dispatch('DoStopMicropolis');
}

/**
 * Dispatches the save-as prompt callback.
 * Mirrors `Eval("UISaveCityAs")` in `DoSaveCityAs`
 * (`ref/micropolis/src/sim/s_fileio.c`).
 * Difference from C: callback invocation is explicit and testable.
 */
export function dispatchUiSaveCityAs(dispatch: UiCallbackDispatcher): ScriptRuntimeResult {
  return dispatch('UISaveCityAs');
}

/**
 * Dispatches the save-success callback.
 * Mirrors `Eval("UIDidSaveCity")` in `DidSaveCity`
 * (`ref/micropolis/src/sim/s_fileio.c`).
 * Difference from C: callback invocation is explicit and testable.
 */
export function dispatchUiDidSaveCity(dispatch: UiCallbackDispatcher): ScriptRuntimeResult {
  return dispatch('UIDidSaveCity');
}

/**
 * Dispatches the save-failure callback with one message argument.
 * Mirrors `sprintf("UIDidntSaveCity {%s}", msg)` + `Eval(buf)` in
 * `DidntSaveCity` (`ref/micropolis/src/sim/s_fileio.c`).
 * Difference from C: message transport is argv-based and does not depend on
 * Tcl brace interpolation.
 */
export function dispatchUiDidntSaveCity(
  dispatch: UiCallbackDispatcher,
  message: string,
): ScriptRuntimeResult {
  return dispatch('UIDidntSaveCity', [message]);
}

/**
 * Dispatches the load-success callback.
 * Mirrors `Eval("UIDidLoadCity")` in `DidLoadCity`
 * (`ref/micropolis/src/sim/s_fileio.c`).
 * Difference from C: callback invocation is explicit and testable.
 */
export function dispatchUiDidLoadCity(dispatch: UiCallbackDispatcher): ScriptRuntimeResult {
  return dispatch('UIDidLoadCity');
}

/**
 * Dispatches the load-failure callback with one message argument.
 * Mirrors `sprintf("UIDidntLoadCity {%s}", msg)` + `Eval(buf)` in
 * `DidntLoadCity` (`ref/micropolis/src/sim/s_fileio.c`).
 * Difference from C: message transport is argv-based and does not depend on
 * Tcl brace interpolation.
 */
export function dispatchUiDidntLoadCity(
  dispatch: UiCallbackDispatcher,
  message: string,
): ScriptRuntimeResult {
  return dispatch('UIDidntLoadCity', [message]);
}

/**
 * Dispatches the scenario-load completion callback.
 * Mirrors `Eval("UIDidLoadScenario")` in `DidLoadScenario`
 * (`ref/micropolis/src/sim/s_fileio.c`).
 * Difference from C: callback invocation is explicit and testable.
 */
export function dispatchUiDidLoadScenario(dispatch: UiCallbackDispatcher): ScriptRuntimeResult {
  return dispatch('UIDidLoadScenario');
}
