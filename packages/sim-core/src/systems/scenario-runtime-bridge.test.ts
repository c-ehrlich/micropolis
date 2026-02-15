import { describe, expect, it } from 'vitest';

import { getClassicBuiltinScenarioRuntimeDefinition } from '../../../scenario-runtime/src/index.ts';
import { createSimState } from '../core/sim-state.ts';
import {
  getSimScenarioBehaviorProfile,
  setLegacySimScenarioRuntimeById,
  setSimScenarioRuntimeInputs,
} from './scenario-runtime-bridge.ts';

describe('scenario runtime behavior profile bridge', () => {
  it('maps legacy scenario id 2 to SF ship-honk behavior profile', () => {
    /**
     * Magic number source:
     * - Scenario id `2` is San Francisco in `LoadScenario(short s)` from
     *   `ref/micropolis/src/sim/s_fileio.c`.
     * - `DoShipSprite` special-cases `ScenarioID == 2` in
     *   `ref/micropolis/src/sim/w_sprite.c`.
     */
    const state = createSimState();
    setLegacySimScenarioRuntimeById(state, 2);

    const profile = getSimScenarioBehaviorProfile(state);
    expect(profile.key).toBe('classic/sf-ship-honk');
    expect(profile.realtime.shipHonkBehavior).toBe('legacy-sf-low-speed');
  });

  it('honors explicit behavior profile keys for declarative runtime inputs', () => {
    const runtimeDefinition = getClassicBuiltinScenarioRuntimeDefinition('builtin/dullsville');
    if (runtimeDefinition === undefined) {
      throw new Error('missing builtin/dullsville runtime definition');
    }

    const state = createSimState();
    setSimScenarioRuntimeInputs(state, {
      runtimeDefinition,
      behaviorProfileKey: 'classic/sf-ship-honk',
    });

    expect(getSimScenarioBehaviorProfile(state).key).toBe('classic/sf-ship-honk');
  });

  it('falls back to the default behavior profile when runtime state is absent', () => {
    const state = createSimState();
    expect(getSimScenarioBehaviorProfile(state).key).toBe('classic/default');
    expect(getSimScenarioBehaviorProfile(state).realtime.shipHonkBehavior).toBe('default');
  });
});
