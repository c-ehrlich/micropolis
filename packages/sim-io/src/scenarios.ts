import { normalizeScenarioId, type ScenarioId } from '../../scenario-core/src/classic-scenarios.ts';

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
