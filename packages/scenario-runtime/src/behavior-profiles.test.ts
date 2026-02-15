import { describe, expect, it } from 'vitest';

import {
  classicScenarioBehaviorProfileKeyForLegacyId,
  getClassicScenarioBehaviorProfileByLegacyId,
  getClassicScenarioBehaviorProfileByScenarioKey,
  getDefaultScenarioBehaviorProfile,
  getScenarioBehaviorProfile,
  SCENARIO_BEHAVIOR_PROFILES,
} from './behavior-profiles.ts';

describe('scenario behavior profile registry', () => {
  it('exposes a closed profile registry', () => {
    expect(SCENARIO_BEHAVIOR_PROFILES.map((profile) => profile.key)).toEqual([
      'classic/default',
      'classic/sf-ship-honk',
    ]);
  });

  it('maps classic legacy ids with SF ship-honk parity', () => {
    /**
     * Magic number source:
     * - Scenario id `2` is San Francisco in `LoadScenario(short s)` from
     *   `ref/micropolis/src/sim/s_fileio.c`.
     * - `DoShipSprite` applies the special ship honk branch only for
     *   `ScenarioID == 2` in `ref/micropolis/src/sim/w_sprite.c`.
     */
    expect(classicScenarioBehaviorProfileKeyForLegacyId(2)).toBe('classic/sf-ship-honk');
    expect(getClassicScenarioBehaviorProfileByLegacyId(2)?.realtime.shipHonkBehavior).toBe(
      'legacy-sf-low-speed',
    );

    expect(classicScenarioBehaviorProfileKeyForLegacyId(1)).toBe('classic/default');
    expect(classicScenarioBehaviorProfileKeyForLegacyId(8)).toBe('classic/default');
    expect(classicScenarioBehaviorProfileKeyForLegacyId(0)).toBeUndefined();
    expect(classicScenarioBehaviorProfileKeyForLegacyId(9)).toBeUndefined();
  });

  it('maps classic builtin/* keys and keeps unknown-key lookup closed', () => {
    expect(getClassicScenarioBehaviorProfileByScenarioKey('builtin/san-francisco')?.key).toBe(
      'classic/sf-ship-honk',
    );
    expect(getClassicScenarioBehaviorProfileByScenarioKey('builtin/dullsville')?.key).toBe(
      'classic/default',
    );
    expect(getClassicScenarioBehaviorProfileByScenarioKey('builtin/unknown')).toBeUndefined();

    expect(getScenarioBehaviorProfile('classic/default')?.realtime.shipHonkBehavior).toBe(
      'default',
    );
    expect(getScenarioBehaviorProfile('classic/sf-ship-honk')?.realtime.shipHonkBehavior).toBe(
      'legacy-sf-low-speed',
    );
    expect(getScenarioBehaviorProfile('classic/not-registered')).toBeUndefined();

    expect(getDefaultScenarioBehaviorProfile().key).toBe('classic/default');
  });
});
