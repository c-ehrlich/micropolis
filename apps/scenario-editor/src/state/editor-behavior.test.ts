import { describe, expect, test } from 'vitest';

import {
  createScenarioEditorInitialBehaviorDraft,
  getScenarioEditorBehaviorValidationIssue,
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

  test('skips validation while profile assignment is disabled', () => {
    expect(
      getScenarioEditorBehaviorValidationIssue({
        enabled: false,
        profileKey: 'classic/not-registered',
      }),
    ).toBeUndefined();
  });
});
