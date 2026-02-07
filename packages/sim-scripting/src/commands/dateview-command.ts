import {
  makeScriptFailure,
  makeScriptSuccess,
  ScriptRuntimeError,
  ScriptRuntimeErrorCode,
} from '../runtime/errors.ts';
import type { ScriptRuntimeResult } from '../runtime/result-code.ts';
import type { ScriptCommandHandler, ScriptRuntime } from '../runtime/script-runtime.ts';
import { ViewRegistry } from '../state/view-registry.ts';

const TCL_INT32_MIN = -2147483648n;
const TCL_INT32_MAX = 2147483647n;
const DEFAULT_DATE_VIEW_FONT = '-Adobe-Helvetica-Bold-R-Normal-*-140-*';
const DEFAULT_DATE_VIEW_BACKGROUND = '#b0b0b0';
const DEFAULT_DATE_VIEW_BORDER_WIDTH = 2;
const DEFAULT_DATE_VIEW_PAD_X = 1;
const DEFAULT_DATE_VIEW_PAD_Y = 1;
const DEFAULT_DATE_VIEW_WIDTH = 0;
const DEFAULT_DATE_VIEW_MONTH_TAB = 7;
const DEFAULT_DATE_VIEW_YEAR_TAB = 13;
const DEFAULT_DATE_VIEW_VISIBLE = 0;
const DEFAULT_DATE_VIEW_WINDOW_SIZE = 16;
const DEFAULT_DATE_VIEW_RESET = 1;
const DEFAULT_DATE_VIEW_MONTH = 0;
const DEFAULT_DATE_VIEW_YEAR = 0;
const DEFAULT_DATE_VIEW_LAST_MONTH = 0;
const DEFAULT_DATE_VIEW_LAST_YEAR = 0;

/**
 * Mutable `dateview` configure fields.
 * Mirrors `DateConfigSpecs` (`-font`, `-background`, `-borderwidth`, `-padx`,
 * `-pady`, `-width`, `-monthtab`, `-yeartab`) in
 * `ref/micropolis/src/sim/w_date.c`.
 * Difference from C: this stores explicit values instead of Tk-managed config slots.
 */
export interface DateViewConfigureState {
  font: string;
  background: string;
  borderWidth: number;
  padX: number;
  padY: number;
  width: number;
  monthTab: number;
  yearTab: number;
}

/**
 * Mutable state for one created date-view command.
 * Mirrors `SimDate` fields used by `DateCmdposition`, `DateCmdsize`,
 * `DateCmdVisible`, `DateCmdReset`, and `DateCmdSet` in
 * `ref/micropolis/src/sim/w_date.c`.
 * Difference from C: Tk/X11 objects and timer tokens are omitted.
 */
export interface DateViewState {
  commandName: string;
  visible: number;
  wX: number;
  wY: number;
  wWidth: number;
  wHeight: number;
  reset: number;
  month: number;
  year: number;
  lastMonth: number;
  lastYear: number;
  redrawPending: boolean;
  configure: DateViewConfigureState;
}

/**
 * Constructor overrides for `createDateViewState`.
 * Mirrors defaults initialized in `DateViewCmd` + `InitNewDate` + `DoResizeDate(16,16)`
 * in `ref/micropolis/src/sim/w_date.c`.
 */
export interface CreateDateViewStateOptions {
  visible?: number;
  wX?: number;
  wY?: number;
  wWidth?: number;
  wHeight?: number;
  reset?: number;
  month?: number;
  year?: number;
  lastMonth?: number;
  lastYear?: number;
  redrawPending?: boolean;
  configure?: Partial<DateViewConfigureState>;
}

/**
 * Hook callbacks used by `dateview` subcommands.
 * Mirrors redraw scheduling via `EventuallyRedrawDate(date)` in
 * `ref/micropolis/src/sim/w_date.c`.
 * Difference from C: redraw side effects are injectable callbacks.
 */
export interface DateViewSubcommandHooks {
  onScheduleRedraw?: (viewState: DateViewState, source: 'Reset' | 'Set') => void;
}

/**
 * Constructor options for `createDateViewSubcommandEntries`.
 * Mirrors `date_command_init` wiring in `ref/micropolis/src/sim/w_date.c`.
 */
export interface CreateDateViewSubcommandEntriesOptions {
  hooks?: DateViewSubcommandHooks;
}

/**
 * Subcommand names registered for `dateview`.
 * Mirrors `DATE_CMD(configure|position|size|Visible|Reset|Set)` in
 * `date_command_init` (`ref/micropolis/src/sim/w_date.c`).
 */
export const DATE_VIEW_SUBCOMMAND_NAMES = [
  'configure',
  'position',
  'size',
  'Visible',
  'Reset',
  'Set',
] as const;

/**
 * Union of supported date-view subcommand names.
 */
export type DateViewSubcommandName = (typeof DATE_VIEW_SUBCOMMAND_NAMES)[number];

/**
 * Handler signature for `<dateViewPath> <Subcommand> ...`.
 * Mirrors `DateCmd*` function pointer dispatch through `DateCmds`
 * by `DoDateCmd` in `ref/micropolis/src/sim/w_date.c`.
 */
export type DateViewSubcommandHandler = (
  viewState: DateViewState,
  argv: readonly string[],
) => ScriptRuntimeResult;

/**
 * Case-sensitive `dateview` subcommand table.
 * Mirrors `Tcl_HashTable DateCmds` lookup behavior in `DoDateCmd`
 * (`ref/micropolis/src/sim/w_date.c`).
 */
export type DateViewSubcommandTable = ReadonlyMap<string, DateViewSubcommandHandler>;

/**
 * One `dateview` subcommand registration tuple.
 * Mirrors one `DATE_CMD(name)` hash insertion in `date_command_init`
 * (`ref/micropolis/src/sim/w_date.c`).
 */
export type DateViewSubcommandEntry = readonly [name: string, handler: DateViewSubcommandHandler];

const DATE_VIEW_CONFIGURE_OPTION_NAMES = [
  '-font',
  '-background',
  '-borderwidth',
  '-padx',
  '-pady',
  '-width',
  '-monthtab',
  '-yeartab',
] as const;
type DateViewConfigureOptionName = (typeof DATE_VIEW_CONFIGURE_OPTION_NAMES)[number];

/**
 * Marks a date view for deferred redraw processing.
 * Mirrors command-time calls to `EventuallyRedrawDate(date)` in
 * `DateCmdReset` and `DateCmdSet` (`ref/micropolis/src/sim/w_date.c`).
 * Difference from C: timer coalescing cadence (`DateUpdateTime = 200`) is not modeled.
 */
export function requestDateViewRedraw(
  viewState: DateViewState,
  source: 'Reset' | 'Set',
  hooks: DateViewSubcommandHooks = {},
): void {
  viewState.redrawPending = true;
  hooks.onScheduleRedraw?.(viewState, source);
}

/**
 * Parses a Tcl-style integer and enforces 32-bit C `int` range.
 * Mirrors `Tcl_GetInt` usage in `DateCmdposition`, `DateCmdsize`,
 * `DateCmdVisible`, and `DateCmdSet` (`ref/micropolis/src/sim/w_date.c`).
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
 * Creates a typed invalid-argc runtime result.
 * Mirrors `TCL_ERROR` branches for wrong argc in `DateCmd*`
 * (`ref/micropolis/src/sim/w_date.c`).
 */
function makeInvalidArgCount(message: string): ScriptRuntimeResult {
  return makeScriptFailure(new ScriptRuntimeError(ScriptRuntimeErrorCode.InvalidArgCount, message));
}

/**
 * Creates a typed invalid-integer runtime result.
 * Mirrors `Tcl_GetInt(...) != TCL_OK` and range failures in `DateCmd*`
 * (`ref/micropolis/src/sim/w_date.c`).
 */
function makeInvalidInteger(message: string): ScriptRuntimeResult {
  return makeScriptFailure(new ScriptRuntimeError(ScriptRuntimeErrorCode.InvalidInteger, message));
}

/**
 * Converts raw configure option names into the typed date configure union.
 * Mirrors option-name matching in `DateCmdconfigure` + `ConfigureSimDate`
 * (`ref/micropolis/src/sim/w_date.c`).
 */
function toDateViewConfigureOptionName(raw: string): DateViewConfigureOptionName | null {
  switch (raw) {
    case '-font':
    case '-background':
    case '-borderwidth':
    case '-padx':
    case '-pady':
    case '-width':
    case '-monthtab':
    case '-yeartab':
      return raw;
    default:
      return null;
  }
}

/**
 * Reads one date configure option from state.
 * Mirrors single-option `Tk_ConfigureInfo(..., argv[2], ...)` in
 * `DateCmdconfigure` (`ref/micropolis/src/sim/w_date.c`).
 */
function readDateViewConfigureOption(
  viewState: DateViewState,
  optionName: DateViewConfigureOptionName,
): string {
  switch (optionName) {
    case '-font':
      return viewState.configure.font;
    case '-background':
      return viewState.configure.background;
    case '-borderwidth':
      return String(viewState.configure.borderWidth);
    case '-padx':
      return String(viewState.configure.padX);
    case '-pady':
      return String(viewState.configure.padY);
    case '-width':
      return String(viewState.configure.width);
    case '-monthtab':
      return String(viewState.configure.monthTab);
    case '-yeartab':
      return String(viewState.configure.yearTab);
  }
}

/**
 * Serializes all date configure options into a Tcl-like `name value` list.
 * Mirrors no-arg `Tk_ConfigureInfo(..., NULL, ...)` behavior in
 * `DateCmdconfigure` (`ref/micropolis/src/sim/w_date.c`).
 * Difference from C: this returns a flat list instead of Tk's full option tuples.
 */
function serializeDateViewConfigureOptions(viewState: DateViewState): string {
  return DATE_VIEW_CONFIGURE_OPTION_NAMES.map((optionName) => {
    return `${optionName} ${readDateViewConfigureOption(viewState, optionName)}`;
  }).join(' ');
}

/**
 * Applies one date configure option write to state.
 * Mirrors `ConfigureSimDate` writes through `DateConfigSpecs` in
 * `ref/micropolis/src/sim/w_date.c`.
 */
function writeDateViewConfigureOption(
  viewState: DateViewState,
  optionName: DateViewConfigureOptionName,
  optionValue: string,
  contextLabel: string,
): ScriptRuntimeResult | null {
  switch (optionName) {
    case '-font':
      viewState.configure.font = optionValue;
      return null;
    case '-background':
      viewState.configure.background = optionValue;
      return null;
    case '-borderwidth': {
      const parsedBorderWidth = parseTclInt32(optionValue);
      if (parsedBorderWidth === null) {
        return makeInvalidInteger(
          `${contextLabel} expected an integer border width: ${optionValue}`,
        );
      }
      viewState.configure.borderWidth = parsedBorderWidth;
      return null;
    }
    case '-padx': {
      const parsedPadX = parseTclInt32(optionValue);
      if (parsedPadX === null) {
        return makeInvalidInteger(`${contextLabel} expected an integer pad x: ${optionValue}`);
      }
      viewState.configure.padX = parsedPadX;
      return null;
    }
    case '-pady': {
      const parsedPadY = parseTclInt32(optionValue);
      if (parsedPadY === null) {
        return makeInvalidInteger(`${contextLabel} expected an integer pad y: ${optionValue}`);
      }
      viewState.configure.padY = parsedPadY;
      return null;
    }
    case '-width': {
      const parsedWidth = parseTclInt32(optionValue);
      if (parsedWidth === null) {
        return makeInvalidInteger(`${contextLabel} expected an integer width: ${optionValue}`);
      }
      viewState.configure.width = parsedWidth;
      return null;
    }
    case '-monthtab': {
      const parsedMonthTab = parseTclInt32(optionValue);
      if (parsedMonthTab === null) {
        return makeInvalidInteger(`${contextLabel} expected an integer month tab: ${optionValue}`);
      }
      viewState.configure.monthTab = parsedMonthTab;
      return null;
    }
    case '-yeartab': {
      const parsedYearTab = parseTclInt32(optionValue);
      if (parsedYearTab === null) {
        return makeInvalidInteger(`${contextLabel} expected an integer year tab: ${optionValue}`);
      }
      viewState.configure.yearTab = parsedYearTab;
      return null;
    }
  }
}

/**
 * Applies `configure` option/value pairs for date-view creation and writes.
 * Mirrors `ConfigureSimDate(interp, date, argc-2, argv+2, TK_CONFIG_ARGV_ONLY)`
 * call in `DateCmdconfigure` (`ref/micropolis/src/sim/w_date.c`).
 */
function applyDateViewConfigureOptionPairs(
  viewState: DateViewState,
  optionPairs: readonly string[],
  contextLabel: string,
): ScriptRuntimeResult | null {
  if (optionPairs.length % 2 !== 0) {
    return makeInvalidArgCount(
      `${contextLabel} configure expects option/value pairs, got ${optionPairs.length} trailing args`,
    );
  }

  for (let index = 0; index < optionPairs.length; index += 2) {
    const rawOptionName = optionPairs[index];
    const optionValue = optionPairs[index + 1];
    if (rawOptionName === undefined || optionValue === undefined) {
      return makeInvalidArgCount(`${contextLabel} configure encountered missing option/value pair`);
    }

    const optionName = toDateViewConfigureOptionName(rawOptionName);
    if (optionName === null) {
      return makeScriptFailure(
        new ScriptRuntimeError(
          ScriptRuntimeErrorCode.Internal,
          `${contextLabel} configure unknown option: ${rawOptionName}`,
        ),
      );
    }

    const writeResult = writeDateViewConfigureOption(
      viewState,
      optionName,
      optionValue,
      `${contextLabel} configure`,
    );
    if (writeResult !== null) {
      return writeResult;
    }
  }

  return null;
}

/**
 * Implements the `configure` date-view subcommand.
 * Mirrors `DateCmdconfigure` in `ref/micropolis/src/sim/w_date.c`.
 * Parity note: argv shape and option writes are preserved.
 */
function handleDateViewConfigureSubcommand(
  viewState: DateViewState,
  argv: readonly string[],
): ScriptRuntimeResult {
  if (argv.length === 2) {
    return makeScriptSuccess(serializeDateViewConfigureOptions(viewState));
  }

  if (argv.length === 3) {
    const rawOptionName = argv[2];
    if (rawOptionName === undefined) {
      return makeInvalidArgCount(
        `${viewState.commandName} configure missing option name at argv[2]`,
      );
    }

    const optionName = toDateViewConfigureOptionName(rawOptionName);
    if (optionName === null) {
      return makeScriptFailure(
        new ScriptRuntimeError(
          ScriptRuntimeErrorCode.Internal,
          `${viewState.commandName} configure unknown option: ${rawOptionName}`,
        ),
      );
    }

    return makeScriptSuccess(readDateViewConfigureOption(viewState, optionName));
  }

  const writeResult = applyDateViewConfigureOptionPairs(
    viewState,
    argv.slice(2),
    viewState.commandName,
  );
  if (writeResult !== null) {
    return writeResult;
  }

  return makeScriptSuccess('');
}

/**
 * Implements the `position` date-view subcommand.
 * Mirrors `DateCmdposition` in `ref/micropolis/src/sim/w_date.c`:
 * accepts argc 2 or 4, parses `x y`, and returns `w_x w_y`.
 */
function handleDateViewPositionSubcommand(
  viewState: DateViewState,
  argv: readonly string[],
): ScriptRuntimeResult {
  if (argv.length !== 2 && argv.length !== 4) {
    return makeInvalidArgCount(
      `${viewState.commandName} position expects argc 2 or 4, got ${argv.length}`,
    );
  }

  if (argv.length === 4) {
    const rawX = argv[2];
    const rawY = argv[3];
    if (rawX === undefined || rawY === undefined) {
      return makeInvalidArgCount(`${viewState.commandName} position missing x/y arguments`);
    }

    const parsedX = parseTclInt32(rawX);
    if (parsedX === null) {
      return makeInvalidInteger(`${viewState.commandName} position expected an integer x: ${rawX}`);
    }

    const parsedY = parseTclInt32(rawY);
    if (parsedY === null) {
      return makeInvalidInteger(`${viewState.commandName} position expected an integer y: ${rawY}`);
    }

    viewState.wX = parsedX;
    viewState.wY = parsedY;
  }

  return makeScriptSuccess(`${viewState.wX} ${viewState.wY}`);
}

/**
 * Implements the `size` date-view subcommand.
 * Mirrors `DateCmdsize` in `ref/micropolis/src/sim/w_date.c`:
 * accepts argc 2 or 4, parses `w h`, and returns `w_width w_height`.
 */
function handleDateViewSizeSubcommand(
  viewState: DateViewState,
  argv: readonly string[],
): ScriptRuntimeResult {
  if (argv.length !== 2 && argv.length !== 4) {
    return makeInvalidArgCount(
      `${viewState.commandName} size expects argc 2 or 4, got ${argv.length}`,
    );
  }

  if (argv.length === 4) {
    const rawWidth = argv[2];
    const rawHeight = argv[3];
    if (rawWidth === undefined || rawHeight === undefined) {
      return makeInvalidArgCount(`${viewState.commandName} size missing width/height arguments`);
    }

    const parsedWidth = parseTclInt32(rawWidth);
    if (parsedWidth === null) {
      return makeInvalidInteger(
        `${viewState.commandName} size expected an integer width: ${rawWidth}`,
      );
    }

    const parsedHeight = parseTclInt32(rawHeight);
    if (parsedHeight === null) {
      return makeInvalidInteger(
        `${viewState.commandName} size expected an integer height: ${rawHeight}`,
      );
    }

    viewState.wWidth = parsedWidth;
    viewState.wHeight = parsedHeight;
  }

  return makeScriptSuccess(`${viewState.wWidth} ${viewState.wHeight}`);
}

/**
 * Implements the `Visible` date-view subcommand.
 * Mirrors `DateCmdVisible` in `ref/micropolis/src/sim/w_date.c`.
 */
function handleDateViewVisibleSubcommand(
  viewState: DateViewState,
  argv: readonly string[],
): ScriptRuntimeResult {
  if (argv.length !== 2 && argv.length !== 3) {
    return makeInvalidArgCount(
      `${viewState.commandName} Visible expects argc 2 or 3, got ${argv.length}`,
    );
  }

  if (argv.length === 3) {
    const rawVisible = argv[2];
    if (rawVisible === undefined) {
      return makeInvalidArgCount(`${viewState.commandName} Visible missing visible argument`);
    }

    const parsedVisible = parseTclInt32(rawVisible);
    if (parsedVisible === null || parsedVisible < 0 || parsedVisible > 1) {
      return makeInvalidInteger(
        `${viewState.commandName} Visible expected an integer visible in range 0..1: ${rawVisible}`,
      );
    }

    viewState.visible = parsedVisible;
  }

  return makeScriptSuccess(String(viewState.visible));
}

/**
 * Builds the `Reset` date-view subcommand handler.
 * Mirrors `DateCmdReset` in `ref/micropolis/src/sim/w_date.c`:
 * sets `date->reset = 1` and requests deferred redraw.
 */
function createDateViewResetSubcommandHandler(
  hooks: DateViewSubcommandHooks,
): DateViewSubcommandHandler {
  return (viewState: DateViewState, argv: readonly string[]): ScriptRuntimeResult => {
    if (argv.length !== 2) {
      return makeInvalidArgCount(
        `${viewState.commandName} Reset expects argc 2, got ${argv.length}`,
      );
    }

    viewState.reset = 1;
    requestDateViewRedraw(viewState, 'Reset', hooks);
    return makeScriptSuccess('');
  };
}

/**
 * Builds the `Set` date-view subcommand handler.
 * Mirrors `DateCmdSet` in `ref/micropolis/src/sim/w_date.c`:
 * enforces month `0..11`, year `>= 0`, writes values, and requests redraw.
 */
function createDateViewSetSubcommandHandler(
  hooks: DateViewSubcommandHooks,
): DateViewSubcommandHandler {
  return (viewState: DateViewState, argv: readonly string[]): ScriptRuntimeResult => {
    if (argv.length !== 4) {
      return makeInvalidArgCount(`${viewState.commandName} Set expects argc 4, got ${argv.length}`);
    }

    const rawMonth = argv[2];
    const rawYear = argv[3];
    if (rawMonth === undefined || rawYear === undefined) {
      return makeInvalidArgCount(`${viewState.commandName} Set missing month/year arguments`);
    }

    const parsedMonth = parseTclInt32(rawMonth);
    if (parsedMonth === null || parsedMonth < 0 || parsedMonth >= 12) {
      return makeInvalidInteger(
        `${viewState.commandName} Set expected an integer month in range 0..11: ${rawMonth}`,
      );
    }

    const parsedYear = parseTclInt32(rawYear);
    if (parsedYear === null || parsedYear < 0) {
      return makeInvalidInteger(
        `${viewState.commandName} Set expected an integer year >= 0: ${rawYear}`,
      );
    }

    viewState.month = parsedMonth;
    viewState.year = parsedYear;
    requestDateViewRedraw(viewState, 'Set', hooks);
    return makeScriptSuccess('');
  };
}

/**
 * Creates mutable state backing one `dateview` widget command.
 * Mirrors `DateViewCmd` + `InitNewDate` + `DoResizeDate(16, 16)` defaults in
 * `ref/micropolis/src/sim/w_date.c`.
 * Difference from C: `redrawPending` is modeled as a boolean instead of timer-token state.
 */
export function createDateViewState(
  commandName: string,
  options: CreateDateViewStateOptions = {},
): DateViewState {
  return {
    commandName,
    visible: options.visible ?? DEFAULT_DATE_VIEW_VISIBLE,
    wX: options.wX ?? 0,
    wY: options.wY ?? 0,
    wWidth: options.wWidth ?? DEFAULT_DATE_VIEW_WINDOW_SIZE,
    wHeight: options.wHeight ?? DEFAULT_DATE_VIEW_WINDOW_SIZE,
    reset: options.reset ?? DEFAULT_DATE_VIEW_RESET,
    month: options.month ?? DEFAULT_DATE_VIEW_MONTH,
    year: options.year ?? DEFAULT_DATE_VIEW_YEAR,
    lastMonth: options.lastMonth ?? DEFAULT_DATE_VIEW_LAST_MONTH,
    lastYear: options.lastYear ?? DEFAULT_DATE_VIEW_LAST_YEAR,
    redrawPending: options.redrawPending ?? false,
    configure: {
      font: options.configure?.font ?? DEFAULT_DATE_VIEW_FONT,
      background: options.configure?.background ?? DEFAULT_DATE_VIEW_BACKGROUND,
      borderWidth: options.configure?.borderWidth ?? DEFAULT_DATE_VIEW_BORDER_WIDTH,
      padX: options.configure?.padX ?? DEFAULT_DATE_VIEW_PAD_X,
      padY: options.configure?.padY ?? DEFAULT_DATE_VIEW_PAD_Y,
      width: options.configure?.width ?? DEFAULT_DATE_VIEW_WIDTH,
      monthTab: options.configure?.monthTab ?? DEFAULT_DATE_VIEW_MONTH_TAB,
      yearTab: options.configure?.yearTab ?? DEFAULT_DATE_VIEW_YEAR_TAB,
    },
  };
}

/**
 * Builds `dateview` subcommand entries for the P3.2 command set.
 * Mirrors `DATE_CMD(...)` registration in `date_command_init`
 * (`ref/micropolis/src/sim/w_date.c`).
 */
export function createDateViewSubcommandEntries(
  options: CreateDateViewSubcommandEntriesOptions = {},
): readonly DateViewSubcommandEntry[] {
  const hooks = options.hooks ?? {};

  return [
    ['configure', handleDateViewConfigureSubcommand] as const,
    ['position', handleDateViewPositionSubcommand] as const,
    ['size', handleDateViewSizeSubcommand] as const,
    ['Visible', handleDateViewVisibleSubcommand] as const,
    ['Reset', createDateViewResetSubcommandHandler(hooks)] as const,
    ['Set', createDateViewSetSubcommandHandler(hooks)] as const,
  ];
}

/**
 * Builds a case-sensitive date-view subcommand lookup table.
 * Mirrors `Tcl_HashTable DateCmds` registration behavior in
 * `date_command_init`/`DoDateCmd` (`ref/micropolis/src/sim/w_date.c`).
 * Parity note: duplicate names use last-registration-wins map semantics.
 */
export function createDateViewSubcommandTable(
  entries: readonly DateViewSubcommandEntry[] = [],
): DateViewSubcommandTable {
  const table = new Map<string, DateViewSubcommandHandler>();

  for (const [name, handler] of entries) {
    table.set(name, handler);
  }

  return table;
}

/**
 * Default subcommand table for date-view shell behavior.
 * Mirrors `date_command_init` registrations in `ref/micropolis/src/sim/w_date.c`.
 */
export const DATE_VIEW_SUBCOMMAND_TABLE = createDateViewSubcommandTable(
  createDateViewSubcommandEntries(),
);

/**
 * Creates the per-widget date-view dispatcher bound to one view state.
 * Mirrors `DoDateCmd` subcommand lookup flow in `ref/micropolis/src/sim/w_date.c`.
 * Difference from C: typed runtime errors replace Tcl string appends.
 */
export function createDateViewWidgetCommandDispatcher(
  viewState: DateViewState,
  subcommands: DateViewSubcommandTable = DATE_VIEW_SUBCOMMAND_TABLE,
): ScriptCommandHandler {
  return (argv: readonly string[]): ScriptRuntimeResult => {
    const subcommandName = argv[1];
    if (subcommandName === undefined) {
      return makeInvalidArgCount(
        `${viewState.commandName} command requires a subcommand in argv[1]`,
      );
    }

    const subcommandHandler = subcommands.get(subcommandName);
    if (subcommandHandler === undefined) {
      return makeScriptFailure(
        new ScriptRuntimeError(
          ScriptRuntimeErrorCode.UnknownSubcommand,
          `unknown dateview subcommand: ${subcommandName}`,
        ),
      );
    }

    return subcommandHandler(viewState, argv);
  };
}

/**
 * Constructor options for `createDateViewCommandDispatcher`.
 * Mirrors state/command wiring around `DateViewCmd` + `DoDateCmd`
 * in `ref/micropolis/src/sim/w_date.c`.
 */
export interface CreateDateViewCommandDispatcherOptions {
  runtime: ScriptRuntime;
  views?: ViewRegistry<DateViewState>;
  createViewState?: (commandName: string) => DateViewState;
  subcommands?: DateViewSubcommandTable;
}

/**
 * Creates the top-level `dateview` factory command dispatcher.
 * Mirrors `DateViewCmd` creation flow for `dateview pathName ?options?`
 * in `ref/micropolis/src/sim/w_date.c`.
 * Parity note: this preserves command creation/registration behavior while omitting Tk window lifecycle.
 */
export function createDateViewCommandDispatcher(
  options: CreateDateViewCommandDispatcherOptions,
): ScriptCommandHandler {
  const views = options.views ?? new ViewRegistry<DateViewState>();
  const createViewState =
    options.createViewState ?? ((commandName: string) => createDateViewState(commandName));
  const subcommands = options.subcommands ?? DATE_VIEW_SUBCOMMAND_TABLE;

  return (argv: readonly string[]): ScriptRuntimeResult => {
    const commandName = argv[1];
    if (commandName === undefined || commandName.length === 0) {
      return makeInvalidArgCount('dateview command requires a pathName in argv[1]');
    }

    if (views.get(commandName) !== undefined) {
      return makeScriptFailure(
        new ScriptRuntimeError(
          ScriptRuntimeErrorCode.Internal,
          `dateview command already exists: ${commandName}`,
        ),
      );
    }

    const viewState = createViewState(commandName);
    const configureResult = applyDateViewConfigureOptionPairs(
      viewState,
      argv.slice(2),
      `dateview ${commandName}`,
    );
    if (configureResult !== null) {
      return configureResult;
    }

    views.add(commandName, viewState);
    options.runtime.registerCommand(
      commandName,
      createDateViewWidgetCommandDispatcher(viewState, subcommands),
    );
    return makeScriptSuccess(commandName);
  };
}

/**
 * Registers the top-level `dateview` command in a runtime.
 * Mirrors `Tcl_CreateCommand(..., "dateview", DateViewCmd, ...)`
 * in `date_command_init` (`ref/micropolis/src/sim/w_date.c`).
 */
export function registerDateViewCommand(
  runtime: ScriptRuntime,
  options: Omit<CreateDateViewCommandDispatcherOptions, 'runtime'> = {},
): void {
  runtime.registerCommand(
    'dateview',
    createDateViewCommandDispatcher({
      runtime,
      ...options,
    }),
  );
}
