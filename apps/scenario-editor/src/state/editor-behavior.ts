import {
  DEFAULT_SCENARIO_BEHAVIOR_PROFILE_KEY,
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
const SCENARIO_EDITOR_BEHAVIOR_PROFILE_KEY_SET = new Set<ScenarioBehaviorProfileKey>(
  SCENARIO_EDITOR_BEHAVIOR_PROFILE_KEYS,
);

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
 * Type guard for closed Stage 4.3 behavior-profile keys.
 * Mirrors the runtime closed registry from `packages/scenario-runtime/src/behavior-profiles.ts`,
 * which ports `DoShipSprite` scenario-id branches in `ref/micropolis/src/sim/w_sprite.c`.
 */
export function isScenarioEditorBehaviorProfileKey(
  profileKey: string,
): profileKey is ScenarioBehaviorProfileKey {
  return SCENARIO_EDITOR_BEHAVIOR_PROFILE_KEY_SET.has(profileKey as ScenarioBehaviorProfileKey);
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

  const normalizedProfileKey = draft.profileKey.trim();
  if (isScenarioEditorBehaviorProfileKey(normalizedProfileKey)) {
    return undefined;
  }

  const closedKeys = SCENARIO_EDITOR_BEHAVIOR_PROFILE_KEYS.join(', ');
  if (normalizedProfileKey.length === 0) {
    return `behavior profile key is required and must match one of the closed registered keys: ${closedKeys}`;
  }
  return `behavior profile key must match one of the closed registered keys: ${closedKeys}`;
}
