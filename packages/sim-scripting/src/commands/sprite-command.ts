import {
  makeScriptFailure,
  makeScriptSuccess,
  ScriptRuntimeError,
  ScriptRuntimeErrorCode,
} from '../runtime/errors.ts';
import type { ScriptRuntimeResult } from '../runtime/result-code.ts';
import type { ScriptCommandHandler, ScriptRuntime } from '../runtime/script-runtime.ts';
import { SpriteRegistry } from '../state/sprite-registry.ts';

const TCL_INT32_MIN = -2147483648n;
const TCL_INT32_MAX = 2147483647n;
const SPRITE_TYPE_MIN = 1;
const SPRITE_TYPE_MAX = 8;
const DEFAULT_SPRITE_FRAME = 0;

/**
 * Mutable state for one created sprite command.
 * Mirrors sprite command-visible fields initialized by `SpriteCmd`/`NewSprite`
 * in `ref/micropolis/src/sim/w_sprite.c`.
 * Parity note: creation sets `frame = 0` to keep the sprite invisible until
 * later `Init` (implemented in `P3.4`), matching C behavior.
 */
export interface SpriteState {
  commandName: string;
  name: string;
  type: number;
  frame: number;
}

/**
 * Constructor overrides for `createSpriteState`.
 * Mirrors creation-time defaults set by `SpriteCmd` in
 * `ref/micropolis/src/sim/w_sprite.c`.
 */
export interface CreateSpriteStateOptions {
  frame?: number;
}

/**
 * Handler signature for `<spriteName> <Subcommand> ...`.
 * Mirrors `SpriteCmd*` function pointer dispatch through `SpriteCmds`
 * by `DoSpriteCmd` in `ref/micropolis/src/sim/w_sprite.c`.
 */
export type SpriteSubcommandHandler = (
  spriteState: SpriteState,
  argv: readonly string[],
) => ScriptRuntimeResult;

/**
 * Case-sensitive sprite subcommand table.
 * Mirrors `Tcl_HashTable SpriteCmds` lookup behavior in `DoSpriteCmd`
 * (`ref/micropolis/src/sim/w_sprite.c`).
 */
export type SpriteSubcommandTable = ReadonlyMap<string, SpriteSubcommandHandler>;

/**
 * One sprite subcommand registration tuple.
 * Mirrors one `SPRITE_CMD(name)` hash insertion in `sprite_command_init`
 * (`ref/micropolis/src/sim/w_sprite.c`).
 */
export type SpriteSubcommandEntry = readonly [name: string, handler: SpriteSubcommandHandler];

/**
 * Parses a Tcl-style integer and enforces 32-bit C `int` range.
 * Mirrors `Tcl_GetInt` usage in `SpriteCmd` from
 * `ref/micropolis/src/sim/w_sprite.c`.
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
 * Mirrors `TCL_ERROR` returns from `SpriteCmd`/`DoSpriteCmd` when argc is invalid
 * in `ref/micropolis/src/sim/w_sprite.c`.
 */
function makeInvalidArgCount(message: string): ScriptRuntimeResult {
  return makeScriptFailure(new ScriptRuntimeError(ScriptRuntimeErrorCode.InvalidArgCount, message));
}

/**
 * Creates a typed invalid-integer runtime result.
 * Mirrors `Tcl_GetInt(...) != TCL_OK` failures in `SpriteCmd`
 * (`ref/micropolis/src/sim/w_sprite.c`).
 */
function makeInvalidInteger(message: string): ScriptRuntimeResult {
  return makeScriptFailure(new ScriptRuntimeError(ScriptRuntimeErrorCode.InvalidInteger, message));
}

/**
 * Creates mutable state backing one sprite command.
 * Mirrors `SpriteCmd` + `NewSprite` initialization in
 * `ref/micropolis/src/sim/w_sprite.c`.
 */
export function createSpriteState(
  commandName: string,
  type: number,
  options: CreateSpriteStateOptions = {},
): SpriteState {
  return {
    commandName,
    name: commandName,
    type,
    frame: options.frame ?? DEFAULT_SPRITE_FRAME,
  };
}

/**
 * Builds sprite subcommand entries for the P3.3 dispatcher scaffold.
 * Mirrors `SPRITE_CMD(...)` table wiring in `sprite_command_init`
 * (`ref/micropolis/src/sim/w_sprite.c`).
 * Difference from C: this phase intentionally returns no field handlers; those
 * are added in `P3.4`.
 */
export function createSpriteSubcommandEntries(): readonly SpriteSubcommandEntry[] {
  return [];
}

/**
 * Builds a case-sensitive sprite subcommand lookup table.
 * Mirrors `Tcl_HashTable SpriteCmds` registration behavior in
 * `sprite_command_init`/`DoSpriteCmd` (`ref/micropolis/src/sim/w_sprite.c`).
 * Parity note: duplicate names use last-registration-wins map semantics.
 */
export function createSpriteSubcommandTable(
  entries: readonly SpriteSubcommandEntry[] = [],
): SpriteSubcommandTable {
  const table = new Map<string, SpriteSubcommandHandler>();

  for (const [name, handler] of entries) {
    table.set(name, handler);
  }

  return table;
}

/**
 * Default sprite subcommand table for P3.3 dispatch wiring.
 * Mirrors the existence of `SpriteCmds` in `sprite_command_init`
 * (`ref/micropolis/src/sim/w_sprite.c`) before accessors are fully ported.
 */
export const SPRITE_SUBCOMMAND_TABLE = createSpriteSubcommandTable(createSpriteSubcommandEntries());

/**
 * Creates the per-sprite command dispatcher bound to one sprite state.
 * Mirrors `DoSpriteCmd` subcommand lookup flow in `ref/micropolis/src/sim/w_sprite.c`.
 * Difference from C: errors are typed instead of Tcl string append side effects.
 */
export function createSpriteWidgetCommandDispatcher(
  spriteState: SpriteState,
  subcommands: SpriteSubcommandTable = SPRITE_SUBCOMMAND_TABLE,
): ScriptCommandHandler {
  return (argv: readonly string[]): ScriptRuntimeResult => {
    const subcommandName = argv[1];
    if (subcommandName === undefined) {
      return makeInvalidArgCount(
        `${spriteState.commandName} command requires a subcommand in argv[1]`,
      );
    }

    const subcommandHandler = subcommands.get(subcommandName);
    if (subcommandHandler === undefined) {
      return makeScriptFailure(
        new ScriptRuntimeError(
          ScriptRuntimeErrorCode.UnknownSubcommand,
          `unknown sprite subcommand: ${subcommandName}`,
        ),
      );
    }

    return subcommandHandler(spriteState, argv);
  };
}

/**
 * Constructor options for `createSpriteCommandDispatcher`.
 * Mirrors state/command wiring around `SpriteCmd` + `DoSpriteCmd`
 * in `ref/micropolis/src/sim/w_sprite.c`.
 */
export interface CreateSpriteCommandDispatcherOptions {
  runtime: ScriptRuntime;
  sprites?: SpriteRegistry<SpriteState>;
  createSpriteState?: (commandName: string, type: number) => SpriteState;
  subcommands?: SpriteSubcommandTable;
}

/**
 * Creates the top-level `sprite` factory command dispatcher.
 * Mirrors `SpriteCmd` creation flow for `sprite <name> <type>` in
 * `ref/micropolis/src/sim/w_sprite.c`.
 * Parity note: type validation enforces `1..OBJN-1` (`OBJN=9` in `sim.h`).
 * Difference from C: duplicate sprite names return a typed internal error
 * rather than replacing an existing Tcl command.
 */
export function createSpriteCommandDispatcher(
  options: CreateSpriteCommandDispatcherOptions,
): ScriptCommandHandler {
  const sprites = options.sprites ?? new SpriteRegistry<SpriteState>();
  const createState =
    options.createSpriteState ??
    ((commandName: string, type: number) => createSpriteState(commandName, type));
  const subcommands = options.subcommands ?? SPRITE_SUBCOMMAND_TABLE;

  return (argv: readonly string[]): ScriptRuntimeResult => {
    if (argv.length !== 3) {
      return makeInvalidArgCount(`sprite command expects argc 3, got ${argv.length}`);
    }

    const commandName = argv[1];
    const rawType = argv[2];
    if (commandName === undefined || rawType === undefined) {
      return makeInvalidArgCount('sprite command requires <name> and <type>');
    }

    const parsedType = parseTclInt32(rawType);
    if (parsedType === null || parsedType < SPRITE_TYPE_MIN || parsedType > SPRITE_TYPE_MAX) {
      return makeInvalidInteger(
        `sprite command expected an integer type in range ${SPRITE_TYPE_MIN}..${SPRITE_TYPE_MAX}: ${rawType}`,
      );
    }

    if (sprites.get(commandName) !== undefined) {
      return makeScriptFailure(
        new ScriptRuntimeError(
          ScriptRuntimeErrorCode.Internal,
          `sprite command already exists: ${commandName}`,
        ),
      );
    }

    const spriteState = createState(commandName, parsedType);
    sprites.add(commandName, spriteState);
    options.runtime.registerCommand(
      commandName,
      createSpriteWidgetCommandDispatcher(spriteState, subcommands),
    );
    return makeScriptSuccess(commandName);
  };
}

/**
 * Registers the top-level `sprite` command in a runtime.
 * Mirrors `Tcl_CreateCommand(..., "sprite", SpriteCmd, ...)`
 * in `sprite_command_init` (`ref/micropolis/src/sim/w_sprite.c`).
 */
export function registerSpriteCommand(
  runtime: ScriptRuntime,
  options: Omit<CreateSpriteCommandDispatcherOptions, 'runtime'> = {},
): void {
  runtime.registerCommand(
    'sprite',
    createSpriteCommandDispatcher({
      runtime,
      ...options,
    }),
  );
}
