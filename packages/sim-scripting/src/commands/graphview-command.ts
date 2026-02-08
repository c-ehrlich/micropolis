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
const DEFAULT_GRAPH_VIEW_FONT = '-Adobe-Helvetica-Bold-R-Normal-*-140-*';
const DEFAULT_GRAPH_VIEW_BACKGROUND = '#b0b0b0';
const DEFAULT_GRAPH_VIEW_BORDER_WIDTH = 0;
const DEFAULT_GRAPH_VIEW_RELIEF = 'flat';
const DEFAULT_GRAPH_VIEW_VISIBLE = 0;
const DEFAULT_GRAPH_VIEW_RANGE = 10;
const DEFAULT_GRAPH_VIEW_MASK = 63;
const DEFAULT_GRAPH_VIEW_WINDOW_SIZE = 16;

/**
 * Mutable `graphview` configure fields.
 * Mirrors `GraphConfigSpecs` (`-font`, `-background`, `-borderwidth`, `-relief`)
 * in `ref/micropolis/src/sim/w_graph.c`.
 * Difference from C: this stores explicit values instead of Tk-managed widget config slots.
 */
export interface GraphViewConfigureState {
  font: string;
  background: string;
  borderWidth: number;
  relief: string;
}

/**
 * Mutable state for one created graph view command.
 * Mirrors `SimGraph` fields used by `GraphCmdposition`, `GraphCmdsize`,
 * `GraphCmdVisible`, `GraphCmdRange`, and `GraphCmdMask`
 * in `ref/micropolis/src/sim/w_graph.c`.
 * Difference from C: Tk/X11 resources (window, pixmap, border handles) are omitted.
 */
export interface GraphViewState {
  commandName: string;
  visible: number;
  wX: number;
  wY: number;
  wWidth: number;
  wHeight: number;
  range: number;
  mask: number;
  configure: GraphViewConfigureState;
}

/**
 * Constructor overrides for `createGraphViewState`.
 * Mirrors defaults initialized in `InitNewGraph` and `DoResizeGraph(16, 16)`
 * in `ref/micropolis/src/sim/w_graph.c`.
 */
export interface CreateGraphViewStateOptions {
  visible?: number;
  wX?: number;
  wY?: number;
  wWidth?: number;
  wHeight?: number;
  range?: number;
  mask?: number;
  configure?: Partial<GraphViewConfigureState>;
}

/**
 * Shared graph redraw marker state.
 * Mirrors the global `NewGraph` flag in `ref/micropolis/src/sim/w_graph.c`,
 * which is set by `GraphCmdRange` and `GraphCmdMask`.
 */
export interface GraphViewRedrawState {
  newGraph: boolean;
}

/**
 * Hook callbacks used by graph-view subcommands.
 * Mirrors side effects adjacent to `GraphCmdRange`/`GraphCmdMask` in
 * `ref/micropolis/src/sim/w_graph.c`.
 * Difference from C: side effects are exposed via injectable callbacks.
 */
export interface GraphViewSubcommandHooks {
  onMarkNewGraph?: (viewState: GraphViewState, source: 'Range' | 'Mask') => void;
}

/**
 * Constructor options for `createGraphViewSubcommandEntries`.
 * Mirrors `graph_command_init` wiring and global-flag mutation paths in
 * `ref/micropolis/src/sim/w_graph.c`.
 */
export interface CreateGraphViewSubcommandEntriesOptions {
  redrawState?: GraphViewRedrawState;
  hooks?: GraphViewSubcommandHooks;
}

/**
 * Subcommand names registered for `graphview`.
 * Mirrors `GRAPH_CMD(configure|position|size|Visible|Range|Mask)` in
 * `graph_command_init` (`ref/micropolis/src/sim/w_graph.c`).
 */
export const GRAPH_VIEW_SUBCOMMAND_NAMES = [
  'configure',
  'position',
  'size',
  'Visible',
  'Range',
  'Mask',
] as const;

/**
 * Union of supported graph-view subcommand names.
 */
export type GraphViewSubcommandName = (typeof GRAPH_VIEW_SUBCOMMAND_NAMES)[number];

/**
 * Handler signature for `<graphViewPath> <Subcommand> ...`.
 * Mirrors `GraphCmd*` function pointers looked up through `GraphCmds`
 * by `DoGraphCmd` in `ref/micropolis/src/sim/w_graph.c`.
 */
export type GraphViewSubcommandHandler = (
  viewState: GraphViewState,
  argv: readonly string[],
) => ScriptRuntimeResult;

/**
 * Case-sensitive `graphview` subcommand table.
 * Mirrors `Tcl_HashTable GraphCmds` lookup behavior in `DoGraphCmd`
 * (`ref/micropolis/src/sim/w_graph.c`).
 */
export type GraphViewSubcommandTable = ReadonlyMap<string, GraphViewSubcommandHandler>;

/**
 * One `graphview` subcommand registration tuple.
 * Mirrors one `GRAPH_CMD(name)` hash-table insertion in
 * `graph_command_init` (`ref/micropolis/src/sim/w_graph.c`).
 */
export type GraphViewSubcommandEntry = readonly [name: string, handler: GraphViewSubcommandHandler];

const GRAPH_VIEW_CONFIGURE_OPTION_NAMES = [
  '-font',
  '-background',
  '-borderwidth',
  '-relief',
] as const;
type GraphViewConfigureOptionName = (typeof GRAPH_VIEW_CONFIGURE_OPTION_NAMES)[number];

/**
 * Creates mutable redraw marker state for graph commands.
 * Mirrors boot-time `NewGraph = 0` setup and later command writes in
 * `ref/micropolis/src/sim/w_graph.c`.
 * Parity note: default redraw flag state is a 1:1 port.
 */
export function createGraphViewRedrawState(initialNewGraph = false): GraphViewRedrawState {
  return {
    newGraph: initialNewGraph,
  };
}

/**
 * Marks graph data as dirty for redraw processing.
 * Mirrors `NewGraph = 1` in `GraphCmdRange` and `GraphCmdMask`
 * from `ref/micropolis/src/sim/w_graph.c`.
 * Parity note: dirty-flag mutation and callback timing are 1:1 with C behavior.
 */
export function markGraphViewNeedsRedraw(
  viewState: GraphViewState,
  source: 'Range' | 'Mask',
  redrawState: GraphViewRedrawState,
  hooks: GraphViewSubcommandHooks = {},
): void {
  redrawState.newGraph = true;
  hooks.onMarkNewGraph?.(viewState, source);
}

/**
 * Parses a Tcl-style integer and enforces 32-bit C `int` range.
 * Mirrors `Tcl_GetInt` usage in `GraphCmdposition`, `GraphCmdsize`,
 * `GraphCmdVisible`, `GraphCmdRange`, and `GraphCmdMask`
 * (`ref/micropolis/src/sim/w_graph.c`).
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
 * Mirrors `TCL_ERROR` branches for wrong argc in `GraphCmd*`
 * (`ref/micropolis/src/sim/w_graph.c`).
 */
function makeInvalidArgCount(message: string): ScriptRuntimeResult {
  return makeScriptFailure(new ScriptRuntimeError(ScriptRuntimeErrorCode.InvalidArgCount, message));
}

/**
 * Creates a typed invalid-integer runtime result.
 * Mirrors `Tcl_GetInt(...) != TCL_OK` failure branches in `GraphCmd*`
 * (`ref/micropolis/src/sim/w_graph.c`).
 */
function makeInvalidInteger(message: string): ScriptRuntimeResult {
  return makeScriptFailure(new ScriptRuntimeError(ScriptRuntimeErrorCode.InvalidInteger, message));
}

/**
 * Converts raw configure option names into the typed graph configure union.
 * Mirrors `Tk_ConfigureInfo`/`ConfigureSimGraph` option-name matching in
 * `GraphCmdconfigure` (`ref/micropolis/src/sim/w_graph.c`).
 */
function toGraphViewConfigureOptionName(raw: string): GraphViewConfigureOptionName | null {
  switch (raw) {
    case '-font':
    case '-background':
    case '-borderwidth':
    case '-relief':
      return raw;
    default:
      return null;
  }
}

/**
 * Reads one graph configure option from state.
 * Mirrors single-option `Tk_ConfigureInfo(..., argv[2], ...)` in
 * `GraphCmdconfigure` (`ref/micropolis/src/sim/w_graph.c`).
 */
function readGraphViewConfigureOption(
  viewState: GraphViewState,
  optionName: GraphViewConfigureOptionName,
): string {
  switch (optionName) {
    case '-font':
      return viewState.configure.font;
    case '-background':
      return viewState.configure.background;
    case '-borderwidth':
      return String(viewState.configure.borderWidth);
    case '-relief':
      return viewState.configure.relief;
  }
}

/**
 * Serializes all graph configure options into a Tcl-like `name value` list.
 * Mirrors no-arg `Tk_ConfigureInfo(..., NULL, ...)` behavior in
 * `GraphCmdconfigure` (`ref/micropolis/src/sim/w_graph.c`).
 * Difference from C: this returns a simplified flat list instead of Tk's full option tuples.
 */
function serializeGraphViewConfigureOptions(viewState: GraphViewState): string {
  return GRAPH_VIEW_CONFIGURE_OPTION_NAMES.map((optionName) => {
    return `${optionName} ${readGraphViewConfigureOption(viewState, optionName)}`;
  }).join(' ');
}

/**
 * Applies one graph configure option write to state.
 * Mirrors `ConfigureSimGraph` updates through `GraphConfigSpecs` in
 * `ref/micropolis/src/sim/w_graph.c`.
 */
function writeGraphViewConfigureOption(
  viewState: GraphViewState,
  optionName: GraphViewConfigureOptionName,
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
    case '-relief':
      viewState.configure.relief = optionValue;
      return null;
  }
}

/**
 * Applies `configure` option/value pairs for graph-view creation and writes.
 * Mirrors `ConfigureSimGraph(..., argc-2, argv+2, TK_CONFIG_ARGV_ONLY)` call
 * in `GraphCmdconfigure` (`ref/micropolis/src/sim/w_graph.c`).
 */
function applyGraphViewConfigureOptionPairs(
  viewState: GraphViewState,
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

    const optionName = toGraphViewConfigureOptionName(rawOptionName);
    if (optionName === null) {
      return makeScriptFailure(
        new ScriptRuntimeError(
          ScriptRuntimeErrorCode.Internal,
          `${contextLabel} configure unknown option: ${rawOptionName}`,
        ),
      );
    }

    const writeResult = writeGraphViewConfigureOption(
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
 * Implements the `configure` graph-view subcommand.
 * Mirrors `GraphCmdconfigure` in `ref/micropolis/src/sim/w_graph.c`.
 * Parity note: this preserves argc shape and option handling, but returns a
 * simplified option listing instead of Tk's full configure-info payload.
 */
function handleGraphViewConfigureSubcommand(
  viewState: GraphViewState,
  argv: readonly string[],
): ScriptRuntimeResult {
  if (argv.length === 2) {
    return makeScriptSuccess(serializeGraphViewConfigureOptions(viewState));
  }

  if (argv.length === 3) {
    const rawOptionName = argv[2];
    if (rawOptionName === undefined) {
      return makeInvalidArgCount(
        `${viewState.commandName} configure missing option name at argv[2]`,
      );
    }

    const optionName = toGraphViewConfigureOptionName(rawOptionName);
    if (optionName === null) {
      return makeScriptFailure(
        new ScriptRuntimeError(
          ScriptRuntimeErrorCode.Internal,
          `${viewState.commandName} configure unknown option: ${rawOptionName}`,
        ),
      );
    }

    return makeScriptSuccess(readGraphViewConfigureOption(viewState, optionName));
  }

  const writeResult = applyGraphViewConfigureOptionPairs(
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
 * Implements the `position` graph-view subcommand.
 * Mirrors `GraphCmdposition` in `ref/micropolis/src/sim/w_graph.c`:
 * accepts argc 2 or 4, parses `x y` with `Tcl_GetInt`, and returns `w_x w_y`.
 */
function handleGraphViewPositionSubcommand(
  viewState: GraphViewState,
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
 * Implements the `size` graph-view subcommand.
 * Mirrors `GraphCmdsize` in `ref/micropolis/src/sim/w_graph.c`:
 * accepts argc 2 or 4, parses `w h` with `Tcl_GetInt`, and returns `w_width w_height`.
 */
function handleGraphViewSizeSubcommand(
  viewState: GraphViewState,
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
 * Implements the `Visible` graph-view subcommand.
 * Mirrors `GraphCmdVisible` in `ref/micropolis/src/sim/w_graph.c`.
 */
function handleGraphViewVisibleSubcommand(
  viewState: GraphViewState,
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
 * Builds the `Range` graph-view subcommand handler.
 * Mirrors `GraphCmdRange` in `ref/micropolis/src/sim/w_graph.c`:
 * allowed values are only `10` or `120`, and writes set `NewGraph = 1`.
 */
function createGraphViewRangeSubcommandHandler(
  redrawState: GraphViewRedrawState,
  hooks: GraphViewSubcommandHooks,
): GraphViewSubcommandHandler {
  return (viewState: GraphViewState, argv: readonly string[]): ScriptRuntimeResult => {
    if (argv.length !== 2 && argv.length !== 3) {
      return makeInvalidArgCount(
        `${viewState.commandName} Range expects argc 2 or 3, got ${argv.length}`,
      );
    }

    if (argv.length === 3) {
      const rawRange = argv[2];
      if (rawRange === undefined) {
        return makeInvalidArgCount(`${viewState.commandName} Range missing range argument`);
      }

      const parsedRange = parseTclInt32(rawRange);
      if (parsedRange === null || (parsedRange !== 10 && parsedRange !== 120)) {
        return makeInvalidInteger(
          `${viewState.commandName} Range expected an integer range of 10 or 120: ${rawRange}`,
        );
      }

      viewState.range = parsedRange;
      markGraphViewNeedsRedraw(viewState, 'Range', redrawState, hooks);
    }

    return makeScriptSuccess(String(viewState.range));
  };
}

/**
 * Builds the `Mask` graph-view subcommand handler.
 * Mirrors `GraphCmdMask` in `ref/micropolis/src/sim/w_graph.c`:
 * allowed values are `0..63`, and writes set `NewGraph = 1`.
 */
function createGraphViewMaskSubcommandHandler(
  redrawState: GraphViewRedrawState,
  hooks: GraphViewSubcommandHooks,
): GraphViewSubcommandHandler {
  return (viewState: GraphViewState, argv: readonly string[]): ScriptRuntimeResult => {
    if (argv.length !== 2 && argv.length !== 3) {
      return makeInvalidArgCount(
        `${viewState.commandName} Mask expects argc 2 or 3, got ${argv.length}`,
      );
    }

    if (argv.length === 3) {
      const rawMask = argv[2];
      if (rawMask === undefined) {
        return makeInvalidArgCount(`${viewState.commandName} Mask missing mask argument`);
      }

      const parsedMask = parseTclInt32(rawMask);
      if (parsedMask === null || parsedMask < 0 || parsedMask > 63) {
        return makeInvalidInteger(
          `${viewState.commandName} Mask expected an integer mask in range 0..63: ${rawMask}`,
        );
      }

      viewState.mask = parsedMask;
      markGraphViewNeedsRedraw(viewState, 'Mask', redrawState, hooks);
    }

    return makeScriptSuccess(String(viewState.mask));
  };
}

/**
 * Creates mutable state backing one `graphview` widget command.
 * Mirrors `InitNewGraph` + `DoResizeGraph(16, 16)` defaults in
 * `ref/micropolis/src/sim/w_graph.c`.
 * Parity note: defaults include `range=10`, `mask=ALL_HISTORIES (63)`, and `visible=0`.
 * Difference from C: this is plain TypeScript data without Tk/X11 allocations.
 */
export function createGraphViewState(
  commandName: string,
  options: CreateGraphViewStateOptions = {},
): GraphViewState {
  return {
    commandName,
    visible: options.visible ?? DEFAULT_GRAPH_VIEW_VISIBLE,
    wX: options.wX ?? 0,
    wY: options.wY ?? 0,
    wWidth: options.wWidth ?? DEFAULT_GRAPH_VIEW_WINDOW_SIZE,
    wHeight: options.wHeight ?? DEFAULT_GRAPH_VIEW_WINDOW_SIZE,
    range: options.range ?? DEFAULT_GRAPH_VIEW_RANGE,
    mask: options.mask ?? DEFAULT_GRAPH_VIEW_MASK,
    configure: {
      font: options.configure?.font ?? DEFAULT_GRAPH_VIEW_FONT,
      background: options.configure?.background ?? DEFAULT_GRAPH_VIEW_BACKGROUND,
      borderWidth: options.configure?.borderWidth ?? DEFAULT_GRAPH_VIEW_BORDER_WIDTH,
      relief: options.configure?.relief ?? DEFAULT_GRAPH_VIEW_RELIEF,
    },
  };
}

/**
 * Builds `graphview` subcommand entries for the P3.1 command set.
 * Mirrors `GRAPH_CMD(...)` registration in `graph_command_init`
 * (`ref/micropolis/src/sim/w_graph.c`).
 * Parity note: subcommand coverage is a 1:1 port.
 */
export function createGraphViewSubcommandEntries(
  options: CreateGraphViewSubcommandEntriesOptions = {},
): readonly GraphViewSubcommandEntry[] {
  const redrawState = options.redrawState ?? createGraphViewRedrawState();
  const hooks = options.hooks ?? {};

  return [
    ['configure', handleGraphViewConfigureSubcommand] as const,
    ['position', handleGraphViewPositionSubcommand] as const,
    ['size', handleGraphViewSizeSubcommand] as const,
    ['Visible', handleGraphViewVisibleSubcommand] as const,
    ['Range', createGraphViewRangeSubcommandHandler(redrawState, hooks)] as const,
    ['Mask', createGraphViewMaskSubcommandHandler(redrawState, hooks)] as const,
  ];
}

/**
 * Builds a case-sensitive graph-view subcommand lookup table.
 * Mirrors `Tcl_HashTable GraphCmds` registration behavior in
 * `graph_command_init`/`DoGraphCmd` (`ref/micropolis/src/sim/w_graph.c`).
 * Parity note: duplicate names use last-registration-wins map semantics.
 */
export function createGraphViewSubcommandTable(
  entries: readonly GraphViewSubcommandEntry[] = [],
): GraphViewSubcommandTable {
  const table = new Map<string, GraphViewSubcommandHandler>();

  for (const [name, handler] of entries) {
    table.set(name, handler);
  }

  return table;
}

/**
 * Default subcommand table for graph-view shell behavior.
 * Mirrors `graph_command_init` registrations in `ref/micropolis/src/sim/w_graph.c`.
 */
export const GRAPH_VIEW_SUBCOMMAND_TABLE = createGraphViewSubcommandTable(
  createGraphViewSubcommandEntries(),
);

/**
 * Creates the per-widget graph-view dispatcher bound to one view state.
 * Mirrors `DoGraphCmd` subcommand lookup flow in `ref/micropolis/src/sim/w_graph.c`.
 * Difference from C: this returns typed runtime errors instead of Tcl string appends.
 */
export function createGraphViewWidgetCommandDispatcher(
  viewState: GraphViewState,
  subcommands: GraphViewSubcommandTable = GRAPH_VIEW_SUBCOMMAND_TABLE,
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
          `unknown graphview subcommand: ${subcommandName}`,
        ),
      );
    }

    return subcommandHandler(viewState, argv);
  };
}

/**
 * Constructor options for `createGraphViewCommandDispatcher`.
 * Mirrors state and command wiring around `GraphViewCmd` + `DoGraphCmd`
 * in `ref/micropolis/src/sim/w_graph.c`.
 */
export interface CreateGraphViewCommandDispatcherOptions {
  runtime: ScriptRuntime;
  views?: ViewRegistry<GraphViewState>;
  createViewState?: (commandName: string) => GraphViewState;
  subcommands?: GraphViewSubcommandTable;
}

/**
 * Creates the top-level `graphview` factory command dispatcher.
 * Mirrors `GraphViewCmd` creation flow for `graphview pathName ?options?`
 * in `ref/micropolis/src/sim/w_graph.c`: create graph state, register widget command, return pathName.
 * Parity note: Tk window lifecycle and rendering setup are intentionally omitted.
 */
export function createGraphViewCommandDispatcher(
  options: CreateGraphViewCommandDispatcherOptions,
): ScriptCommandHandler {
  const views = options.views ?? new ViewRegistry<GraphViewState>();
  const createViewState =
    options.createViewState ?? ((commandName: string) => createGraphViewState(commandName));
  const subcommands = options.subcommands ?? GRAPH_VIEW_SUBCOMMAND_TABLE;

  return (argv: readonly string[]): ScriptRuntimeResult => {
    const commandName = argv[1];
    if (commandName === undefined || commandName.length === 0) {
      return makeInvalidArgCount('graphview command requires a pathName in argv[1]');
    }

    if (views.get(commandName) !== undefined) {
      return makeScriptFailure(
        new ScriptRuntimeError(
          ScriptRuntimeErrorCode.Internal,
          `graphview command already exists: ${commandName}`,
        ),
      );
    }

    const viewState = createViewState(commandName);
    const configureResult = applyGraphViewConfigureOptionPairs(
      viewState,
      argv.slice(2),
      `graphview ${commandName}`,
    );
    if (configureResult !== null) {
      return configureResult;
    }

    views.add(commandName, viewState);
    options.runtime.registerCommand(
      commandName,
      createGraphViewWidgetCommandDispatcher(viewState, subcommands),
    );
    return makeScriptSuccess(commandName);
  };
}

/**
 * Registers the top-level `graphview` command in a runtime.
 * Mirrors `Tcl_CreateCommand(..., "graphview", GraphViewCmd, ...)`
 * in `graph_command_init` (`ref/micropolis/src/sim/w_graph.c`).
 * Parity note: command registration name and factory binding are 1:1 with C.
 */
export function registerGraphViewCommand(
  runtime: ScriptRuntime,
  options: Omit<CreateGraphViewCommandDispatcherOptions, 'runtime'> = {},
): void {
  runtime.registerCommand(
    'graphview',
    createGraphViewCommandDispatcher({
      runtime,
      ...options,
    }),
  );
}
