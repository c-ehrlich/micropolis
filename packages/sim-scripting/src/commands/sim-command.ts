import {
  makeScriptFailure,
  makeScriptSuccess,
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
 * One `sim` subcommand registration entry.
 * Mirrors one `HASHED_CMD(Sim, name)` registration in `sim_command_init`
 * (`ref/micropolis/src/sim/w_sim.c`).
 */
export type SimSubcommandEntry = readonly [name: string, handler: SimSubcommandHandler];

/**
 * Accessor-style `sim` subcommand names implemented via `SIMCMD_ACCESS_INT(...)`
 * in `ref/micropolis/src/sim/w_sim.c`.
 * Parity note: these names stay case-sensitive and are registered exactly as in C.
 */
export const SIM_ACCESSOR_INT_SUBCOMMAND_NAMES = [
  'LakeLevel',
  'TreeLevel',
  'CurveLevel',
  'CreateIsland',
  'OverRide',
  'Expensive',
  'Players',
  'Votes',
  'BobHeight',
  'PendingTool',
  'PendingX',
  'PendingY',
] as const;

/**
 * Union of all `SIMCMD_ACCESS_INT` `sim` subcommand names in `w_sim.c`.
 */
export type SimAccessorIntSubcommandName = (typeof SIM_ACCESSOR_INT_SUBCOMMAND_NAMES)[number];

/**
 * Mutable backing state for `SIMCMD_ACCESS_INT` subcommands.
 * Mirrors the underlying C globals read/written by `SimCmd<Var>` wrappers in
 * `ref/micropolis/src/sim/w_sim.c`.
 */
export type SimAccessorIntState = Record<SimAccessorIntSubcommandName, number>;

const SIM_ACCESSOR_INT_DEFAULT_STATE: SimAccessorIntState = {
  // Defaults from `s_gen.c`.
  LakeLevel: -1,
  TreeLevel: -1,
  CurveLevel: -1,
  CreateIsland: -1,
  // Defaults from `w_tool.c`.
  OverRide: 0,
  Expensive: 1000,
  Players: 1,
  Votes: 0,
  // Default from `w_editor.c`.
  BobHeight: 8,
  // Defaults from `w_tool.c` / `s_init.c`.
  PendingTool: -1,
  PendingX: 0,
  PendingY: 0,
};

const TCL_INT32_MIN = -2147483648n;
const TCL_INT32_MAX = 2147483647n;

/**
 * Creates per-runtime mutable state for `SIMCMD_ACCESS_INT` subcommands.
 * Mirrors C global initialization defaults from:
 * - `ref/micropolis/src/sim/s_gen.c` (`TreeLevel/LakeLevel/CurveLevel/CreateIsland`)
 * - `ref/micropolis/src/sim/w_tool.c` (`OverRide/Expensive/Players/Votes/Pending*`)
 * - `ref/micropolis/src/sim/w_editor.c` (`BobHeight`)
 * Difference from C: callers can override individual initial values for tests.
 */
export function createSimAccessorIntState(
  initialValues: Partial<SimAccessorIntState> = {},
): SimAccessorIntState {
  return {
    ...SIM_ACCESSOR_INT_DEFAULT_STATE,
    ...initialValues,
  };
}

/**
 * Parses a Tcl-style integer and enforces 32-bit C `int` range parity.
 * Mirrors `Tcl_GetInt` usage in `SIMCMD_ACCESS_INT(...)` from
 * `ref/micropolis/src/sim/w_sim.c`.
 * Parity note: supports decimal, hex (`0x`), and leading-zero octal forms.
 */
function parseTclInt32(raw: string): number | null {
  const text = raw.trim();
  if (text.length === 0) {
    return null;
  }

  let sign = 1n;
  let magnitude = text;
  if (text[0] === '+' || text[0] === '-') {
    if (text[0] === '-') {
      sign = -1n;
    }
    magnitude = text.slice(1);
  }

  if (magnitude.length === 0) {
    return null;
  }

  let parsedMagnitude: bigint;
  if (/^0[xX][0-9a-fA-F]+$/.test(magnitude)) {
    parsedMagnitude = BigInt(magnitude);
  } else if (/^0[0-7]+$/.test(magnitude)) {
    parsedMagnitude = BigInt(`0o${magnitude.slice(1)}`);
  } else if (/^(0|[1-9][0-9]*)$/.test(magnitude)) {
    parsedMagnitude = BigInt(magnitude);
  } else {
    return null;
  }

  const parsed = parsedMagnitude * sign;
  if (parsed < TCL_INT32_MIN || parsed > TCL_INT32_MAX) {
    return null;
  }

  return Number(parsed);
}

/**
 * Builds one `SIMCMD_ACCESS_INT`-equivalent handler for a single C global.
 * Mirrors `SIMCMD_ACCESS_INT(var)` in `ref/micropolis/src/sim/w_sim.c`:
 * accept argc 2 or 3, parse/set on write, and always return the current value.
 * Difference from C: failures are typed (`INVALID_ARG_COUNT`/`INVALID_INTEGER`).
 */
function createSimAccessorIntSubcommandHandler(
  accessorState: SimAccessorIntState,
  name: SimAccessorIntSubcommandName,
): SimSubcommandHandler {
  return (argv: readonly string[]): ScriptRuntimeResult => {
    if (argv.length !== 2 && argv.length !== 3) {
      return makeScriptFailure(
        new ScriptRuntimeError(
          ScriptRuntimeErrorCode.InvalidArgCount,
          `sim ${name} expects argc 2 or 3, got ${argv.length}`,
        ),
      );
    }

    if (argv.length === 3) {
      const rawValue = argv[2];
      if (rawValue === undefined) {
        return makeScriptFailure(
          new ScriptRuntimeError(
            ScriptRuntimeErrorCode.InvalidArgCount,
            `sim ${name} missing integer argument at argv[2]`,
          ),
        );
      }

      const parsedValue = parseTclInt32(rawValue);
      if (parsedValue === null) {
        return makeScriptFailure(
          new ScriptRuntimeError(
            ScriptRuntimeErrorCode.InvalidInteger,
            `sim ${name} expected a 32-bit integer at argv[2]: ${rawValue}`,
          ),
        );
      }

      accessorState[name] = parsedValue;
    }

    return makeScriptSuccess(String(accessorState[name]));
  };
}

/**
 * Builds `sim` subcommand entries for all `SIMCMD_ACCESS_INT` handlers.
 * Mirrors `SIM_CMD(...)` registrations for accessor commands in
 * `sim_command_init` (`ref/micropolis/src/sim/w_sim.c`).
 * Parity note: no extra range validation beyond Tcl integer parsing.
 */
export function createSimAccessorIntSubcommandEntries(
  accessorState: SimAccessorIntState,
): readonly SimSubcommandEntry[] {
  return SIM_ACCESSOR_INT_SUBCOMMAND_NAMES.map((name) => {
    return [name, createSimAccessorIntSubcommandHandler(accessorState, name)] as const;
  });
}

/**
 * Read-only getter `sim` subcommand names from `w_sim.c`.
 * Mirrors `SIMCMD_GET_STR(Displays)` plus explicit getter handlers in
 * `ref/micropolis/src/sim/w_sim.c` (`WorldX`, `LandValue`, `PolMaxX`, etc.).
 * Parity note: names stay case-sensitive and are registered as-is.
 */
export const SIM_READ_ONLY_GETTER_SUBCOMMAND_NAMES = [
  'Displays',
  'WorldX',
  'WorldY',
  'LandValue',
  'Traffic',
  'Crime',
  'Unemployment',
  'Fires',
  'Pollution',
  'PolMaxX',
  'PolMaxY',
  'TrafMaxX',
  'TrafMaxY',
  'MeltX',
  'MeltY',
  'CrimeMaxX',
  'CrimeMaxY',
  'CenterX',
  'CenterY',
  'FloodX',
  'FloodY',
  'CrashX',
  'CrashY',
  'Platform',
  'Version',
  'MultiPlayerMode',
  'SugarMode',
] as const;

/**
 * Union of read-only getter `sim` subcommand names from `w_sim.c`.
 */
export type SimReadOnlyGetterSubcommandName =
  (typeof SIM_READ_ONLY_GETTER_SUBCOMMAND_NAMES)[number];

type SimReadOnlyStringGetterSubcommandName = 'Displays' | 'Platform' | 'Version';
type SimReadOnlyIntGetterSubcommandName = Exclude<
  SimReadOnlyGetterSubcommandName,
  SimReadOnlyStringGetterSubcommandName
>;

/**
 * Mutable backing state for read-only getter subcommands.
 * Mirrors global values/functions read by getters in
 * `ref/micropolis/src/sim/w_sim.c` (`Displays`, `WORLD_X/Y`, `LVAverage`,
 * `PolMaxX`, `MultiPlayerMode`, etc.).
 * Difference from C: values are centralized in one typed object so tests and
 * future sim-core wiring can update them without process-global state.
 */
export type SimReadOnlyGetterState = Record<SimReadOnlyStringGetterSubcommandName, string> &
  Record<SimReadOnlyIntGetterSubcommandName, number>;

const SIM_READ_ONLY_GETTER_DEFAULT_STATE: SimReadOnlyGetterState = {
  // `sim.c`: default global pointer, normalized to empty string in TS.
  Displays: '',
  // `headers/sim.h`: `SimWidth` / `SimHeight` defaults.
  WorldX: 120,
  WorldY: 100,
  // Aggregate metrics are C globals/functions exposed by read-only getters.
  LandValue: 0,
  Traffic: 0,
  Crime: 0,
  Unemployment: 0,
  Fires: 0,
  Pollution: 0,
  // Underlying tile/raw locations used by getter wrappers in `w_sim.c`.
  PolMaxX: 0,
  PolMaxY: 0,
  TrafMaxX: 0,
  TrafMaxY: 0,
  MeltX: 0,
  MeltY: 0,
  CrimeMaxX: 0,
  CrimeMaxY: 0,
  CenterX: 0,
  CenterY: 0,
  FloodX: 0,
  FloodY: 0,
  CrashX: 0,
  CrashY: 0,
  // `SimCmdPlatform` / `MicropolisVersion` in `sim.c` + `w_sim.c`.
  Platform: 'unix',
  Version: '4.0',
  // `sim.c` command-line mode toggles, read through read-only handlers.
  MultiPlayerMode: 0,
  SugarMode: 0,
};

const SIM_READ_ONLY_NO_ARG_COUNT_CHECK_NAMES = new Set<SimReadOnlyGetterSubcommandName>([
  'Displays',
  'Platform',
  'Version',
]);

const SIM_READ_ONLY_TILE_CENTER_GETTER_NAMES = new Set<SimReadOnlyIntGetterSubcommandName>([
  'PolMaxX',
  'PolMaxY',
  'MeltX',
  'MeltY',
  'CrimeMaxX',
  'CrimeMaxY',
  'CenterX',
  'CenterY',
  'FloodX',
  'FloodY',
  'CrashX',
  'CrashY',
]);

/**
 * Creates per-runtime mutable state for read-only getter subcommands.
 * Mirrors getter read paths in `ref/micropolis/src/sim/w_sim.c`.
 * Difference from C: callers may override values to emulate evolving sim state
 * without mutating global C variables.
 */
export function createSimReadOnlyGetterState(
  initialValues: Partial<SimReadOnlyGetterState> = {},
): SimReadOnlyGetterState {
  return {
    ...SIM_READ_ONLY_GETTER_DEFAULT_STATE,
    ...initialValues,
  };
}

function isSimReadOnlyStringGetterSubcommandName(
  name: SimReadOnlyGetterSubcommandName,
): name is SimReadOnlyStringGetterSubcommandName {
  return name === 'Displays' || name === 'Platform' || name === 'Version';
}

function createSimReadOnlyGetterSubcommandHandler(
  getterState: SimReadOnlyGetterState,
  name: SimReadOnlyGetterSubcommandName,
): SimSubcommandHandler {
  return (argv: readonly string[]): ScriptRuntimeResult => {
    if (!SIM_READ_ONLY_NO_ARG_COUNT_CHECK_NAMES.has(name) && argv.length !== 2) {
      return makeScriptFailure(
        new ScriptRuntimeError(
          ScriptRuntimeErrorCode.InvalidArgCount,
          `sim ${name} expects argc 2, got ${argv.length}`,
        ),
      );
    }

    if (isSimReadOnlyStringGetterSubcommandName(name)) {
      return makeScriptSuccess(getterState[name]);
    }

    const value = getterState[name];
    if (SIM_READ_ONLY_TILE_CENTER_GETTER_NAMES.has(name)) {
      return makeScriptSuccess(String((value << 4) + 8));
    }

    return makeScriptSuccess(String(value));
  };
}

/**
 * Builds `sim` subcommand entries for all read-only getter handlers.
 * Mirrors read-only `SIM_CMD(...)` registrations in `sim_command_init` and
 * getter implementations in `ref/micropolis/src/sim/w_sim.c`.
 * Parity note: `Displays`, `Platform`, and `Version` intentionally skip
 * argc validation because their C handlers also skip that check.
 */
export function createSimReadOnlyGetterSubcommandEntries(
  getterState: SimReadOnlyGetterState,
): readonly SimSubcommandEntry[] {
  return SIM_READ_ONLY_GETTER_SUBCOMMAND_NAMES.map((name) => {
    return [name, createSimReadOnlyGetterSubcommandHandler(getterState, name)] as const;
  });
}

/**
 * `sim` subcommands that map to `SIMCMD_CALL(...)` for session/redraw control.
 * Mirrors `SIMCMD_CALL` entries in `ref/micropolis/src/sim/w_sim.c` that are
 * part of the session/redraw cluster (`SaveCity`, `ReallyQuit`).
 */
export const SIM_SESSION_CONTROL_CALL_ONLY_SUBCOMMAND_NAMES = ['SaveCity', 'ReallyQuit'] as const;

/**
 * `sim` subcommands that map to `SIMCMD_CALL_KICK(...)` for session/redraw flow.
 * Mirrors `SIMCMD_CALL_KICK` entries in `ref/micropolis/src/sim/w_sim.c`:
 * `GameStarted`, redraw/update calls, budget redraw calls, and pause/resume.
 */
export const SIM_SESSION_CONTROL_CALL_AND_KICK_SUBCOMMAND_NAMES = [
  'GameStarted',
  'InitGame',
  'UpdateHeads',
  'UpdateMaps',
  'UpdateEditors',
  'RedrawMaps',
  'RedrawEditors',
  'UpdateGraphs',
  'UpdateEvaluation',
  'UpdateBudget',
  'UpdateBudgetWindow',
  'DoBudget',
  'DoBudgetFromMenu',
  'Pause',
  'Resume',
] as const;

/**
 * Union of session/redraw control `sim` subcommand names implemented for `P1.4`.
 * Mirrors the `SIMCMD_CALL` + `SIMCMD_CALL_KICK` entries above plus explicit
 * `SimCmdUpdate` in `ref/micropolis/src/sim/w_sim.c`.
 */
export type SimSessionControlSubcommandName =
  | (typeof SIM_SESSION_CONTROL_CALL_ONLY_SUBCOMMAND_NAMES)[number]
  | (typeof SIM_SESSION_CONTROL_CALL_AND_KICK_SUBCOMMAND_NAMES)[number]
  | 'Update';

/**
 * Mutable `Kick` scheduling state for session/redraw subcommands.
 * Mirrors `UpdateDelayed` in `ref/micropolis/src/sim/w_tk.c`, where `Kick()`
 * only schedules one delayed update until the pending update is consumed.
 */
export interface SimKickState {
  updateDelayed: boolean;
}

/**
 * Hook callbacks used by `runSimKick`.
 * Mirrors `Kick()` in `ref/micropolis/src/sim/w_tk.c`:
 * `Kick()` side-effect (`onKick`) runs every call, while delayed update
 * scheduling (`onScheduleDelayedUpdate`) runs only when `UpdateDelayed` flips
 * from `0` to `1`.
 */
export interface SimKickHooks {
  onKick?: () => void;
  onScheduleDelayedUpdate?: () => void;
}

/**
 * Creates mutable `Kick` scheduling state.
 * Mirrors boot-time `UpdateDelayed = 0` initialization in
 * `ref/micropolis/src/sim/s_init.c`.
 */
export function createSimKickState(initialUpdateDelayed = false): SimKickState {
  return {
    updateDelayed: initialUpdateDelayed,
  };
}

/**
 * Executes C-style `Kick()` behavior against mutable state.
 * Mirrors `Kick()` in `ref/micropolis/src/sim/w_tk.c`:
 * call the kick side effect, then schedule delayed update only when no delayed
 * update is currently pending.
 */
export function runSimKick(kickState: SimKickState, hooks: SimKickHooks = {}): void {
  hooks.onKick?.();
  if (!kickState.updateDelayed) {
    kickState.updateDelayed = true;
    hooks.onScheduleDelayedUpdate?.();
  }
}

/**
 * Callback hooks for session control/redraw `sim` subcommands.
 * Mirrors `SIMCMD_CALL`, `SIMCMD_CALL_KICK`, and `SimCmdUpdate` dispatch paths
 * in `ref/micropolis/src/sim/w_sim.c`.
 * Difference from C: command function pointers are modeled as typed callbacks.
 */
export interface SimSessionControlHooks extends SimKickHooks {
  onCall?: (
    name:
      | (typeof SIM_SESSION_CONTROL_CALL_ONLY_SUBCOMMAND_NAMES)[number]
      | (typeof SIM_SESSION_CONTROL_CALL_AND_KICK_SUBCOMMAND_NAMES)[number],
  ) => void;
  onUpdate?: () => void;
}

/**
 * Constructor options for `createSimSessionControlSubcommandEntries`.
 * Mirrors command registration wiring for session/redraw commands in
 * `sim_command_init` (`ref/micropolis/src/sim/w_sim.c`).
 */
export interface CreateSimSessionControlSubcommandEntriesOptions {
  hooks?: SimSessionControlHooks;
  kickState?: SimKickState;
}

function createSimCallOnlySubcommandHandler(
  hooks: SimSessionControlHooks,
  name: (typeof SIM_SESSION_CONTROL_CALL_ONLY_SUBCOMMAND_NAMES)[number],
): SimSubcommandHandler {
  return () => {
    hooks.onCall?.(name);
    return makeScriptSuccess();
  };
}

function createSimCallAndKickSubcommandHandler(
  hooks: SimSessionControlHooks,
  kickState: SimKickState,
  name: (typeof SIM_SESSION_CONTROL_CALL_AND_KICK_SUBCOMMAND_NAMES)[number],
): SimSubcommandHandler {
  return () => {
    hooks.onCall?.(name);
    runSimKick(kickState, hooks);
    return makeScriptSuccess();
  };
}

function createSimUpdateSubcommandHandler(hooks: SimSessionControlHooks): SimSubcommandHandler {
  return () => {
    hooks.onUpdate?.();
    return makeScriptSuccess();
  };
}

/**
 * Builds session control/redraw `sim` subcommand entries and `Kick` behavior.
 * Mirrors `SIMCMD_CALL`, `SIMCMD_CALL_KICK`, and `SimCmdUpdate` in
 * `ref/micropolis/src/sim/w_sim.c`, plus `Kick()` coalescing in
 * `ref/micropolis/src/sim/w_tk.c`.
 * Parity note: these handlers intentionally do not validate argc, matching the
 * C macro expansions that ignore extra arguments for these call-only commands.
 */
export function createSimSessionControlSubcommandEntries(
  options: CreateSimSessionControlSubcommandEntriesOptions = {},
): readonly SimSubcommandEntry[] {
  const hooks = options.hooks ?? {};
  const kickState = options.kickState ?? createSimKickState();

  return [
    ...SIM_SESSION_CONTROL_CALL_ONLY_SUBCOMMAND_NAMES.map((name) => {
      return [name, createSimCallOnlySubcommandHandler(hooks, name)] as const;
    }),
    ...SIM_SESSION_CONTROL_CALL_AND_KICK_SUBCOMMAND_NAMES.map((name) => {
      return [name, createSimCallAndKickSubcommandHandler(hooks, kickState, name)] as const;
    }),
    ['Update', createSimUpdateSubcommandHandler(hooks)] as const,
  ];
}

/**
 * `sim` speed/delay/skip/rest subcommands from `w_sim.c`.
 * Mirrors explicit command registrations for `Speed`, `Skips`, `Skip`,
 * `Delay`, and `NeedRest` in `sim_command_init`
 * (`ref/micropolis/src/sim/w_sim.c`).
 */
export const SIM_SPEED_DELAY_CONTROL_SUBCOMMAND_NAMES = [
  'Speed',
  'Skips',
  'Skip',
  'Delay',
  'NeedRest',
] as const;

/**
 * Union of speed/delay/skip/rest control subcommand names from `w_sim.c`.
 */
export type SimSpeedDelayControlSubcommandName =
  (typeof SIM_SPEED_DELAY_CONTROL_SUBCOMMAND_NAMES)[number];

/**
 * Mutable backing state for speed/delay/skip/rest controls.
 * Mirrors globals touched by `SimCmdSpeed`, `SimCmdSkips`, `SimCmdSkip`,
 * `SimCmdDelay`, and `SimCmdNeedRest` in `ref/micropolis/src/sim/w_sim.c`,
 * plus `setSpeed` / `setSkips` in `ref/micropolis/src/sim/w_util.c`.
 * Difference from C: timer/UI side effects from `setSpeed` are modeled only as
 * state transitions; callback wiring is handled separately.
 */
export interface SimSpeedDelayControlState {
  simMetaSpeed: number;
  simSpeed: number;
  simPaused: boolean;
  simPausedSpeed: number;
  simDelay: number;
  simSkips: number;
  simSkip: number;
  needRest: number;
}

const SIM_SPEED_DELAY_CONTROL_DEFAULT_STATE: SimSpeedDelayControlState = {
  // `sim_init` in `sim.c` calls `setSpeed(0)`, leaving effective speed at 0.
  simMetaSpeed: 0,
  simSpeed: 0,
  // Pause globals from `sim.c`.
  simPaused: false,
  simPausedSpeed: 3,
  // `sim.c` default globals.
  simDelay: 50,
  simSkips: 0,
  simSkip: 0,
  // `w_tk.c` global default.
  needRest: 0,
};

/**
 * Constructor options for speed/delay/skip/rest subcommands.
 * Mirrors command wiring around `SimCmdSpeed/Delay/Skips/Skip/NeedRest` in
 * `ref/micropolis/src/sim/w_sim.c`.
 */
export interface CreateSimSpeedDelayControlSubcommandEntriesOptions {
  state?: SimSpeedDelayControlState;
  kickState?: SimKickState;
  kickHooks?: SimKickHooks;
}

/**
 * Creates mutable state used by speed/delay/skip/rest controls.
 * Mirrors relevant C globals initialized in:
 * - `ref/micropolis/src/sim/sim.c` (`sim_delay`, `sim_skips`, `sim_skip`)
 * - `ref/micropolis/src/sim/w_tk.c` (`NeedRest`)
 * - `ref/micropolis/src/sim/w_util.c` (`setSpeed` effective/meta speed behavior)
 * Difference from C: defaults are grouped into one testable state object.
 */
export function createSimSpeedDelayControlState(
  initialValues: Partial<SimSpeedDelayControlState> = {},
): SimSpeedDelayControlState {
  return {
    ...SIM_SPEED_DELAY_CONTROL_DEFAULT_STATE,
    ...initialValues,
  };
}

/**
 * Validates C-parity argc for speed/delay/skip/rest controls.
 * Mirrors `if ((argc != 2) && (argc != 3)) return TCL_ERROR;` in
 * `SimCmdSpeed`, `SimCmdSkips`, `SimCmdSkip`, `SimCmdDelay`, and `SimCmdNeedRest`
 * (`ref/micropolis/src/sim/w_sim.c`).
 */
function validateSimSpeedDelayControlArgCount(
  argv: readonly string[],
  name: SimSpeedDelayControlSubcommandName,
): ScriptRuntimeResult | null {
  if (argv.length === 2 || argv.length === 3) {
    return null;
  }

  return makeScriptFailure(
    new ScriptRuntimeError(
      ScriptRuntimeErrorCode.InvalidArgCount,
      `sim ${name} expects argc 2 or 3, got ${argv.length}`,
    ),
  );
}

/**
 * Parses a write-argument integer for speed/delay/skip/rest controls.
 * Mirrors `Tcl_GetInt(interp, argv[2], &value)` usage in command setters in
 * `ref/micropolis/src/sim/w_sim.c`.
 */
function parseSimSpeedDelayControlWriteArg(
  argv: readonly string[],
  name: SimSpeedDelayControlSubcommandName,
): number | ScriptRuntimeResult {
  const rawValue = argv[2];
  if (rawValue === undefined) {
    return makeScriptFailure(
      new ScriptRuntimeError(
        ScriptRuntimeErrorCode.InvalidArgCount,
        `sim ${name} missing integer argument at argv[2]`,
      ),
    );
  }

  const parsedValue = parseTclInt32(rawValue);
  if (parsedValue === null) {
    return makeScriptFailure(
      new ScriptRuntimeError(
        ScriptRuntimeErrorCode.InvalidInteger,
        `sim ${name} expected a 32-bit integer at argv[2]: ${rawValue}`,
      ),
    );
  }

  return parsedValue;
}

/**
 * Applies `setSpeed` parity state transitions.
 * Mirrors `setSpeed(short)` in `ref/micropolis/src/sim/w_util.c`:
 * clamp to `0..3`, update meta speed, and map to effective speed `0` if paused.
 */
function applySimSetSpeedParity(state: SimSpeedDelayControlState, speed: number): void {
  let clampedSpeed = speed;
  if (clampedSpeed < 0) {
    clampedSpeed = 0;
  } else if (clampedSpeed > 3) {
    clampedSpeed = 3;
  }

  state.simMetaSpeed = clampedSpeed;
  if (state.simPaused) {
    state.simPausedSpeed = clampedSpeed;
    clampedSpeed = 0;
  }

  state.simSpeed = clampedSpeed;
}

/**
 * Applies `setSkips` parity state transitions.
 * Mirrors `setSkips(int)` in `ref/micropolis/src/sim/w_util.c`:
 * set `sim_skips` and reset `sim_skip` to `0`.
 */
function applySimSetSkipsParity(state: SimSpeedDelayControlState, skips: number): void {
  state.simSkips = skips;
  state.simSkip = 0;
}

/**
 * Creates one `SimCmdSpeed`-equivalent handler.
 * Mirrors `SimCmdSpeed` in `ref/micropolis/src/sim/w_sim.c`:
 * accept setter value `0..7`, apply `setSpeed` clamping behavior, call `Kick`,
 * and return effective `SimSpeed`.
 */
function createSimSpeedSubcommandHandler(
  state: SimSpeedDelayControlState,
  kickState: SimKickState,
  kickHooks: SimKickHooks,
): SimSubcommandHandler {
  return (argv: readonly string[]): ScriptRuntimeResult => {
    const argCountError = validateSimSpeedDelayControlArgCount(argv, 'Speed');
    if (argCountError !== null) {
      return argCountError;
    }

    if (argv.length === 3) {
      const parsedValue = parseSimSpeedDelayControlWriteArg(argv, 'Speed');
      if (typeof parsedValue !== 'number') {
        return parsedValue;
      }
      if (parsedValue < 0 || parsedValue > 7) {
        return makeScriptFailure(
          new ScriptRuntimeError(
            ScriptRuntimeErrorCode.InvalidInteger,
            `sim Speed expected an integer in range 0..7 at argv[2]: ${parsedValue}`,
          ),
        );
      }

      applySimSetSpeedParity(state, parsedValue);
      runSimKick(kickState, kickHooks);
    }

    return makeScriptSuccess(String(state.simSpeed));
  };
}

/**
 * Creates one `SimCmdSkips`-equivalent handler.
 * Mirrors `SimCmdSkips` in `ref/micropolis/src/sim/w_sim.c`:
 * enforce non-negative input, call `setSkips`, then `Kick`, and return
 * `sim_skips`.
 */
function createSimSkipsSubcommandHandler(
  state: SimSpeedDelayControlState,
  kickState: SimKickState,
  kickHooks: SimKickHooks,
): SimSubcommandHandler {
  return (argv: readonly string[]): ScriptRuntimeResult => {
    const argCountError = validateSimSpeedDelayControlArgCount(argv, 'Skips');
    if (argCountError !== null) {
      return argCountError;
    }

    if (argv.length === 3) {
      const parsedValue = parseSimSpeedDelayControlWriteArg(argv, 'Skips');
      if (typeof parsedValue !== 'number') {
        return parsedValue;
      }
      if (parsedValue < 0) {
        return makeScriptFailure(
          new ScriptRuntimeError(
            ScriptRuntimeErrorCode.InvalidInteger,
            `sim Skips expected a non-negative integer at argv[2]: ${parsedValue}`,
          ),
        );
      }

      applySimSetSkipsParity(state, parsedValue);
      runSimKick(kickState, kickHooks);
    }

    return makeScriptSuccess(String(state.simSkips));
  };
}

/**
 * Creates one `SimCmdSkip`-equivalent handler.
 * Mirrors `SimCmdSkip` in `ref/micropolis/src/sim/w_sim.c`:
 * enforce non-negative input, write/read `sim_skip`, and do not call `Kick`.
 */
function createSimSkipSubcommandHandler(state: SimSpeedDelayControlState): SimSubcommandHandler {
  return (argv: readonly string[]): ScriptRuntimeResult => {
    const argCountError = validateSimSpeedDelayControlArgCount(argv, 'Skip');
    if (argCountError !== null) {
      return argCountError;
    }

    if (argv.length === 3) {
      const parsedValue = parseSimSpeedDelayControlWriteArg(argv, 'Skip');
      if (typeof parsedValue !== 'number') {
        return parsedValue;
      }
      if (parsedValue < 0) {
        return makeScriptFailure(
          new ScriptRuntimeError(
            ScriptRuntimeErrorCode.InvalidInteger,
            `sim Skip expected a non-negative integer at argv[2]: ${parsedValue}`,
          ),
        );
      }

      state.simSkip = parsedValue;
    }

    return makeScriptSuccess(String(state.simSkip));
  };
}

/**
 * Creates one `SimCmdDelay`-equivalent handler.
 * Mirrors `SimCmdDelay` in `ref/micropolis/src/sim/w_sim.c`:
 * enforce non-negative input, write/read `sim_delay`, and call `Kick` on set.
 */
function createSimDelaySubcommandHandler(
  state: SimSpeedDelayControlState,
  kickState: SimKickState,
  kickHooks: SimKickHooks,
): SimSubcommandHandler {
  return (argv: readonly string[]): ScriptRuntimeResult => {
    const argCountError = validateSimSpeedDelayControlArgCount(argv, 'Delay');
    if (argCountError !== null) {
      return argCountError;
    }

    if (argv.length === 3) {
      const parsedValue = parseSimSpeedDelayControlWriteArg(argv, 'Delay');
      if (typeof parsedValue !== 'number') {
        return parsedValue;
      }
      if (parsedValue < 0) {
        return makeScriptFailure(
          new ScriptRuntimeError(
            ScriptRuntimeErrorCode.InvalidInteger,
            `sim Delay expected a non-negative integer at argv[2]: ${parsedValue}`,
          ),
        );
      }

      state.simDelay = parsedValue;
      runSimKick(kickState, kickHooks);
    }

    return makeScriptSuccess(String(state.simDelay));
  };
}

/**
 * Creates one `SimCmdNeedRest`-equivalent handler.
 * Mirrors `SimCmdNeedRest` in `ref/micropolis/src/sim/w_sim.c`:
 * parse any Tcl integer (including negatives), write/read `NeedRest`,
 * and do not call `Kick`.
 */
function createSimNeedRestSubcommandHandler(
  state: SimSpeedDelayControlState,
): SimSubcommandHandler {
  return (argv: readonly string[]): ScriptRuntimeResult => {
    const argCountError = validateSimSpeedDelayControlArgCount(argv, 'NeedRest');
    if (argCountError !== null) {
      return argCountError;
    }

    if (argv.length === 3) {
      const parsedValue = parseSimSpeedDelayControlWriteArg(argv, 'NeedRest');
      if (typeof parsedValue !== 'number') {
        return parsedValue;
      }

      state.needRest = parsedValue;
    }

    return makeScriptSuccess(String(state.needRest));
  };
}

/**
 * Builds speed/delay/skip/rest `sim` subcommand entries.
 * Mirrors `SimCmdSpeed`, `SimCmdSkips`, `SimCmdSkip`, `SimCmdDelay`, and
 * `SimCmdNeedRest` in `ref/micropolis/src/sim/w_sim.c`, plus `setSpeed` and
 * `setSkips` behavior in `ref/micropolis/src/sim/w_util.c`.
 * Parity note: `Speed` accepts `0..7` at parse time but returns clamped
 * effective speed (`0..3`) after `setSpeed`.
 */
export function createSimSpeedDelayControlSubcommandEntries(
  options: CreateSimSpeedDelayControlSubcommandEntriesOptions = {},
): readonly SimSubcommandEntry[] {
  const state = options.state ?? createSimSpeedDelayControlState();
  const kickState = options.kickState ?? createSimKickState();
  const kickHooks = options.kickHooks ?? {};

  return [
    ['Speed', createSimSpeedSubcommandHandler(state, kickState, kickHooks)] as const,
    ['Skips', createSimSkipsSubcommandHandler(state, kickState, kickHooks)] as const,
    ['Skip', createSimSkipSubcommandHandler(state)] as const,
    ['Delay', createSimDelaySubcommandHandler(state, kickState, kickHooks)] as const,
    ['NeedRest', createSimNeedRestSubcommandHandler(state)] as const,
  ];
}

/**
 * Builds a case-sensitive `sim` subcommand table from ordered entries.
 * Mirrors repeated `HASHED_CMD(...)` registration writes in
 * `ref/micropolis/src/sim/w_sim.c` plus `Tcl_CreateHashEntry` behavior in
 * `ref/micropolis/src/sim/headers/macros.h`: duplicate keys overwrite
 * `clientData`, so the last entry wins.
 * Difference from C: returns a typed `Map` instead of mutating one global hash
 * in place.
 */
export function createSimSubcommandTable(
  entries: readonly SimSubcommandEntry[] = [],
): SimSubcommandTable {
  const table = new Map<string, SimSubcommandHandler>();
  for (const [name, handler] of entries) {
    table.set(name, handler);
  }

  return table;
}

const DEFAULT_SIM_KICK_STATE = createSimKickState();

/**
 * Default `sim` subcommand table.
 * Mirrors `sim_command_init` registration slices from
 * `ref/micropolis/src/sim/w_sim.c` for:
 * - session/redraw control (`SIMCMD_CALL`, `SIMCMD_CALL_KICK`, `SimCmdUpdate`)
 * - speed/delay/skip/rest controls (`SimCmdSpeed`, `SimCmdDelay`,
 *   `SimCmdSkips`, `SimCmdSkip`, `SimCmdNeedRest`)
 * - accessor commands (`SIMCMD_ACCESS_INT(...)`)
 * - read-only getter commands (`SIMCMD_GET_*` + explicit getters)
 */
export const SIM_SUBCOMMAND_TABLE: SimSubcommandTable = createSimSubcommandTable([
  ...createSimSessionControlSubcommandEntries({
    kickState: DEFAULT_SIM_KICK_STATE,
  }),
  ...createSimSpeedDelayControlSubcommandEntries({
    kickState: DEFAULT_SIM_KICK_STATE,
  }),
  ...createSimAccessorIntSubcommandEntries(createSimAccessorIntState()),
  ...createSimReadOnlyGetterSubcommandEntries(createSimReadOnlyGetterState()),
]);

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
