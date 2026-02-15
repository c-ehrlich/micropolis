import {
  getScenarioDefinition,
  normalizeScenarioId,
  type ScenarioDefinition,
  type ScenarioId,
} from '../../scenario-core/src/classic-scenarios.ts';

export {
  cityTimeForScenarioYear,
  getScenarioDefinition,
  normalizeScenarioId,
  SCENARIO_TABLE,
  type ScenarioDefinition,
  scenarioDefinitionSchema,
  scenarioFileNameForId,
  type ScenarioId,
  scenarioIdSchema,
} from '../../scenario-core/src/classic-scenarios.ts';

const DISASTER_WAIT_TABLE = [0, 2, 10, 5, 20, 3, 5, 5, 2 * 48] as const;
const SCORE_WAIT_TABLE = [
  0,
  30 * 48,
  5 * 48,
  5 * 48,
  10 * 48,
  5 * 48,
  10 * 48,
  5 * 48,
  10 * 48,
] as const;

const BUILTIN_SCENARIO_KEYS_BY_ID = [
  '',
  'builtin/dullsville',
  'builtin/san-francisco',
  'builtin/hamburg',
  'builtin/bern',
  'builtin/tokyo',
  'builtin/detroit',
  'builtin/boston',
  'builtin/rio-de-janeiro',
] as const;

/**
 * Canonical builtin scenario key domain for classic scenario resources.
 * Maps Stage 2 key identity (`builtin/*`) to legacy `LoadScenario(short s)` ids
 * from `ref/micropolis/src/sim/s_fileio.c`.
 */
export type BuiltinScenarioKey = (typeof BUILTIN_SCENARIO_KEYS_BY_ID)[ScenarioId];

const BUILTIN_SCENARIO_ID_BY_KEY: Readonly<Record<BuiltinScenarioKey, ScenarioId>> = Object.freeze(
  BUILTIN_SCENARIO_KEYS_BY_ID.reduce(
    (lookup, key, index) => {
      if (index === 0 || key === '') {
        return lookup;
      }
      return {
        ...lookup,
        [key]: index as ScenarioId,
      };
    },
    {} as Record<BuiltinScenarioKey, ScenarioId>,
  ),
);

/**
 * Resolve a classic scenario id into its canonical `builtin/*` key.
 * Mirrors `LoadScenario(short s)` id normalization in
 * `ref/micropolis/src/sim/s_fileio.c`, then projects to Stage 2 key identity.
 */
export function scenarioKeyForId(value: number): BuiltinScenarioKey {
  const id = normalizeScenarioId(value);
  const key = BUILTIN_SCENARIO_KEYS_BY_ID[id];
  if (key === undefined) {
    throw new Error(`expected builtin scenario key for id ${id}`);
  }
  return key;
}

/**
 * Resolve a canonical `builtin/*` key into its legacy classic scenario id.
 * Mirrors `LoadScenario(short s)` id routing domain in
 * `ref/micropolis/src/sim/s_fileio.c`.
 * Parity note: unknown keys return `undefined` (no C fallback clamp) so callers
 * can reject unsupported key-based requests explicitly.
 */
export function scenarioIdForKey(scenarioKey: string): ScenarioId | undefined {
  return BUILTIN_SCENARIO_ID_BY_KEY[scenarioKey as BuiltinScenarioKey];
}

/**
 * Resolve classic scenario metadata from a canonical `builtin/*` key.
 * Mirrors `LoadScenario` metadata table lookup in
 * `ref/micropolis/src/sim/s_fileio.c`, with Stage 2 key-to-id translation first.
 */
export function getScenarioDefinitionForKey(scenarioKey: string): ScenarioDefinition | undefined {
  const scenarioId = scenarioIdForKey(scenarioKey);
  if (scenarioId === undefined) {
    return undefined;
  }
  return getScenarioDefinition(scenarioId);
}

/**
 * Resolve the scenario disaster countdown in ticks.
 * Mirrors `DISASTER_WAIT_TABLE` consumed by `simLoadInit` in
 * `packages/sim-core/src/systems/init.ts`, which ports
 * `ScenarioID` disaster timing from `ref/micropolis/src/sim/s_sim.c`.
 */
export function scenarioDisasterWaitForId(value: number): number {
  const id = normalizeScenarioId(value);
  return getTimerTableValue(DISASTER_WAIT_TABLE, id, 'disaster');
}

/**
 * Resolve the scenario score countdown in ticks.
 * Mirrors `SCORE_WAIT_TABLE` consumed by `simLoadInit` in
 * `packages/sim-core/src/systems/init.ts`, which ports
 * scenario score timing from `ref/micropolis/src/sim/s_sim.c`.
 */
export function scenarioScoreWaitForId(value: number): number {
  const id = normalizeScenarioId(value);
  return getTimerTableValue(SCORE_WAIT_TABLE, id, 'score');
}

/**
 * Read one scenario timer table value with strict bounds checks.
 * Mirrors C table indexing expectations used by scenario init timing in
 * `ref/micropolis/src/sim/s_sim.c`.
 */
function getTimerTableValue(
  table: readonly number[],
  id: ScenarioId,
  tableLabel: 'disaster' | 'score',
): number {
  const value = table[id];
  if (value !== undefined) {
    return value;
  }
  throw new Error(`expected ${tableLabel} wait for scenario id ${id}`);
}
