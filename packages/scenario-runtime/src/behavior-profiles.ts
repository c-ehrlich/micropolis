import type { ClassicBuiltinScenarioKey } from './builtin-classic-scenarios.ts';

const CLASSIC_SCENARIO_ID_MIN = 1;
const CLASSIC_SCENARIO_ID_MAX = 8;

/**
 * Closed ship-honk behavior variants consumed by realtime sprite logic.
 *
 * Mapping note:
 * - `legacy-sf-low-speed` mirrors the `ScenarioID == 2` branch in `DoShipSprite`
 *   from `ref/micropolis/src/sim/w_sprite.c`.
 * - `default` mirrors the non-SF branch in that same function.
 */
export type ScenarioShipHonkBehavior = 'default' | 'legacy-sf-low-speed';

/**
 * Closed keyspace for runtime behavior profiles.
 *
 * Mapping note:
 * - This registry is intentionally closed to preserve deterministic parity with
 *   Micropolis C behavior variants instead of supporting arbitrary runtime hooks.
 */
export type ScenarioBehaviorProfileKey = 'classic/default' | 'classic/sf-ship-honk';

/**
 * Runtime behavior profile payload shared across simulation systems.
 *
 * Mapping note:
 * - Micropolis C used direct global branches (`ScenarioID`) in
 *   `ref/micropolis/src/sim/w_sprite.c`.
 * - This profile is an intentional declarative indirection to decouple behavior
 *   selection from numeric scenario IDs.
 */
export interface ScenarioBehaviorProfile {
  readonly key: ScenarioBehaviorProfileKey;
  readonly realtime: {
    readonly shipHonkBehavior: ScenarioShipHonkBehavior;
  };
}

/**
 * Default behavior profile key for scenarios without special runtime variants.
 *
 * Mapping note:
 * - Mirrors all classic scenarios except San Francisco in `DoShipSprite`
 *   (`ref/micropolis/src/sim/w_sprite.c`).
 */
export const DEFAULT_SCENARIO_BEHAVIOR_PROFILE_KEY: ScenarioBehaviorProfileKey = 'classic/default';

const CLASSIC_BEHAVIOR_PROFILE_KEY_BY_LEGACY_ID = [
  undefined,
  'classic/default',
  'classic/sf-ship-honk',
  'classic/default',
  'classic/default',
  'classic/default',
  'classic/default',
  'classic/default',
  'classic/default',
] as const;

const CLASSIC_BEHAVIOR_PROFILE_KEY_BY_SCENARIO_KEY: Readonly<
  Record<ClassicBuiltinScenarioKey, ScenarioBehaviorProfileKey>
> = Object.freeze({
  'builtin/dullsville': 'classic/default',
  'builtin/san-francisco': 'classic/sf-ship-honk',
  'builtin/hamburg': 'classic/default',
  'builtin/bern': 'classic/default',
  'builtin/tokyo': 'classic/default',
  'builtin/detroit': 'classic/default',
  'builtin/boston': 'classic/default',
  'builtin/rio-de-janeiro': 'classic/default',
});

const SCENARIO_BEHAVIOR_PROFILE_REGISTRY: Readonly<
  Record<ScenarioBehaviorProfileKey, ScenarioBehaviorProfile>
> = Object.freeze({
  'classic/default': {
    key: 'classic/default',
    realtime: {
      shipHonkBehavior: 'default',
    },
  },
  'classic/sf-ship-honk': {
    key: 'classic/sf-ship-honk',
    realtime: {
      shipHonkBehavior: 'legacy-sf-low-speed',
    },
  },
});

/**
 * Closed behavior profile list for editor/runtime selection surfaces.
 *
 * Mapping note:
 * - Registry values preserve deterministic C-ported behavior variants.
 */
export const SCENARIO_BEHAVIOR_PROFILES: readonly ScenarioBehaviorProfile[] = Object.freeze(
  Object.values(SCENARIO_BEHAVIOR_PROFILE_REGISTRY),
);

/**
 * Reads one behavior profile from the closed profile registry.
 *
 * Mapping note:
 * - Returns `undefined` for unknown keys; callers can explicitly fall back to
 *   `classic/default`.
 */
export function getScenarioBehaviorProfile(
  profileKey: string,
): ScenarioBehaviorProfile | undefined {
  return SCENARIO_BEHAVIOR_PROFILE_REGISTRY[profileKey as ScenarioBehaviorProfileKey];
}

/**
 * Returns the default behavior profile for non-specialized scenarios.
 *
 * Mapping note:
 * - Mirrors classic non-SF ship-honk behavior from `DoShipSprite` in
 *   `ref/micropolis/src/sim/w_sprite.c`.
 */
export function getDefaultScenarioBehaviorProfile(): ScenarioBehaviorProfile {
  return SCENARIO_BEHAVIOR_PROFILE_REGISTRY[DEFAULT_SCENARIO_BEHAVIOR_PROFILE_KEY];
}

/**
 * Resolves one behavior profile key from a classic legacy numeric scenario id.
 *
 * Mapping note:
 * - Legacy IDs mirror `LoadScenario(short s)` in
 *   `ref/micropolis/src/sim/s_fileio.c`.
 * - ID `2` (San Francisco) maps to the special ship-honk behavior used by
 *   `DoShipSprite` in `ref/micropolis/src/sim/w_sprite.c`.
 */
export function classicScenarioBehaviorProfileKeyForLegacyId(
  scenarioId: number,
): ScenarioBehaviorProfileKey | undefined {
  const normalizedId = normalizeClassicScenarioId(scenarioId);
  if (!normalizedId) {
    return undefined;
  }

  return CLASSIC_BEHAVIOR_PROFILE_KEY_BY_LEGACY_ID[normalizedId];
}

/**
 * Reads one behavior profile by classic numeric scenario id.
 *
 * Mapping note:
 * - Combines classic legacy ID normalization with closed-profile lookup.
 */
export function getClassicScenarioBehaviorProfileByLegacyId(
  scenarioId: number,
): ScenarioBehaviorProfile | undefined {
  const profileKey = classicScenarioBehaviorProfileKeyForLegacyId(scenarioId);
  if (profileKey === undefined) {
    return undefined;
  }
  return getScenarioBehaviorProfile(profileKey);
}

/**
 * Reads one behavior profile by canonical classic `builtin/*` scenario key.
 *
 * Mapping note:
 * - `builtin/san-francisco` maps to the SF ship-honk variant; all other classic
 *   built-ins map to the default profile.
 */
export function getClassicScenarioBehaviorProfileByScenarioKey(
  scenarioKey: string,
): ScenarioBehaviorProfile | undefined {
  const profileKey =
    CLASSIC_BEHAVIOR_PROFILE_KEY_BY_SCENARIO_KEY[scenarioKey as ClassicBuiltinScenarioKey];
  if (profileKey === undefined) {
    return undefined;
  }
  return getScenarioBehaviorProfile(profileKey);
}

const normalizeClassicScenarioId = (value: number): number => {
  if (!Number.isInteger(value)) {
    return 0;
  }
  if (value < CLASSIC_SCENARIO_ID_MIN || value > CLASSIC_SCENARIO_ID_MAX) {
    return 0;
  }
  return value;
};
