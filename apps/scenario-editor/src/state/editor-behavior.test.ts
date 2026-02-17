import { describe, expect, test } from 'vitest';

import {
  createScenarioEditorBehaviorDraftFromBundle,
  createScenarioEditorInitialBehaviorDraft,
  getScenarioEditorBehaviorValidationIssue,
  isScenarioEditorBehaviorProfileKey,
  SCENARIO_EDITOR_BEHAVIOR_PROFILE_KEYS,
} from './editor-behavior.ts';

/**
 * Stage 4.3 behavior-profile authoring tests.
 * Parity anchor: profile keys map to closed `DoShipSprite` behavior variants from
 * `ref/micropolis/src/sim/w_sprite.c` via `packages/scenario-runtime`.
 */
describe('scenario editor behavior profile drafting', () => {
  test('exposes the closed runtime behavior profile key list', () => {
    expect(SCENARIO_EDITOR_BEHAVIOR_PROFILE_KEYS).toEqual([
      'classic/default',
      'classic/sf-ship-honk',
    ]);
  });

  test('creates initial behavior draft disabled with default profile key', () => {
    const draft = createScenarioEditorInitialBehaviorDraft();

    expect(draft).toEqual({
      enabled: false,
      profileKey: 'classic/default',
    });
  });

  test('hydrates behavior draft from bundle behavior profile keys', () => {
    const hydrated = createScenarioEditorBehaviorDraftFromBundle({
      version: 1,
      key: 'user/behavior-hydrate',
      name: 'Behavior Hydrate',
      description: '',
      tags: [],
      start: {
        startYear: 2000,
        startFunds: 10000,
      },
      map: {
        kind: 'city-file-bytes',
        width: 120,
        height: 100,
        cityFileBytes: 'AA==',
      },
      // Magic number source:
      // - Scenario id `2` is San Francisco in `LoadScenario(short s)` in
      //   `ref/micropolis/src/sim/s_fileio.c`.
      // - `DoShipSprite` special-cases `ScenarioID == 2` in
      //   `ref/micropolis/src/sim/w_sprite.c`.
      behaviorProfileKey: 'classic/sf-ship-honk',
    });
    expect(hydrated).toEqual({
      enabled: true,
      profileKey: 'classic/sf-ship-honk',
    });

    const withoutBundleKey = createScenarioEditorBehaviorDraftFromBundle({
      version: 1,
      key: 'user/no-behavior-key',
      name: 'No Behavior Key',
      description: '',
      tags: [],
      start: {
        startYear: 2000,
        startFunds: 10000,
      },
      map: {
        kind: 'city-file-bytes',
        width: 120,
        height: 100,
        cityFileBytes: 'AA==',
      },
    });
    expect(withoutBundleKey).toEqual({
      enabled: false,
      profileKey: 'classic/default',
    });

    const withExplicitDefaultKey = createScenarioEditorBehaviorDraftFromBundle({
      version: 1,
      key: 'user/default-behavior-key',
      name: 'Default Behavior Key',
      description: '',
      tags: [],
      start: {
        startYear: 2000,
        startFunds: 10000,
      },
      map: {
        kind: 'city-file-bytes',
        width: 120,
        height: 100,
        cityFileBytes: 'AA==',
      },
      behaviorProfileKey: 'classic/default',
    });
    expect(withExplicitDefaultKey).toEqual({
      enabled: false,
      profileKey: 'classic/default',
    });
  });

  test('validates enabled profile assignment against closed registry', () => {
    expect(
      getScenarioEditorBehaviorValidationIssue({
        enabled: true,
        profileKey: 'classic/sf-ship-honk',
      }),
    ).toBeUndefined();

    const issue = getScenarioEditorBehaviorValidationIssue({
      enabled: true,
      profileKey: 'classic/not-registered',
    });
    expect(issue).toContain('closed registered keys');
    expect(issue).toContain('classic/default');
    expect(issue).toContain('classic/sf-ship-honk');
  });

  test('accepts whitespace-padded closed keys by trimming before validation', () => {
    expect(
      getScenarioEditorBehaviorValidationIssue({
        enabled: true,
        profileKey: '  classic/default  ',
      }),
    ).toBeUndefined();
  });

  test('skips validation while profile assignment is disabled', () => {
    expect(
      getScenarioEditorBehaviorValidationIssue({
        enabled: false,
        profileKey: 'classic/not-registered',
      }),
    ).toBeUndefined();
  });

  test('exposes a closed-key type guard for behavior profile UI state', () => {
    expect(isScenarioEditorBehaviorProfileKey('classic/default')).toBe(true);
    expect(isScenarioEditorBehaviorProfileKey('classic/sf-ship-honk')).toBe(true);
    expect(isScenarioEditorBehaviorProfileKey('classic/not-registered')).toBe(false);
  });
});
