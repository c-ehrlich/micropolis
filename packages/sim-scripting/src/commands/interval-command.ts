import {
  makeScriptFailure,
  makeScriptSuccess,
  ScriptRuntimeError,
  ScriptRuntimeErrorCode,
} from '../runtime/errors.ts';
import type { ScriptRuntimeResult } from '../runtime/result-code.ts';
import type { ScriptCommandHandler, ScriptRuntime } from '../runtime/script-runtime.ts';
import { WidgetRegistry } from '../state/widget-registry.ts';

const TCL_INT32_MIN = -2147483648n;
const TCL_INT32_MAX = 2147483647n;

const DEFAULT_INTERVAL_ACTIVE_FOREGROUND = '#ffaeb9';
const DEFAULT_INTERVAL_BACKGROUND = '#eed5b7';
const DEFAULT_INTERVAL_BORDER_WIDTH = 2;
const DEFAULT_INTERVAL_COMMAND: string | null = null;
const DEFAULT_INTERVAL_CURSOR: string | null = null;
const DEFAULT_INTERVAL_FONT = '-Adobe-Helvetica-Bold-R-Normal-*-120-*';
const DEFAULT_INTERVAL_FOREGROUND = 'Black';
const DEFAULT_INTERVAL_FROM = 0;
const DEFAULT_INTERVAL_LABEL: string | null = null;
const DEFAULT_INTERVAL_LENGTH = 100;
const DEFAULT_INTERVAL_ORIENT = 'vertical';
const DEFAULT_INTERVAL_RELIEF = 'flat';
const DEFAULT_INTERVAL_SHOW_VALUE = 1;
const DEFAULT_INTERVAL_SLIDER_FOREGROUND = '#cdb79e';
const DEFAULT_INTERVAL_MIN = 0;
const DEFAULT_INTERVAL_MAX = 9999;
const DEFAULT_INTERVAL_STATE = 'normal';
const DEFAULT_INTERVAL_TICK_INTERVAL = 0;
const DEFAULT_INTERVAL_TO = 100;
const DEFAULT_INTERVAL_WIDTH = 15;

const INTERVAL_CONFIGURE_OPTION_NAMES = [
  '-activeforeground',
  '-background',
  '-borderwidth',
  '-command',
  '-cursor',
  '-font',
  '-foreground',
  '-from',
  '-label',
  '-length',
  '-orient',
  '-relief',
  '-showvalue',
  '-sliderforeground',
  '-min',
  '-max',
  '-state',
  '-tickinterval',
  '-to',
  '-width',
] as const;

/**
 * Valid orientation values for `interval` widgets.
 * Mirrors `ConfigureInterval` orientation parsing (`vertical`/`horizontal`)
 * in `ref/micropolis/src/sim/w_inter.c`.
 */
export type IntervalOrient = 'vertical' | 'horizontal';

/**
 * Valid state values for `interval` widgets.
 * Mirrors `ConfigureInterval` state validation (`normal`/`disabled`) in
 * `ref/micropolis/src/sim/w_inter.c`.
 */
export type IntervalWidgetState = 'normal' | 'disabled';

/**
 * Mutable `interval` configure fields.
 * Mirrors `configSpecs` and `Interval` script-visible fields in
 * `ref/micropolis/src/sim/w_inter.c`.
 * Difference from C: Tk/X11 resources are represented as scalar values.
 */
export interface IntervalConfigureState {
  activeForeground: string;
  background: string;
  borderWidth: number;
  command: string | null;
  cursor: string | null;
  font: string;
  foreground: string;
  fromValue: number;
  label: string | null;
  length: number;
  orient: IntervalOrient;
  relief: string;
  showValue: number;
  sliderForeground: string;
  minValue: number;
  maxValue: number;
  state: IntervalWidgetState;
  tickInterval: number;
  toValue: number;
  width: number;
}

/**
 * Mutable state for one created `interval` command.
 * Mirrors script-visible interval fields used by `IntervalWidgetCmd`,
 * `ConfigureInterval`, and `SetInterval` in `ref/micropolis/src/sim/w_inter.c`.
 * Difference from C: redraw and command-callback side effects are not modeled.
 */
export interface IntervalState {
  commandName: string;
  configure: IntervalConfigureState;
}

/**
 * Constructor overrides for `createIntervalState`.
 * Mirrors defaults assigned by `Tk_IntervalCmd` + `ConfigureInterval`
 * in `ref/micropolis/src/sim/w_inter.c`.
 */
export interface CreateIntervalStateOptions {
  configure?: Partial<IntervalConfigureState>;
}

/**
 * Subcommand names registered for `interval`.
 * Mirrors `IntervalWidgetCmd` branches in `ref/micropolis/src/sim/w_inter.c`.
 */
export const INTERVAL_SUBCOMMAND_NAMES = ['configure', 'get', 'set', 'reset'] as const;

/**
 * Union of supported interval subcommand names.
 */
export type IntervalSubcommandName = (typeof INTERVAL_SUBCOMMAND_NAMES)[number];

/**
 * Handler signature for `<intervalPath> <Subcommand> ...`.
 * Mirrors `IntervalWidgetCmd` dispatch in `ref/micropolis/src/sim/w_inter.c`.
 */
export type IntervalSubcommandHandler = (
  intervalState: IntervalState,
  argv: readonly string[],
) => ScriptRuntimeResult;

/**
 * Case-sensitive interval subcommand table.
 * Mirrors Tcl command lookup behavior for per-widget commands.
 */
export type IntervalSubcommandTable = ReadonlyMap<string, IntervalSubcommandHandler>;

/**
 * One interval subcommand registration tuple.
 * Mirrors one subcommand branch in `IntervalWidgetCmd`.
 */
export type IntervalSubcommandEntry = readonly [name: string, handler: IntervalSubcommandHandler];

type IntervalConfigureOptionName = (typeof INTERVAL_CONFIGURE_OPTION_NAMES)[number];

/**
 * Parses a Tcl-style integer and enforces 32-bit C `int` range.
 * Mirrors `Tcl_GetInt` usage in `IntervalWidgetCmd` and `ConfigureInterval`
 * (`ref/micropolis/src/sim/w_inter.c`).
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
 * Mirrors `TCL_ERROR` wrong-argument-count branches in `IntervalWidgetCmd`.
 */
function makeInvalidArgCount(message: string): ScriptRuntimeResult {
  return makeScriptFailure(new ScriptRuntimeError(ScriptRuntimeErrorCode.InvalidArgCount, message));
}

/**
 * Creates a typed invalid-integer runtime result.
 * Mirrors `Tcl_GetInt(...) != TCL_OK` branches in `IntervalWidgetCmd`.
 */
function makeInvalidInteger(message: string): ScriptRuntimeResult {
  return makeScriptFailure(new ScriptRuntimeError(ScriptRuntimeErrorCode.InvalidInteger, message));
}

/**
 * Clamps one value to interval bounds while preserving C direction logic.
 * Mirrors XOR-based clamp checks in `SetInterval` and `IntervalWidgetCmd set`
 * (`ref/micropolis/src/sim/w_inter.c`).
 */
function clampIntervalValueToBounds(value: number, fromValue: number, toValue: number): number {
  let clampedValue = value;
  if (clampedValue < fromValue !== toValue < fromValue) {
    clampedValue = fromValue;
  }
  if (clampedValue > toValue !== toValue < fromValue) {
    clampedValue = toValue;
  }
  return clampedValue;
}

/**
 * Applies C-style `SetInterval` normalization and writes state if changed.
 * Mirrors `SetInterval(intervalPtr, min, max, notify)` in
 * `ref/micropolis/src/sim/w_inter.c` (without redraw/notify side effects).
 */
function setIntervalRange(intervalState: IntervalState, minValue: number, maxValue: number): void {
  let nextMinValue = minValue;
  let nextMaxValue = maxValue;
  if (nextMinValue > nextMaxValue) {
    const temp = nextMinValue;
    nextMinValue = nextMaxValue;
    nextMaxValue = temp;
  }

  const fromValue = intervalState.configure.fromValue;
  const toValue = intervalState.configure.toValue;

  nextMinValue = clampIntervalValueToBounds(nextMinValue, fromValue, toValue);
  nextMaxValue = clampIntervalValueToBounds(nextMaxValue, fromValue, toValue);

  if (
    nextMinValue === intervalState.configure.minValue &&
    nextMaxValue === intervalState.configure.maxValue
  ) {
    return;
  }

  intervalState.configure.minValue = nextMinValue;
  intervalState.configure.maxValue = nextMaxValue;
}

/**
 * Applies post-config normalization for `interval` options.
 * Mirrors `ConfigureInterval` in `ref/micropolis/src/sim/w_inter.c`:
 * normalize `tickInterval` sign and clamp `min/max` through `SetInterval`.
 */
function normalizeIntervalAfterConfigure(intervalState: IntervalState): void {
  const configure = intervalState.configure;
  if (configure.tickInterval < 0 !== configure.toValue - configure.fromValue < 0) {
    configure.tickInterval = -configure.tickInterval;
  }

  setIntervalRange(intervalState, configure.minValue, configure.maxValue);
}

/**
 * Converts raw configure option names into the typed interval option union.
 * Mirrors option-name parsing in `ConfigureInterval` (`ref/micropolis/src/sim/w_inter.c`).
 * Difference from C: Tk synonyms (`-bd`, `-bg`, `-fg`) are normalized explicitly.
 */
function toIntervalConfigureOptionName(raw: string): IntervalConfigureOptionName | null {
  switch (raw) {
    case '-activeforeground':
    case '-background':
    case '-borderwidth':
    case '-command':
    case '-cursor':
    case '-font':
    case '-foreground':
    case '-from':
    case '-label':
    case '-length':
    case '-orient':
    case '-relief':
    case '-showvalue':
    case '-sliderforeground':
    case '-min':
    case '-max':
    case '-state':
    case '-tickinterval':
    case '-to':
    case '-width':
      return raw;
    case '-bd':
      return '-borderwidth';
    case '-bg':
      return '-background';
    case '-fg':
      return '-foreground';
    default:
      return null;
  }
}

/**
 * Reads one interval configure option from state.
 * Mirrors single-option `Tk_ConfigureInfo(..., argv[2], ...)` behavior in
 * `IntervalWidgetCmd` (`ref/micropolis/src/sim/w_inter.c`).
 */
function readIntervalConfigureOption(
  intervalState: IntervalState,
  optionName: IntervalConfigureOptionName,
): string {
  const configure = intervalState.configure;

  switch (optionName) {
    case '-activeforeground':
      return configure.activeForeground;
    case '-background':
      return configure.background;
    case '-borderwidth':
      return String(configure.borderWidth);
    case '-command':
      return configure.command ?? '';
    case '-cursor':
      return configure.cursor ?? '';
    case '-font':
      return configure.font;
    case '-foreground':
      return configure.foreground;
    case '-from':
      return String(configure.fromValue);
    case '-label':
      return configure.label ?? '';
    case '-length':
      return String(configure.length);
    case '-orient':
      return configure.orient;
    case '-relief':
      return configure.relief;
    case '-showvalue':
      return String(configure.showValue);
    case '-sliderforeground':
      return configure.sliderForeground;
    case '-min':
      return String(configure.minValue);
    case '-max':
      return String(configure.maxValue);
    case '-state':
      return configure.state;
    case '-tickinterval':
      return String(configure.tickInterval);
    case '-to':
      return String(configure.toValue);
    case '-width':
      return String(configure.width);
  }
}

/**
 * Serializes all interval configure options into a Tcl-like `name value` list.
 * Mirrors no-arg `Tk_ConfigureInfo(..., NULL, ...)` behavior in `IntervalWidgetCmd`.
 * Difference from C: this returns a flat list rather than Tk option tuples.
 */
function serializeIntervalConfigureOptions(intervalState: IntervalState): string {
  return INTERVAL_CONFIGURE_OPTION_NAMES.map((optionName) => {
    return `${optionName} ${readIntervalConfigureOption(intervalState, optionName)}`;
  }).join(' ');
}

/**
 * Applies one interval configure option write to state.
 * Mirrors Tk option writes performed by `ConfigureInterval` in
 * `ref/micropolis/src/sim/w_inter.c`.
 */
function writeIntervalConfigureOption(
  intervalState: IntervalState,
  optionName: IntervalConfigureOptionName,
  optionValue: string,
  contextLabel: string,
): ScriptRuntimeResult | null {
  const configure = intervalState.configure;

  switch (optionName) {
    case '-activeforeground':
      configure.activeForeground = optionValue;
      return null;
    case '-background':
      configure.background = optionValue;
      return null;
    case '-borderwidth': {
      const parsedBorderWidth = parseTclInt32(optionValue);
      if (parsedBorderWidth === null) {
        return makeInvalidInteger(
          `${contextLabel} expected an integer border width: ${optionValue}`,
        );
      }
      configure.borderWidth = parsedBorderWidth;
      return null;
    }
    case '-command':
      configure.command = optionValue.length === 0 ? null : optionValue;
      return null;
    case '-cursor':
      configure.cursor = optionValue.length === 0 ? null : optionValue;
      return null;
    case '-font':
      configure.font = optionValue;
      return null;
    case '-foreground':
      configure.foreground = optionValue;
      return null;
    case '-from': {
      const parsedFromValue = parseTclInt32(optionValue);
      if (parsedFromValue === null) {
        return makeInvalidInteger(`${contextLabel} expected an integer from value: ${optionValue}`);
      }
      configure.fromValue = parsedFromValue;
      return null;
    }
    case '-label':
      configure.label = optionValue.length === 0 ? null : optionValue;
      return null;
    case '-length': {
      const parsedLength = parseTclInt32(optionValue);
      if (parsedLength === null) {
        return makeInvalidInteger(`${contextLabel} expected an integer length: ${optionValue}`);
      }
      configure.length = parsedLength;
      return null;
    }
    case '-orient':
      if (optionValue !== 'vertical' && optionValue !== 'horizontal') {
        return makeScriptFailure(
          new ScriptRuntimeError(
            ScriptRuntimeErrorCode.Internal,
            `${contextLabel} bad orientation "${optionValue}": must be vertical or horizontal`,
          ),
        );
      }
      configure.orient = optionValue;
      return null;
    case '-relief':
      configure.relief = optionValue;
      return null;
    case '-showvalue': {
      const parsedShowValue = parseTclInt32(optionValue);
      if (parsedShowValue === null) {
        return makeInvalidInteger(`${contextLabel} expected an integer showvalue: ${optionValue}`);
      }
      configure.showValue = parsedShowValue;
      return null;
    }
    case '-sliderforeground':
      configure.sliderForeground = optionValue;
      return null;
    case '-min': {
      const parsedMinValue = parseTclInt32(optionValue);
      if (parsedMinValue === null) {
        return makeInvalidInteger(`${contextLabel} expected an integer min value: ${optionValue}`);
      }
      configure.minValue = parsedMinValue;
      return null;
    }
    case '-max': {
      const parsedMaxValue = parseTclInt32(optionValue);
      if (parsedMaxValue === null) {
        return makeInvalidInteger(`${contextLabel} expected an integer max value: ${optionValue}`);
      }
      configure.maxValue = parsedMaxValue;
      return null;
    }
    case '-state':
      if (optionValue !== 'normal' && optionValue !== 'disabled') {
        configure.state = 'normal';
        return makeScriptFailure(
          new ScriptRuntimeError(
            ScriptRuntimeErrorCode.Internal,
            `${contextLabel} bad state value "${optionValue}":  must be normal or disabled`,
          ),
        );
      }
      configure.state = optionValue;
      return null;
    case '-tickinterval': {
      const parsedTickInterval = parseTclInt32(optionValue);
      if (parsedTickInterval === null) {
        return makeInvalidInteger(
          `${contextLabel} expected an integer tick interval: ${optionValue}`,
        );
      }
      configure.tickInterval = parsedTickInterval;
      return null;
    }
    case '-to': {
      const parsedToValue = parseTclInt32(optionValue);
      if (parsedToValue === null) {
        return makeInvalidInteger(`${contextLabel} expected an integer to value: ${optionValue}`);
      }
      configure.toValue = parsedToValue;
      return null;
    }
    case '-width': {
      const parsedWidth = parseTclInt32(optionValue);
      if (parsedWidth === null) {
        return makeInvalidInteger(`${contextLabel} expected an integer width: ${optionValue}`);
      }
      configure.width = parsedWidth;
      return null;
    }
  }
}

/**
 * Applies `configure` option/value pairs for interval creation and writes.
 * Mirrors `ConfigureInterval(interp, intervalPtr, ..., TK_CONFIG_ARGV_ONLY)`
 * in `IntervalWidgetCmd` (`ref/micropolis/src/sim/w_inter.c`).
 */
function applyIntervalConfigureOptionPairs(
  intervalState: IntervalState,
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

    const optionName = toIntervalConfigureOptionName(rawOptionName);
    if (optionName === null) {
      return makeScriptFailure(
        new ScriptRuntimeError(
          ScriptRuntimeErrorCode.Internal,
          `${contextLabel} configure unknown option: ${rawOptionName}`,
        ),
      );
    }

    const writeResult = writeIntervalConfigureOption(
      intervalState,
      optionName,
      optionValue,
      `${contextLabel} configure`,
    );
    if (writeResult !== null) {
      return writeResult;
    }
  }

  normalizeIntervalAfterConfigure(intervalState);
  return null;
}

/**
 * Implements the `configure` interval subcommand.
 * Mirrors the `configure` branch in `IntervalWidgetCmd`
 * (`ref/micropolis/src/sim/w_inter.c`).
 */
function handleIntervalConfigureSubcommand(
  intervalState: IntervalState,
  argv: readonly string[],
): ScriptRuntimeResult {
  if (argv.length === 2) {
    return makeScriptSuccess(serializeIntervalConfigureOptions(intervalState));
  }

  if (argv.length === 3) {
    const rawOptionName = argv[2];
    if (rawOptionName === undefined) {
      return makeInvalidArgCount(
        `${intervalState.commandName} configure missing option name at argv[2]`,
      );
    }

    const optionName = toIntervalConfigureOptionName(rawOptionName);
    if (optionName === null) {
      return makeScriptFailure(
        new ScriptRuntimeError(
          ScriptRuntimeErrorCode.Internal,
          `${intervalState.commandName} configure unknown option: ${rawOptionName}`,
        ),
      );
    }

    return makeScriptSuccess(readIntervalConfigureOption(intervalState, optionName));
  }

  const writeResult = applyIntervalConfigureOptionPairs(
    intervalState,
    argv.slice(2),
    intervalState.commandName,
  );
  if (writeResult !== null) {
    return writeResult;
  }

  return makeScriptSuccess('');
}

/**
 * Implements the `get` interval subcommand.
 * Mirrors `sprintf("%d %d", minValue, maxValue)` behavior in
 * `IntervalWidgetCmd` (`ref/micropolis/src/sim/w_inter.c`).
 */
function handleIntervalGetSubcommand(
  intervalState: IntervalState,
  argv: readonly string[],
): ScriptRuntimeResult {
  if (argv.length !== 2) {
    return makeInvalidArgCount(
      `${intervalState.commandName} get expects argc 2, got ${argv.length}`,
    );
  }

  return makeScriptSuccess(
    `${intervalState.configure.minValue} ${intervalState.configure.maxValue}`,
  );
}

/**
 * Implements the `set` interval subcommand.
 * Mirrors `IntervalWidgetCmd` set branch in `ref/micropolis/src/sim/w_inter.c`:
 * swap `min/max`, clamp to `from/to`, and no-op while disabled.
 */
function handleIntervalSetSubcommand(
  intervalState: IntervalState,
  argv: readonly string[],
): ScriptRuntimeResult {
  if (argv.length !== 4) {
    return makeInvalidArgCount(
      `${intervalState.commandName} set expects argc 4, got ${argv.length}`,
    );
  }

  const rawMinValue = argv[2];
  const rawMaxValue = argv[3];
  if (rawMinValue === undefined || rawMaxValue === undefined) {
    return makeInvalidArgCount(`${intervalState.commandName} set missing min/max arguments`);
  }

  let parsedMinValue = parseTclInt32(rawMinValue);
  if (parsedMinValue === null) {
    return makeInvalidInteger(
      `${intervalState.commandName} set expected an integer min: ${rawMinValue}`,
    );
  }

  let parsedMaxValue = parseTclInt32(rawMaxValue);
  if (parsedMaxValue === null) {
    return makeInvalidInteger(
      `${intervalState.commandName} set expected an integer max: ${rawMaxValue}`,
    );
  }

  if (parsedMinValue > parsedMaxValue) {
    const temp = parsedMinValue;
    parsedMinValue = parsedMaxValue;
    parsedMaxValue = temp;
  }

  if (intervalState.configure.state === 'normal') {
    parsedMinValue = clampIntervalValueToBounds(
      parsedMinValue,
      intervalState.configure.fromValue,
      intervalState.configure.toValue,
    );
    parsedMaxValue = clampIntervalValueToBounds(
      parsedMaxValue,
      intervalState.configure.fromValue,
      intervalState.configure.toValue,
    );
    setIntervalRange(intervalState, parsedMinValue, parsedMaxValue);
  }

  return makeScriptSuccess('');
}

/**
 * Implements the `reset` interval subcommand.
 * Mirrors `SetInterval(intervalPtr, fromValue, toValue, 0)` in
 * `IntervalWidgetCmd` (`ref/micropolis/src/sim/w_inter.c`).
 */
function handleIntervalResetSubcommand(
  intervalState: IntervalState,
  argv: readonly string[],
): ScriptRuntimeResult {
  if (argv.length !== 2) {
    return makeInvalidArgCount(
      `${intervalState.commandName} reset expects argc 2, got ${argv.length}`,
    );
  }

  setIntervalRange(
    intervalState,
    intervalState.configure.fromValue,
    intervalState.configure.toValue,
  );
  return makeScriptSuccess('');
}

/**
 * Creates mutable state backing one `interval` widget command.
 * Mirrors `Tk_IntervalCmd` defaults plus `ConfigureInterval` normalization in
 * `ref/micropolis/src/sim/w_inter.c`.
 * Difference from C: state is explicit and does not include Tk window handles.
 */
export function createIntervalState(
  commandName: string,
  options: CreateIntervalStateOptions = {},
): IntervalState {
  const intervalState: IntervalState = {
    commandName,
    configure: {
      activeForeground: options.configure?.activeForeground ?? DEFAULT_INTERVAL_ACTIVE_FOREGROUND,
      background: options.configure?.background ?? DEFAULT_INTERVAL_BACKGROUND,
      borderWidth: options.configure?.borderWidth ?? DEFAULT_INTERVAL_BORDER_WIDTH,
      command: options.configure?.command ?? DEFAULT_INTERVAL_COMMAND,
      cursor: options.configure?.cursor ?? DEFAULT_INTERVAL_CURSOR,
      font: options.configure?.font ?? DEFAULT_INTERVAL_FONT,
      foreground: options.configure?.foreground ?? DEFAULT_INTERVAL_FOREGROUND,
      fromValue: options.configure?.fromValue ?? DEFAULT_INTERVAL_FROM,
      label: options.configure?.label ?? DEFAULT_INTERVAL_LABEL,
      length: options.configure?.length ?? DEFAULT_INTERVAL_LENGTH,
      orient: options.configure?.orient ?? DEFAULT_INTERVAL_ORIENT,
      relief: options.configure?.relief ?? DEFAULT_INTERVAL_RELIEF,
      showValue: options.configure?.showValue ?? DEFAULT_INTERVAL_SHOW_VALUE,
      sliderForeground: options.configure?.sliderForeground ?? DEFAULT_INTERVAL_SLIDER_FOREGROUND,
      minValue: options.configure?.minValue ?? DEFAULT_INTERVAL_MIN,
      maxValue: options.configure?.maxValue ?? DEFAULT_INTERVAL_MAX,
      state: options.configure?.state ?? DEFAULT_INTERVAL_STATE,
      tickInterval: options.configure?.tickInterval ?? DEFAULT_INTERVAL_TICK_INTERVAL,
      toValue: options.configure?.toValue ?? DEFAULT_INTERVAL_TO,
      width: options.configure?.width ?? DEFAULT_INTERVAL_WIDTH,
    },
  };

  normalizeIntervalAfterConfigure(intervalState);
  return intervalState;
}

/**
 * Builds `interval` subcommand entries.
 * Mirrors `IntervalWidgetCmd` subcommand branches in
 * `ref/micropolis/src/sim/w_inter.c`.
 */
export function createIntervalSubcommandEntries(): readonly IntervalSubcommandEntry[] {
  return [
    ['configure', handleIntervalConfigureSubcommand] as const,
    ['get', handleIntervalGetSubcommand] as const,
    ['set', handleIntervalSetSubcommand] as const,
    ['reset', handleIntervalResetSubcommand] as const,
  ];
}

/**
 * Builds a case-sensitive interval subcommand lookup table.
 * Mirrors per-widget command lookup semantics in Tcl.
 * Parity note: duplicate names use last-registration-wins map semantics.
 */
export function createIntervalSubcommandTable(
  entries: readonly IntervalSubcommandEntry[] = [],
): IntervalSubcommandTable {
  const table = new Map<string, IntervalSubcommandHandler>();

  for (const [name, handler] of entries) {
    table.set(name, handler);
  }

  return table;
}

/**
 * Default subcommand table for interval shell behavior.
 * Mirrors `IntervalWidgetCmd` subcommands in `ref/micropolis/src/sim/w_inter.c`.
 */
export const INTERVAL_SUBCOMMAND_TABLE = createIntervalSubcommandTable(
  createIntervalSubcommandEntries(),
);

/**
 * Creates the per-widget interval dispatcher bound to one interval state.
 * Mirrors `IntervalWidgetCmd` command dispatch in `ref/micropolis/src/sim/w_inter.c`.
 * Difference from C: typed runtime errors replace Tcl string error appends.
 */
export function createIntervalWidgetCommandDispatcher(
  intervalState: IntervalState,
  subcommands: IntervalSubcommandTable = INTERVAL_SUBCOMMAND_TABLE,
): ScriptCommandHandler {
  return (argv: readonly string[]): ScriptRuntimeResult => {
    const subcommandName = argv[1];
    if (subcommandName === undefined) {
      return makeInvalidArgCount(
        `${intervalState.commandName} command requires a subcommand in argv[1]`,
      );
    }

    const subcommandHandler = subcommands.get(subcommandName);
    if (subcommandHandler === undefined) {
      return makeScriptFailure(
        new ScriptRuntimeError(
          ScriptRuntimeErrorCode.UnknownSubcommand,
          `unknown interval subcommand: ${subcommandName}`,
        ),
      );
    }

    return subcommandHandler(intervalState, argv);
  };
}

/**
 * Constructor options for `createIntervalCommandDispatcher`.
 * Mirrors widget-state creation and command registration flow in `Tk_IntervalCmd`
 * (`ref/micropolis/src/sim/w_inter.c`) and top-level registration in
 * `ref/micropolis/src/sim/w_tk.c`.
 */
export interface CreateIntervalCommandDispatcherOptions {
  runtime: ScriptRuntime;
  widgets?: WidgetRegistry<IntervalState>;
  createIntervalState?: (commandName: string) => IntervalState;
  subcommands?: IntervalSubcommandTable;
}

/**
 * Creates the top-level `interval` factory command dispatcher.
 * Mirrors `Tk_IntervalCmd` creation flow for `interval pathName ?options?`
 * in `ref/micropolis/src/sim/w_inter.c`.
 * Parity note: this preserves script-visible command/state behavior but omits Tk windows/events.
 */
export function createIntervalCommandDispatcher(
  options: CreateIntervalCommandDispatcherOptions,
): ScriptCommandHandler {
  const widgets = options.widgets ?? new WidgetRegistry<IntervalState>();
  const createIntervalStateFactory =
    options.createIntervalState ?? ((commandName: string) => createIntervalState(commandName));
  const subcommands = options.subcommands ?? INTERVAL_SUBCOMMAND_TABLE;

  return (argv: readonly string[]): ScriptRuntimeResult => {
    const commandName = argv[1];
    if (commandName === undefined || commandName.length === 0) {
      return makeInvalidArgCount('interval command requires a pathName in argv[1]');
    }

    if (widgets.get(commandName) !== undefined) {
      return makeScriptFailure(
        new ScriptRuntimeError(
          ScriptRuntimeErrorCode.Internal,
          `interval command already exists: ${commandName}`,
        ),
      );
    }

    const intervalState = createIntervalStateFactory(commandName);
    const configureResult = applyIntervalConfigureOptionPairs(
      intervalState,
      argv.slice(2),
      `interval ${commandName}`,
    );
    if (configureResult !== null) {
      return configureResult;
    }

    widgets.add(commandName, intervalState);
    options.runtime.registerCommand(
      commandName,
      createIntervalWidgetCommandDispatcher(intervalState, subcommands),
    );
    return makeScriptSuccess(commandName);
  };
}

/**
 * Registers the top-level `interval` command in a runtime.
 * Mirrors `Tcl_CreateCommand(..., "interval", Tk_IntervalCmd, ...)`
 * in `ref/micropolis/src/sim/w_tk.c`.
 */
export function registerIntervalCommand(
  runtime: ScriptRuntime,
  options: Omit<CreateIntervalCommandDispatcherOptions, 'runtime'> = {},
): void {
  runtime.registerCommand(
    'interval',
    createIntervalCommandDispatcher({
      runtime,
      ...options,
    }),
  );
}
