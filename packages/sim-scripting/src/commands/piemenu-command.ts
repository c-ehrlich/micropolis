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

const DEFAULT_PIE_MENU_ACTIVE_BACKGROUND = '#bfbfbf';
const DEFAULT_PIE_MENU_ACTIVE_BORDER_WIDTH = 2;
const DEFAULT_PIE_MENU_ACTIVE_FOREGROUND = 'black';
const DEFAULT_PIE_MENU_BACKGROUND = '#bfbfbf';
const DEFAULT_PIE_MENU_BORDER_WIDTH = 2;
const DEFAULT_PIE_MENU_CURSOR = 'circle';
const DEFAULT_PIE_MENU_FOREGROUND = 'black';
const DEFAULT_PIE_MENU_FONT = '-Adobe-Helvetica-Bold-R-Normal-*-120-*';
const DEFAULT_PIE_MENU_TITLE = '';
const DEFAULT_PIE_MENU_PREVIEW = '';
const DEFAULT_PIE_MENU_TITLE_FONT = DEFAULT_PIE_MENU_FONT;
const DEFAULT_PIE_MENU_INITIAL_ANGLE = 0;
const DEFAULT_PIE_MENU_INACTIVE_RADIUS = 8;
const DEFAULT_PIE_MENU_MIN_RADIUS = 16;
const DEFAULT_PIE_MENU_EXTRA_RADIUS = 2;
const DEFAULT_PIE_MENU_FIXED_RADIUS = 0;
const DEFAULT_PIE_MENU_ACTIVE_INDEX = -1;
const DEFAULT_PIE_MENU_POPUP_DELAY = 250;
const DEFAULT_PIE_MENU_SHAPED = 1;

const PIE_MENU_ENTRY_TYPE_COMMAND = 'command';
const PIE_MENU_ENTRY_TYPE_PIEMENU = 'piemenu';

const PIE_MENU_CONFIGURE_OPTION_NAMES = [
  '-activebackground',
  '-activeborderwidth',
  '-activeforeground',
  '-background',
  '-borderwidth',
  '-cursor',
  '-foreground',
  '-font',
  '-title',
  '-preview',
  '-titlefont',
  '-initialangle',
  '-inactiveradius',
  '-minradius',
  '-extraradius',
  '-fixedradius',
  '-active',
  '-popupdelay',
  '-shaped',
] as const;

const PIE_MENU_ENTRY_CONFIGURE_OPTION_NAMES = [
  '-activebackground',
  '-background',
  '-bitmap',
  '-command',
  '-preview',
  '-font',
  '-label',
  '-piemenu',
  '-xoffset',
  '-yoffset',
] as const;

/**
 * Supported pie-menu entry kinds.
 * Mirrors `COMMAND_ENTRY` and `PIEMENU_ENTRY` in
 * `ref/micropolis/src/sim/w_piem.c`.
 */
export type PieMenuEntryType =
  | typeof PIE_MENU_ENTRY_TYPE_COMMAND
  | typeof PIE_MENU_ENTRY_TYPE_PIEMENU;

/**
 * Mutable `piemenu` configure fields.
 * Mirrors `configSpecs` in `ref/micropolis/src/sim/w_piem.c`.
 * Difference from C: this stores scalar option values explicitly instead of Tk-managed config slots.
 */
export interface PieMenuConfigureState {
  activeBackground: string;
  activeBorderWidth: number;
  activeForeground: string;
  background: string;
  borderWidth: number;
  cursor: string | null;
  foreground: string;
  font: string;
  title: string;
  preview: string;
  titleFont: string;
  initialAngle: number;
  inactiveRadius: number;
  minRadius: number;
  extraRadius: number;
  fixedRadius: number;
  active: number;
  popupDelay: number;
  shaped: number;
}

/**
 * Mutable state for one pie-menu entry.
 * Mirrors `PieMenuEntry` script-configurable fields from `entryConfigSpecs`
 * in `ref/micropolis/src/sim/w_piem.c`.
 * Difference from C: pixmap/font/border handles are represented as simple nullable names.
 */
export interface PieMenuEntryState {
  type: PieMenuEntryType;
  label: string | null;
  command: string | null;
  preview: string | null;
  piemenu: string | null;
  bitmap: string | null;
  font: string | null;
  background: string | null;
  activeBackground: string | null;
  xOffset: number;
  yOffset: number;
}

/**
 * Mutable state for one created pie-menu command.
 * Mirrors script-visible portions of `PieMenu` in `ref/micropolis/src/sim/w_piem.c`
 * that are required by P4.1 subcommands (`configure`, `add`, `delete`,
 * `entryconfigure`, `index`).
 * Difference from C: Tk window/event handles and drawing caches are not modeled.
 */
export interface PieMenuState {
  commandName: string;
  entries: PieMenuEntryState[];
  active: number;
  popupPending: boolean;
  resizePending: boolean;
  configure: PieMenuConfigureState;
}

/**
 * Constructor overrides for `createPieMenuState`.
 * Mirrors defaults initialized in `Tk_PieMenuCmd` and follow-up config in
 * `ConfigurePieMenu` (`ref/micropolis/src/sim/w_piem.c`).
 */
export interface CreatePieMenuStateOptions {
  entries?: readonly PieMenuEntryState[];
  active?: number;
  popupPending?: boolean;
  resizePending?: boolean;
  configure?: Partial<PieMenuConfigureState>;
}

/**
 * Hook callbacks used by pie-menu subcommands.
 * Mirrors C helper calls adjacent to `GetPieMenuIndex` in
 * `ref/micropolis/src/sim/w_piem.c`.
 * Difference from C: `@x,y` hit-testing can be injected for deterministic tests.
 */
export interface PieMenuSubcommandHooks {
  resolveIndexAtCoordinates?: (menuState: PieMenuState, x: number, y: number) => number;
}

/**
 * Constructor options for `createPieMenuSubcommandEntries`.
 * Mirrors command-table wiring in `PieMenuWidgetCmd`
 * (`ref/micropolis/src/sim/w_piem.c`).
 */
export interface CreatePieMenuSubcommandEntriesOptions {
  hooks?: PieMenuSubcommandHooks;
}

/**
 * Subcommand names registered for P4.1 pie-menu shell behavior.
 * Mirrors this P4.1 subset from `PieMenuWidgetCmd` in
 * `ref/micropolis/src/sim/w_piem.c`.
 */
export const PIE_MENU_SUBCOMMAND_NAMES = [
  'configure',
  'add',
  'delete',
  'entryconfigure',
  'index',
] as const;

/**
 * Union of supported pie-menu shell subcommand names.
 */
export type PieMenuSubcommandName = (typeof PIE_MENU_SUBCOMMAND_NAMES)[number];

/**
 * Handler signature for `<piePath> <Subcommand> ...`.
 * Mirrors function-pointer style dispatch in `PieMenuWidgetCmd`
 * (`ref/micropolis/src/sim/w_piem.c`).
 */
export type PieMenuSubcommandHandler = (
  menuState: PieMenuState,
  argv: readonly string[],
) => ScriptRuntimeResult;

/**
 * Case-sensitive pie-menu subcommand table.
 * Mirrors Tcl hash lookup behavior used in command dispatch across the C bridge.
 */
export type PieMenuSubcommandTable = ReadonlyMap<string, PieMenuSubcommandHandler>;

/**
 * One pie-menu subcommand registration tuple.
 * Mirrors one subcommand branch registration point in `PieMenuWidgetCmd`
 * (`ref/micropolis/src/sim/w_piem.c`).
 */
export type PieMenuSubcommandEntry = readonly [name: string, handler: PieMenuSubcommandHandler];

type PieMenuConfigureOptionName = (typeof PIE_MENU_CONFIGURE_OPTION_NAMES)[number];
type PieMenuEntryConfigureOptionName = (typeof PIE_MENU_ENTRY_CONFIGURE_OPTION_NAMES)[number];

/**
 * Parses a Tcl-style integer and enforces 32-bit C `int` range.
 * Mirrors `Tcl_GetInt` call sites in `PieMenuWidgetCmd` and `GetPieMenuIndex`
 * (`ref/micropolis/src/sim/w_piem.c`).
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

function makeInvalidArgCount(message: string): ScriptRuntimeResult {
  return makeScriptFailure(new ScriptRuntimeError(ScriptRuntimeErrorCode.InvalidArgCount, message));
}

function makeInvalidInteger(message: string): ScriptRuntimeResult {
  return makeScriptFailure(new ScriptRuntimeError(ScriptRuntimeErrorCode.InvalidInteger, message));
}

function toPieMenuConfigureOptionName(raw: string): PieMenuConfigureOptionName | null {
  switch (raw) {
    case '-activebackground':
    case '-activeborderwidth':
    case '-activeforeground':
    case '-background':
    case '-borderwidth':
    case '-cursor':
    case '-foreground':
    case '-font':
    case '-title':
    case '-preview':
    case '-titlefont':
    case '-initialangle':
    case '-inactiveradius':
    case '-minradius':
    case '-extraradius':
    case '-fixedradius':
    case '-active':
    case '-popupdelay':
    case '-shaped':
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

function readPieMenuConfigureOption(
  menuState: PieMenuState,
  optionName: PieMenuConfigureOptionName,
): string {
  switch (optionName) {
    case '-activebackground':
      return menuState.configure.activeBackground;
    case '-activeborderwidth':
      return String(menuState.configure.activeBorderWidth);
    case '-activeforeground':
      return menuState.configure.activeForeground;
    case '-background':
      return menuState.configure.background;
    case '-borderwidth':
      return String(menuState.configure.borderWidth);
    case '-cursor':
      return menuState.configure.cursor ?? '';
    case '-foreground':
      return menuState.configure.foreground;
    case '-font':
      return menuState.configure.font;
    case '-title':
      return menuState.configure.title;
    case '-preview':
      return menuState.configure.preview;
    case '-titlefont':
      return menuState.configure.titleFont;
    case '-initialangle':
      return String(menuState.configure.initialAngle);
    case '-inactiveradius':
      return String(menuState.configure.inactiveRadius);
    case '-minradius':
      return String(menuState.configure.minRadius);
    case '-extraradius':
      return String(menuState.configure.extraRadius);
    case '-fixedradius':
      return String(menuState.configure.fixedRadius);
    case '-active':
      return String(menuState.active);
    case '-popupdelay':
      return String(menuState.configure.popupDelay);
    case '-shaped':
      return String(menuState.configure.shaped);
  }
}

function serializePieMenuConfigureOptions(menuState: PieMenuState): string {
  return PIE_MENU_CONFIGURE_OPTION_NAMES.map((optionName) => {
    return `${optionName} ${readPieMenuConfigureOption(menuState, optionName)}`;
  }).join(' ');
}

function writePieMenuConfigureOption(
  menuState: PieMenuState,
  optionName: PieMenuConfigureOptionName,
  optionValue: string,
  contextLabel: string,
): ScriptRuntimeResult | null {
  switch (optionName) {
    case '-activebackground':
      menuState.configure.activeBackground = optionValue;
      return null;
    case '-activeborderwidth': {
      const parsed = parseTclInt32(optionValue);
      if (parsed === null) {
        return makeInvalidInteger(
          `${contextLabel} expected an integer active border width: ${optionValue}`,
        );
      }
      menuState.configure.activeBorderWidth = parsed;
      return null;
    }
    case '-activeforeground':
      menuState.configure.activeForeground = optionValue;
      return null;
    case '-background':
      menuState.configure.background = optionValue;
      return null;
    case '-borderwidth': {
      const parsed = parseTclInt32(optionValue);
      if (parsed === null) {
        return makeInvalidInteger(
          `${contextLabel} expected an integer border width: ${optionValue}`,
        );
      }
      menuState.configure.borderWidth = parsed;
      return null;
    }
    case '-cursor':
      menuState.configure.cursor = optionValue;
      return null;
    case '-foreground':
      menuState.configure.foreground = optionValue;
      return null;
    case '-font':
      menuState.configure.font = optionValue;
      return null;
    case '-title':
      menuState.configure.title = optionValue;
      return null;
    case '-preview':
      menuState.configure.preview = optionValue;
      return null;
    case '-titlefont':
      menuState.configure.titleFont = optionValue;
      return null;
    case '-initialangle': {
      const parsed = parseTclInt32(optionValue);
      if (parsed === null) {
        return makeInvalidInteger(
          `${contextLabel} expected an integer initial angle: ${optionValue}`,
        );
      }
      menuState.configure.initialAngle = parsed;
      return null;
    }
    case '-inactiveradius': {
      const parsed = parseTclInt32(optionValue);
      if (parsed === null) {
        return makeInvalidInteger(
          `${contextLabel} expected an integer inactive radius: ${optionValue}`,
        );
      }
      menuState.configure.inactiveRadius = parsed;
      return null;
    }
    case '-minradius': {
      const parsed = parseTclInt32(optionValue);
      if (parsed === null) {
        return makeInvalidInteger(`${contextLabel} expected an integer min radius: ${optionValue}`);
      }
      menuState.configure.minRadius = parsed;
      return null;
    }
    case '-extraradius': {
      const parsed = parseTclInt32(optionValue);
      if (parsed === null) {
        return makeInvalidInteger(
          `${contextLabel} expected an integer extra radius: ${optionValue}`,
        );
      }
      menuState.configure.extraRadius = parsed;
      return null;
    }
    case '-fixedradius': {
      const parsed = parseTclInt32(optionValue);
      if (parsed === null) {
        return makeInvalidInteger(
          `${contextLabel} expected an integer fixed radius: ${optionValue}`,
        );
      }
      menuState.configure.fixedRadius = parsed;
      return null;
    }
    case '-active': {
      const parsed = parseTclInt32(optionValue);
      if (parsed === null) {
        return makeInvalidInteger(
          `${contextLabel} expected an integer active index: ${optionValue}`,
        );
      }
      menuState.active = parsed;
      menuState.configure.active = parsed;
      return null;
    }
    case '-popupdelay': {
      const parsed = parseTclInt32(optionValue);
      if (parsed === null) {
        return makeInvalidInteger(
          `${contextLabel} expected an integer popup delay: ${optionValue}`,
        );
      }
      menuState.configure.popupDelay = parsed;
      return null;
    }
    case '-shaped': {
      const parsed = parseTclInt32(optionValue);
      if (parsed === null) {
        return makeInvalidInteger(`${contextLabel} expected an integer shaped: ${optionValue}`);
      }
      menuState.configure.shaped = parsed;
      return null;
    }
  }
}

function applyPieMenuConfigureOptionPairs(
  menuState: PieMenuState,
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

    const optionName = toPieMenuConfigureOptionName(rawOptionName);
    if (optionName === null) {
      return makeScriptFailure(
        new ScriptRuntimeError(
          ScriptRuntimeErrorCode.Internal,
          `${contextLabel} configure unknown option: ${rawOptionName}`,
        ),
      );
    }

    const writeResult = writePieMenuConfigureOption(
      menuState,
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

function toPieMenuEntryConfigureOptionName(raw: string): PieMenuEntryConfigureOptionName | null {
  switch (raw) {
    case '-activebackground':
    case '-background':
    case '-bitmap':
    case '-command':
    case '-preview':
    case '-font':
    case '-label':
    case '-piemenu':
    case '-xoffset':
    case '-yoffset':
      return raw;
    default:
      return null;
  }
}

function supportsPieMenuEntryOption(
  entry: PieMenuEntryState,
  optionName: PieMenuEntryConfigureOptionName,
): boolean {
  if (entry.type === PIE_MENU_ENTRY_TYPE_PIEMENU && optionName === '-command') {
    return false;
  }

  return true;
}

function readPieMenuEntryConfigureOption(
  entry: PieMenuEntryState,
  optionName: PieMenuEntryConfigureOptionName,
): string {
  switch (optionName) {
    case '-activebackground':
      return entry.activeBackground ?? '';
    case '-background':
      return entry.background ?? '';
    case '-bitmap':
      return entry.bitmap ?? '';
    case '-command':
      return entry.command ?? '';
    case '-preview':
      return entry.preview ?? '';
    case '-font':
      return entry.font ?? '';
    case '-label':
      return entry.label ?? '';
    case '-piemenu':
      return entry.piemenu ?? '';
    case '-xoffset':
      return String(entry.xOffset);
    case '-yoffset':
      return String(entry.yOffset);
  }
}

function serializePieMenuEntryConfigureOptions(entry: PieMenuEntryState): string {
  return PIE_MENU_ENTRY_CONFIGURE_OPTION_NAMES.filter((optionName) => {
    return supportsPieMenuEntryOption(entry, optionName);
  })
    .map((optionName) => {
      return `${optionName} ${readPieMenuEntryConfigureOption(entry, optionName)}`;
    })
    .join(' ');
}

function writePieMenuEntryConfigureOption(
  entry: PieMenuEntryState,
  optionName: PieMenuEntryConfigureOptionName,
  optionValue: string,
  contextLabel: string,
): ScriptRuntimeResult | null {
  if (!supportsPieMenuEntryOption(entry, optionName)) {
    return makeScriptFailure(
      new ScriptRuntimeError(
        ScriptRuntimeErrorCode.Internal,
        `${contextLabel} unknown option: ${optionName}`,
      ),
    );
  }

  switch (optionName) {
    case '-activebackground':
      entry.activeBackground = optionValue;
      return null;
    case '-background':
      entry.background = optionValue;
      return null;
    case '-bitmap':
      entry.bitmap = optionValue;
      return null;
    case '-command':
      entry.command = optionValue;
      return null;
    case '-preview':
      entry.preview = optionValue;
      return null;
    case '-font':
      entry.font = optionValue;
      return null;
    case '-label':
      entry.label = optionValue;
      return null;
    case '-piemenu':
      entry.piemenu = optionValue;
      return null;
    case '-xoffset': {
      const parsed = parseTclInt32(optionValue);
      if (parsed === null) {
        return makeInvalidInteger(`${contextLabel} expected an integer x offset: ${optionValue}`);
      }
      entry.xOffset = parsed;
      return null;
    }
    case '-yoffset': {
      const parsed = parseTclInt32(optionValue);
      if (parsed === null) {
        return makeInvalidInteger(`${contextLabel} expected an integer y offset: ${optionValue}`);
      }
      entry.yOffset = parsed;
      return null;
    }
  }
}

function applyPieMenuEntryConfigureOptionPairs(
  entry: PieMenuEntryState,
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

    const optionName = toPieMenuEntryConfigureOptionName(rawOptionName);
    if (optionName === null) {
      return makeScriptFailure(
        new ScriptRuntimeError(
          ScriptRuntimeErrorCode.Internal,
          `${contextLabel} unknown option: ${rawOptionName}`,
        ),
      );
    }

    const writeResult = writePieMenuEntryConfigureOption(
      entry,
      optionName,
      optionValue,
      contextLabel,
    );
    if (writeResult !== null) {
      return writeResult;
    }
  }

  return null;
}

function parsePieMenuEntryType(raw: string): PieMenuEntryType | null {
  if (raw.length === 0) {
    return null;
  }

  if (PIE_MENU_ENTRY_TYPE_COMMAND.startsWith(raw)) {
    return PIE_MENU_ENTRY_TYPE_COMMAND;
  }

  if (PIE_MENU_ENTRY_TYPE_PIEMENU.startsWith(raw)) {
    return PIE_MENU_ENTRY_TYPE_PIEMENU;
  }

  return null;
}

function createPieMenuEntryState(type: PieMenuEntryType): PieMenuEntryState {
  return {
    type,
    label: null,
    command: null,
    preview: null,
    piemenu: null,
    bitmap: null,
    font: null,
    background: null,
    activeBackground: null,
    xOffset: 0,
    yOffset: 0,
  };
}

function globPatternToRegExp(pattern: string): RegExp {
  let source = '^';

  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === undefined) {
      continue;
    }

    if (char === '*') {
      source += '.*';
      continue;
    }

    if (char === '?') {
      source += '.';
      continue;
    }

    if (char === '[') {
      let classSource = '[';
      let cursor = index + 1;
      let closed = false;

      const first = pattern[cursor];
      if (first === '!' || first === '^') {
        classSource += '^';
        cursor += 1;
      }

      if (pattern[cursor] === ']') {
        classSource += ']';
        cursor += 1;
      }

      while (cursor < pattern.length) {
        const classChar = pattern[cursor];
        if (classChar === undefined) {
          break;
        }

        if (classChar === ']') {
          classSource += ']';
          closed = true;
          break;
        }

        if (classChar === '\\') {
          const escaped = pattern[cursor + 1];
          if (escaped !== undefined) {
            classSource += `\\${escaped}`;
            cursor += 2;
            continue;
          }
        }

        if ('\\'.includes(classChar)) {
          classSource += `\\${classChar}`;
        } else {
          classSource += classChar;
        }
        cursor += 1;
      }

      if (closed) {
        source += classSource;
        index = cursor;
        continue;
      }

      source += '\\[';
      continue;
    }

    if (char === '\\') {
      const escaped = pattern[index + 1];
      if (escaped !== undefined) {
        source += escaped.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        index += 1;
        continue;
      }

      source += '\\\\';
      continue;
    }

    source += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  source += '$';
  return new RegExp(source);
}

function tclStringMatch(text: string, pattern: string): boolean {
  return globPatternToRegExp(pattern).test(text);
}

function parseAtCoordinateIndex(raw: string): readonly [number, number] | null {
  if (!raw.startsWith('@')) {
    return null;
  }

  const coordinateText = raw.slice(1);
  const commaIndex = coordinateText.indexOf(',');
  if (commaIndex <= 0 || commaIndex === coordinateText.length - 1) {
    return null;
  }

  const xText = coordinateText.slice(0, commaIndex);
  const yText = coordinateText.slice(commaIndex + 1);
  const x = parseTclInt32(xText);
  const y = parseTclInt32(yText);
  if (x === null || y === null) {
    return null;
  }

  return [x, y] as const;
}

function clampResolvedIndex(value: number, maxLength: number): number {
  if (!Number.isFinite(value)) {
    return -1;
  }

  const truncated = Math.trunc(value);
  if (truncated < 0 || truncated >= maxLength) {
    return -1;
  }

  return truncated;
}

/**
 * Resolves an index token to a numeric pie-menu entry index.
 * Mirrors `GetPieMenuIndex` in `ref/micropolis/src/sim/w_piem.c`.
 * Parity note: numeric parsing only starts when the first character is a digit,
 * and unmatched values produce `bad menu entry index` errors.
 */
export function resolvePieMenuIndex(
  menuState: PieMenuState,
  indexToken: string,
  hooks: PieMenuSubcommandHooks = {},
): number | ScriptRuntimeResult {
  if (indexToken === 'active') {
    return menuState.active;
  }

  if (indexToken === 'last') {
    return menuState.entries.length - 1;
  }

  if (indexToken === 'none') {
    return -1;
  }

  const coordinateIndex = parseAtCoordinateIndex(indexToken);
  if (coordinateIndex !== null) {
    const [x, y] = coordinateIndex;
    const resolvedRaw = hooks.resolveIndexAtCoordinates?.(menuState, x, y) ?? -1;
    return clampResolvedIndex(resolvedRaw, menuState.entries.length);
  }

  const firstChar = indexToken[0];
  if (firstChar !== undefined && /[0-9]/.test(firstChar)) {
    const parsedIndex = parseTclInt32(indexToken);
    if (parsedIndex !== null && parsedIndex >= 0 && parsedIndex < menuState.entries.length) {
      return parsedIndex;
    }
  }

  for (let index = 0; index < menuState.entries.length; index += 1) {
    const entry = menuState.entries[index];
    if (entry === undefined) {
      continue;
    }

    if (entry.label !== null && tclStringMatch(entry.label, indexToken)) {
      return index;
    }
  }

  return makeScriptFailure(
    new ScriptRuntimeError(ScriptRuntimeErrorCode.Internal, `bad menu entry index "${indexToken}"`),
  );
}

function handlePieMenuConfigureSubcommand(
  menuState: PieMenuState,
  argv: readonly string[],
): ScriptRuntimeResult {
  if (argv.length === 2) {
    return makeScriptSuccess(serializePieMenuConfigureOptions(menuState));
  }

  if (argv.length === 3) {
    const rawOptionName = argv[2];
    if (rawOptionName === undefined) {
      return makeInvalidArgCount(
        `${menuState.commandName} configure missing option name at argv[2]`,
      );
    }

    const optionName = toPieMenuConfigureOptionName(rawOptionName);
    if (optionName === null) {
      return makeScriptFailure(
        new ScriptRuntimeError(
          ScriptRuntimeErrorCode.Internal,
          `${menuState.commandName} configure unknown option: ${rawOptionName}`,
        ),
      );
    }

    return makeScriptSuccess(readPieMenuConfigureOption(menuState, optionName));
  }

  const writeResult = applyPieMenuConfigureOptionPairs(
    menuState,
    argv.slice(2),
    menuState.commandName,
  );
  if (writeResult !== null) {
    return writeResult;
  }

  return makeScriptSuccess('');
}

function createPieMenuAddSubcommandHandler(): PieMenuSubcommandHandler {
  return (menuState: PieMenuState, argv: readonly string[]): ScriptRuntimeResult => {
    const typeText = argv[2];
    if (typeText === undefined) {
      return makeInvalidArgCount(
        `${menuState.commandName} add expects argc >= 3, got ${argv.length}`,
      );
    }

    const type = parsePieMenuEntryType(typeText);
    if (type === null) {
      return makeScriptFailure(
        new ScriptRuntimeError(
          ScriptRuntimeErrorCode.Internal,
          `bad menu entry type "${typeText}":  must be command or piemenu`,
        ),
      );
    }

    const entry = createPieMenuEntryState(type);
    const configureResult = applyPieMenuEntryConfigureOptionPairs(
      entry,
      argv.slice(3),
      `${menuState.commandName} add`,
    );
    if (configureResult !== null) {
      return configureResult;
    }

    menuState.entries.push(entry);
    menuState.resizePending = true;

    return makeScriptSuccess('');
  };
}

function createPieMenuDeleteSubcommandHandler(
  hooks: PieMenuSubcommandHooks,
): PieMenuSubcommandHandler {
  return (menuState: PieMenuState, argv: readonly string[]): ScriptRuntimeResult => {
    const indexToken = argv[2];
    if (argv.length !== 3 || indexToken === undefined) {
      return makeInvalidArgCount(
        `${menuState.commandName} delete expects argc 3, got ${argv.length}`,
      );
    }

    const indexOrError = resolvePieMenuIndex(menuState, indexToken, hooks);
    if (typeof indexOrError !== 'number') {
      return indexOrError;
    }

    if (indexOrError < 0) {
      return makeScriptSuccess('');
    }

    menuState.entries.splice(indexOrError, 1);
    menuState.resizePending = true;

    if (menuState.active === indexOrError) {
      menuState.active = -1;
      menuState.configure.active = -1;
    } else if (menuState.active > indexOrError) {
      menuState.active -= 1;
      menuState.configure.active = menuState.active;
    }

    return makeScriptSuccess('');
  };
}

function createPieMenuEntryConfigureSubcommandHandler(
  hooks: PieMenuSubcommandHooks,
): PieMenuSubcommandHandler {
  return (menuState: PieMenuState, argv: readonly string[]): ScriptRuntimeResult => {
    const indexToken = argv[2];
    if (argv.length < 3 || indexToken === undefined) {
      return makeInvalidArgCount(
        `${menuState.commandName} entryconfigure expects argc >= 3, got ${argv.length}`,
      );
    }

    const indexOrError = resolvePieMenuIndex(menuState, indexToken, hooks);
    if (typeof indexOrError !== 'number') {
      return indexOrError;
    }

    if (indexOrError < 0) {
      return makeScriptSuccess('');
    }

    const entry = menuState.entries[indexOrError];
    if (entry === undefined) {
      return makeScriptFailure(
        new ScriptRuntimeError(
          ScriptRuntimeErrorCode.Internal,
          `bad menu entry index "${indexToken}"`,
        ),
      );
    }

    if (argv.length === 3) {
      return makeScriptSuccess(serializePieMenuEntryConfigureOptions(entry));
    }

    if (argv.length === 4) {
      const rawOptionName = argv[3];
      if (rawOptionName === undefined) {
        return makeInvalidArgCount(
          `${menuState.commandName} entryconfigure missing option name at argv[3]`,
        );
      }

      const optionName = toPieMenuEntryConfigureOptionName(rawOptionName);
      if (optionName === null || !supportsPieMenuEntryOption(entry, optionName)) {
        return makeScriptFailure(
          new ScriptRuntimeError(
            ScriptRuntimeErrorCode.Internal,
            `${menuState.commandName} entryconfigure unknown option: ${rawOptionName}`,
          ),
        );
      }

      return makeScriptSuccess(readPieMenuEntryConfigureOption(entry, optionName));
    }

    const writeResult = applyPieMenuEntryConfigureOptionPairs(
      entry,
      argv.slice(3),
      `${menuState.commandName} entryconfigure`,
    );
    if (writeResult !== null) {
      return writeResult;
    }

    menuState.resizePending = true;
    return makeScriptSuccess('');
  };
}

function createPieMenuIndexSubcommandHandler(
  hooks: PieMenuSubcommandHooks,
): PieMenuSubcommandHandler {
  return (menuState: PieMenuState, argv: readonly string[]): ScriptRuntimeResult => {
    const indexToken = argv[2];
    if (argv.length !== 3 || indexToken === undefined) {
      return makeInvalidArgCount(
        `${menuState.commandName} index expects argc 3, got ${argv.length}`,
      );
    }

    const indexOrError = resolvePieMenuIndex(menuState, indexToken, hooks);
    if (typeof indexOrError !== 'number') {
      return indexOrError;
    }

    if (indexOrError < 0) {
      return makeScriptSuccess('none');
    }

    return makeScriptSuccess(String(indexOrError));
  };
}

/**
 * Creates one pie-menu state object with Micropolis defaults.
 * Mirrors `Tk_PieMenuCmd` field initialization and `ConfigurePieMenu` defaulting
 * in `ref/micropolis/src/sim/w_piem.c`.
 */
export function createPieMenuState(
  commandName: string,
  options: CreatePieMenuStateOptions = {},
): PieMenuState {
  const configuredActive = options.configure?.active;
  const active = options.active ?? configuredActive ?? DEFAULT_PIE_MENU_ACTIVE_INDEX;

  return {
    commandName,
    entries: (options.entries ?? []).map((entry) => ({ ...entry })),
    active,
    popupPending: options.popupPending ?? false,
    resizePending: options.resizePending ?? false,
    configure: {
      activeBackground: options.configure?.activeBackground ?? DEFAULT_PIE_MENU_ACTIVE_BACKGROUND,
      activeBorderWidth:
        options.configure?.activeBorderWidth ?? DEFAULT_PIE_MENU_ACTIVE_BORDER_WIDTH,
      activeForeground: options.configure?.activeForeground ?? DEFAULT_PIE_MENU_ACTIVE_FOREGROUND,
      background: options.configure?.background ?? DEFAULT_PIE_MENU_BACKGROUND,
      borderWidth: options.configure?.borderWidth ?? DEFAULT_PIE_MENU_BORDER_WIDTH,
      cursor: options.configure?.cursor ?? DEFAULT_PIE_MENU_CURSOR,
      foreground: options.configure?.foreground ?? DEFAULT_PIE_MENU_FOREGROUND,
      font: options.configure?.font ?? DEFAULT_PIE_MENU_FONT,
      title: options.configure?.title ?? DEFAULT_PIE_MENU_TITLE,
      preview: options.configure?.preview ?? DEFAULT_PIE_MENU_PREVIEW,
      titleFont: options.configure?.titleFont ?? DEFAULT_PIE_MENU_TITLE_FONT,
      initialAngle: options.configure?.initialAngle ?? DEFAULT_PIE_MENU_INITIAL_ANGLE,
      inactiveRadius: options.configure?.inactiveRadius ?? DEFAULT_PIE_MENU_INACTIVE_RADIUS,
      minRadius: options.configure?.minRadius ?? DEFAULT_PIE_MENU_MIN_RADIUS,
      extraRadius: options.configure?.extraRadius ?? DEFAULT_PIE_MENU_EXTRA_RADIUS,
      fixedRadius: options.configure?.fixedRadius ?? DEFAULT_PIE_MENU_FIXED_RADIUS,
      active,
      popupDelay: options.configure?.popupDelay ?? DEFAULT_PIE_MENU_POPUP_DELAY,
      shaped: options.configure?.shaped ?? DEFAULT_PIE_MENU_SHAPED,
    },
  };
}

/**
 * Builds pie-menu subcommand entries for the P4.1 command set.
 * Mirrors `PieMenuWidgetCmd` branches for `configure`, `add`, `delete`,
 * `entryconfigure`, and `index` in `ref/micropolis/src/sim/w_piem.c`.
 */
export function createPieMenuSubcommandEntries(
  options: CreatePieMenuSubcommandEntriesOptions = {},
): readonly PieMenuSubcommandEntry[] {
  const hooks = options.hooks ?? {};

  return [
    ['configure', handlePieMenuConfigureSubcommand] as const,
    ['add', createPieMenuAddSubcommandHandler()] as const,
    ['delete', createPieMenuDeleteSubcommandHandler(hooks)] as const,
    ['entryconfigure', createPieMenuEntryConfigureSubcommandHandler(hooks)] as const,
    ['index', createPieMenuIndexSubcommandHandler(hooks)] as const,
  ];
}

/**
 * Builds a case-sensitive pie-menu subcommand lookup table.
 * Mirrors Tcl command table lookup behavior where duplicate registrations are
 * last-write-wins.
 */
export function createPieMenuSubcommandTable(
  entries: readonly PieMenuSubcommandEntry[] = [],
): PieMenuSubcommandTable {
  const table = new Map<string, PieMenuSubcommandHandler>();

  for (const [name, handler] of entries) {
    table.set(name, handler);
  }

  return table;
}

/**
 * Default subcommand table for P4.1 pie-menu shell behavior.
 * Mirrors this task's subcommand subset from `PieMenuWidgetCmd`
 * in `ref/micropolis/src/sim/w_piem.c`.
 */
export const PIE_MENU_SUBCOMMAND_TABLE = createPieMenuSubcommandTable(
  createPieMenuSubcommandEntries(),
);

/**
 * Creates the per-widget pie-menu dispatcher bound to one menu state.
 * Mirrors `PieMenuWidgetCmd` subcommand lookup flow in
 * `ref/micropolis/src/sim/w_piem.c`.
 * Difference from C: typed runtime errors replace Tcl string appends.
 */
export function createPieMenuWidgetCommandDispatcher(
  menuState: PieMenuState,
  subcommands: PieMenuSubcommandTable = PIE_MENU_SUBCOMMAND_TABLE,
): ScriptCommandHandler {
  return (argv: readonly string[]): ScriptRuntimeResult => {
    const subcommandName = argv[1];
    if (subcommandName === undefined) {
      return makeInvalidArgCount(
        `${menuState.commandName} command requires a subcommand in argv[1]`,
      );
    }

    const subcommandHandler = subcommands.get(subcommandName);
    if (subcommandHandler === undefined) {
      return makeScriptFailure(
        new ScriptRuntimeError(
          ScriptRuntimeErrorCode.UnknownSubcommand,
          `unknown piemenu subcommand: ${subcommandName}`,
        ),
      );
    }

    return subcommandHandler(menuState, argv);
  };
}

/**
 * Constructor options for `createPieMenuCommandDispatcher`.
 * Mirrors state/command wiring in `Tk_PieMenuCmd` and `PieMenuWidgetCmd`
 * from `ref/micropolis/src/sim/w_piem.c`.
 */
export interface CreatePieMenuCommandDispatcherOptions {
  runtime: ScriptRuntime;
  widgets?: WidgetRegistry<PieMenuState>;
  createMenuState?: (commandName: string) => PieMenuState;
  subcommands?: PieMenuSubcommandTable;
}

/**
 * Creates the top-level `piemenu` factory command dispatcher.
 * Mirrors `Tk_PieMenuCmd` creation flow for `piemenu pathName ?options?`
 * in `ref/micropolis/src/sim/w_piem.c`.
 * Parity note: Tk windowing side effects are omitted; script-visible state is preserved.
 */
export function createPieMenuCommandDispatcher(
  options: CreatePieMenuCommandDispatcherOptions,
): ScriptCommandHandler {
  const widgets = options.widgets ?? new WidgetRegistry<PieMenuState>();
  const createMenuState =
    options.createMenuState ?? ((commandName: string) => createPieMenuState(commandName));
  const subcommands = options.subcommands ?? PIE_MENU_SUBCOMMAND_TABLE;

  return (argv: readonly string[]): ScriptRuntimeResult => {
    const commandName = argv[1];
    if (commandName === undefined || commandName.length === 0) {
      return makeInvalidArgCount('piemenu command requires a pathName in argv[1]');
    }

    if (widgets.get(commandName) !== undefined) {
      return makeScriptFailure(
        new ScriptRuntimeError(
          ScriptRuntimeErrorCode.Internal,
          `piemenu command already exists: ${commandName}`,
        ),
      );
    }

    const menuState = createMenuState(commandName);
    const configureResult = applyPieMenuConfigureOptionPairs(
      menuState,
      argv.slice(2),
      `piemenu ${commandName}`,
    );
    if (configureResult !== null) {
      return configureResult;
    }

    widgets.add(commandName, menuState);
    options.runtime.registerCommand(
      commandName,
      createPieMenuWidgetCommandDispatcher(menuState, subcommands),
    );
    return makeScriptSuccess(commandName);
  };
}

/**
 * Registers the top-level `piemenu` command in a runtime.
 * Mirrors `Tcl_CreateCommand(..., "piemenu", Tk_PieMenuCmd, ...)`
 * in `ref/micropolis/src/sim/w_tk.c`.
 */
export function registerPieMenuCommand(
  runtime: ScriptRuntime,
  options: Omit<CreatePieMenuCommandDispatcherOptions, 'runtime'> = {},
): void {
  runtime.registerCommand(
    'piemenu',
    createPieMenuCommandDispatcher({
      runtime,
      ...options,
    }),
  );
}
