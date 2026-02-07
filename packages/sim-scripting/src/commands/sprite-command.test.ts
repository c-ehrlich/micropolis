import { describe, expect, it } from 'vitest';

import { makeScriptSuccess, ScriptRuntimeErrorCode } from '../runtime/errors.ts';
import { ScriptResultCode } from '../runtime/result-code.ts';
import { ScriptRuntime } from '../runtime/script-runtime.ts';
import { SpriteRegistry } from '../state/sprite-registry.ts';
import {
  createSpriteCommandDispatcher,
  createSpriteState,
  createSpriteSubcommandTable,
  createSpriteWidgetCommandDispatcher,
  registerSpriteCommand,
  type SpriteState,
} from './sprite-command.ts';

describe('sprite top-level command shell', () => {
  it('creates a named sprite command and registers it for dispatch', () => {
    const runtime = new ScriptRuntime();
    const sprites = new SpriteRegistry<SpriteState>();
    registerSpriteCommand(runtime, {
      sprites,
    });

    expect(runtime.invoke(['sprite', 'godzilla', '5'])).toEqual({
      code: ScriptResultCode.Ok,
      value: 'godzilla',
    });

    const created = sprites.get('godzilla');
    expect(created).toBeDefined();
    if (created === undefined) {
      throw new Error('expected sprite state to be registered');
    }

    // `SpriteCmd` calls `NewSprite(argv[1], type, 0, 0)` and then sets
    // `sprite->frame = 0` in `ref/micropolis/src/sim/w_sprite.c`.
    expect(created.name).toBe('godzilla');
    expect(created.type).toBe(5);
    expect(created.frame).toBe(0);

    expect(runtime.invoke(['godzilla', 'Init'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.UnknownSubcommand,
      message: 'unknown sprite subcommand: Init',
    });
  });

  it('matches SpriteCmd argc and type validation rules', () => {
    const runtime = new ScriptRuntime();
    const dispatcher = createSpriteCommandDispatcher({ runtime });

    expect(dispatcher(['sprite', 'godzilla'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.InvalidArgCount,
      message: 'sprite command expects argc 3, got 2',
    });

    expect(dispatcher(['sprite', 'godzilla', 'abc'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.InvalidInteger,
      message: 'sprite command expected an integer type in range 1..8: abc',
    });

    // `OBJN` is `9` in `ref/micropolis/src/sim/headers/sim.h`, so
    // `SpriteCmd` accepts only `1..OBJN-1` => `1..8`.
    expect(dispatcher(['sprite', 'godzilla', '0'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.InvalidInteger,
      message: 'sprite command expected an integer type in range 1..8: 0',
    });

    expect(dispatcher(['sprite', 'godzilla', '9'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.InvalidInteger,
      message: 'sprite command expected an integer type in range 1..8: 9',
    });

    // `SpriteCmd` uses `Tcl_GetInt`, so hex and leading-zero octal forms are valid.
    expect(dispatcher(['sprite', 'train', '0x1'])).toEqual({
      code: ScriptResultCode.Ok,
      value: 'train',
    });
    expect(dispatcher(['sprite', 'bus', '010'])).toEqual({
      code: ScriptResultCode.Ok,
      value: 'bus',
    });
  });

  it('returns a typed internal error for duplicate sprite command names', () => {
    const runtime = new ScriptRuntime();
    const dispatcher = createSpriteCommandDispatcher({ runtime });

    expect(dispatcher(['sprite', 'copter', '2'])).toEqual({
      code: ScriptResultCode.Ok,
      value: 'copter',
    });

    expect(dispatcher(['sprite', 'copter', '2'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.Internal,
      message: 'sprite command already exists: copter',
    });
  });
});

describe('sprite widget command shell', () => {
  it('dispatches sprite subcommands with case-sensitive lookup', () => {
    const spriteState = createSpriteState('copter', 2);
    const dispatcher = createSpriteWidgetCommandDispatcher(
      spriteState,
      createSpriteSubcommandTable([
        ['ping', () => makeScriptSuccess('pong')],
        ['status', (sprite) => makeScriptSuccess(`${sprite.name}:${sprite.type}`)],
      ]),
    );

    expect(dispatcher(['copter', 'ping'])).toEqual({
      code: ScriptResultCode.Ok,
      value: 'pong',
    });
    expect(dispatcher(['copter', 'status'])).toEqual({
      code: ScriptResultCode.Ok,
      value: 'copter:2',
    });

    expect(dispatcher(['copter'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.InvalidArgCount,
      message: 'copter command requires a subcommand in argv[1]',
    });

    expect(dispatcher(['copter', 'Ping'])).toEqual({
      code: ScriptResultCode.Error,
      errorCode: ScriptRuntimeErrorCode.UnknownSubcommand,
      message: 'unknown sprite subcommand: Ping',
    });
  });

  it('uses last-entry-wins semantics for duplicate subcommand registrations', () => {
    const spriteState = createSpriteState('bus', 8);
    const dispatcher = createSpriteWidgetCommandDispatcher(
      spriteState,
      createSpriteSubcommandTable([
        ['mode', () => makeScriptSuccess('old')],
        ['mode', () => makeScriptSuccess('new')],
      ]),
    );

    expect(dispatcher(['bus', 'mode'])).toEqual({
      code: ScriptResultCode.Ok,
      value: 'new',
    });
  });
});
