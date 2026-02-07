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
 * Formats a numeric value like C `%d`/`(int)` conversions in Micropolis bridge code.
 * Mirrors integer truncation toward zero used throughout callback emitters in
 * `ref/micropolis/src/sim/w_update.c`, `w_util.c`, and `w_budget.c`.
 */
function toCIntegerString(value: number): string {
  return String(Math.trunc(value));
}

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
  return dispatch('UIStartScenario', [toCIntegerString(scenario)]);
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

/**
 * Dispatches the funds-status callback with one display string.
 * Mirrors `sprintf("UISetFunds {%s}", localStr)` in `ReallyUpdateFunds`
 * (`ref/micropolis/src/sim/w_update.c`).
 * Difference from C: formatted funds text is provided directly by caller.
 */
export function dispatchUiSetFunds(
  dispatch: UiCallbackDispatcher,
  funds: string,
): ScriptRuntimeResult {
  return dispatch('UISetFunds', [funds]);
}

/**
 * Dispatches the date-status callback with date label/month/year values.
 * Mirrors `sprintf("UISetDate {%s} %d %d", str, m, y)` in `updateDate`
 * (`ref/micropolis/src/sim/w_update.c`).
 * Difference from C: month/year inputs come from caller and are truncated.
 */
export function dispatchUiSetDate(
  dispatch: UiCallbackDispatcher,
  date: string,
  month: number,
  year: number,
): ScriptRuntimeResult {
  return dispatch('UISetDate', [date, toCIntegerString(month), toCIntegerString(year)]);
}

/**
 * Dispatches the RCI-demand callback from raw valve values.
 * Mirrors `sprintf("UISetDemand %d %d %d", (int)(r/100), ...)` in `SetDemand`
 * (`ref/micropolis/src/sim/w_update.c`).
 * Parity note: each channel uses C-style truncation toward zero after `/100`.
 */
export function dispatchUiSetDemand(
  dispatch: UiCallbackDispatcher,
  residential: number,
  commercial: number,
  industrial: number,
): ScriptRuntimeResult {
  return dispatch('UISetDemand', [
    toCIntegerString(residential / 100),
    toCIntegerString(commercial / 100),
    toCIntegerString(industrial / 100),
  ]);
}

/**
 * Dispatches the options-status callback from packed option bits.
 * Mirrors `UpdateOptionsMenu` bit expansion in `ref/micropolis/src/sim/w_update.c`:
 * `1=autobudget, 2=autogoto, 4=autobulldoze, 8=disasters, 16=sound,
 * 32=animation, 64=messages, 128=notices`.
 * Difference from C: the packed bitfield is passed in directly by caller.
 */
export function dispatchUiSetOptions(
  dispatch: UiCallbackDispatcher,
  options: number,
): ScriptRuntimeResult {
  const optionBits = Math.trunc(options);
  return dispatch('UISetOptions', [
    (optionBits & 1) !== 0 ? '1' : '0',
    (optionBits & 2) !== 0 ? '1' : '0',
    (optionBits & 4) !== 0 ? '1' : '0',
    (optionBits & 8) !== 0 ? '1' : '0',
    (optionBits & 16) !== 0 ? '1' : '0',
    (optionBits & 32) !== 0 ? '1' : '0',
    (optionBits & 64) !== 0 ? '1' : '0',
    (optionBits & 128) !== 0 ? '1' : '0',
  ]);
}

/**
 * Dispatches the speed-status callback.
 * Mirrors `sprintf("UISetSpeed %d", sim_paused ? 0 : SimMetaSpeed)` in `setSpeed`
 * (`ref/micropolis/src/sim/w_util.c`).
 * Difference from C: paused/non-paused speed selection is handled by caller.
 */
export function dispatchUiSetSpeed(
  dispatch: UiCallbackDispatcher,
  speed: number,
): ScriptRuntimeResult {
  return dispatch('UISetSpeed', [toCIntegerString(speed)]);
}

/**
 * Dispatches the game-level status callback.
 * Mirrors `sprintf("UISetGameLevel %d", GameLevel)` in `UpdateGameLevel`
 * (`ref/micropolis/src/sim/w_util.c`).
 * Difference from C: level source is provided by caller.
 */
export function dispatchUiSetGameLevel(
  dispatch: UiCallbackDispatcher,
  level: number,
): ScriptRuntimeResult {
  return dispatch('UISetGameLevel', [toCIntegerString(level)]);
}

/**
 * Dispatches the city-name status callback.
 * Mirrors `sprintf("UISetCityName {%s}", CityName)` in `setAnyCityName`
 * (`ref/micropolis/src/sim/w_util.c`).
 * Difference from C: caller controls whether the name was sanitized.
 */
export function dispatchUiSetCityName(
  dispatch: UiCallbackDispatcher,
  cityName: string,
): ScriptRuntimeResult {
  return dispatch('UISetCityName', [cityName]);
}

/**
 * Dispatches the map-state callback with view path and numeric state.
 * Mirrors `sprintf("UISetMapState %s %d", Tk_PathName(...), state)` in
 * `DoSetMapState` (`ref/micropolis/src/sim/w_util.c`).
 * Difference from C: view path and state source values are provided by caller.
 */
export function dispatchUiSetMapState(
  dispatch: UiCallbackDispatcher,
  viewPath: string,
  state: number,
): ScriptRuntimeResult {
  return dispatch('UISetMapState', [viewPath, toCIntegerString(state)]);
}

/**
 * Dispatches the budget-dialog show-and-wait callback.
 * Mirrors `Eval("UIShowBudgetAndWait")` in `ShowBudgetWindowAndStartWaiting`
 * (`ref/micropolis/src/sim/w_budget.c`).
 * Difference from C: pause/timer side effects are not handled in this helper.
 */
export function dispatchUiShowBudgetAndWait(dispatch: UiCallbackDispatcher): ScriptRuntimeResult {
  return dispatch('UIShowBudgetAndWait');
}

/**
 * Dispatches the budget refresh callback.
 * Mirrors `Eval("UIUpdateBudget")` in `UpdateBudget`
 * (`ref/micropolis/src/sim/w_budget.c`).
 * Difference from C: draw-flag updates happen outside this helper.
 */
export function dispatchUiUpdateBudget(dispatch: UiCallbackDispatcher): ScriptRuntimeResult {
  return dispatch('UIUpdateBudget');
}

/**
 * Dispatches the top-line budget values callback.
 * Mirrors `sprintf("UISetBudget {%s} {%s} {%s} {%s} {%d}", ...)` in `SetBudget`
 * (`ref/micropolis/src/sim/w_budget.c`).
 * Difference from C: formatted cashflow strings are passed directly by caller.
 */
export function dispatchUiSetBudget(
  dispatch: UiCallbackDispatcher,
  cashflow: string,
  previous: string,
  current: string,
  collected: string,
  taxRate: number,
): ScriptRuntimeResult {
  return dispatch('UISetBudget', [
    cashflow,
    previous,
    current,
    collected,
    toCIntegerString(taxRate),
  ]);
}

/**
 * Dispatches per-department budget slider values in Tcl callback order.
 * Mirrors `sprintf("UISetBudgetValues {%s} {%s} %d {%s} {%s} %d {%s} {%s} %d", ...)`
 * in `SetBudgetValues` (`ref/micropolis/src/sim/w_budget.c`).
 * Difference from C: percent values are supplied by caller instead of reading
 * global `roadPercent`/`policePercent`/`firePercent` state.
 */
export function dispatchUiSetBudgetValues(
  dispatch: UiCallbackDispatcher,
  roadGot: string,
  roadWant: string,
  roadPercent: number,
  policeGot: string,
  policeWant: string,
  policePercent: number,
  fireGot: string,
  fireWant: string,
  firePercent: number,
): ScriptRuntimeResult {
  return dispatch('UISetBudgetValues', [
    roadGot,
    roadWant,
    toCIntegerString(roadPercent),
    policeGot,
    policeWant,
    toCIntegerString(policePercent),
    fireGot,
    fireWant,
    toCIntegerString(firePercent),
  ]);
}

/**
 * Dispatches the evaluation payload callback in scorecard field order.
 * Mirrors `sprintf("UISetEvaluation {%s} ... {%s}")` in `SetEvaluation`
 * (`ref/micropolis/src/sim/w_eval.c`).
 * Difference from C: preformatted string fields are passed directly by caller.
 */
export function dispatchUiSetEvaluation(
  dispatch: UiCallbackDispatcher,
  changed: string,
  score: string,
  ps0: string,
  ps1: string,
  ps2: string,
  ps3: string,
  pv0: string,
  pv1: string,
  pv2: string,
  pv3: string,
  pop: string,
  delta: string,
  assessed: string,
  cityClass: string,
  cityLevel: string,
  goodYes: string,
  goodNo: string,
  title: string,
): ScriptRuntimeResult {
  return dispatch('UISetEvaluation', [
    changed,
    score,
    ps0,
    ps1,
    ps2,
    ps3,
    pv0,
    pv1,
    pv2,
    pv3,
    pop,
    delta,
    assessed,
    cityClass,
    cityLevel,
    goodYes,
    goodNo,
    title,
  ]);
}
