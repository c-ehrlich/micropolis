import { describe, expect, it } from 'vitest';

import { makeScriptSuccess } from '../runtime/errors.ts';
import { ScriptResultCode } from '../runtime/result-code.ts';
import { ScriptRuntime } from '../runtime/script-runtime.ts';
import { createScriptingState } from '../state/scripting-state.ts';
import {
  createUiCallbackDispatcher,
  dispatchDoStopMicropolis,
  dispatchUiCallback,
  dispatchUiDidLoadCity,
  dispatchUiDidLoadScenario,
  dispatchUiDidntLoadCity,
  dispatchUiDidntSaveCity,
  dispatchUiDidSaveCity,
  dispatchUiNewGame,
  dispatchUiPlayNewCity,
  dispatchUiReallyStartGame,
  dispatchUiSaveCityAs,
  dispatchUiSetBudget,
  dispatchUiSetBudgetValues,
  dispatchUiSetCityName,
  dispatchUiSetDate,
  dispatchUiSetDemand,
  dispatchUiSetEvaluation,
  dispatchUiSetFunds,
  dispatchUiSetGameLevel,
  dispatchUiSetMapState,
  dispatchUiSetOptions,
  dispatchUiSetSpeed,
  dispatchUiShowBudgetAndWait,
  dispatchUiStartLoad,
  dispatchUiStartMicropolis,
  dispatchUiStartScenario,
  dispatchUiUpdateBudget,
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

describe('ui startup/lifecycle callback helpers', () => {
  it('dispatches UIStartMicropolis with homedir/resourcedir/hostname argv order', () => {
    const runtime = new ScriptRuntime();
    let capturedArgv: readonly string[] = [];
    runtime.registerCommand('::ui::startMicropolis', (argv) => {
      capturedArgv = argv;
      return makeScriptSuccess('ok');
    });

    const state = createScriptingState();
    registerUiCallback(state, 'UIStartMicropolis', '::ui::startMicropolis');
    const dispatch = createUiCallbackDispatcher({ runtime, state });

    expect(
      dispatchUiStartMicropolis(
        dispatch,
        '/Users/cje',
        '/Users/cje/dev/city/ref/micropolis/res',
        'host.local',
      ),
    ).toEqual({
      code: ScriptResultCode.Ok,
      value: 'ok',
    });

    expect(capturedArgv).toEqual([
      '::ui::startMicropolis',
      '/Users/cje',
      '/Users/cje/dev/city/ref/micropolis/res',
      'host.local',
    ]);
  });

  it('dispatches lifecycle callbacks that take no argv values', () => {
    const runtime = new ScriptRuntime();
    const observedArgv: string[][] = [];
    const callbackEntries: Array<readonly [string, string]> = [
      ['UIPlayNewCity', '::ui::playNewCity'],
      ['UIReallyStartGame', '::ui::reallyStartGame'],
      ['UIStartLoad', '::ui::startLoad'],
      ['UINewGame', '::ui::newGame'],
      ['DoStopMicropolis', '::ui::stopMicropolis'],
    ];

    for (const [, reference] of callbackEntries) {
      runtime.registerCommand(reference, (argv) => {
        observedArgv.push([...argv]);
        return makeScriptSuccess(reference);
      });
    }

    const state = createScriptingState({
      callbackEntries,
    });
    const dispatch = createUiCallbackDispatcher({ runtime, state });

    expect(dispatchUiPlayNewCity(dispatch)).toEqual({
      code: ScriptResultCode.Ok,
      value: '::ui::playNewCity',
    });
    expect(dispatchUiReallyStartGame(dispatch)).toEqual({
      code: ScriptResultCode.Ok,
      value: '::ui::reallyStartGame',
    });
    expect(dispatchUiStartLoad(dispatch)).toEqual({
      code: ScriptResultCode.Ok,
      value: '::ui::startLoad',
    });
    expect(dispatchUiNewGame(dispatch)).toEqual({
      code: ScriptResultCode.Ok,
      value: '::ui::newGame',
    });
    expect(dispatchDoStopMicropolis(dispatch)).toEqual({
      code: ScriptResultCode.Ok,
      value: '::ui::stopMicropolis',
    });

    expect(observedArgv).toEqual([
      ['::ui::playNewCity'],
      ['::ui::reallyStartGame'],
      ['::ui::startLoad'],
      ['::ui::newGame'],
      ['::ui::stopMicropolis'],
    ]);
  });

  it('formats UIStartScenario id like C sprintf with %d integer coercion', () => {
    // `DoStartScenario` builds `UIStartScenario %d` in
    // `ref/micropolis/src/sim/w_stubs.c`, so the emitted Tcl argument is a
    // base-10 signed integer string.
    const runtime = new ScriptRuntime();
    let capturedArgv: readonly string[] = [];
    runtime.registerCommand('UIStartScenario', (argv) => {
      capturedArgv = argv;
      return makeScriptSuccess(argv[1] ?? '');
    });

    const state = createScriptingState();
    const dispatch = createUiCallbackDispatcher({ runtime, state });

    expect(dispatchUiStartScenario(dispatch, 12.9)).toEqual({
      code: ScriptResultCode.Ok,
      value: '12',
    });
    expect(capturedArgv).toEqual(['UIStartScenario', '12']);
  });
});

describe('ui file i/o callback helpers', () => {
  it('dispatches save/load/scenario success callbacks with deterministic callback names', () => {
    // Mirrors success-side `Eval("UISaveCityAs")`, `Eval("UIDidSaveCity")`,
    // `Eval("UIDidLoadCity")`, and `Eval("UIDidLoadScenario")` in
    // `ref/micropolis/src/sim/s_fileio.c`.
    const runtime = new ScriptRuntime();
    const observedArgv: string[][] = [];
    const callbackEntries: Array<readonly [string, string]> = [
      ['UISaveCityAs', '::ui::saveCityAs'],
      ['UIDidSaveCity', '::ui::didSaveCity'],
      ['UIDidLoadCity', '::ui::didLoadCity'],
      ['UIDidLoadScenario', '::ui::didLoadScenario'],
    ];

    for (const [, reference] of callbackEntries) {
      runtime.registerCommand(reference, (argv) => {
        observedArgv.push([...argv]);
        return makeScriptSuccess(reference);
      });
    }

    const state = createScriptingState({
      callbackEntries,
    });
    const dispatch = createUiCallbackDispatcher({ runtime, state });

    expect(dispatchUiSaveCityAs(dispatch)).toEqual({
      code: ScriptResultCode.Ok,
      value: '::ui::saveCityAs',
    });
    expect(dispatchUiDidSaveCity(dispatch)).toEqual({
      code: ScriptResultCode.Ok,
      value: '::ui::didSaveCity',
    });
    expect(dispatchUiDidLoadCity(dispatch)).toEqual({
      code: ScriptResultCode.Ok,
      value: '::ui::didLoadCity',
    });
    expect(dispatchUiDidLoadScenario(dispatch)).toEqual({
      code: ScriptResultCode.Ok,
      value: '::ui::didLoadScenario',
    });

    expect(observedArgv).toEqual([
      ['::ui::saveCityAs'],
      ['::ui::didSaveCity'],
      ['::ui::didLoadCity'],
      ['::ui::didLoadScenario'],
    ]);
  });

  it('dispatches save/load failure callbacks with one message argument', () => {
    // Mirrors failure-side `sprintf(... "{%s}")` + `Eval(buf)` in
    // `DidntSaveCity` and `DidntLoadCity` at `ref/micropolis/src/sim/s_fileio.c`.
    const runtime = new ScriptRuntime();
    const observedArgv: string[][] = [];
    const callbackEntries: Array<readonly [string, string]> = [
      ['UIDidntSaveCity', '::ui::didntSaveCity'],
      ['UIDidntLoadCity', '::ui::didntLoadCity'],
    ];

    for (const [, reference] of callbackEntries) {
      runtime.registerCommand(reference, (argv) => {
        observedArgv.push([...argv]);
        return makeScriptSuccess(reference);
      });
    }

    const state = createScriptingState({
      callbackEntries,
    });
    const dispatch = createUiCallbackDispatcher({ runtime, state });

    expect(dispatchUiDidntSaveCity(dispatch, 'Unable to save city.')).toEqual({
      code: ScriptResultCode.Ok,
      value: '::ui::didntSaveCity',
    });
    expect(dispatchUiDidntLoadCity(dispatch, 'Unable to load city.')).toEqual({
      code: ScriptResultCode.Ok,
      value: '::ui::didntLoadCity',
    });

    expect(observedArgv).toEqual([
      ['::ui::didntSaveCity', 'Unable to save city.'],
      ['::ui::didntLoadCity', 'Unable to load city.'],
    ]);
  });
});

describe('ui status/budget/evaluation callback helpers', () => {
  it('dispatches simulation status callbacks with C argument shaping and order', () => {
    // Mirrors `UISet*` emissions in `ref/micropolis/src/sim/w_update.c` and
    // `ref/micropolis/src/sim/w_util.c`, including `(int)(valve/100)` demand
    // scaling and bitfield expansion in `UpdateOptionsMenu`.
    const runtime = new ScriptRuntime();
    const observedArgv: string[][] = [];
    const callbackEntries: Array<readonly [string, string]> = [
      ['UISetFunds', '::ui::setFunds'],
      ['UISetDate', '::ui::setDate'],
      ['UISetDemand', '::ui::setDemand'],
      ['UISetOptions', '::ui::setOptions'],
      ['UISetSpeed', '::ui::setSpeed'],
      ['UISetGameLevel', '::ui::setGameLevel'],
      ['UISetCityName', '::ui::setCityName'],
      ['UISetMapState', '::ui::setMapState'],
    ];

    for (const [, reference] of callbackEntries) {
      runtime.registerCommand(reference, (argv) => {
        observedArgv.push([...argv]);
        return makeScriptSuccess(reference);
      });
    }

    const state = createScriptingState({
      callbackEntries,
    });
    const dispatch = createUiCallbackDispatcher({ runtime, state });

    dispatchUiSetFunds(dispatch, 'Funds: $1,234');
    dispatchUiSetDate(dispatch, 'Apr 2050', 3.9, 2050.2);
    dispatchUiSetDemand(dispatch, 1299, -2501, 3000);
    dispatchUiSetOptions(dispatch, 213.8);
    dispatchUiSetSpeed(dispatch, 3.7);
    dispatchUiSetGameLevel(dispatch, 2.9);
    dispatchUiSetCityName(dispatch, 'Mega City');
    dispatchUiSetMapState(dispatch, '.map0', 14.1);

    expect(observedArgv).toEqual([
      ['::ui::setFunds', 'Funds: $1,234'],
      ['::ui::setDate', 'Apr 2050', '3', '2050'],
      ['::ui::setDemand', '12', '-25', '30'],
      ['::ui::setOptions', '1', '0', '1', '0', '1', '0', '1', '1'],
      ['::ui::setSpeed', '3'],
      ['::ui::setGameLevel', '2'],
      ['::ui::setCityName', 'Mega City'],
      ['::ui::setMapState', '.map0', '14'],
    ]);
  });

  it('dispatches budget and evaluation callbacks with C callback argv order', () => {
    // Mirrors callback order from `SetBudget`, `SetBudgetValues`, and
    // `SetEvaluation` in `ref/micropolis/src/sim/w_budget.c` and `w_eval.c`.
    // "Magic" percent values are C-style `(int)(percent * 100)` outputs.
    const runtime = new ScriptRuntime();
    const observedArgv: string[][] = [];
    const callbackEntries: Array<readonly [string, string]> = [
      ['UIShowBudgetAndWait', '::ui::showBudgetAndWait'],
      ['UIUpdateBudget', '::ui::updateBudget'],
      ['UISetBudget', '::ui::setBudget'],
      ['UISetBudgetValues', '::ui::setBudgetValues'],
      ['UISetEvaluation', '::ui::setEvaluation'],
    ];

    for (const [, reference] of callbackEntries) {
      runtime.registerCommand(reference, (argv) => {
        observedArgv.push([...argv]);
        return makeScriptSuccess(reference);
      });
    }

    const state = createScriptingState({
      callbackEntries,
    });
    const dispatch = createUiCallbackDispatcher({ runtime, state });

    dispatchUiShowBudgetAndWait(dispatch);
    dispatchUiUpdateBudget(dispatch);
    dispatchUiSetBudget(dispatch, '$200', '$100', '$300', '$150', 9.8);
    dispatchUiSetBudgetValues(
      dispatch,
      '$75',
      '$100',
      75.9,
      '$43',
      '$90',
      48.2,
      '$22',
      '$80',
      27.9,
    );
    dispatchUiSetEvaluation(
      dispatch,
      '1',
      '500',
      'Crime',
      'Pollution',
      'Traffic',
      'Taxes',
      '120',
      '90',
      '80',
      '20',
      '12345',
      '50',
      '$999,000',
      'City',
      'Easy',
      '42%',
      '58%',
      'Mayor Report',
    );

    expect(observedArgv).toEqual([
      ['::ui::showBudgetAndWait'],
      ['::ui::updateBudget'],
      ['::ui::setBudget', '$200', '$100', '$300', '$150', '9'],
      ['::ui::setBudgetValues', '$75', '$100', '75', '$43', '$90', '48', '$22', '$80', '27'],
      [
        '::ui::setEvaluation',
        '1',
        '500',
        'Crime',
        'Pollution',
        'Traffic',
        'Taxes',
        '120',
        '90',
        '80',
        '20',
        '12345',
        '50',
        '$999,000',
        'City',
        'Easy',
        '42%',
        '58%',
        'Mayor Report',
      ],
    ]);
  });
});
