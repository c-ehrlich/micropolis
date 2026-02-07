import { describe, expect, it, vi } from 'vitest';

import { makeScriptSuccess } from '../runtime/errors.ts';
import { ScriptResultCode } from '../runtime/result-code.ts';
import { ScriptRuntime } from '../runtime/script-runtime.ts';
import { createSimScriptingRuntime } from './create-sim-scripting-runtime.ts';

describe('createSimScriptingRuntime', () => {
  it('creates runtime/state from a single bootstrap entrypoint', () => {
    // Mirrors the Tcl bootstrap object graph setup from `tk_main` in
    // `ref/micropolis/src/sim/w_tk.c`, but exposed as one explicit TS API.
    const bundle = createSimScriptingRuntime();

    expect(bundle.runtime).toBeInstanceOf(ScriptRuntime);
    expect(bundle.state.sim).toBeNull();
    expect(bundle.state.views.size).toBe(0);
    expect(bundle.state.sprites.size).toBe(0);
    expect(bundle.state.widgets.size).toBe(0);
    expect(bundle.state.callbacks.size).toBe(0);
  });

  it('runs base command registration hook with bootstrap bundle', () => {
    // Mirrors command init flow where `tk_main` registers command entrypoints
    // (`sim_command_init`, map/editor/etc.) before Tcl command dispatch.
    const registerBaseCommands = vi.fn(
      (
        bundle: ReturnType<typeof createSimScriptingRuntime<{ readonly cityName: string }>>,
      ): void => {
        bundle.runtime.registerCommand('sim', () =>
          makeScriptSuccess(bundle.state.sim?.cityName ?? ''),
        );
      },
    );

    const bundle = createSimScriptingRuntime<{ readonly cityName: string }>({
      sim: { cityName: 'Capitol' },
      registerBaseCommands,
    });

    expect(registerBaseCommands).toHaveBeenCalledOnce();
    expect(registerBaseCommands).toHaveBeenCalledWith(bundle);
    expect(bundle.runtime.invoke(['sim'])).toEqual({
      code: ScriptResultCode.Ok,
      value: 'Capitol',
    });
  });
});
