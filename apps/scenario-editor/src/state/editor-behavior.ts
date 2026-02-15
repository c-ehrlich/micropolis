import {
  DEFAULT_SCENARIO_BEHAVIOR_PROFILE_KEY,
  getScenarioBehaviorProfile,
  SCENARIO_BEHAVIOR_PROFILES,
  type ScenarioBehaviorProfileKey,
} from '@city/scenario-runtime';

/**
 * Closed behavior-profile keys exposed by Stage 4.3 authoring UI.
 * Mirrors the runtime registry from `packages/scenario-runtime/src/behavior-profiles.ts`,
 * which ports `ScenarioID`-based behavior variants from `DoShipSprite` in
 * `ref/micropolis/src/sim/w_sprite.c` to a declarative closed keyspace.
 */
export const SCENARIO_EDITOR_BEHAVIOR_PROFILE_KEYS: readonly ScenarioBehaviorProfileKey[] =
  SCENARIO_BEHAVIOR_PROFILES.map((profile) => profile.key);

/**
 * Stage 4.3 behavior-profile assignment draft state for the scenario editor.
 * Parity note: Micropolis C did not expose behavior-profile authoring UI; this is an editor-only
 * draft model for selecting closed runtime variants equivalent to C `ScenarioID` branches.
 */
export interface ScenarioEditorBehaviorDraft {
  readonly enabled: boolean;
  readonly profileKey: string;
}

/**
 * Creates initial Stage 4.3 behavior-profile draft state for a new editor session.
 * Uses the closed runtime default profile, which mirrors non-San-Francisco behavior in
 * `DoShipSprite` from `ref/micropolis/src/sim/w_sprite.c`.
 */
export function createScenarioEditorInitialBehaviorDraft(): ScenarioEditorBehaviorDraft {
  return {
    enabled: false,
    profileKey: DEFAULT_SCENARIO_BEHAVIOR_PROFILE_KEY,
  };
}

/**
 * Returns a validation issue when an enabled behavior assignment is not in the closed registry.
 * Mapping note: closed validation preserves deterministic parity by rejecting arbitrary runtime
 * hooks and allowing only registered keys from `SCENARIO_BEHAVIOR_PROFILES`.
 */
export function getScenarioEditorBehaviorValidationIssue(
  draft: ScenarioEditorBehaviorDraft,
): string | undefined {
  if (!draft.enabled) {
    return undefined;
  }

  if (getScenarioBehaviorProfile(draft.profileKey) !== undefined) {
    return undefined;
  }

  const closedKeys = SCENARIO_EDITOR_BEHAVIOR_PROFILE_KEYS.join(', ');
  return `behavior profile key must match one of the closed registered keys: ${closedKeys}`;
}
