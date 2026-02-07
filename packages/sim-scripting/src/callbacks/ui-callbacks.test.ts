import { describe, expect, it } from 'vitest';

import { makeScriptSuccess } from '../runtime/errors.ts';
import { ScriptResultCode } from '../runtime/result-code.ts';
import { ScriptRuntime } from '../runtime/script-runtime.ts';
import { createScriptingState } from '../state/scripting-state.ts';
import {
  createUiCallbackDispatcher,
  dispatchUiCallback,
  registerUiCallback,
  registerUiCallbacks,
} from './ui-callbacks.ts';

describe('ui callback dispatcher and registration', () => {
  it('registers callback references and dispatches by callback name', () => {
    // Mirrors C callback emission like `UISetFunds {...}` in
    // `ref/micropolis/src/sim/w_update.c`, but remapped through state.
    const runtime = new ScriptRuntime();
    runtime.registerCommand('::ui::setFunds', (argv) => makeScriptSuccess(argv.slice(1).join(',')));

    const state = createScriptingState();
    registerUiCallback(state, 'UISetFunds', '::ui::setFunds');

    expect(dispatchUiCallback({ runtime, state }, 'UISetFunds', ['1500'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '1500',
    });
  });

  it('uses last registration when a callback mapping is overridden', () => {
    // Mirrors later-definition-wins behavior from Tcl script loading order
    // driven by `source` in `ref/micropolis/src/sim/w_tk.c`.
    const runtime = new ScriptRuntime();
    runtime.registerCommand('::ui::first', () => makeScriptSuccess('first'));
    runtime.registerCommand('::ui::second', () => makeScriptSuccess('second'));

    const state = createScriptingState();
    registerUiCallback(state, 'UIPlayNewCity', '::ui::first');
    registerUiCallback(state, 'UIPlayNewCity', '::ui::second');

    expect(dispatchUiCallback({ runtime, state }, 'UIPlayNewCity')).toEqual({
      code: ScriptResultCode.Ok,
      value: 'second',
    });
  });

  it('invokes callbackName directly when no remap is registered', () => {
    // Mirrors direct `Eval("UIStartMicropolis ...")` procedure invocation in
    // `ref/micropolis/src/sim/w_tk.c` when no aliasing layer exists.
    const runtime = new ScriptRuntime();
    runtime.registerCommand('UIStartMicropolis', (argv) =>
      makeScriptSuccess(argv.slice(1).join(' ')),
    );

    const state = createScriptingState();
    const dispatch = createUiCallbackDispatcher({ runtime, state });

    expect(dispatch('UIStartMicropolis', ['/home', '/resource', 'localhost'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '/home /resource localhost',
    });
  });

  it('registers multiple callback mappings from iterable entries', () => {
    const runtime = new ScriptRuntime();
    runtime.registerCommand('::ui::setDate', (argv) => makeScriptSuccess(argv.slice(1).join('|')));

    const state = createScriptingState();
    registerUiCallbacks(state, [
      ['UISetFunds', '::ui::setFunds'],
      ['UISetDate', '::ui::setDate'],
    ]);

    const dispatch = createUiCallbackDispatcher({ runtime, state });

    expect(dispatch('UISetDate', ['Apr 1900', '3', '1900'])).toEqual({
      code: ScriptResultCode.Ok,
      value: 'Apr 1900|3|1900',
    });
  });
});
