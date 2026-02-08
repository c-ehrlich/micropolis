import {
  resolveSimScriptingFeatureFlags,
  type SimScriptingFeatureFlags,
} from '../feature-flags.ts';
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
 * Parity note: default `false` is 1:1 with C startup behavior.
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
 * Parity note: side-effect order and delayed-update gating are a 1:1 port.
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
 * `sim` legacy extra subcommands from source deltas.
 * Mirrors explicit registrations for `HeatSteps`, `HeatFlow`, and `HeatRule`
 * in `sim_command_init` (`ref/micropolis/src/sim/w_sim.c`).
 * Parity note: these are grouped under optional `legacyExtras` in TS even
 * though the original C build registers them unconditionally.
 */
export const SIM_LEGACY_EXTRA_SUBCOMMAND_NAMES = ['HeatSteps', 'HeatFlow', 'HeatRule'] as const;

/**
 * Union of source-delta legacy extra subcommand names.
 */
export type SimLegacyExtraSubcommandName = (typeof SIM_LEGACY_EXTRA_SUBCOMMAND_NAMES)[number];

/**
 * Mutable backing state for source-delta `sim` legacy extras.
 * Mirrors globals initialized in `ref/micropolis/src/sim/sim.c`:
 * `heat_steps`, `heat_flow`, and `heat_rule`.
 * Difference from C: values are grouped into one typed object for per-runtime
 * configuration instead of process globals.
 */
export interface SimLegacyExtraState {
  heatSteps: number;
  heatFlow: number;
  heatRule: number;
}

const SIM_LEGACY_EXTRA_DEFAULT_STATE: SimLegacyExtraState = {
  // Defaults from `sim.c`.
  heatSteps: 0,
  heatFlow: -7,
  heatRule: 0,
};

/**
 * Constructor options for `createSimLegacyExtraSubcommandEntries`.
 * Mirrors legacy extra command wiring in `sim_command_init`
 * (`ref/micropolis/src/sim/w_sim.c`).
 */
export interface CreateSimLegacyExtraSubcommandEntriesOptions {
  state?: SimLegacyExtraState;
  kickState?: SimKickState;
  kickHooks?: SimKickHooks;
}

/**
 * Creates mutable state for source-delta legacy extras.
 * Mirrors `heat_steps`, `heat_flow`, and `heat_rule` defaults from
 * `ref/micropolis/src/sim/sim.c`.
 * Difference from C: callers can override defaults for tests/runtime wiring.
 */
export function createSimLegacyExtraState(
  initialValues: Partial<SimLegacyExtraState> = {},
): SimLegacyExtraState {
  return {
    ...SIM_LEGACY_EXTRA_DEFAULT_STATE,
    ...initialValues,
  };
}

function validateSimLegacyExtraArgCount(
  argv: readonly string[],
  name: SimLegacyExtraSubcommandName,
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

function parseSimLegacyExtraWriteInt(
  argv: readonly string[],
  name: SimLegacyExtraSubcommandName,
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

function createSimHeatStepsSubcommandHandler(
  state: SimLegacyExtraState,
  kickState: SimKickState,
  kickHooks: SimKickHooks,
): SimSubcommandHandler {
  return (argv: readonly string[]): ScriptRuntimeResult => {
    const argCountError = validateSimLegacyExtraArgCount(argv, 'HeatSteps');
    if (argCountError !== null) {
      return argCountError;
    }

    if (argv.length === 3) {
      const parsedValue = parseSimLegacyExtraWriteInt(argv, 'HeatSteps');
      if (typeof parsedValue !== 'number') {
        return parsedValue;
      }
      if (parsedValue < 0) {
        return makeScriptFailure(
          new ScriptRuntimeError(
            ScriptRuntimeErrorCode.InvalidInteger,
            `sim HeatSteps expected a non-negative integer at argv[2]: ${parsedValue}`,
          ),
        );
      }

      state.heatSteps = parsedValue;
      runSimKick(kickState, kickHooks);
    }

    return makeScriptSuccess(String(state.heatSteps));
  };
}

function createSimHeatFlowSubcommandHandler(state: SimLegacyExtraState): SimSubcommandHandler {
  return (argv: readonly string[]): ScriptRuntimeResult => {
    const argCountError = validateSimLegacyExtraArgCount(argv, 'HeatFlow');
    if (argCountError !== null) {
      return argCountError;
    }

    if (argv.length === 3) {
      const parsedValue = parseSimLegacyExtraWriteInt(argv, 'HeatFlow');
      if (typeof parsedValue !== 'number') {
        return parsedValue;
      }
      state.heatFlow = parsedValue;
    }

    return makeScriptSuccess(String(state.heatFlow));
  };
}

function createSimHeatRuleSubcommandHandler(state: SimLegacyExtraState): SimSubcommandHandler {
  return (argv: readonly string[]): ScriptRuntimeResult => {
    const argCountError = validateSimLegacyExtraArgCount(argv, 'HeatRule');
    if (argCountError !== null) {
      return argCountError;
    }

    if (argv.length === 3) {
      const parsedValue = parseSimLegacyExtraWriteInt(argv, 'HeatRule');
      if (typeof parsedValue !== 'number') {
        return parsedValue;
      }
      state.heatRule = parsedValue;
    }

    return makeScriptSuccess(String(state.heatRule));
  };
}

/**
 * Builds source-delta legacy extra `sim` subcommand entries.
 * Mirrors `SimCmdHeatSteps`, `SimCmdHeatFlow`, and `SimCmdHeatRule` in
 * `ref/micropolis/src/sim/w_sim.c`.
 * Parity note: `HeatSteps` setter runs `Kick()` in C; `HeatFlow` and
 * `HeatRule` setters do not.
 */
export function createSimLegacyExtraSubcommandEntries(
  options: CreateSimLegacyExtraSubcommandEntriesOptions = {},
): readonly SimSubcommandEntry[] {
  const state = options.state ?? createSimLegacyExtraState();
  const kickState = options.kickState ?? createSimKickState();
  const kickHooks = options.kickHooks ?? {};

  return [
    ['HeatSteps', createSimHeatStepsSubcommandHandler(state, kickState, kickHooks)] as const,
    ['HeatFlow', createSimHeatFlowSubcommandHandler(state)] as const,
    ['HeatRule', createSimHeatRuleSubcommandHandler(state)] as const,
  ];
}

/**
 * `sim` city/game setup subcommands from `w_sim.c`.
 * Mirrors explicit command registrations for `CityName`, `CityFileName`,
 * `GameLevel`, `Year`, `GenerateNewCity`, `GenerateSomeCity`, `LoadCity`,
 * and `LoadScenario` in `sim_command_init`
 * (`ref/micropolis/src/sim/w_sim.c`).
 */
export const SIM_CITY_GAME_SETUP_SUBCOMMAND_NAMES = [
  'CityName',
  'CityFileName',
  'GameLevel',
  'Year',
  'GenerateNewCity',
  'GenerateSomeCity',
  'LoadCity',
  'LoadScenario',
] as const;

/**
 * Union of city/game setup subcommand names from `w_sim.c`.
 */
export type SimCityGameSetupSubcommandName = (typeof SIM_CITY_GAME_SETUP_SUBCOMMAND_NAMES)[number];

/**
 * Mutable backing state for city/game setup subcommands.
 * Mirrors globals/functions touched by `SimCmdCityName`, `SimCmdCityFileName`,
 * `SimCmdGameLevel`, and `SimCmdYear` in `ref/micropolis/src/sim/w_sim.c`,
 * plus `SetGameLevelFunds`, `SetYear`, and `CurrentYear` in
 * `ref/micropolis/src/sim/w_util.c`.
 * Difference from C: process-global values are grouped into one typed object.
 */
export interface SimCityGameSetupState {
  cityName: string;
  cityFileName: string | null;
  gameLevel: number;
  totalFunds: number;
  startingYear: number;
  cityTime: number;
}

const SIM_CITY_GAME_SETUP_DEFAULT_STATE: SimCityGameSetupState = {
  // Set by callbacks/startup scripts in C (`w_stubs.c`), so default is empty.
  cityName: '',
  // `sim.c` global default.
  cityFileName: null,
  // `StartupGameLevel` defaults to `0`; `sim_init` applies `SetGameLevelFunds(0)`.
  gameLevel: 0,
  // `SetGameLevelFunds(0)` in `w_util.c`.
  totalFunds: 20000,
  // `sim_init` default in `sim.c`.
  startingYear: 1900,
  // `sim_init` default in `sim.c`.
  cityTime: 50,
};

/**
 * Parity flags for city/game setup subcommands.
 * Mirrors the `CityFileName` allocation bug in `SimCmdCityFileName`
 * (`ref/micropolis/src/sim/w_sim.c`), where allocation uses `strlen(argv[0]) + 1`
 * instead of `strlen(argv[2]) + 1`.
 * Difference from C: legacy bug mode is deterministic and safe by truncating
 * the copied value to the legacy buffer payload length.
 */
export interface SimCityGameSetupParityOptions {
  legacyCityFileNameAllocationBug?: boolean;
}

/**
 * Hook callbacks for city/game setup command side effects.
 * Mirrors the C call-outs in `ref/micropolis/src/sim/w_sim.c`:
 * `GenerateNewCity()`, `GenerateSomeCity(int)`, `LoadCity(char*)`,
 * `LoadScenario(int)`, and `doTimeStuff()` inside `SetYear`.
 */
export interface SimCityGameSetupHooks {
  onGenerateNewCity?: () => void;
  onGenerateSomeCity?: (seed: number) => void;
  onLoadCity?: (path: string) => void;
  onLoadScenario?: (scenarioId: number) => void;
  onDoTimeStuff?: () => void;
}

/**
 * Constructor options for `createSimCityGameSetupSubcommandEntries`.
 * Mirrors setup command wiring in `sim_command_init`
 * (`ref/micropolis/src/sim/w_sim.c`).
 */
export interface CreateSimCityGameSetupSubcommandEntriesOptions {
  state?: SimCityGameSetupState;
  hooks?: SimCityGameSetupHooks;
  parity?: SimCityGameSetupParityOptions;
}

/**
 * Creates mutable state for city/game setup subcommands.
 * Mirrors relevant globals initialized in `ref/micropolis/src/sim/sim.c`
 * and updated via `ref/micropolis/src/sim/w_util.c`.
 * Difference from C: callers can override defaults per runtime/test.
 */
export function createSimCityGameSetupState(
  initialValues: Partial<SimCityGameSetupState> = {},
): SimCityGameSetupState {
  return {
    ...SIM_CITY_GAME_SETUP_DEFAULT_STATE,
    ...initialValues,
  };
}

function validateSimCityGameSetupAccessorArgCount(
  argv: readonly string[],
  name: 'CityName' | 'CityFileName' | 'GameLevel' | 'Year',
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

function validateSimCityGameSetupStrictArgCount(
  argv: readonly string[],
  name: 'GenerateSomeCity' | 'LoadScenario' | 'LoadCity',
): ScriptRuntimeResult | null {
  if (argv.length === 3) {
    return null;
  }

  return makeScriptFailure(
    new ScriptRuntimeError(
      ScriptRuntimeErrorCode.InvalidArgCount,
      `sim ${name} expects argc 3, got ${argv.length}`,
    ),
  );
}

function parseSimCityGameSetupWriteInt(
  argv: readonly string[],
  name: 'GameLevel' | 'Year' | 'GenerateSomeCity' | 'LoadScenario',
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

function setCityNameParity(name: string): string {
  return name.replace(/[^0-9A-Za-z]/g, '_');
}

function setCityFileNameParity(
  argv: readonly string[],
  nextValue: string,
  parity: SimCityGameSetupParityOptions,
): string {
  if (!parity.legacyCityFileNameAllocationBug) {
    return nextValue;
  }

  const legacyBufferPayloadLength = (argv[0] ?? '').length;
  return nextValue.slice(0, legacyBufferPayloadLength);
}

function applySimSetGameLevelFundsParity(state: SimCityGameSetupState, level: number): void {
  switch (level) {
    case 0:
      state.totalFunds = 20000;
      state.gameLevel = 0;
      break;
    case 1:
      state.totalFunds = 10000;
      state.gameLevel = 1;
      break;
    case 2:
      state.totalFunds = 5000;
      state.gameLevel = 2;
      break;
    default:
      state.totalFunds = 20000;
      state.gameLevel = 0;
      break;
  }
}

function cIntDiv(a: number, b: number): number {
  return Math.trunc(a / b);
}

function currentYearParity(state: SimCityGameSetupState): number {
  return cIntDiv(state.cityTime, 48) + state.startingYear;
}

function applySimSetYearParity(
  state: SimCityGameSetupState,
  year: number,
  hooks: SimCityGameSetupHooks,
): void {
  let clampedYear = year;
  if (clampedYear < state.startingYear) {
    clampedYear = state.startingYear;
  }

  const yearDelta = clampedYear - state.startingYear - cIntDiv(state.cityTime, 48);
  state.cityTime += yearDelta * 48;
  hooks.onDoTimeStuff?.();
}

function createSimCityNameSubcommandHandler(state: SimCityGameSetupState): SimSubcommandHandler {
  return (argv: readonly string[]): ScriptRuntimeResult => {
    const argCountError = validateSimCityGameSetupAccessorArgCount(argv, 'CityName');
    if (argCountError !== null) {
      return argCountError;
    }

    if (argv.length === 3) {
      const rawName = argv[2];
      if (rawName === undefined) {
        return makeScriptFailure(
          new ScriptRuntimeError(
            ScriptRuntimeErrorCode.InvalidArgCount,
            'sim CityName missing string argument at argv[2]',
          ),
        );
      }
      state.cityName = setCityNameParity(rawName);
    }

    return makeScriptSuccess(state.cityName);
  };
}

function createSimCityFileNameSubcommandHandler(
  state: SimCityGameSetupState,
  parity: SimCityGameSetupParityOptions,
): SimSubcommandHandler {
  return (argv: readonly string[]): ScriptRuntimeResult => {
    const argCountError = validateSimCityGameSetupAccessorArgCount(argv, 'CityFileName');
    if (argCountError !== null) {
      return argCountError;
    }

    if (argv.length === 3) {
      const rawPath = argv[2];
      if (rawPath === undefined) {
        return makeScriptFailure(
          new ScriptRuntimeError(
            ScriptRuntimeErrorCode.InvalidArgCount,
            'sim CityFileName missing string argument at argv[2]',
          ),
        );
      }

      state.cityFileName = null;
      if (rawPath.length > 0) {
        state.cityFileName = setCityFileNameParity(argv, rawPath, parity);
      }
    }

    return makeScriptSuccess(state.cityFileName ?? '');
  };
}

function createSimGameLevelSubcommandHandler(state: SimCityGameSetupState): SimSubcommandHandler {
  return (argv: readonly string[]): ScriptRuntimeResult => {
    const argCountError = validateSimCityGameSetupAccessorArgCount(argv, 'GameLevel');
    if (argCountError !== null) {
      return argCountError;
    }

    if (argv.length === 3) {
      const parsedValue = parseSimCityGameSetupWriteInt(argv, 'GameLevel');
      if (typeof parsedValue !== 'number') {
        return parsedValue;
      }
      if (parsedValue < 0 || parsedValue > 2) {
        return makeScriptFailure(
          new ScriptRuntimeError(
            ScriptRuntimeErrorCode.InvalidInteger,
            `sim GameLevel expected an integer in range 0..2 at argv[2]: ${parsedValue}`,
          ),
        );
      }

      applySimSetGameLevelFundsParity(state, parsedValue);
    }

    return makeScriptSuccess(String(state.gameLevel));
  };
}

function createSimYearSubcommandHandler(
  state: SimCityGameSetupState,
  hooks: SimCityGameSetupHooks,
): SimSubcommandHandler {
  return (argv: readonly string[]): ScriptRuntimeResult => {
    const argCountError = validateSimCityGameSetupAccessorArgCount(argv, 'Year');
    if (argCountError !== null) {
      return argCountError;
    }

    if (argv.length === 3) {
      const parsedValue = parseSimCityGameSetupWriteInt(argv, 'Year');
      if (typeof parsedValue !== 'number') {
        return parsedValue;
      }

      applySimSetYearParity(state, parsedValue, hooks);
    }

    return makeScriptSuccess(String(currentYearParity(state)));
  };
}

function createSimGenerateNewCitySubcommandHandler(
  hooks: SimCityGameSetupHooks,
): SimSubcommandHandler {
  return () => {
    hooks.onGenerateNewCity?.();
    return makeScriptSuccess();
  };
}

function createSimGenerateSomeCitySubcommandHandler(
  hooks: SimCityGameSetupHooks,
): SimSubcommandHandler {
  return (argv: readonly string[]): ScriptRuntimeResult => {
    const argCountError = validateSimCityGameSetupStrictArgCount(argv, 'GenerateSomeCity');
    if (argCountError !== null) {
      return argCountError;
    }

    const parsedValue = parseSimCityGameSetupWriteInt(argv, 'GenerateSomeCity');
    if (typeof parsedValue !== 'number') {
      return parsedValue;
    }

    hooks.onGenerateSomeCity?.(parsedValue);
    return makeScriptSuccess();
  };
}

function createSimLoadCitySubcommandHandler(hooks: SimCityGameSetupHooks): SimSubcommandHandler {
  return (argv: readonly string[]): ScriptRuntimeResult => {
    const argCountError = validateSimCityGameSetupStrictArgCount(argv, 'LoadCity');
    if (argCountError !== null) {
      return argCountError;
    }

    const path = argv[2];
    if (path === undefined) {
      return makeScriptFailure(
        new ScriptRuntimeError(
          ScriptRuntimeErrorCode.InvalidArgCount,
          'sim LoadCity missing string argument at argv[2]',
        ),
      );
    }

    hooks.onLoadCity?.(path);
    return makeScriptSuccess();
  };
}

function createSimLoadScenarioSubcommandHandler(
  hooks: SimCityGameSetupHooks,
): SimSubcommandHandler {
  return (argv: readonly string[]): ScriptRuntimeResult => {
    const argCountError = validateSimCityGameSetupStrictArgCount(argv, 'LoadScenario');
    if (argCountError !== null) {
      return argCountError;
    }

    const parsedValue = parseSimCityGameSetupWriteInt(argv, 'LoadScenario');
    if (typeof parsedValue !== 'number') {
      return parsedValue;
    }

    hooks.onLoadScenario?.(parsedValue);
    return makeScriptSuccess();
  };
}

/**
 * Builds city/game setup `sim` subcommand entries.
 * Mirrors `SimCmdCityName`, `SimCmdCityFileName`, `SimCmdGameLevel`,
 * `SimCmdYear`, and load/generate macro commands in
 * `ref/micropolis/src/sim/w_sim.c`, plus `SetGameLevelFunds` and year math in
 * `ref/micropolis/src/sim/w_util.c`.
 * Parity note: `GenerateNewCity` intentionally skips argc checks because its C
 * `SIMCMD_CALL` macro expansion does the same.
 */
export function createSimCityGameSetupSubcommandEntries(
  options: CreateSimCityGameSetupSubcommandEntriesOptions = {},
): readonly SimSubcommandEntry[] {
  const state = options.state ?? createSimCityGameSetupState();
  const hooks = options.hooks ?? {};
  const parity = options.parity ?? {};

  return [
    ['CityName', createSimCityNameSubcommandHandler(state)] as const,
    ['CityFileName', createSimCityFileNameSubcommandHandler(state, parity)] as const,
    ['GameLevel', createSimGameLevelSubcommandHandler(state)] as const,
    ['Year', createSimYearSubcommandHandler(state, hooks)] as const,
    ['GenerateNewCity', createSimGenerateNewCitySubcommandHandler(hooks)] as const,
    ['GenerateSomeCity', createSimGenerateSomeCitySubcommandHandler(hooks)] as const,
    ['LoadCity', createSimLoadCitySubcommandHandler(hooks)] as const,
    ['LoadScenario', createSimLoadScenarioSubcommandHandler(hooks)] as const,
  ];
}

/**
 * `sim` budget/options subcommands from `w_sim.c`.
 * Mirrors explicit command registrations for:
 * `Funds`, `TaxRate`, `FireFund`, `PoliceFund`, `RoadFund`,
 * `AutoBudget`, `AutoGoto`, `AutoBulldoze`, `Disasters`, `Sound`,
 * `DoAnimation`, `DoMessages`, and `DoNotices` in `sim_command_init`
 * (`ref/micropolis/src/sim/w_sim.c`).
 */
export const SIM_BUDGET_OPTIONS_SUBCOMMAND_NAMES = [
  'Funds',
  'TaxRate',
  'FireFund',
  'PoliceFund',
  'RoadFund',
  'AutoBudget',
  'AutoGoto',
  'AutoBulldoze',
  'Disasters',
  'Sound',
  'DoAnimation',
  'DoMessages',
  'DoNotices',
] as const;

/**
 * Union of budget/options subcommand names from `w_sim.c`.
 */
export type SimBudgetOptionsSubcommandName = (typeof SIM_BUDGET_OPTIONS_SUBCOMMAND_NAMES)[number];

type SimBudgetOptionsBinaryToggleSubcommandName =
  | 'AutoBudget'
  | 'AutoGoto'
  | 'AutoBulldoze'
  | 'Disasters'
  | 'Sound';

type SimBudgetOptionsFreeIntToggleSubcommandName = 'DoAnimation' | 'DoMessages' | 'DoNotices';

/**
 * Mutable backing state for budget/options subcommands.
 * Mirrors globals touched by these `SimCmd*` handlers in
 * `ref/micropolis/src/sim/w_sim.c` plus funding state in
 * `ref/micropolis/src/sim/w_budget.c`:
 * `TotalFunds`, `CityTax`, department fund percentages/spend/max values,
 * option toggles, and `MustUpdateFunds`/`MustUpdateOptions`.
 * Difference from C: process-global values are grouped into one typed object.
 */
export interface SimBudgetOptionsState {
  totalFunds: number;
  mustUpdateFunds: number;
  cityTax: number;
  firePercent: number;
  policePercent: number;
  roadPercent: number;
  fireSpend: number;
  policeSpend: number;
  roadSpend: number;
  fireMaxValue: number;
  policeMaxValue: number;
  roadMaxValue: number;
  autoBudget: number;
  autoGo: number;
  autoBulldoze: number;
  noDisasters: number;
  userSoundOn: number;
  doAnimation: number;
  doMessages: number;
  doNotices: number;
  mustUpdateOptions: number;
}

const SIM_BUDGET_OPTIONS_DEFAULT_STATE: SimBudgetOptionsState = {
  // `sim_init` sets funds to 5000 then applies `SetGameLevelFunds(0)`.
  totalFunds: 20000,
  // `w_update.c` globals are zero-initialized.
  mustUpdateFunds: 0,
  // `sim_init` default.
  cityTax: 7,
  // `InitFundingLevel` in `w_budget.c`.
  firePercent: 1.0,
  policePercent: 1.0,
  roadPercent: 1.0,
  // `s_alloc.c` globals are zero-initialized.
  fireSpend: 0,
  policeSpend: 0,
  roadSpend: 0,
  fireMaxValue: 0,
  policeMaxValue: 0,
  roadMaxValue: 0,
  // `sim_init` defaults in `sim.c`.
  autoBudget: 1,
  autoGo: 1,
  autoBulldoze: 1,
  noDisasters: 0,
  userSoundOn: 1,
  doAnimation: 1,
  doMessages: 1,
  doNotices: 1,
  // `sim_init` marks options dirty once at startup.
  mustUpdateOptions: 1,
};

/**
 * Hook callbacks for budget/options command side effects.
 * Mirrors side effects triggered by `SimCmd*` handlers in
 * `ref/micropolis/src/sim/w_sim.c`:
 * `drawBudgetWindow()`, `UpdateFundEffects()`, and `UpdateBudget()`.
 * Difference from C: side effects are injected as typed callbacks.
 */
export interface SimBudgetOptionsHooks extends SimKickHooks {
  onDrawBudgetWindow?: () => void;
  onUpdateFundEffects?: () => void;
  onUpdateBudget?: () => void;
}

/**
 * Constructor options for `createSimBudgetOptionsSubcommandEntries`.
 * Mirrors budget/options command wiring in `sim_command_init`
 * (`ref/micropolis/src/sim/w_sim.c`).
 */
export interface CreateSimBudgetOptionsSubcommandEntriesOptions {
  state?: SimBudgetOptionsState;
  hooks?: SimBudgetOptionsHooks;
  kickState?: SimKickState;
}

/**
 * Creates mutable state for budget/options subcommands.
 * Mirrors relevant globals initialized in `ref/micropolis/src/sim/sim.c`,
 * `ref/micropolis/src/sim/w_budget.c`, and `ref/micropolis/src/sim/w_update.c`.
 * Difference from C: callers may override defaults per runtime/test.
 */
export function createSimBudgetOptionsState(
  initialValues: Partial<SimBudgetOptionsState> = {},
): SimBudgetOptionsState {
  return {
    ...SIM_BUDGET_OPTIONS_DEFAULT_STATE,
    ...initialValues,
  };
}

/**
 * Validates C-parity argc for budget/options controls.
 * Mirrors `if ((argc != 2) && (argc != 3)) return TCL_ERROR;` in
 * `SimCmdFunds`, `SimCmdTaxRate`, fund-percent commands, and option toggles
 * in `ref/micropolis/src/sim/w_sim.c`.
 */
function validateSimBudgetOptionsArgCount(
  argv: readonly string[],
  name: SimBudgetOptionsSubcommandName,
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
 * Parses one write-argument integer for budget/options controls.
 * Mirrors `Tcl_GetInt(interp, argv[2], &value)` usage in the corresponding
 * `SimCmd*` handlers from `ref/micropolis/src/sim/w_sim.c`.
 */
function parseSimBudgetOptionsWriteInt(
  argv: readonly string[],
  name: SimBudgetOptionsSubcommandName,
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
 * Converts stored percent fraction to C `int` return format.
 * Mirrors `sprintf(..., "%d", (int)(percent * 100.0))` in
 * `SimCmdFireFund`, `SimCmdPoliceFund`, and `SimCmdRoadFund`
 * (`ref/micropolis/src/sim/w_sim.c`).
 */
function toPercentIntForResult(percent: number): number {
  return Math.trunc(percent * 100.0);
}

/**
 * Applies one department fund-percent write with C integer spend math.
 * Mirrors `SimCmdFireFund`, `SimCmdPoliceFund`, and `SimCmdRoadFund` in
 * `ref/micropolis/src/sim/w_sim.c`: set percent as fraction, compute spend via
 * integer division, run `UpdateFundEffects()`, then `Kick()`.
 */
function applyDepartmentFundPercentWrite(
  state: SimBudgetOptionsState,
  hooks: SimBudgetOptionsHooks,
  kickState: SimKickState,
  rawPercent: number,
  fields: {
    percentField: 'firePercent' | 'policePercent' | 'roadPercent';
    spendField: 'fireSpend' | 'policeSpend' | 'roadSpend';
    maxField: 'fireMaxValue' | 'policeMaxValue' | 'roadMaxValue';
  },
): void {
  state[fields.percentField] = rawPercent / 100.0;
  state[fields.spendField] = cIntDiv(state[fields.maxField] * rawPercent, 100);
  hooks.onUpdateFundEffects?.();
  runSimKick(kickState, hooks);
}

/**
 * Creates one budget-control (`Funds`/`TaxRate`) handler.
 * Mirrors `SimCmdFunds` and `SimCmdTaxRate` in `ref/micropolis/src/sim/w_sim.c`.
 */
function createSimBudgetControlSubcommandHandler(
  state: SimBudgetOptionsState,
  hooks: SimBudgetOptionsHooks,
  kickState: SimKickState,
  name: 'Funds' | 'TaxRate',
): SimSubcommandHandler {
  return (argv: readonly string[]): ScriptRuntimeResult => {
    const argCountError = validateSimBudgetOptionsArgCount(argv, name);
    if (argCountError !== null) {
      return argCountError;
    }

    if (argv.length === 3) {
      const parsedValue = parseSimBudgetOptionsWriteInt(argv, name);
      if (typeof parsedValue !== 'number') {
        return parsedValue;
      }

      if (name === 'Funds') {
        if (parsedValue < 0) {
          return makeScriptFailure(
            new ScriptRuntimeError(
              ScriptRuntimeErrorCode.InvalidInteger,
              `sim Funds expected a non-negative integer at argv[2]: ${parsedValue}`,
            ),
          );
        }

        state.totalFunds = parsedValue;
        state.mustUpdateFunds = 1;
        runSimKick(kickState, hooks);
      } else {
        if (parsedValue < 0 || parsedValue > 20) {
          return makeScriptFailure(
            new ScriptRuntimeError(
              ScriptRuntimeErrorCode.InvalidInteger,
              `sim TaxRate expected an integer in range 0..20 at argv[2]: ${parsedValue}`,
            ),
          );
        }

        state.cityTax = parsedValue;
        hooks.onDrawBudgetWindow?.();
        runSimKick(kickState, hooks);
      }
    }

    return makeScriptSuccess(String(name === 'Funds' ? state.totalFunds : state.cityTax));
  };
}

/**
 * Creates one department fund-percent handler.
 * Mirrors `SimCmdFireFund`, `SimCmdPoliceFund`, and `SimCmdRoadFund`
 * in `ref/micropolis/src/sim/w_sim.c`.
 */
function createSimDepartmentFundSubcommandHandler(
  state: SimBudgetOptionsState,
  hooks: SimBudgetOptionsHooks,
  kickState: SimKickState,
  name: 'FireFund' | 'PoliceFund' | 'RoadFund',
): SimSubcommandHandler {
  return (argv: readonly string[]): ScriptRuntimeResult => {
    const argCountError = validateSimBudgetOptionsArgCount(argv, name);
    if (argCountError !== null) {
      return argCountError;
    }

    if (argv.length === 3) {
      const parsedValue = parseSimBudgetOptionsWriteInt(argv, name);
      if (typeof parsedValue !== 'number') {
        return parsedValue;
      }
      if (parsedValue < 0 || parsedValue > 100) {
        return makeScriptFailure(
          new ScriptRuntimeError(
            ScriptRuntimeErrorCode.InvalidInteger,
            `sim ${name} expected an integer in range 0..100 at argv[2]: ${parsedValue}`,
          ),
        );
      }

      if (name === 'FireFund') {
        applyDepartmentFundPercentWrite(state, hooks, kickState, parsedValue, {
          percentField: 'firePercent',
          spendField: 'fireSpend',
          maxField: 'fireMaxValue',
        });
      } else if (name === 'PoliceFund') {
        applyDepartmentFundPercentWrite(state, hooks, kickState, parsedValue, {
          percentField: 'policePercent',
          spendField: 'policeSpend',
          maxField: 'policeMaxValue',
        });
      } else {
        applyDepartmentFundPercentWrite(state, hooks, kickState, parsedValue, {
          percentField: 'roadPercent',
          spendField: 'roadSpend',
          maxField: 'roadMaxValue',
        });
      }
    }

    if (name === 'FireFund') {
      return makeScriptSuccess(String(toPercentIntForResult(state.firePercent)));
    }
    if (name === 'PoliceFund') {
      return makeScriptSuccess(String(toPercentIntForResult(state.policePercent)));
    }
    return makeScriptSuccess(String(toPercentIntForResult(state.roadPercent)));
  };
}

/**
 * Creates one binary option-toggle handler (`0|1`) with C parity behavior.
 * Mirrors `SimCmdAutoBudget`, `SimCmdAutoGoto`, `SimCmdAutoBulldoze`,
 * `SimCmdDisasters`, and `SimCmdSound` in `ref/micropolis/src/sim/w_sim.c`.
 */
function createSimBinaryOptionSubcommandHandler(
  state: SimBudgetOptionsState,
  hooks: SimBudgetOptionsHooks,
  kickState: SimKickState,
  name: SimBudgetOptionsBinaryToggleSubcommandName,
): SimSubcommandHandler {
  return (argv: readonly string[]): ScriptRuntimeResult => {
    const argCountError = validateSimBudgetOptionsArgCount(argv, name);
    if (argCountError !== null) {
      return argCountError;
    }

    if (argv.length === 3) {
      const parsedValue = parseSimBudgetOptionsWriteInt(argv, name);
      if (typeof parsedValue !== 'number') {
        return parsedValue;
      }
      if (parsedValue < 0 || parsedValue > 1) {
        return makeScriptFailure(
          new ScriptRuntimeError(
            ScriptRuntimeErrorCode.InvalidInteger,
            `sim ${name} expected an integer in range 0..1 at argv[2]: ${parsedValue}`,
          ),
        );
      }

      if (name === 'AutoBudget') {
        state.autoBudget = parsedValue;
      } else if (name === 'AutoGoto') {
        state.autoGo = parsedValue;
      } else if (name === 'AutoBulldoze') {
        state.autoBulldoze = parsedValue;
      } else if (name === 'Disasters') {
        state.noDisasters = parsedValue !== 0 ? 0 : 1;
      } else {
        state.userSoundOn = parsedValue;
      }

      state.mustUpdateOptions = 1;
      runSimKick(kickState, hooks);
      if (name === 'AutoBudget') {
        hooks.onUpdateBudget?.();
      }
    }

    if (name === 'AutoBudget') {
      return makeScriptSuccess(String(state.autoBudget));
    }
    if (name === 'AutoGoto') {
      return makeScriptSuccess(String(state.autoGo));
    }
    if (name === 'AutoBulldoze') {
      return makeScriptSuccess(String(state.autoBulldoze));
    }
    if (name === 'Disasters') {
      return makeScriptSuccess(String(state.noDisasters !== 0 ? 0 : 1));
    }
    return makeScriptSuccess(String(state.userSoundOn));
  };
}

/**
 * Creates one free-int option-toggle handler.
 * Mirrors `SimCmdDoAnimation`, `SimCmdDoMessages`, and `SimCmdDoNotices` in
 * `ref/micropolis/src/sim/w_sim.c`, which accept any Tcl integer.
 */
function createSimFreeIntOptionSubcommandHandler(
  state: SimBudgetOptionsState,
  hooks: SimBudgetOptionsHooks,
  kickState: SimKickState,
  name: SimBudgetOptionsFreeIntToggleSubcommandName,
): SimSubcommandHandler {
  return (argv: readonly string[]): ScriptRuntimeResult => {
    const argCountError = validateSimBudgetOptionsArgCount(argv, name);
    if (argCountError !== null) {
      return argCountError;
    }

    if (argv.length === 3) {
      const parsedValue = parseSimBudgetOptionsWriteInt(argv, name);
      if (typeof parsedValue !== 'number') {
        return parsedValue;
      }

      if (name === 'DoAnimation') {
        state.doAnimation = parsedValue;
      } else if (name === 'DoMessages') {
        state.doMessages = parsedValue;
      } else {
        state.doNotices = parsedValue;
      }

      state.mustUpdateOptions = 1;
      runSimKick(kickState, hooks);
    }

    if (name === 'DoAnimation') {
      return makeScriptSuccess(String(state.doAnimation));
    }
    if (name === 'DoMessages') {
      return makeScriptSuccess(String(state.doMessages));
    }
    return makeScriptSuccess(String(state.doNotices));
  };
}

/**
 * Builds budget/options `sim` subcommand entries.
 * Mirrors `SimCmdFunds`, `SimCmdTaxRate`, fund-percent handlers, and option
 * toggles in `ref/micropolis/src/sim/w_sim.c`.
 * Parity note: department spend math uses truncating integer division to match
 * C integer behavior from `(maxValue * percent) / 100`.
 */
export function createSimBudgetOptionsSubcommandEntries(
  options: CreateSimBudgetOptionsSubcommandEntriesOptions = {},
): readonly SimSubcommandEntry[] {
  const state = options.state ?? createSimBudgetOptionsState();
  const hooks = options.hooks ?? {};
  const kickState = options.kickState ?? createSimKickState();

  return [
    ['Funds', createSimBudgetControlSubcommandHandler(state, hooks, kickState, 'Funds')] as const,
    [
      'TaxRate',
      createSimBudgetControlSubcommandHandler(state, hooks, kickState, 'TaxRate'),
    ] as const,
    [
      'FireFund',
      createSimDepartmentFundSubcommandHandler(state, hooks, kickState, 'FireFund'),
    ] as const,
    [
      'PoliceFund',
      createSimDepartmentFundSubcommandHandler(state, hooks, kickState, 'PoliceFund'),
    ] as const,
    [
      'RoadFund',
      createSimDepartmentFundSubcommandHandler(state, hooks, kickState, 'RoadFund'),
    ] as const,
    [
      'AutoBudget',
      createSimBinaryOptionSubcommandHandler(state, hooks, kickState, 'AutoBudget'),
    ] as const,
    [
      'AutoGoto',
      createSimBinaryOptionSubcommandHandler(state, hooks, kickState, 'AutoGoto'),
    ] as const,
    [
      'AutoBulldoze',
      createSimBinaryOptionSubcommandHandler(state, hooks, kickState, 'AutoBulldoze'),
    ] as const,
    [
      'Disasters',
      createSimBinaryOptionSubcommandHandler(state, hooks, kickState, 'Disasters'),
    ] as const,
    ['Sound', createSimBinaryOptionSubcommandHandler(state, hooks, kickState, 'Sound')] as const,
    [
      'DoAnimation',
      createSimFreeIntOptionSubcommandHandler(state, hooks, kickState, 'DoAnimation'),
    ] as const,
    [
      'DoMessages',
      createSimFreeIntOptionSubcommandHandler(state, hooks, kickState, 'DoMessages'),
    ] as const,
    [
      'DoNotices',
      createSimFreeIntOptionSubcommandHandler(state, hooks, kickState, 'DoNotices'),
    ] as const,
  ];
}

/**
 * `sim` map/dynamic/overlay misc subcommands from `w_sim.c`.
 * Mirrors explicit command registrations for:
 * `FlushStyle`, `DonDither`, `DoOverlay`, `Tile`, `Fill`, `DynamicData`,
 * and `ResetDynamic` in `sim_command_init`
 * (`ref/micropolis/src/sim/w_sim.c`).
 */
export const SIM_MAP_DYNAMIC_OVERLAY_MISC_SUBCOMMAND_NAMES = [
  'FlushStyle',
  'DonDither',
  'DoOverlay',
  'Tile',
  'Fill',
  'DynamicData',
  'ResetDynamic',
] as const;

/**
 * Union of map/dynamic/overlay misc subcommand names from `w_sim.c`.
 */
export type SimMapDynamicOverlayMiscSubcommandName =
  (typeof SIM_MAP_DYNAMIC_OVERLAY_MISC_SUBCOMMAND_NAMES)[number];

const SIM_MAP_DEFAULT_WORLD_WIDTH = 120;
const SIM_MAP_DEFAULT_WORLD_HEIGHT = 100;
const SIM_DYNAMIC_DATA_LENGTH = 32;
const SIM_RESET_DYNAMIC_LENGTH = 16;

/**
 * Mutable backing state for map/dynamic/overlay misc subcommands.
 * Mirrors globals touched by these handlers in `ref/micropolis/src/sim/w_sim.c`:
 * `Map`, `DynamicData`, `NewMapFlags[DYMAP]`, `FlushStyle`, `DonDither`,
 * and `DoOverlay`.
 * Difference from C: `Map[x][y]` is stored as a linear `Int32Array` with
 * `index = x * worldHeight + y` for deterministic typed access.
 */
export interface SimMapDynamicOverlayMiscState {
  worldWidth: number;
  worldHeight: number;
  mapTiles: Int16Array;
  dynamicData: Int32Array;
  newMapFlagsDynamic: number;
  flushStyle: number;
  donDither: number;
  doOverlay: number;
}

/**
 * Constructor options for `createSimMapDynamicOverlayMiscState`.
 * Mirrors the C globals above while allowing deterministic overrides in tests.
 */
export interface CreateSimMapDynamicOverlayMiscStateOptions {
  worldWidth?: number;
  worldHeight?: number;
  mapTiles?: Int16Array | readonly number[];
  dynamicData?: Int32Array | readonly number[];
  newMapFlagsDynamic?: number;
  flushStyle?: number;
  donDither?: number;
  doOverlay?: number;
}

/**
 * Constructor options for `createSimMapDynamicOverlayMiscSubcommandEntries`.
 * Mirrors map/dynamic/overlay command wiring in `sim_command_init`
 * (`ref/micropolis/src/sim/w_sim.c`).
 */
export interface CreateSimMapDynamicOverlayMiscSubcommandEntriesOptions {
  state?: SimMapDynamicOverlayMiscState;
  kickState?: SimKickState;
  kickHooks?: SimKickHooks;
}

function normalizeInt32Array(
  expectedLength: number,
  source: Int32Array | readonly number[] | undefined,
): Int32Array {
  const normalized = new Int32Array(expectedLength);
  if (source === undefined) {
    return normalized;
  }

  const copyLength = Math.min(expectedLength, source.length);
  for (let index = 0; index < copyLength; index += 1) {
    const value = source[index];
    if (value !== undefined) {
      normalized[index] = value;
    }
  }
  return normalized;
}

function normalizeInt16Array(
  expectedLength: number,
  source: Int16Array | readonly number[] | undefined,
): Int16Array {
  const normalized = new Int16Array(expectedLength);
  if (source === undefined) {
    return normalized;
  }

  const copyLength = Math.min(expectedLength, source.length);
  for (let index = 0; index < copyLength; index += 1) {
    const value = source[index];
    if (value !== undefined) {
      normalized[index] = value;
    }
  }
  return normalized;
}

/**
 * Creates mutable state for map/dynamic/overlay misc subcommands.
 * Mirrors defaults initialized by C globals:
 * - world size from `headers/sim.h` (`WORLD_X=120`, `WORLD_Y=100`)
 * - `FlushStyle` from `ref/micropolis/src/sim/w_x.c` (`IS_LINUX` default `3`)
 * - `DonDither` from `ref/micropolis/src/sim/s_scan.c` (`0`)
 * - `DoOverlay` from `ref/micropolis/src/sim/w_editor.c` (`2`)
 * - `Map` / `DynamicData` zero-initialized storage in C runtime
 * Difference from C: callers may explicitly override world/map buffer sizes.
 * Parity note: map storage uses `Int16Array` to mirror C `short Map[x][y]`.
 */
export function createSimMapDynamicOverlayMiscState(
  options: CreateSimMapDynamicOverlayMiscStateOptions = {},
): SimMapDynamicOverlayMiscState {
  const worldWidth = options.worldWidth ?? SIM_MAP_DEFAULT_WORLD_WIDTH;
  const worldHeight = options.worldHeight ?? SIM_MAP_DEFAULT_WORLD_HEIGHT;
  const mapTileCount = worldWidth * worldHeight;

  return {
    worldWidth,
    worldHeight,
    mapTiles: normalizeInt16Array(mapTileCount, options.mapTiles),
    dynamicData: normalizeInt32Array(SIM_DYNAMIC_DATA_LENGTH, options.dynamicData),
    newMapFlagsDynamic: options.newMapFlagsDynamic ?? 0,
    flushStyle: options.flushStyle ?? 3,
    donDither: options.donDither ?? 0,
    doOverlay: options.doOverlay ?? 2,
  };
}

function validateSimMapOverlayAccessorArgCount(
  argv: readonly string[],
  name: 'FlushStyle' | 'DonDither' | 'DoOverlay' | 'DynamicData',
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

function parseSimMapDynamicOverlayWriteInt(
  argv: readonly string[],
  name: SimMapDynamicOverlayMiscSubcommandName,
  argIndex: number,
): number | ScriptRuntimeResult {
  const rawValue = argv[argIndex];
  if (rawValue === undefined) {
    return makeScriptFailure(
      new ScriptRuntimeError(
        ScriptRuntimeErrorCode.InvalidArgCount,
        `sim ${name} missing integer argument at argv[${argIndex}]`,
      ),
    );
  }

  const parsedValue = parseTclInt32(rawValue);
  if (parsedValue === null) {
    return makeScriptFailure(
      new ScriptRuntimeError(
        ScriptRuntimeErrorCode.InvalidInteger,
        `sim ${name} expected a 32-bit integer at argv[${argIndex}]: ${rawValue}`,
      ),
    );
  }

  return parsedValue;
}

function createSimNonNegativeOverlayAccessorSubcommandHandler(
  state: SimMapDynamicOverlayMiscState,
  name: 'FlushStyle' | 'DonDither' | 'DoOverlay',
  field: 'flushStyle' | 'donDither' | 'doOverlay',
): SimSubcommandHandler {
  return (argv: readonly string[]): ScriptRuntimeResult => {
    const argCountError = validateSimMapOverlayAccessorArgCount(argv, name);
    if (argCountError !== null) {
      return argCountError;
    }

    if (argv.length === 3) {
      const parsedValue = parseSimMapDynamicOverlayWriteInt(argv, name, 2);
      if (typeof parsedValue !== 'number') {
        return parsedValue;
      }
      if (parsedValue < 0) {
        return makeScriptFailure(
          new ScriptRuntimeError(
            ScriptRuntimeErrorCode.InvalidInteger,
            `sim ${name} expected a non-negative integer at argv[2]: ${parsedValue}`,
          ),
        );
      }

      state[field] = parsedValue;
    }

    return makeScriptSuccess(String(state[field]));
  };
}

function toMapTileIndex(worldHeight: number, x: number, y: number): number {
  return x * worldHeight + y;
}

function createSimTileSubcommandHandler(
  state: SimMapDynamicOverlayMiscState,
): SimSubcommandHandler {
  return (argv: readonly string[]): ScriptRuntimeResult => {
    if (argv.length !== 4 && argv.length !== 5) {
      return makeScriptFailure(
        new ScriptRuntimeError(
          ScriptRuntimeErrorCode.InvalidArgCount,
          `sim Tile expects argc 4 or 5, got ${argv.length}`,
        ),
      );
    }

    const parsedX = parseSimMapDynamicOverlayWriteInt(argv, 'Tile', 2);
    if (typeof parsedX !== 'number') {
      return parsedX;
    }
    if (parsedX < 0 || parsedX >= state.worldWidth) {
      return makeScriptFailure(
        new ScriptRuntimeError(
          ScriptRuntimeErrorCode.InvalidInteger,
          `sim Tile expected x in range 0..${state.worldWidth - 1} at argv[2]: ${parsedX}`,
        ),
      );
    }

    const parsedY = parseSimMapDynamicOverlayWriteInt(argv, 'Tile', 3);
    if (typeof parsedY !== 'number') {
      return parsedY;
    }
    if (parsedY < 0 || parsedY >= state.worldHeight) {
      return makeScriptFailure(
        new ScriptRuntimeError(
          ScriptRuntimeErrorCode.InvalidInteger,
          `sim Tile expected y in range 0..${state.worldHeight - 1} at argv[3]: ${parsedY}`,
        ),
      );
    }

    const mapIndex = toMapTileIndex(state.worldHeight, parsedX, parsedY);
    if (argv.length === 5) {
      const parsedTile = parseSimMapDynamicOverlayWriteInt(argv, 'Tile', 4);
      if (typeof parsedTile !== 'number') {
        return parsedTile;
      }
      state.mapTiles[mapIndex] = parsedTile;
    }

    return makeScriptSuccess(String(state.mapTiles[mapIndex] ?? 0));
  };
}

function createSimFillSubcommandHandler(
  state: SimMapDynamicOverlayMiscState,
): SimSubcommandHandler {
  return (argv: readonly string[]): ScriptRuntimeResult => {
    if (argv.length !== 3) {
      return makeScriptFailure(
        new ScriptRuntimeError(
          ScriptRuntimeErrorCode.InvalidArgCount,
          `sim Fill expects argc 3, got ${argv.length}`,
        ),
      );
    }

    const parsedTile = parseSimMapDynamicOverlayWriteInt(argv, 'Fill', 2);
    if (typeof parsedTile !== 'number') {
      return parsedTile;
    }

    state.mapTiles.fill(parsedTile);
    return makeScriptSuccess(String(parsedTile));
  };
}

function createSimDynamicDataSubcommandHandler(
  state: SimMapDynamicOverlayMiscState,
  kickState: SimKickState,
  kickHooks: SimKickHooks,
): SimSubcommandHandler {
  return (argv: readonly string[]): ScriptRuntimeResult => {
    if (argv.length !== 3 && argv.length !== 4) {
      return makeScriptFailure(
        new ScriptRuntimeError(
          ScriptRuntimeErrorCode.InvalidArgCount,
          `sim DynamicData expects argc 3 or 4, got ${argv.length}`,
        ),
      );
    }

    const parsedIndex = parseSimMapDynamicOverlayWriteInt(argv, 'DynamicData', 2);
    if (typeof parsedIndex !== 'number') {
      return parsedIndex;
    }
    if (parsedIndex < 0 || parsedIndex >= SIM_DYNAMIC_DATA_LENGTH) {
      return makeScriptFailure(
        new ScriptRuntimeError(
          ScriptRuntimeErrorCode.InvalidInteger,
          `sim DynamicData expected an integer index in range 0..31 at argv[2]: ${parsedIndex}`,
        ),
      );
    }

    if (argv.length === 4) {
      const parsedValue = parseSimMapDynamicOverlayWriteInt(argv, 'DynamicData', 3);
      if (typeof parsedValue !== 'number') {
        return parsedValue;
      }

      state.dynamicData[parsedIndex] = parsedValue;
      state.newMapFlagsDynamic = 1;
      runSimKick(kickState, kickHooks);
    }

    return makeScriptSuccess(String(state.dynamicData[parsedIndex] ?? 0));
  };
}

function createSimResetDynamicSubcommandHandler(
  state: SimMapDynamicOverlayMiscState,
  kickState: SimKickState,
  kickHooks: SimKickHooks,
): SimSubcommandHandler {
  return () => {
    for (let index = 0; index < SIM_RESET_DYNAMIC_LENGTH; index += 1) {
      state.dynamicData[index] = (index & 1) !== 0 ? 99999 : -99999;
    }

    state.newMapFlagsDynamic = 1;
    runSimKick(kickState, kickHooks);
    return makeScriptSuccess();
  };
}

/**
 * Builds map/dynamic/overlay misc `sim` subcommand entries.
 * Mirrors `SimCmdFlushStyle`, `SimCmdDonDither`, `SimCmdDoOverlay`,
 * `SimCmdTile`, `SimCmdFill`, `SimCmdDynamicData`, and `SimCmdResetDynamic`
 * in `ref/micropolis/src/sim/w_sim.c`.
 * Parity note: only dynamic-map writes (`DynamicData` set and `ResetDynamic`)
 * set `NewMapFlags[DYMAP] = 1` and invoke `Kick()`.
 */
export function createSimMapDynamicOverlayMiscSubcommandEntries(
  options: CreateSimMapDynamicOverlayMiscSubcommandEntriesOptions = {},
): readonly SimSubcommandEntry[] {
  const state = options.state ?? createSimMapDynamicOverlayMiscState();
  const kickState = options.kickState ?? createSimKickState();
  const kickHooks = options.kickHooks ?? {};

  return [
    [
      'FlushStyle',
      createSimNonNegativeOverlayAccessorSubcommandHandler(state, 'FlushStyle', 'flushStyle'),
    ] as const,
    [
      'DonDither',
      createSimNonNegativeOverlayAccessorSubcommandHandler(state, 'DonDither', 'donDither'),
    ] as const,
    [
      'DoOverlay',
      createSimNonNegativeOverlayAccessorSubcommandHandler(state, 'DoOverlay', 'doOverlay'),
    ] as const,
    ['Tile', createSimTileSubcommandHandler(state)] as const,
    ['Fill', createSimFillSubcommandHandler(state)] as const,
    ['DynamicData', createSimDynamicDataSubcommandHandler(state, kickState, kickHooks)] as const,
    ['ResetDynamic', createSimResetDynamicSubcommandHandler(state, kickState, kickHooks)] as const,
  ];
}

/**
 * `sim` disasters/sprite-goal utility subcommands from `w_sim.c`.
 * Mirrors explicit command registrations for:
 * `MakeFire`, `MakeFlood`, `MakeTornado`, `MakeEarthquake`, `MakeMonster`,
 * `MakeMeltdown`, `FireBomb`, `MonsterGoal`, `HelicopterGoal`, and
 * `MonsterDirection` in `sim_command_init`
 * (`ref/micropolis/src/sim/w_sim.c`).
 */
export const SIM_DISASTERS_SPRITE_GOAL_UTILITY_SUBCOMMAND_NAMES = [
  'MakeFire',
  'MakeFlood',
  'MakeTornado',
  'MakeEarthquake',
  'MakeMonster',
  'MakeMeltdown',
  'FireBomb',
  'MonsterGoal',
  'HelicopterGoal',
  'MonsterDirection',
] as const;

/**
 * Union of disasters/sprite-goal utility subcommand names from `w_sim.c`.
 */
export type SimDisastersSpriteGoalUtilitySubcommandName =
  (typeof SIM_DISASTERS_SPRITE_GOAL_UTILITY_SUBCOMMAND_NAMES)[number];

type SimDisasterCreatorSubcommandName =
  | 'MakeFire'
  | 'MakeFlood'
  | 'MakeTornado'
  | 'MakeEarthquake'
  | 'MakeMonster'
  | 'MakeMeltdown'
  | 'FireBomb';

/**
 * Minimal mutable sprite fields used by goal utilities.
 * Mirrors fields assigned in `SimCmdMonsterGoal`, `SimCmdHelicopterGoal`, and
 * `SimCmdMonsterDirection` in `ref/micropolis/src/sim/w_sim.c`:
 * `dest_x`, `dest_y`, `control`, and `count`.
 * Difference from C: field names are camel-cased and scoped to this command
 * adapter instead of writing directly to `SimSprite`.
 */
export interface SimDisasterSpriteGoalUtilitySprite {
  destX: number;
  destY: number;
  control: number;
  count: number;
}

/**
 * Mutable backing state for disasters/sprite-goal utility subcommands.
 * Mirrors `GetSprite(GOD)` / `GetSprite(COP)` read paths in
 * `ref/micropolis/src/sim/w_sim.c`.
 * Difference from C: GOD/COP lookup targets are injected as typed nullable
 * references instead of process-global sprite arrays.
 */
export interface SimDisastersSpriteGoalUtilityState {
  godSprite: SimDisasterSpriteGoalUtilitySprite | null;
  copSprite: SimDisasterSpriteGoalUtilitySprite | null;
}

const SIM_DISASTERS_SPRITE_GOAL_UTILITY_DEFAULT_STATE: SimDisastersSpriteGoalUtilityState = {
  godSprite: null,
  copSprite: null,
};

/**
 * Hook callbacks for disasters/sprite-goal utility side effects.
 * Mirrors the C calls made by these handlers in `ref/micropolis/src/sim/w_sim.c`:
 * disaster creators, `MakeMonster()`, and `GenerateCopter(x, y)`.
 * Difference from C: side effects are injected callbacks so tests/runtime can
 * provide engine integration explicitly.
 */
export interface SimDisastersSpriteGoalUtilityHooks {
  onMakeFire?: () => void;
  onMakeFlood?: () => void;
  onMakeTornado?: () => void;
  onMakeEarthquake?: () => void;
  onMakeMonster?: () => void;
  onMakeMeltdown?: () => void;
  onFireBomb?: () => void;
  onGenerateCopter?: (x: number, y: number) => void;
}

/**
 * Constructor options for `createSimDisastersSpriteGoalUtilitySubcommandEntries`.
 * Mirrors command wiring for disaster/sprite-goal utilities in
 * `sim_command_init` (`ref/micropolis/src/sim/w_sim.c`).
 */
export interface CreateSimDisastersSpriteGoalUtilitySubcommandEntriesOptions {
  state?: SimDisastersSpriteGoalUtilityState;
  hooks?: SimDisastersSpriteGoalUtilityHooks;
}

/**
 * Creates mutable state for disasters/sprite-goal utility subcommands.
 * Mirrors nullable `GetSprite(...)` lookup behavior in `ref/micropolis/src/sim/w_sprite.c`
 * and command consumers in `ref/micropolis/src/sim/w_sim.c`.
 * Difference from C: callers may override GOD/COP sprite refs per runtime/test.
 */
export function createSimDisastersSpriteGoalUtilityState(
  initialValues: Partial<SimDisastersSpriteGoalUtilityState> = {},
): SimDisastersSpriteGoalUtilityState {
  return {
    ...SIM_DISASTERS_SPRITE_GOAL_UTILITY_DEFAULT_STATE,
    ...initialValues,
  };
}

/**
 * Creates default goal-related sprite fields.
 * Mirrors field defaults initialized by `InitSprite` in
 * `ref/micropolis/src/sim/w_sprite.c` for `dest_x`, `dest_y`, `control`,
 * and `count`.
 * Difference from C: only the fields touched by `SimCmd*Goal` utilities are
 * modeled here.
 */
function createDefaultDisasterSpriteGoalUtilitySprite(): SimDisasterSpriteGoalUtilitySprite {
  return {
    // `InitSprite` defaults in `w_sprite.c`.
    destX: 0,
    destY: 0,
    control: -1,
    count: 0,
  };
}

/**
 * Parses one Tcl integer argument for disaster/sprite-goal utilities.
 * Mirrors `Tcl_GetInt` usage in `SimCmdMonsterGoal`, `SimCmdHelicopterGoal`,
 * and `SimCmdMonsterDirection` in `ref/micropolis/src/sim/w_sim.c`.
 */
function parseSimDisasterSpriteGoalIntArg(
  argv: readonly string[],
  name: SimDisastersSpriteGoalUtilitySubcommandName,
  argIndex: number,
): number | ScriptRuntimeResult {
  const rawValue = argv[argIndex];
  if (rawValue === undefined) {
    return makeScriptFailure(
      new ScriptRuntimeError(
        ScriptRuntimeErrorCode.InvalidArgCount,
        `sim ${name} missing integer argument at argv[${argIndex}]`,
      ),
    );
  }

  const parsedValue = parseTclInt32(rawValue);
  if (parsedValue === null) {
    return makeScriptFailure(
      new ScriptRuntimeError(
        ScriptRuntimeErrorCode.InvalidInteger,
        `sim ${name} expected a 32-bit integer at argv[${argIndex}]: ${rawValue}`,
      ),
    );
  }

  return parsedValue;
}

/**
 * Executes `MakeMonster` side effect for goal utilities.
 * Mirrors `MakeMonster()` calls from `SimCmdMonsterGoal` and
 * `SimCmdMonsterDirection` in `ref/micropolis/src/sim/w_sim.c`.
 * Difference from C: when no hook is provided, a deterministic default GOD
 * sprite is created locally to keep command parity testable.
 */
function runSimMakeMonsterParity(
  state: SimDisastersSpriteGoalUtilityState,
  hooks: SimDisastersSpriteGoalUtilityHooks,
): void {
  hooks.onMakeMonster?.();
  if (hooks.onMakeMonster === undefined && state.godSprite === null) {
    state.godSprite = createDefaultDisasterSpriteGoalUtilitySprite();
  }
}

/**
 * Executes `GenerateCopter` side effect for `HelicopterGoal`.
 * Mirrors `GenerateCopter(x, y)` usage in `SimCmdHelicopterGoal`
 * (`ref/micropolis/src/sim/w_sim.c`).
 * Difference from C: when no hook is provided, a deterministic default COP
 * sprite is created locally to keep command parity testable.
 */
function runSimGenerateCopterParity(
  state: SimDisastersSpriteGoalUtilityState,
  hooks: SimDisastersSpriteGoalUtilityHooks,
  x: number,
  y: number,
): void {
  hooks.onGenerateCopter?.(x, y);
  if (hooks.onGenerateCopter === undefined && state.copSprite === null) {
    state.copSprite = createDefaultDisasterSpriteGoalUtilitySprite();
  }
}

/**
 * Resolves a GOD sprite using C parity lookup/create flow.
 * Mirrors:
 * `GetSprite(GOD)` -> `MakeMonster()` -> `GetSprite(GOD)` in
 * `SimCmdMonsterGoal` / `SimCmdMonsterDirection`
 * (`ref/micropolis/src/sim/w_sim.c`).
 */
function ensureSimGodSprite(
  state: SimDisastersSpriteGoalUtilityState,
  hooks: SimDisastersSpriteGoalUtilityHooks,
  callerName: 'MonsterGoal' | 'MonsterDirection',
): SimDisasterSpriteGoalUtilitySprite | ScriptRuntimeResult {
  if (state.godSprite !== null) {
    return state.godSprite;
  }

  runSimMakeMonsterParity(state, hooks);
  if (state.godSprite === null) {
    return makeScriptFailure(
      new ScriptRuntimeError(
        ScriptRuntimeErrorCode.Internal,
        `sim ${callerName} could not create a GOD sprite`,
      ),
    );
  }

  return state.godSprite;
}

/**
 * Resolves a COP sprite using C parity lookup/create flow.
 * Mirrors:
 * `GetSprite(COP)` -> `GenerateCopter(x, y)` -> `GetSprite(COP)` in
 * `SimCmdHelicopterGoal` (`ref/micropolis/src/sim/w_sim.c`).
 */
function ensureSimCopSprite(
  state: SimDisastersSpriteGoalUtilityState,
  hooks: SimDisastersSpriteGoalUtilityHooks,
  x: number,
  y: number,
): SimDisasterSpriteGoalUtilitySprite | ScriptRuntimeResult {
  if (state.copSprite !== null) {
    return state.copSprite;
  }

  runSimGenerateCopterParity(state, hooks, x, y);
  if (state.copSprite === null) {
    return makeScriptFailure(
      new ScriptRuntimeError(
        ScriptRuntimeErrorCode.Internal,
        'sim HelicopterGoal could not create a COP sprite',
      ),
    );
  }

  return state.copSprite;
}

/**
 * Creates one disaster-creator handler using `SIMCMD_CALL` parity.
 * Mirrors `SIMCMD_CALL(...)` expansions for disaster creators and `FireBomb`
 * in `ref/micropolis/src/sim/w_sim.c`.
 * Parity note: argc is intentionally ignored.
 */
function createSimDisasterCreatorSubcommandHandler(
  state: SimDisastersSpriteGoalUtilityState,
  hooks: SimDisastersSpriteGoalUtilityHooks,
  name: SimDisasterCreatorSubcommandName,
): SimSubcommandHandler {
  return () => {
    if (name === 'MakeFire') {
      hooks.onMakeFire?.();
    } else if (name === 'MakeFlood') {
      hooks.onMakeFlood?.();
    } else if (name === 'MakeTornado') {
      hooks.onMakeTornado?.();
    } else if (name === 'MakeEarthquake') {
      hooks.onMakeEarthquake?.();
    } else if (name === 'MakeMonster') {
      runSimMakeMonsterParity(state, hooks);
    } else if (name === 'MakeMeltdown') {
      hooks.onMakeMeltdown?.();
    } else {
      hooks.onFireBomb?.();
    }

    return makeScriptSuccess();
  };
}

/**
 * Creates one `SimCmdMonsterGoal`-equivalent handler.
 * Mirrors `SimCmdMonsterGoal` in `ref/micropolis/src/sim/w_sim.c`:
 * parse pixel coords, resolve GOD sprite via lookup/create flow, then set
 * `dest_x`, `dest_y`, `control=-2`, and `count=-1`.
 */
function createSimMonsterGoalSubcommandHandler(
  state: SimDisastersSpriteGoalUtilityState,
  hooks: SimDisastersSpriteGoalUtilityHooks,
): SimSubcommandHandler {
  return (argv: readonly string[]): ScriptRuntimeResult => {
    if (argv.length !== 4) {
      return makeScriptFailure(
        new ScriptRuntimeError(
          ScriptRuntimeErrorCode.InvalidArgCount,
          `sim MonsterGoal expects argc 4, got ${argv.length}`,
        ),
      );
    }

    const parsedX = parseSimDisasterSpriteGoalIntArg(argv, 'MonsterGoal', 2);
    if (typeof parsedX !== 'number') {
      return parsedX;
    }

    const parsedY = parseSimDisasterSpriteGoalIntArg(argv, 'MonsterGoal', 3);
    if (typeof parsedY !== 'number') {
      return parsedY;
    }

    const sprite = ensureSimGodSprite(state, hooks, 'MonsterGoal');
    if ('code' in sprite) {
      return sprite;
    }

    sprite.destX = parsedX;
    sprite.destY = parsedY;
    sprite.control = -2;
    sprite.count = -1;
    return makeScriptSuccess();
  };
}

/**
 * Creates one `SimCmdHelicopterGoal`-equivalent handler.
 * Mirrors `SimCmdHelicopterGoal` in `ref/micropolis/src/sim/w_sim.c`:
 * parse pixel coords, resolve COP sprite via lookup/create flow, then set
 * `dest_x` and `dest_y`.
 */
function createSimHelicopterGoalSubcommandHandler(
  state: SimDisastersSpriteGoalUtilityState,
  hooks: SimDisastersSpriteGoalUtilityHooks,
): SimSubcommandHandler {
  return (argv: readonly string[]): ScriptRuntimeResult => {
    if (argv.length !== 4) {
      return makeScriptFailure(
        new ScriptRuntimeError(
          ScriptRuntimeErrorCode.InvalidArgCount,
          `sim HelicopterGoal expects argc 4, got ${argv.length}`,
        ),
      );
    }

    const parsedX = parseSimDisasterSpriteGoalIntArg(argv, 'HelicopterGoal', 2);
    if (typeof parsedX !== 'number') {
      return parsedX;
    }

    const parsedY = parseSimDisasterSpriteGoalIntArg(argv, 'HelicopterGoal', 3);
    if (typeof parsedY !== 'number') {
      return parsedY;
    }

    const sprite = ensureSimCopSprite(state, hooks, parsedX, parsedY);
    if ('code' in sprite) {
      return sprite;
    }

    sprite.destX = parsedX;
    sprite.destY = parsedY;
    return makeScriptSuccess();
  };
}

/**
 * Creates one `SimCmdMonsterDirection`-equivalent handler.
 * Mirrors `SimCmdMonsterDirection` in `ref/micropolis/src/sim/w_sim.c`:
 * parse direction, enforce range `-1..7`, resolve GOD sprite via lookup/create
 * flow, and assign `control`.
 */
function createSimMonsterDirectionSubcommandHandler(
  state: SimDisastersSpriteGoalUtilityState,
  hooks: SimDisastersSpriteGoalUtilityHooks,
): SimSubcommandHandler {
  return (argv: readonly string[]): ScriptRuntimeResult => {
    if (argv.length !== 3) {
      return makeScriptFailure(
        new ScriptRuntimeError(
          ScriptRuntimeErrorCode.InvalidArgCount,
          `sim MonsterDirection expects argc 3, got ${argv.length}`,
        ),
      );
    }

    const parsedDirection = parseSimDisasterSpriteGoalIntArg(argv, 'MonsterDirection', 2);
    if (typeof parsedDirection !== 'number') {
      return parsedDirection;
    }
    if (parsedDirection < -1 || parsedDirection > 7) {
      return makeScriptFailure(
        new ScriptRuntimeError(
          ScriptRuntimeErrorCode.InvalidInteger,
          `sim MonsterDirection expected direction in range -1..7 at argv[2]: ${parsedDirection}`,
        ),
      );
    }

    const sprite = ensureSimGodSprite(state, hooks, 'MonsterDirection');
    if ('code' in sprite) {
      return sprite;
    }

    sprite.control = parsedDirection;
    return makeScriptSuccess();
  };
}

/**
 * Builds disasters/sprite-goal utility `sim` subcommand entries.
 * Mirrors disaster creator call commands (`SIMCMD_CALL`) plus
 * `SimCmdMonsterGoal`, `SimCmdHelicopterGoal`, and `SimCmdMonsterDirection`
 * in `ref/micropolis/src/sim/w_sim.c`.
 * Parity note: creator handlers intentionally skip argc validation because the
 * C macro form does the same; sprite-goal handlers enforce explicit argc/range
 * checks and follow `GetSprite` -> create -> `GetSprite` flow.
 */
export function createSimDisastersSpriteGoalUtilitySubcommandEntries(
  options: CreateSimDisastersSpriteGoalUtilitySubcommandEntriesOptions = {},
): readonly SimSubcommandEntry[] {
  const state = options.state ?? createSimDisastersSpriteGoalUtilityState();
  const hooks = options.hooks ?? {};

  return [
    ['MakeFire', createSimDisasterCreatorSubcommandHandler(state, hooks, 'MakeFire')] as const,
    ['MakeFlood', createSimDisasterCreatorSubcommandHandler(state, hooks, 'MakeFlood')] as const,
    [
      'MakeTornado',
      createSimDisasterCreatorSubcommandHandler(state, hooks, 'MakeTornado'),
    ] as const,
    [
      'MakeEarthquake',
      createSimDisasterCreatorSubcommandHandler(state, hooks, 'MakeEarthquake'),
    ] as const,
    [
      'MakeMonster',
      createSimDisasterCreatorSubcommandHandler(state, hooks, 'MakeMonster'),
    ] as const,
    [
      'MakeMeltdown',
      createSimDisasterCreatorSubcommandHandler(state, hooks, 'MakeMeltdown'),
    ] as const,
    ['FireBomb', createSimDisasterCreatorSubcommandHandler(state, hooks, 'FireBomb')] as const,
    ['MonsterGoal', createSimMonsterGoalSubcommandHandler(state, hooks)] as const,
    ['HelicopterGoal', createSimHelicopterGoalSubcommandHandler(state, hooks)] as const,
    ['MonsterDirection', createSimMonsterDirectionSubcommandHandler(state, hooks)] as const,
  ];
}

/**
 * `sim` URL/browser/random/dollars utility subcommands from `w_sim.c`.
 * Mirrors explicit command registrations for `QuoteURL`, `OpenWebBrowser`,
 * `Rand`, and `Dollars` in `sim_command_init`
 * (`ref/micropolis/src/sim/w_sim.c`).
 */
export const SIM_URL_BROWSER_RANDOM_DOLLARS_UTILITY_SUBCOMMAND_NAMES = [
  'QuoteURL',
  'OpenWebBrowser',
  'Rand',
  'Dollars',
] as const;

/**
 * Union of URL/browser/random/dollars utility subcommand names from `w_sim.c`.
 */
export type SimUrlBrowserRandomDollarsUtilitySubcommandName =
  (typeof SIM_URL_BROWSER_RANDOM_DOLLARS_UTILITY_SUBCOMMAND_NAMES)[number];

/**
 * Hook callbacks for URL/browser/random/dollars side effects.
 * Mirrors side effects in `SimCmdOpenWebBrowser` and random helpers used by
 * `SimCmdRand` in `ref/micropolis/src/sim/w_sim.c` plus `Rand`/`Rand16` in
 * `ref/micropolis/src/sim/s_sim.c`.
 * Difference from C: browser launch and RNG are injectable for deterministic
 * tests and host-environment integration.
 */
export interface SimUrlBrowserRandomDollarsUtilityHooks {
  onOpenWebBrowser?: (shellCommand: string, url: string) => number | undefined;
  onRand?: (maxInclusive: number) => number;
  onRand16?: () => number;
}

/**
 * Parity flags for URL/browser/random/dollars utilities.
 * Mirrors legacy `SimCmdDollars` behavior in `ref/micropolis/src/sim/w_sim.c`,
 * which formats `argv[1]` ("Dollars") because it accepts argc 2.
 * Difference from C: non-legacy mode provides a corrected interface that
 * formats caller input from `argv[2]` with argc 3.
 */
export interface SimUrlBrowserRandomDollarsUtilityParityOptions {
  legacyDollarsLiteralFormat?: boolean;
}

/**
 * Constructor options for `createSimUrlBrowserRandomDollarsUtilitySubcommandEntries`.
 * Mirrors utility command wiring in `sim_command_init`
 * (`ref/micropolis/src/sim/w_sim.c`).
 */
export interface CreateSimUrlBrowserRandomDollarsUtilitySubcommandEntriesOptions {
  hooks?: SimUrlBrowserRandomDollarsUtilityHooks;
  parity?: SimUrlBrowserRandomDollarsUtilityParityOptions;
}

const SIM_URL_QUOTE_HEX_DIGITS = '0123456789ABCDEF';
const SIM_URL_UTILITY_MAX_BYTE_LENGTH = 255;
const SIM_RAND16_MAX = 0xffff;

function getUtf8ByteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

/**
 * URL-escapes bytes using `SimCmdQuoteURL` rules.
 * Mirrors byte loop + `%XX` escaping in `SimCmdQuoteURL`
 * (`ref/micropolis/src/sim/w_sim.c`).
 * Difference from C: JavaScript strings are encoded as UTF-8 bytes first.
 */
function quoteUrlParity(raw: string): string {
  const bytes = Buffer.from(raw, 'utf8');
  let quoted = '';

  for (const byte of bytes.values()) {
    if (
      byte < 32 ||
      byte >= 128 ||
      byte === 43 ||
      byte === 37 ||
      byte === 38 ||
      byte === 60 ||
      byte === 62 ||
      byte === 34 ||
      byte === 39
    ) {
      quoted += `%${SIM_URL_QUOTE_HEX_DIGITS[(byte >> 4) & 0x0f]}${SIM_URL_QUOTE_HEX_DIGITS[byte & 0x0f]}`;
    } else if (byte === 32) {
      quoted += '+';
    } else {
      quoted += String.fromCharCode(byte);
    }
  }

  return quoted;
}

/**
 * Dollar formatter used by `SimCmdDollars`.
 * Mirrors `makeDollarDecimalStr` in `ref/micropolis/src/sim/w_util.c`.
 */
function formatDollarDecimalParity(raw: string): string {
  const numOfDigits = raw.length;
  if (numOfDigits <= 3) {
    return `$${raw}`;
  }

  let leftMostSet = numOfDigits % 3;
  if (leftMostSet === 0) {
    leftMostSet = 3;
  }

  let formatted = `$${raw.slice(0, leftMostSet)}`;
  for (let index = leftMostSet; index < numOfDigits; index += 3) {
    formatted += `,${raw.slice(index, index + 3)}`;
  }

  return formatted;
}

function toSignedInt16(value: number): number {
  const wrapped = value & SIM_RAND16_MAX;
  return wrapped >= 0x8000 ? wrapped - 0x10000 : wrapped;
}

function runSimRand16Parity(hooks: SimUrlBrowserRandomDollarsUtilityHooks): number {
  const hookedValue = hooks.onRand16?.() ?? hooks.onRand?.(SIM_RAND16_MAX);
  if (hookedValue !== undefined) {
    return Math.trunc(hookedValue) & SIM_RAND16_MAX;
  }

  return Math.trunc(Math.random() * (SIM_RAND16_MAX + 1));
}

/**
 * Runs C-style `Rand(short range)` logic for `SimCmdRand`.
 * Mirrors `Rand` in `ref/micropolis/src/sim/s_sim.c`.
 * Difference from C: the divide-by-zero case from input `-1` is safely mapped
 * to `0` instead of invoking undefined behavior.
 */
function runSimRandWithMaxParity(
  maxInclusive: number,
  hooks: SimUrlBrowserRandomDollarsUtilityHooks,
): number {
  if (hooks.onRand !== undefined) {
    return Math.trunc(hooks.onRand(maxInclusive));
  }

  const range = maxInclusive + 1;
  if (range === 0) {
    return 0;
  }

  const maxMultiple = Math.trunc(SIM_RAND16_MAX / range) * range;
  let randomValue = runSimRand16Parity(hooks);
  while (randomValue >= maxMultiple) {
    randomValue = runSimRand16Parity(hooks);
  }

  return Math.trunc(randomValue % range);
}

function createSimQuoteUrlSubcommandHandler(): SimSubcommandHandler {
  return (argv: readonly string[]): ScriptRuntimeResult => {
    if (argv.length !== 3) {
      return makeScriptFailure(
        new ScriptRuntimeError(
          ScriptRuntimeErrorCode.InvalidArgCount,
          `sim QuoteURL expects argc 3, got ${argv.length}`,
        ),
      );
    }

    const rawUrl = argv[2];
    if (rawUrl === undefined) {
      return makeScriptFailure(
        new ScriptRuntimeError(
          ScriptRuntimeErrorCode.InvalidArgCount,
          'sim QuoteURL missing string argument at argv[2]',
        ),
      );
    }
    const byteLength = getUtf8ByteLength(rawUrl);
    if (byteLength > SIM_URL_UTILITY_MAX_BYTE_LENGTH) {
      return makeScriptFailure(
        new ScriptRuntimeError(
          ScriptRuntimeErrorCode.InvalidArgCount,
          `sim QuoteURL expected argv[2] byte length <= 255, got ${byteLength}`,
        ),
      );
    }

    return makeScriptSuccess(quoteUrlParity(rawUrl));
  };
}

function createSimOpenWebBrowserSubcommandHandler(
  hooks: SimUrlBrowserRandomDollarsUtilityHooks,
): SimSubcommandHandler {
  return (argv: readonly string[]): ScriptRuntimeResult => {
    if (argv.length !== 3) {
      return makeScriptFailure(
        new ScriptRuntimeError(
          ScriptRuntimeErrorCode.InvalidArgCount,
          `sim OpenWebBrowser expects argc 3, got ${argv.length}`,
        ),
      );
    }

    const url = argv[2];
    if (url === undefined) {
      return makeScriptFailure(
        new ScriptRuntimeError(
          ScriptRuntimeErrorCode.InvalidArgCount,
          'sim OpenWebBrowser missing string argument at argv[2]',
        ),
      );
    }
    const byteLength = getUtf8ByteLength(url);
    if (byteLength > SIM_URL_UTILITY_MAX_BYTE_LENGTH) {
      return makeScriptFailure(
        new ScriptRuntimeError(
          ScriptRuntimeErrorCode.InvalidArgCount,
          `sim OpenWebBrowser expected argv[2] byte length <= 255, got ${byteLength}`,
        ),
      );
    }

    const shellCommand = `netscape -no-about-splash '${url}' &`;
    let result = 1;
    const hookResult = hooks.onOpenWebBrowser?.(shellCommand, url);
    if (hookResult !== undefined) {
      result = Math.trunc(hookResult);
    }

    return makeScriptSuccess(String(result));
  };
}

function createSimRandSubcommandHandler(
  hooks: SimUrlBrowserRandomDollarsUtilityHooks,
): SimSubcommandHandler {
  return (argv: readonly string[]): ScriptRuntimeResult => {
    if (argv.length !== 2 && argv.length !== 3) {
      return makeScriptFailure(
        new ScriptRuntimeError(
          ScriptRuntimeErrorCode.InvalidArgCount,
          `sim Rand expects argc 2 or 3, got ${argv.length}`,
        ),
      );
    }

    if (argv.length === 3) {
      const rawValue = argv[2];
      if (rawValue === undefined) {
        return makeScriptFailure(
          new ScriptRuntimeError(
            ScriptRuntimeErrorCode.InvalidArgCount,
            'sim Rand missing integer argument at argv[2]',
          ),
        );
      }

      const parsedValue = parseTclInt32(rawValue);
      if (parsedValue === null) {
        return makeScriptFailure(
          new ScriptRuntimeError(
            ScriptRuntimeErrorCode.InvalidInteger,
            `sim Rand expected a 32-bit integer at argv[2]: ${rawValue}`,
          ),
        );
      }

      const range = toSignedInt16(parsedValue);
      return makeScriptSuccess(String(runSimRandWithMaxParity(range, hooks)));
    }

    return makeScriptSuccess(String(runSimRand16Parity(hooks)));
  };
}

function createSimDollarsSubcommandHandler(
  parity: SimUrlBrowserRandomDollarsUtilityParityOptions,
): SimSubcommandHandler {
  return (argv: readonly string[]): ScriptRuntimeResult => {
    if (parity.legacyDollarsLiteralFormat) {
      if (argv.length !== 2) {
        return makeScriptFailure(
          new ScriptRuntimeError(
            ScriptRuntimeErrorCode.InvalidArgCount,
            `sim Dollars expects argc 2 in legacy mode, got ${argv.length}`,
          ),
        );
      }

      const source = argv[1];
      if (source === undefined) {
        return makeScriptFailure(
          new ScriptRuntimeError(
            ScriptRuntimeErrorCode.InvalidArgCount,
            'sim Dollars missing legacy input at argv[1]',
          ),
        );
      }

      return makeScriptSuccess(formatDollarDecimalParity(source));
    }

    if (argv.length !== 3) {
      return makeScriptFailure(
        new ScriptRuntimeError(
          ScriptRuntimeErrorCode.InvalidArgCount,
          `sim Dollars expects argc 3, got ${argv.length}`,
        ),
      );
    }

    const source = argv[2];
    if (source === undefined) {
      return makeScriptFailure(
        new ScriptRuntimeError(
          ScriptRuntimeErrorCode.InvalidArgCount,
          'sim Dollars missing string argument at argv[2]',
        ),
      );
    }

    return makeScriptSuccess(formatDollarDecimalParity(source));
  };
}

/**
 * Builds URL/browser/random/dollars utility `sim` subcommand entries.
 * Mirrors `SimCmdQuoteURL`, `SimCmdOpenWebBrowser`, `SimCmdRand`, and
 * `SimCmdDollars` in `ref/micropolis/src/sim/w_sim.c`, plus `Rand` in
 * `ref/micropolis/src/sim/s_sim.c` and `makeDollarDecimalStr` in
 * `ref/micropolis/src/sim/w_util.c`.
 * Parity note: `legacyDollarsLiteralFormat` toggles the legacy `argv[1]`
 * formatting quirk from C; default mode accepts explicit input at `argv[2]`.
 */
export function createSimUrlBrowserRandomDollarsUtilitySubcommandEntries(
  options: CreateSimUrlBrowserRandomDollarsUtilitySubcommandEntriesOptions = {},
): readonly SimSubcommandEntry[] {
  const hooks = options.hooks ?? {};
  const parity = options.parity ?? {};

  return [
    ['QuoteURL', createSimQuoteUrlSubcommandHandler()] as const,
    ['OpenWebBrowser', createSimOpenWebBrowserSubcommandHandler(hooks)] as const,
    ['Rand', createSimRandSubcommandHandler(hooks)] as const,
    ['Dollars', createSimDollarsSubcommandHandler(parity)] as const,
  ];
}

/**
 * One UDP packet emitted by `udp_hear` while handling `sim HearFrom`.
 * Mirrors packet fields used by `sprintf("HandlePacket %d {%s} {...}")` in
 * `ref/micropolis/src/sim/w_net.c`: source IP text and payload bytes.
 * Difference from C: packet payload is represented as typed readonly numbers.
 */
export interface SimNetworkingPacket {
  readonly ipAddress: string;
  readonly bytes: readonly number[];
}

/**
 * Hook callbacks for optional networking `sim` subcommands.
 * Mirrors `SimCmdListenTo` / `SimCmdHearFrom` in `ref/micropolis/src/sim/w_sim.c`
 * and `udp_listen` / `udp_hear` in `ref/micropolis/src/sim/w_net.c`.
 * Difference from C: socket and callback side effects are injected by hooks.
 */
export interface SimNetworkingHooks {
  onListenTo?: (port: number) => number;
  onHearFrom?: (socket: number) => readonly SimNetworkingPacket[] | void;
  onHandlePacket?: (socket: number, ipAddress: string, bytes: readonly number[]) => void;
}

/**
 * Constructor options for `createSimNetworkingSubcommandEntries`.
 * Mirrors optional `NET` command registration in `sim_command_init`
 * (`ref/micropolis/src/sim/w_sim.c`).
 */
export interface CreateSimNetworkingSubcommandEntriesOptions {
  hooks?: SimNetworkingHooks;
}

function createSimListenToSubcommandHandler(hooks: SimNetworkingHooks): SimSubcommandHandler {
  return (argv: readonly string[]): ScriptRuntimeResult => {
    if (argv.length !== 3) {
      return makeScriptFailure(
        new ScriptRuntimeError(
          ScriptRuntimeErrorCode.InvalidArgCount,
          `sim ListenTo expects argc 3, got ${argv.length}`,
        ),
      );
    }

    const rawPort = argv[2];
    if (rawPort === undefined) {
      return makeScriptFailure(
        new ScriptRuntimeError(
          ScriptRuntimeErrorCode.InvalidArgCount,
          'sim ListenTo missing integer argument at argv[2]',
        ),
      );
    }

    const parsedPort = parseTclInt32(rawPort);
    if (parsedPort === null) {
      return makeScriptFailure(
        new ScriptRuntimeError(
          ScriptRuntimeErrorCode.InvalidInteger,
          `sim ListenTo expected a 32-bit integer at argv[2]: ${rawPort}`,
        ),
      );
    }

    const socket = hooks.onListenTo?.(parsedPort) ?? 0;
    return makeScriptSuccess(String(Math.trunc(socket)));
  };
}

function parseSimHearFromSocketArg(rawSocket: string): number | null {
  if (
    rawSocket[0] !== 'f' ||
    rawSocket[1] !== 'i' ||
    rawSocket[2] !== 'l' ||
    rawSocket[3] !== 'e'
  ) {
    return null;
  }

  return parseTclInt32(rawSocket.slice(4));
}

function createSimHearFromSubcommandHandler(hooks: SimNetworkingHooks): SimSubcommandHandler {
  return (argv: readonly string[]): ScriptRuntimeResult => {
    if (argv.length !== 3) {
      return makeScriptFailure(
        new ScriptRuntimeError(
          ScriptRuntimeErrorCode.InvalidArgCount,
          `sim HearFrom expects argc 3, got ${argv.length}`,
        ),
      );
    }

    const rawSocket = argv[2];
    if (rawSocket === undefined) {
      return makeScriptFailure(
        new ScriptRuntimeError(
          ScriptRuntimeErrorCode.InvalidArgCount,
          'sim HearFrom missing file socket argument at argv[2]',
        ),
      );
    }

    const socket = parseSimHearFromSocketArg(rawSocket);
    if (socket === null) {
      return makeScriptFailure(
        new ScriptRuntimeError(
          ScriptRuntimeErrorCode.InvalidInteger,
          `sim HearFrom expected argv[2] in form file<int>: ${rawSocket}`,
        ),
      );
    }

    const packets = hooks.onHearFrom?.(socket) ?? [];
    for (const packet of packets) {
      hooks.onHandlePacket?.(socket, packet.ipAddress, packet.bytes);
    }

    return makeScriptSuccess();
  };
}

/**
 * Builds optional networking `sim` subcommand entries (`ListenTo`, `HearFrom`).
 * Mirrors `SimCmdListenTo` / `SimCmdHearFrom` in
 * `ref/micropolis/src/sim/w_sim.c` and packet callback emission from
 * `udp_hear` in `ref/micropolis/src/sim/w_net.c`.
 * Parity note: `HearFrom` requires `argv[2]` to begin with lowercase `file`
 * followed by a Tcl-style 32-bit integer socket id.
 */
export function createSimNetworkingSubcommandEntries(
  options: CreateSimNetworkingSubcommandEntriesOptions = {},
): readonly SimSubcommandEntry[] {
  const hooks = options.hooks ?? {};

  return [
    ['ListenTo', createSimListenToSubcommandHandler(hooks)] as const,
    ['HearFrom', createSimHearFromSubcommandHandler(hooks)] as const,
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
 * Constructor options for `createSimDefaultSubcommandEntries`.
 * Mirrors optional registration slices in `sim_command_init` from
 * `ref/micropolis/src/sim/w_sim.c`:
 * - `CAM`-guarded `sim` entries (for example `JustCam`)
 * - `NET`-guarded networking entries (`ListenTo`, `HearFrom`)
 * Difference from C: source-delta extras are grouped behind `legacyExtras`
 * and optional entry arrays are injected explicitly.
 */
export interface CreateSimDefaultSubcommandEntriesOptions {
  featureFlags?: SimScriptingFeatureFlags;
  camSubcommandEntries?: readonly SimSubcommandEntry[];
  netSubcommandEntries?: readonly SimSubcommandEntry[];
  legacyExtraSubcommandEntries?: readonly SimSubcommandEntry[];
}

/**
 * Builds the default ordered `sim` subcommand entry list with feature gating.
 * Mirrors `sim_command_init` in `ref/micropolis/src/sim/w_sim.c`, where
 * optional entries are registered only when `CAM`/`NET` are compiled in.
 * Difference from C: optional slices are runtime-flagged (`CAM`, `NET`,
 * `legacyExtras`) instead of compile-time preprocessor branches.
 */
export function createSimDefaultSubcommandEntries(
  options: CreateSimDefaultSubcommandEntriesOptions = {},
): readonly SimSubcommandEntry[] {
  const featureFlags = resolveSimScriptingFeatureFlags(options.featureFlags);

  const entries: SimSubcommandEntry[] = [
    ...createSimSessionControlSubcommandEntries({
      kickState: DEFAULT_SIM_KICK_STATE,
    }),
    ...createSimSpeedDelayControlSubcommandEntries({
      kickState: DEFAULT_SIM_KICK_STATE,
    }),
    ...createSimBudgetOptionsSubcommandEntries({
      kickState: DEFAULT_SIM_KICK_STATE,
    }),
    ...createSimMapDynamicOverlayMiscSubcommandEntries({
      kickState: DEFAULT_SIM_KICK_STATE,
    }),
    ...createSimDisastersSpriteGoalUtilitySubcommandEntries(),
    ...createSimUrlBrowserRandomDollarsUtilitySubcommandEntries(),
    ...createSimCityGameSetupSubcommandEntries(),
    ...createSimAccessorIntSubcommandEntries(createSimAccessorIntState()),
    ...createSimReadOnlyGetterSubcommandEntries(createSimReadOnlyGetterState()),
  ];

  if (featureFlags.CAM) {
    entries.push(...(options.camSubcommandEntries ?? []));
  }

  if (featureFlags.NET) {
    entries.push(...(options.netSubcommandEntries ?? createSimNetworkingSubcommandEntries()));
  }

  if (featureFlags.legacyExtras) {
    entries.push(
      ...(options.legacyExtraSubcommandEntries ?? createSimLegacyExtraSubcommandEntries()),
    );
  }

  return entries;
}

/**
 * Default `sim` subcommand table.
 * Mirrors `sim_command_init` registration slices from
 * `ref/micropolis/src/sim/w_sim.c` for:
 * - session/redraw control (`SIMCMD_CALL`, `SIMCMD_CALL_KICK`, `SimCmdUpdate`)
 * - speed/delay/skip/rest controls (`SimCmdSpeed`, `SimCmdDelay`,
 *   `SimCmdSkips`, `SimCmdSkip`, `SimCmdNeedRest`)
 * - city/game setup commands (`SimCmdCityName`, `SimCmdCityFileName`,
 *   `SimCmdGameLevel`, `SimCmdYear`, and load/generate entries)
 * - disasters/sprite-goal utilities (`SIMCMD_CALL` disaster creators plus
 *   `SimCmdMonsterGoal`, `SimCmdHelicopterGoal`, `SimCmdMonsterDirection`)
 * - URL/browser/random/dollars utilities (`SimCmdQuoteURL`,
 *   `SimCmdOpenWebBrowser`, `SimCmdRand`, `SimCmdDollars`)
 * - optional networking utilities (`SimCmdListenTo`, `SimCmdHearFrom`)
 *   via `createSimNetworkingSubcommandEntries` when `NET` is enabled
 * - optional source-delta legacy extras (`SimCmdHeatSteps`, `SimCmdHeatFlow`,
 *   `SimCmdHeatRule`) via `createSimLegacyExtraSubcommandEntries` when
 *   `legacyExtras` is enabled
 * - accessor commands (`SIMCMD_ACCESS_INT(...)`)
 * - read-only getter commands (`SIMCMD_GET_*` + explicit getters)
 * Parity note: optional feature slices (`CAM`, `NET`, `legacyExtras`) default
 * to disabled and are enabled through `createSimDefaultSubcommandEntries`.
 */
export const SIM_SUBCOMMAND_TABLE: SimSubcommandTable = createSimSubcommandTable(
  createSimDefaultSubcommandEntries(),
);

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
