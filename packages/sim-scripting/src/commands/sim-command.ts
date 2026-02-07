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

/**
 * Default `sim` subcommand table.
 * Mirrors `sim_command_init` registration for accessor and read-only getter
 * commands from `ref/micropolis/src/sim/w_sim.c`.
 * Parity note: includes `SIMCMD_ACCESS_INT(...)` plus read-only getters.
 */
export const SIM_SUBCOMMAND_TABLE: SimSubcommandTable = createSimSubcommandTable([
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
