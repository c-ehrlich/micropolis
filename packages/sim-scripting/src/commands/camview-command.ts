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
const DEFAULT_CAM_VIEW_WINDOW_SIZE = 512;
const DEFAULT_CAM_VIEW_VISIBLE = 0;
const DEFAULT_CAM_VIEW_IS_MAPPED = 1;

/**
 * Mutable `camview` configure fields.
 * Mirrors `SimCamConfigSpecs` (`-width`, `-height`) in
 * `ref/micropolis/src/sim/w_cam.c`.
 * Difference from C: this stores explicit fields instead of Tk-managed option slots.
 */
export interface CamViewConfigureState {
  width: number;
  height: number;
}

/**
 * Mutable state for one named camera managed by a `camview` command.
 * Mirrors `Cam` fields configured by `CamCmdNewCam`/`CamCmdConfigCam` and
 * `CamConfigSpecs` in `ref/micropolis/src/sim/w_cam.c` plus defaults from
 * `new_cam` in `ref/micropolis/src/sim/g_cam.c`.
 * Difference from C: image buffers/function pointers are not modeled.
 */
export interface CamViewCameraState {
  name: string;
  ruleName: string | null;
  ruleNumber: number;
  x: number;
  y: number;
  width: number;
  height: number;
  idealWidth: number;
  idealHeight: number;
  wrap: number;
  steps: number;
  frob: number;
  dx: number;
  dy: number;
  gx: number;
  gy: number;
  dragging: number;
  setX: number;
  setY: number;
  setWidth: number;
  setHeight: number;
  setX0: number;
  setY0: number;
  setX1: number;
  setY1: number;
  randomizeCount: number;
}

/**
 * Stored color payload for `StoreColor` calls.
 * Mirrors `XColor` fields (`pixel/red/green/blue`) written by
 * `CamCmdStoreColor` in `ref/micropolis/src/sim/w_cam.c`.
 */
export interface CamViewStoredColor {
  index: number;
  r: number;
  g: number;
  b: number;
}

/**
 * Mutable state for one created cam view command.
 * Mirrors scripting-visible `SimCam` fields used by `CamCmdconfigure`,
 * `CamCmdposition`, `CamCmdsize`, `CamCmdVisible`, and camera list commands
 * in `ref/micropolis/src/sim/w_cam.c`.
 * Difference from C: Tk/X11 pointers and shared-memory image buffers are omitted.
 */
export interface CamViewState {
  commandName: string;
  wX: number;
  wY: number;
  visible: number;
  isMapped: number;
  invalid: number;
  skips: number;
  skip: number;
  configure: CamViewConfigureState;
  camCount: number;
  cams: CamViewCameraState[];
  storedColors: Map<number, CamViewStoredColor>;
}

/**
 * Constructor overrides for `createCamViewState`.
 * Mirrors `CamCmd` + `InitNewCam` defaults in `ref/micropolis/src/sim/w_cam.c`:
 * `w_x/w_y=0`, `visible=0`, `invalid=1`, zeroed skip state, and
 * `DoResizeCam(..., 512, 512)` initial dimensions.
 */
export interface CreateCamViewStateOptions {
  wX?: number;
  wY?: number;
  visible?: number;
  isMapped?: number;
  invalid?: number;
  skips?: number;
  skip?: number;
  configure?: Partial<CamViewConfigureState>;
  cams?: readonly CamViewCameraState[];
  storedColors?: Iterable<readonly [number, CamViewStoredColor]>;
}

/**
 * Side-effect hooks for cam-view subcommands.
 * Mirrors C-side effects in `w_cam.c` and `g_cam.c` (`XStoreColor`,
 * `cam_randomize`, `cam_load_rule`, `cam_set_neighborhood`).
 * Difference from C: side effects are injected callbacks.
 */
export interface CamViewSubcommandHooks {
  onStoreColor?: (viewState: CamViewState, color: CamViewStoredColor) => number;
  onRandomizeCam?: (viewState: CamViewState, cam: CamViewCameraState) => void;
  onLoadRule?: (viewState: CamViewState, cam: CamViewCameraState, ruleName: string) => void;
  onSetNeighborhood?: (
    viewState: CamViewState,
    cam: CamViewCameraState,
    neighborhood: number,
  ) => void;
}

/**
 * Constructor options for `createCamViewSubcommandEntries`.
 * Mirrors `cam_command_init` wiring for `CamCmd*` handlers in
 * `ref/micropolis/src/sim/w_cam.c`.
 */
export interface CreateCamViewSubcommandEntriesOptions {
  hooks?: CamViewSubcommandHooks;
}

/**
 * Subcommand names registered for `camview`.
 * Mirrors `CAM_CMD(...)` registrations in `cam_command_init`
 * (`ref/micropolis/src/sim/w_cam.c`).
 */
export const CAM_VIEW_SUBCOMMAND_NAMES = [
  'configure',
  'position',
  'size',
  'Visible',
  'StoreColor',
  'NewCam',
  'DeleteCam',
  'RandomizeCam',
  'ConfigCam',
  'FindCam',
  'FindSomeCam',
] as const;

/**
 * Union of supported cam-view subcommand names.
 */
export type CamViewSubcommandName = (typeof CAM_VIEW_SUBCOMMAND_NAMES)[number];

/**
 * Handler signature for `<camViewPath> <Subcommand> ...`.
 * Mirrors `CamCmd*` function pointer dispatch via `DoCamCmd`
 * in `ref/micropolis/src/sim/w_cam.c`.
 */
export type CamViewSubcommandHandler = (
  viewState: CamViewState,
  argv: readonly string[],
) => ScriptRuntimeResult;

/**
 * Case-sensitive `camview` subcommand table.
 * Mirrors `Tcl_HashTable CamCmds` lookup behavior in `DoCamCmd`
 * (`ref/micropolis/src/sim/w_cam.c`).
 */
export type CamViewSubcommandTable = ReadonlyMap<string, CamViewSubcommandHandler>;

/**
 * One `camview` subcommand registration tuple.
 * Mirrors one `CAM_CMD(name)` hash-table insertion in
 * `cam_command_init` (`ref/micropolis/src/sim/w_cam.c`).
 */
export type CamViewSubcommandEntry = readonly [name: string, handler: CamViewSubcommandHandler];

const CAM_VIEW_CONFIGURE_OPTION_NAMES = ['-width', '-height'] as const;
type CamViewConfigureOptionName = (typeof CAM_VIEW_CONFIGURE_OPTION_NAMES)[number];

const CAM_CONFIG_OPTION_NAMES = [
  '-wrap',
  '-steps',
  '-frob',
  '-x',
  '-y',
  '-width',
  '-height',
  '-dx',
  '-dy',
  '-gx',
  '-gy',
  '-dragging',
  '-setx',
  '-sety',
  '-setwidth',
  '-setheight',
  '-setx0',
  '-sety0',
  '-setx1',
  '-sety1',
] as const;
type CamConfigOptionName = (typeof CAM_CONFIG_OPTION_NAMES)[number];

/**
 * Parses a Tcl-style integer and enforces 32-bit C `int` range.
 * Mirrors `Tcl_GetInt` usage in `CamCmdposition`, `CamCmdsize`,
 * `CamCmdVisible`, `CamCmdNewCam`, `CamCmdFindCam`, and `CamCmdFindSomeCam`
 * (`ref/micropolis/src/sim/w_cam.c`).
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
 * Builds an invalid-argc runtime result.
 * Mirrors `TCL_ERROR` returns on argc mismatch in `CamCmd*`
 * (`ref/micropolis/src/sim/w_cam.c`).
 */
function makeInvalidArgCount(message: string): ScriptRuntimeResult {
  return makeScriptFailure(new ScriptRuntimeError(ScriptRuntimeErrorCode.InvalidArgCount, message));
}

/**
 * Builds an invalid-integer runtime result.
 * Mirrors `Tcl_GetInt(...) != TCL_OK` branches in `CamCmd*`
 * (`ref/micropolis/src/sim/w_cam.c`).
 */
function makeInvalidInteger(message: string): ScriptRuntimeResult {
  return makeScriptFailure(new ScriptRuntimeError(ScriptRuntimeErrorCode.InvalidInteger, message));
}

/**
 * Converts raw SimCam configure option names into the typed union.
 * Mirrors option-name matching done by Tk config APIs in `CamCmdconfigure`
 * (`ref/micropolis/src/sim/w_cam.c`).
 */
function toCamViewConfigureOptionName(raw: string): CamViewConfigureOptionName | null {
  switch (raw) {
    case '-width':
    case '-height':
      return raw;
    default:
      return null;
  }
}

/**
 * Reads one SimCam configure option from state.
 * Mirrors single-option `Tk_ConfigureInfo(..., argv[2], ...)` behavior in
 * `CamCmdconfigure` (`ref/micropolis/src/sim/w_cam.c`).
 */
function readCamViewConfigureOption(
  viewState: CamViewState,
  optionName: CamViewConfigureOptionName,
): string {
  switch (optionName) {
    case '-width':
      return String(viewState.configure.width);
    case '-height':
      return String(viewState.configure.height);
  }
}

/**
 * Serializes SimCam configure options into a Tcl-like `name value` list.
 * Mirrors no-arg `Tk_ConfigureInfo(..., NULL, ...)` in `CamCmdconfigure`
 * (`ref/micropolis/src/sim/w_cam.c`).
 * Difference from C: returns simplified flat `name value` pairs.
 */
function serializeCamViewConfigureOptions(viewState: CamViewState): string {
  return CAM_VIEW_CONFIGURE_OPTION_NAMES.map((optionName) => {
    return `${optionName} ${readCamViewConfigureOption(viewState, optionName)}`;
  }).join(' ');
}

/**
 * Applies one SimCam configure option write.
 * Mirrors `ConfigureCam` writing through `SimCamConfigSpecs`
 * in `ref/micropolis/src/sim/w_cam.c`.
 */
function writeCamViewConfigureOption(
  viewState: CamViewState,
  optionName: CamViewConfigureOptionName,
  optionValue: string,
  contextLabel: string,
): ScriptRuntimeResult | null {
  switch (optionName) {
    case '-width': {
      const parsedWidth = parseTclInt32(optionValue);
      if (parsedWidth === null) {
        return makeInvalidInteger(`${contextLabel} expected an integer width: ${optionValue}`);
      }
      viewState.configure.width = parsedWidth;
      return null;
    }
    case '-height': {
      const parsedHeight = parseTclInt32(optionValue);
      if (parsedHeight === null) {
        return makeInvalidInteger(`${contextLabel} expected an integer height: ${optionValue}`);
      }
      viewState.configure.height = parsedHeight;
      return null;
    }
  }
}

/**
 * Applies SimCam configure option/value pairs.
 * Mirrors `ConfigureCam(..., argc-2, argv+2, ...)` in `CamCmdconfigure`
 * (`ref/micropolis/src/sim/w_cam.c`).
 */
function applyCamViewConfigureOptionPairs(
  viewState: CamViewState,
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

    const optionName = toCamViewConfigureOptionName(rawOptionName);
    if (optionName === null) {
      return makeScriptFailure(
        new ScriptRuntimeError(
          ScriptRuntimeErrorCode.Internal,
          `${contextLabel} configure unknown option: ${rawOptionName}`,
        ),
      );
    }

    const writeResult = writeCamViewConfigureOption(
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
 * Converts raw per-camera configure option names into the typed union.
 * Mirrors `CamConfigSpecs` option matching in `CamCmdConfigCam` and
 * `CamCmdNewCam` (`ref/micropolis/src/sim/w_cam.c`).
 */
function toCamConfigOptionName(raw: string): CamConfigOptionName | null {
  switch (raw) {
    case '-wrap':
    case '-steps':
    case '-frob':
    case '-x':
    case '-y':
    case '-width':
    case '-height':
    case '-dx':
    case '-dy':
    case '-gx':
    case '-gy':
    case '-dragging':
    case '-setx':
    case '-sety':
    case '-setwidth':
    case '-setheight':
    case '-setx0':
    case '-sety0':
    case '-setx1':
    case '-sety1':
      return raw;
    default:
      return null;
  }
}

/**
 * Reads one per-camera configure option from state.
 * Mirrors single-option `Tk_ConfigureInfo(..., argv[3], ...)` in
 * `CamCmdConfigCam` (`ref/micropolis/src/sim/w_cam.c`).
 */
function readCamConfigOption(cam: CamViewCameraState, optionName: CamConfigOptionName): string {
  switch (optionName) {
    case '-wrap':
      return String(cam.wrap);
    case '-steps':
      return String(cam.steps);
    case '-frob':
      return String(cam.frob);
    case '-x':
      return String(cam.x);
    case '-y':
      return String(cam.y);
    case '-width':
      return String(cam.width);
    case '-height':
      return String(cam.height);
    case '-dx':
      return String(cam.dx);
    case '-dy':
      return String(cam.dy);
    case '-gx':
      return String(cam.gx);
    case '-gy':
      return String(cam.gy);
    case '-dragging':
      return String(cam.dragging);
    case '-setx':
      return String(cam.setX);
    case '-sety':
      return String(cam.setY);
    case '-setwidth':
      return String(cam.setWidth);
    case '-setheight':
      return String(cam.setHeight);
    case '-setx0':
      return String(cam.setX0);
    case '-sety0':
      return String(cam.setY0);
    case '-setx1':
      return String(cam.setX1);
    case '-sety1':
      return String(cam.setY1);
  }
}

/**
 * Serializes per-camera configure options into a Tcl-like `name value` list.
 * Mirrors no-option `Tk_ConfigureInfo(..., NULL, ...)` behavior in
 * `CamCmdConfigCam` (`ref/micropolis/src/sim/w_cam.c`).
 * Difference from C: returns simplified flat `name value` pairs.
 */
function serializeCamConfigOptions(cam: CamViewCameraState): string {
  return CAM_CONFIG_OPTION_NAMES.map((optionName) => {
    return `${optionName} ${readCamConfigOption(cam, optionName)}`;
  }).join(' ');
}

/**
 * Applies one per-camera configure option write.
 * Mirrors `Tk_ConfigureWidget(..., CamConfigSpecs, ...)` writes in
 * `CamCmdConfigCam` and `CamCmdNewCam` (`ref/micropolis/src/sim/w_cam.c`).
 */
function writeCamConfigOption(
  cam: CamViewCameraState,
  optionName: CamConfigOptionName,
  optionValue: string,
  contextLabel: string,
): ScriptRuntimeResult | null {
  const parsedValue = parseTclInt32(optionValue);
  if (parsedValue === null) {
    return makeInvalidInteger(`${contextLabel} expected an integer ${optionName}: ${optionValue}`);
  }

  switch (optionName) {
    case '-wrap':
      cam.wrap = parsedValue;
      return null;
    case '-steps':
      cam.steps = parsedValue;
      return null;
    case '-frob':
      cam.frob = parsedValue;
      return null;
    case '-x':
      cam.x = parsedValue;
      return null;
    case '-y':
      cam.y = parsedValue;
      return null;
    case '-width':
      cam.width = parsedValue;
      return null;
    case '-height':
      cam.height = parsedValue;
      return null;
    case '-dx':
      cam.dx = parsedValue;
      return null;
    case '-dy':
      cam.dy = parsedValue;
      return null;
    case '-gx':
      cam.gx = parsedValue;
      return null;
    case '-gy':
      cam.gy = parsedValue;
      return null;
    case '-dragging':
      cam.dragging = parsedValue;
      return null;
    case '-setx':
      cam.setX = parsedValue;
      return null;
    case '-sety':
      cam.setY = parsedValue;
      return null;
    case '-setwidth':
      cam.setWidth = parsedValue;
      return null;
    case '-setheight':
      cam.setHeight = parsedValue;
      return null;
    case '-setx0':
      cam.setX0 = parsedValue;
      return null;
    case '-sety0':
      cam.setY0 = parsedValue;
      return null;
    case '-setx1':
      cam.setX1 = parsedValue;
      return null;
    case '-sety1':
      cam.setY1 = parsedValue;
      return null;
  }
}

/**
 * Applies per-camera configure option/value pairs.
 * Mirrors option writes through `CamConfigSpecs` in `CamCmdConfigCam`
 * and trailing `?options?` in `CamCmdNewCam` (`ref/micropolis/src/sim/w_cam.c`).
 */
function applyCamConfigOptionPairs(
  cam: CamViewCameraState,
  optionPairs: readonly string[],
  contextLabel: string,
): ScriptRuntimeResult | null {
  if (optionPairs.length % 2 !== 0) {
    return makeInvalidArgCount(
      `${contextLabel} expects option/value pairs, got ${optionPairs.length} trailing args`,
    );
  }

  for (let index = 0; index < optionPairs.length; index += 2) {
    const rawOptionName = optionPairs[index];
    const optionValue = optionPairs[index + 1];
    if (rawOptionName === undefined || optionValue === undefined) {
      return makeInvalidArgCount(`${contextLabel} encountered missing option/value pair`);
    }

    const optionName = toCamConfigOptionName(rawOptionName);
    if (optionName === null) {
      return makeScriptFailure(
        new ScriptRuntimeError(
          ScriptRuntimeErrorCode.Internal,
          `${contextLabel} unknown option: ${rawOptionName}`,
        ),
      );
    }

    const writeResult = writeCamConfigOption(cam, optionName, optionValue, contextLabel);
    if (writeResult !== null) {
      return writeResult;
    }
  }

  return null;
}

/**
 * Finds the first camera whose bounds contain a point.
 * Mirrors `find_cam` in `ref/micropolis/src/sim/g_cam.c`.
 */
function findCamByPoint(
  cams: readonly CamViewCameraState[],
  x: number,
  y: number,
): CamViewCameraState | null {
  for (const cam of cams) {
    if (x >= cam.x && y >= cam.y && x < cam.x + cam.width && y < cam.y + cam.height) {
      return cam;
    }
  }

  return null;
}

/**
 * Finds a camera by exact name, scanning head-first list order.
 * Mirrors `find_cam_by_name` in `ref/micropolis/src/sim/g_cam.c`.
 */
function findCamByName(
  cams: readonly CamViewCameraState[],
  name: string,
): CamViewCameraState | null {
  for (const cam of cams) {
    if (cam.name === name) {
      return cam;
    }
  }

  return null;
}

/**
 * Removes one named camera from the linked-list order.
 * Mirrors `DestroyCam` unlink behavior in `ref/micropolis/src/sim/w_cam.c`.
 */
function destroyCamByName(viewState: CamViewState, name: string): void {
  const index = viewState.cams.findIndex((cam) => cam.name === name);
  if (index < 0) {
    return;
  }

  viewState.cams.splice(index, 1);
  viewState.camCount = viewState.cams.length;
}

/**
 * Creates a new camera record with C defaults from `new_cam`.
 * Mirrors `new_cam` in `ref/micropolis/src/sim/g_cam.c`, including even-size
 * alignment `w=(w+1)&~1` and `h=(h+1)&~1`.
 */
function createCamViewCameraState(
  name: string,
  x: number,
  y: number,
  width: number,
  height: number,
): CamViewCameraState {
  const alignedWidth = (width + 1) & ~1;
  const alignedHeight = (height + 1) & ~1;

  return {
    name,
    ruleName: null,
    ruleNumber: 0,
    x,
    y,
    width: alignedWidth,
    height: alignedHeight,
    idealWidth: width,
    idealHeight: height,
    wrap: 3,
    steps: 1,
    frob: -1,
    dx: 0,
    dy: 0,
    gx: 0,
    gy: 0,
    dragging: 0,
    setX: -1,
    setY: -1,
    setWidth: -1,
    setHeight: -1,
    setX0: -1,
    setY0: -1,
    setX1: -1,
    setY1: -1,
    randomizeCount: 0,
  };
}

/**
 * Default `StoreColor` behavior for non-X11 runtime mode.
 * Mirrors `CamCmdStoreColor` data persistence in `ref/micropolis/src/sim/w_cam.c`
 * but stores color values in plain state and returns a deterministic success code.
 */
function runCamViewDefaultStoreColor(viewState: CamViewState, color: CamViewStoredColor): number {
  viewState.storedColors.set(color.index, color);
  return 0;
}

/**
 * Default `RandomizeCam` behavior for non-rendering runtime mode.
 * Mirrors `cam_randomize` invocation in `CamCmdRandomizeCam`
 * (`ref/micropolis/src/sim/w_cam.c`) by recording the call in state.
 */
function runCamViewDefaultRandomize(cam: CamViewCameraState): void {
  cam.randomizeCount += 1;
}

/**
 * Implements the `configure` cam-view subcommand.
 * Mirrors `CamCmdconfigure` in `ref/micropolis/src/sim/w_cam.c`.
 * Parity note: returns simplified option listings instead of Tk's full tuple payload.
 */
function handleCamViewConfigureSubcommand(
  viewState: CamViewState,
  argv: readonly string[],
): ScriptRuntimeResult {
  if (argv.length === 2) {
    return makeScriptSuccess(serializeCamViewConfigureOptions(viewState));
  }

  if (argv.length === 3) {
    const rawOptionName = argv[2];
    if (rawOptionName === undefined) {
      return makeInvalidArgCount(
        `${viewState.commandName} configure missing option name at argv[2]`,
      );
    }

    const optionName = toCamViewConfigureOptionName(rawOptionName);
    if (optionName === null) {
      return makeScriptFailure(
        new ScriptRuntimeError(
          ScriptRuntimeErrorCode.Internal,
          `${viewState.commandName} configure unknown option: ${rawOptionName}`,
        ),
      );
    }

    return makeScriptSuccess(readCamViewConfigureOption(viewState, optionName));
  }

  const writeResult = applyCamViewConfigureOptionPairs(
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
 * Implements the `position` cam-view subcommand.
 * Mirrors `CamCmdposition` in `ref/micropolis/src/sim/w_cam.c`.
 */
function handleCamViewPositionSubcommand(
  viewState: CamViewState,
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
 * Implements the `size` cam-view subcommand.
 * Mirrors `CamCmdsize` in `ref/micropolis/src/sim/w_cam.c`.
 */
function handleCamViewSizeSubcommand(
  viewState: CamViewState,
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

    viewState.configure.width = parsedWidth;
    viewState.configure.height = parsedHeight;
  }

  return makeScriptSuccess(`${viewState.configure.width} ${viewState.configure.height}`);
}

/**
 * Implements the `Visible` cam-view subcommand.
 * Mirrors `CamCmdVisible` in `ref/micropolis/src/sim/w_cam.c`.
 * Difference from C: Tk mapping state is modeled via `viewState.isMapped`.
 */
function handleCamViewVisibleSubcommand(
  viewState: CamViewState,
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

    viewState.visible = parsedVisible !== 0 && viewState.isMapped !== 0 ? 1 : 0;
  }

  return makeScriptSuccess(String(viewState.visible));
}

/**
 * Builds the `StoreColor` cam-view subcommand handler.
 * Mirrors `CamCmdStoreColor` in `ref/micropolis/src/sim/w_cam.c`.
 * Parity note: preserves the legacy parse bug where `r/g/b` are parsed from
 * `argv[2]` rather than `argv[3..5]`.
 */
function createCamViewStoreColorSubcommandHandler(
  hooks: CamViewSubcommandHooks,
): CamViewSubcommandHandler {
  return (viewState: CamViewState, argv: readonly string[]): ScriptRuntimeResult => {
    if (argv.length !== 6) {
      return makeInvalidArgCount(
        `${viewState.commandName} StoreColor expects argc 6, got ${argv.length}`,
      );
    }

    const rawIndex = argv[2];
    if (rawIndex === undefined) {
      return makeInvalidArgCount(`${viewState.commandName} StoreColor missing color arguments`);
    }

    const index = parseTclInt32(rawIndex);
    const r = parseTclInt32(rawIndex);
    const g = parseTclInt32(rawIndex);
    const b = parseTclInt32(rawIndex);
    if (index === null || r === null || g === null || b === null) {
      return makeInvalidInteger(
        `${viewState.commandName} StoreColor expected integer color values from argv[2]: ${rawIndex}`,
      );
    }

    const color = { index, r, g, b };
    const errorCode =
      hooks.onStoreColor?.(viewState, color) ?? runCamViewDefaultStoreColor(viewState, color);
    return makeScriptSuccess(String(errorCode));
  };
}

/**
 * Builds the `NewCam` cam-view subcommand handler.
 * Mirrors `CamCmdNewCam` in `ref/micropolis/src/sim/w_cam.c`, including
 * `ruleOrNumber` parsing where zero means rule-name mode.
 */
function createCamViewNewCamSubcommandHandler(
  hooks: CamViewSubcommandHooks,
): CamViewSubcommandHandler {
  return (viewState: CamViewState, argv: readonly string[]): ScriptRuntimeResult => {
    if (argv.length < 8) {
      return makeInvalidArgCount(
        `${viewState.commandName} NewCam expects argc >= 8, got ${argv.length}`,
      );
    }

    const name = argv[2];
    const ruleOrNumber = argv[3];
    const rawX = argv[4];
    const rawY = argv[5];
    const rawWidth = argv[6];
    const rawHeight = argv[7];
    if (
      name === undefined ||
      ruleOrNumber === undefined ||
      rawX === undefined ||
      rawY === undefined ||
      rawWidth === undefined ||
      rawHeight === undefined
    ) {
      return makeInvalidArgCount(`${viewState.commandName} NewCam missing required arguments`);
    }

    const parsedX = parseTclInt32(rawX);
    if (parsedX === null) {
      return makeInvalidInteger(`${viewState.commandName} NewCam expected an integer x: ${rawX}`);
    }

    const parsedY = parseTclInt32(rawY);
    if (parsedY === null) {
      return makeInvalidInteger(`${viewState.commandName} NewCam expected an integer y: ${rawY}`);
    }

    const parsedWidth = parseTclInt32(rawWidth);
    if (parsedWidth === null) {
      return makeInvalidInteger(
        `${viewState.commandName} NewCam expected an integer width: ${rawWidth}`,
      );
    }

    const parsedHeight = parseTclInt32(rawHeight);
    if (parsedHeight === null) {
      return makeInvalidInteger(
        `${viewState.commandName} NewCam expected an integer height: ${rawHeight}`,
      );
    }

    const parsedRule = parseTclInt32(ruleOrNumber);
    const ruleName = parsedRule === null || parsedRule === 0 ? ruleOrNumber : null;
    const ruleNumber = ruleName === null ? parsedRule : null;

    destroyCamByName(viewState, name);

    const cam = createCamViewCameraState(name, parsedX, parsedY, parsedWidth, parsedHeight);
    if (ruleName !== null) {
      cam.ruleName = ruleName;
      hooks.onLoadRule?.(viewState, cam, ruleName);
    } else {
      if (ruleNumber === null) {
        return makeScriptFailure(
          new ScriptRuntimeError(
            ScriptRuntimeErrorCode.Internal,
            `${viewState.commandName} NewCam resolved an invalid numeric rule`,
          ),
        );
      }
      cam.ruleNumber = ruleNumber;
      hooks.onSetNeighborhood?.(viewState, cam, ruleNumber);
    }

    viewState.cams.unshift(cam);
    viewState.camCount = viewState.cams.length;

    const configureResult = applyCamConfigOptionPairs(
      cam,
      argv.slice(8),
      `${viewState.commandName} NewCam ${name}`,
    );
    if (configureResult !== null) {
      return configureResult;
    }

    return makeScriptSuccess('');
  };
}

/**
 * Implements the `DeleteCam` cam-view subcommand.
 * Mirrors `CamCmdDeleteCam` in `ref/micropolis/src/sim/w_cam.c`.
 */
function handleCamViewDeleteCamSubcommand(
  viewState: CamViewState,
  argv: readonly string[],
): ScriptRuntimeResult {
  if (argv.length !== 3) {
    return makeInvalidArgCount(
      `${viewState.commandName} DeleteCam expects argc 3, got ${argv.length}`,
    );
  }

  const name = argv[2];
  if (name === undefined) {
    return makeInvalidArgCount(`${viewState.commandName} DeleteCam missing camera name`);
  }

  destroyCamByName(viewState, name);
  return makeScriptSuccess('');
}

/**
 * Builds the `RandomizeCam` cam-view subcommand handler.
 * Mirrors `CamCmdRandomizeCam` in `ref/micropolis/src/sim/w_cam.c`.
 */
function createCamViewRandomizeCamSubcommandHandler(
  hooks: CamViewSubcommandHooks,
): CamViewSubcommandHandler {
  return (viewState: CamViewState, argv: readonly string[]): ScriptRuntimeResult => {
    if (argv.length !== 3) {
      return makeInvalidArgCount(
        `${viewState.commandName} RandomizeCam expects argc 3, got ${argv.length}`,
      );
    }

    const name = argv[2];
    if (name === undefined) {
      return makeInvalidArgCount(`${viewState.commandName} RandomizeCam missing camera name`);
    }

    const cam = findCamByName(viewState.cams, name);
    if (cam !== null) {
      if (hooks.onRandomizeCam === undefined) {
        runCamViewDefaultRandomize(cam);
      } else {
        hooks.onRandomizeCam(viewState, cam);
      }
    }

    return makeScriptSuccess('');
  };
}

/**
 * Implements the `ConfigCam` cam-view subcommand.
 * Mirrors `CamCmdConfigCam` in `ref/micropolis/src/sim/w_cam.c`.
 * Parity note: returns simplified option listings instead of Tk's full tuple payload.
 */
function handleCamViewConfigCamSubcommand(
  viewState: CamViewState,
  argv: readonly string[],
): ScriptRuntimeResult {
  if (argv.length < 3) {
    return makeInvalidArgCount(
      `${viewState.commandName} ConfigCam expects argc >= 3, got ${argv.length}`,
    );
  }

  const name = argv[2];
  if (name === undefined) {
    return makeInvalidArgCount(`${viewState.commandName} ConfigCam missing camera name`);
  }

  const cam = findCamByName(viewState.cams, name);
  if (cam === null) {
    return makeScriptFailure(
      new ScriptRuntimeError(
        ScriptRuntimeErrorCode.Internal,
        `${viewState.commandName} ConfigCam unknown camera: ${name}`,
      ),
    );
  }

  if (argv.length === 3) {
    return makeScriptSuccess(serializeCamConfigOptions(cam));
  }

  if (argv.length === 4) {
    const rawOptionName = argv[3];
    if (rawOptionName === undefined) {
      return makeInvalidArgCount(`${viewState.commandName} ConfigCam missing option name`);
    }

    const optionName = toCamConfigOptionName(rawOptionName);
    if (optionName === null) {
      return makeScriptFailure(
        new ScriptRuntimeError(
          ScriptRuntimeErrorCode.Internal,
          `${viewState.commandName} ConfigCam unknown option: ${rawOptionName}`,
        ),
      );
    }

    return makeScriptSuccess(readCamConfigOption(cam, optionName));
  }

  const writeResult = applyCamConfigOptionPairs(
    cam,
    argv.slice(3),
    `${viewState.commandName} ConfigCam ${name}`,
  );
  if (writeResult !== null) {
    return writeResult;
  }

  return makeScriptSuccess('');
}

/**
 * Implements the `FindCam` cam-view subcommand.
 * Mirrors `CamCmdFindCam` in `ref/micropolis/src/sim/w_cam.c`.
 */
function handleCamViewFindCamSubcommand(
  viewState: CamViewState,
  argv: readonly string[],
): ScriptRuntimeResult {
  if (argv.length !== 4) {
    return makeInvalidArgCount(
      `${viewState.commandName} FindCam expects argc 4, got ${argv.length}`,
    );
  }

  const rawX = argv[2];
  const rawY = argv[3];
  if (rawX === undefined || rawY === undefined) {
    return makeInvalidArgCount(`${viewState.commandName} FindCam missing x/y arguments`);
  }

  const parsedX = parseTclInt32(rawX);
  if (parsedX === null) {
    return makeInvalidInteger(`${viewState.commandName} FindCam expected an integer x: ${rawX}`);
  }

  const parsedY = parseTclInt32(rawY);
  if (parsedY === null) {
    return makeInvalidInteger(`${viewState.commandName} FindCam expected an integer y: ${rawY}`);
  }

  const cam = findCamByPoint(viewState.cams, parsedX, parsedY);
  return makeScriptSuccess(cam?.name ?? '');
}

/**
 * Implements the `FindSomeCam` cam-view subcommand.
 * Mirrors `CamCmdFindSomeCam` in `ref/micropolis/src/sim/w_cam.c`.
 */
function handleCamViewFindSomeCamSubcommand(
  viewState: CamViewState,
  argv: readonly string[],
): ScriptRuntimeResult {
  if (argv.length !== 4) {
    return makeInvalidArgCount(
      `${viewState.commandName} FindSomeCam expects argc 4, got ${argv.length}`,
    );
  }

  const rawX = argv[2];
  const rawY = argv[3];
  if (rawX === undefined || rawY === undefined) {
    return makeInvalidArgCount(`${viewState.commandName} FindSomeCam missing x/y arguments`);
  }

  const parsedX = parseTclInt32(rawX);
  if (parsedX === null) {
    return makeInvalidInteger(
      `${viewState.commandName} FindSomeCam expected an integer x: ${rawX}`,
    );
  }

  const parsedY = parseTclInt32(rawY);
  if (parsedY === null) {
    return makeInvalidInteger(
      `${viewState.commandName} FindSomeCam expected an integer y: ${rawY}`,
    );
  }

  const cam = findCamByPoint(viewState.cams, parsedX, parsedY) ?? viewState.cams[0] ?? null;
  return makeScriptSuccess(cam?.name ?? '');
}

/**
 * Creates mutable state backing one `camview` widget command.
 * Mirrors `CamCmd` + `InitNewCam` initialization in `ref/micropolis/src/sim/w_cam.c`.
 * Parity note: default dimensions are `512x512` from `DoResizeCam(scam, 512, 512)`.
 * Difference from C: this keeps only scripting-visible data.
 */
export function createCamViewState(
  commandName: string,
  options: CreateCamViewStateOptions = {},
): CamViewState {
  const width = options.configure?.width ?? DEFAULT_CAM_VIEW_WINDOW_SIZE;
  const height = options.configure?.height ?? DEFAULT_CAM_VIEW_WINDOW_SIZE;

  return {
    commandName,
    wX: options.wX ?? 0,
    wY: options.wY ?? 0,
    visible: options.visible ?? DEFAULT_CAM_VIEW_VISIBLE,
    isMapped: options.isMapped ?? DEFAULT_CAM_VIEW_IS_MAPPED,
    invalid: options.invalid ?? 1,
    skips: options.skips ?? 0,
    skip: options.skip ?? 0,
    configure: {
      width,
      height,
    },
    camCount: options.cams?.length ?? 0,
    cams: options.cams ? [...options.cams] : [],
    storedColors: options.storedColors ? new Map(options.storedColors) : new Map(),
  };
}

/**
 * Builds cam-view subcommand entries for optional CAM mode.
 * Mirrors `CAM_CMD(...)` registration in `cam_command_init`
 * (`ref/micropolis/src/sim/w_cam.c`).
 * Parity note: subcommand coverage is a 1:1 port when CAM mode is enabled.
 */
export function createCamViewSubcommandEntries(
  options: CreateCamViewSubcommandEntriesOptions = {},
): readonly CamViewSubcommandEntry[] {
  const hooks = options.hooks ?? {};

  return [
    ['configure', handleCamViewConfigureSubcommand] as const,
    ['position', handleCamViewPositionSubcommand] as const,
    ['size', handleCamViewSizeSubcommand] as const,
    ['Visible', handleCamViewVisibleSubcommand] as const,
    ['StoreColor', createCamViewStoreColorSubcommandHandler(hooks)] as const,
    ['NewCam', createCamViewNewCamSubcommandHandler(hooks)] as const,
    ['DeleteCam', handleCamViewDeleteCamSubcommand] as const,
    ['RandomizeCam', createCamViewRandomizeCamSubcommandHandler(hooks)] as const,
    ['ConfigCam', handleCamViewConfigCamSubcommand] as const,
    ['FindCam', handleCamViewFindCamSubcommand] as const,
    ['FindSomeCam', handleCamViewFindSomeCamSubcommand] as const,
  ];
}

/**
 * Builds a case-sensitive cam-view subcommand lookup table.
 * Mirrors hash-table registration and lookup semantics of `CamCmds`
 * in `cam_command_init`/`DoCamCmd` (`ref/micropolis/src/sim/w_cam.c`).
 * Parity note: duplicate names use last-registration-wins semantics.
 */
export function createCamViewSubcommandTable(
  entries: readonly CamViewSubcommandEntry[] = [],
): CamViewSubcommandTable {
  const table = new Map<string, CamViewSubcommandHandler>();

  for (const [name, handler] of entries) {
    table.set(name, handler);
  }

  return table;
}

/**
 * Default subcommand table for optional `camview` behavior.
 * Mirrors full `CAM_CMD(...)` set in `cam_command_init`
 * (`ref/micropolis/src/sim/w_cam.c`).
 */
export const CAM_VIEW_SUBCOMMAND_TABLE = createCamViewSubcommandTable(
  createCamViewSubcommandEntries(),
);

/**
 * Creates the per-widget cam-view dispatcher bound to one view state.
 * Mirrors `DoCamCmd` hash lookup flow in `ref/micropolis/src/sim/w_cam.c`.
 * Difference from C: uses typed runtime errors in place of Tcl result strings.
 */
export function createCamViewWidgetCommandDispatcher(
  viewState: CamViewState,
  subcommands: CamViewSubcommandTable = CAM_VIEW_SUBCOMMAND_TABLE,
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
          `unknown camview subcommand: ${subcommandName}`,
        ),
      );
    }

    return subcommandHandler(viewState, argv);
  };
}

/**
 * Constructor options for `createCamViewCommandDispatcher`.
 * Mirrors state and command wiring around `CamCmd` + `DoCamCmd`
 * in `ref/micropolis/src/sim/w_cam.c`.
 */
export interface CreateCamViewCommandDispatcherOptions {
  runtime: ScriptRuntime;
  views?: ViewRegistry<CamViewState>;
  createViewState?: (commandName: string) => CamViewState;
  subcommands?: CamViewSubcommandTable;
}

/**
 * Creates the top-level `camview` factory command dispatcher.
 * Mirrors `CamCmd` creation flow for `camview pathName ?options?` in
 * `ref/micropolis/src/sim/w_cam.c`: create state, register widget command,
 * and return the path name.
 * Difference from C: Tk window/event registration is omitted.
 */
export function createCamViewCommandDispatcher(
  options: CreateCamViewCommandDispatcherOptions,
): ScriptCommandHandler {
  const views = options.views ?? new ViewRegistry<CamViewState>();
  const createViewState =
    options.createViewState ?? ((commandName: string) => createCamViewState(commandName));
  const subcommands = options.subcommands ?? CAM_VIEW_SUBCOMMAND_TABLE;

  return (argv: readonly string[]): ScriptRuntimeResult => {
    const commandName = argv[1];
    if (commandName === undefined || commandName.length === 0) {
      return makeInvalidArgCount('camview command requires a pathName in argv[1]');
    }

    if (views.get(commandName) !== undefined) {
      return makeScriptFailure(
        new ScriptRuntimeError(
          ScriptRuntimeErrorCode.Internal,
          `camview command already exists: ${commandName}`,
        ),
      );
    }

    const viewState = createViewState(commandName);
    const configureResult = applyCamViewConfigureOptionPairs(
      viewState,
      argv.slice(2),
      `camview ${commandName}`,
    );
    if (configureResult !== null) {
      return configureResult;
    }

    views.add(commandName, viewState);
    options.runtime.registerCommand(
      commandName,
      createCamViewWidgetCommandDispatcher(viewState, subcommands),
    );
    return makeScriptSuccess(commandName);
  };
}

/**
 * Registers the top-level `camview` command in a runtime.
 * Mirrors `Tcl_CreateCommand(..., "camview", CamCmd, ...)` in
 * `cam_command_init` (`ref/micropolis/src/sim/w_cam.c`).
 * Parity note: command registration name and factory binding are 1:1 with C.
 */
export function registerCamViewCommand(
  runtime: ScriptRuntime,
  options: Omit<CreateCamViewCommandDispatcherOptions, 'runtime'> = {},
): void {
  runtime.registerCommand(
    'camview',
    createCamViewCommandDispatcher({
      runtime,
      ...options,
    }),
  );
}
