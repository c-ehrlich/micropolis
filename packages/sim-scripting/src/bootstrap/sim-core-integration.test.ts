import { describe, expect, it } from 'vitest';

import { createSimContext, createSimState, runSimLoop } from '../../../sim-core/src/index.ts';
import {
  createSimKickState,
  createSimSessionControlSubcommandEntries,
  createSimSpeedDelayControlState,
  createSimSpeedDelayControlSubcommandEntries,
  createSimSubcommandTable,
  registerSimCommand,
} from '../commands/sim-command.ts';
import { ScriptResultCode } from '../runtime/result-code.ts';
import { ScriptRuntime } from '../runtime/script-runtime.ts';

function registerSimCoreBridgedSim(runtime: ScriptRuntime) {
  const simState = createSimState();
  const mapScanPhases: number[] = [];
  const calls: string[] = [];
  const context = createSimContext({
    hooks: {
      moveObjects: () => {
        calls.push('moveObjects');
      },
    },
  });
  const speedState = createSimSpeedDelayControlState({
    simMetaSpeed: simState.SimSpeed,
    simSpeed: simState.SimSpeed,
  });

  registerSimCommand(
    runtime,
    createSimSubcommandTable([
      ...createSimSpeedDelayControlSubcommandEntries({
        state: speedState,
        kickState: createSimKickState(),
        kickHooks: {
          onKick: () => {
            // Glue parity: scripting `setSpeed` state feeds sim-core `SimSpeed`.
            simState.SimMetaSpeed = speedState.simMetaSpeed;
            simState.SimSpeed = speedState.simSpeed;
          },
        },
      }),
      ...createSimSessionControlSubcommandEntries({
        hooks: {
          onUpdate: () => {
            context.store.beginTick();
            try {
              runSimLoop(simState, context, {
                mapScan: (phase) => {
                  mapScanPhases.push(phase);
                },
              });
            } finally {
              context.store.commitTick();
            }
          },
        },
      }),
    ]),
  );

  return {
    calls,
    mapScanPhases,
    simState,
  };
}

describe('sim scripting to sim-core integration', () => {
  it('drives a representative sim-core update cycle from `sim Update`', () => {
    const runtime = new ScriptRuntime();
    const integration = registerSimCoreBridgedSim(runtime);

    expect(runtime.invoke(['sim', 'Update'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '',
    });

    // `runSimFrame` increments `Fcycle` then dispatches `phase = Fcycle & 15`
    // (`sim.c` loop semantics mirrored in `sim-core/src/sim/simulate.ts`).
    expect(integration.simState.Fcycle).toBe(1);
    expect(integration.mapScanPhases).toEqual([1]);
    expect(integration.calls).toEqual(['moveObjects']);

    expect(runtime.invoke(['sim', 'Speed', '0'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '0',
    });
    expect(runtime.invoke(['sim', 'Update'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '',
    });

    expect(integration.simState.Fcycle).toBe(1);
    expect(integration.calls).toEqual(['moveObjects']);
  });

  it('drives the sim-core heat-path cycle through scripting update hooks', () => {
    const runtime = new ScriptRuntime();
    const integration = registerSimCoreBridgedSim(runtime);

    integration.simState.HeatSteps = 2;

    expect(runtime.invoke(['sim', 'Update'])).toEqual({
      code: ScriptResultCode.Ok,
      value: '',
    });

    // `sim_loop` heat path in `ref/micropolis/src/sim/sim.c` sets `NewMap = 1`
    // and still runs `moveObjects()` once.
    expect(integration.simState.NewMap).toBe(1);
    expect(integration.calls).toEqual(['moveObjects']);
    expect(integration.mapScanPhases).toEqual([]);
  });
});
