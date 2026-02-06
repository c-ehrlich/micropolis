import { getOrThrow } from '../../sim-core/src/core/assert.ts';

/**
 * Canonical Micropolis scenario id range.
 * Mirrors `LoadScenario(short s)` bounds checks in `ref/micropolis/src/sim/s_fileio.c`.
 */
export type ScenarioId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

/**
 * Metadata for one classic Micropolis scenario row.
 * Mirrors the scenario switch table in `ref/micropolis/src/sim/s_fileio.c` (1:1 values).
 */
export interface ScenarioDefinition {
  id: ScenarioId;
  name: string;
  fileName: string;
  startYear: number;
  startFunds: number;
  startCityTime: number;
}

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
 * Convert a scenario start year into C `CityTime` units.
 * Mirrors `CityTime = ((startYear - 1900) * 48) + 2` in `LoadScenario`
 * in `ref/micropolis/src/sim/s_fileio.c` (1:1 arithmetic).
 */
export function cityTimeForScenarioYear(startYear: number): number {
  return (startYear - 1900) * 48 + 2;
}

/**
 * C-style scenario id clamp.
 * Mirrors `if ((s < 1) || (s > 8)) s = 1;` in `LoadScenario`
 * in `ref/micropolis/src/sim/s_fileio.c` (1:1 behavior).
 */
export function normalizeScenarioId(value: number): ScenarioId {
  if (value < 1 || value > 8) {
    return 1;
  }
  return value as ScenarioId;
}

/**
 * Build one immutable scenario row from the C switch-table constants.
 * Mirrors each `case` assignment in `LoadScenario` in `ref/micropolis/src/sim/s_fileio.c`.
 */
const createScenarioDefinition = (
  id: ScenarioId,
  name: string,
  fileName: string,
  startYear: number,
  startFunds: number,
): ScenarioDefinition => ({
  id,
  name,
  fileName,
  startYear,
  startFunds,
  startCityTime: cityTimeForScenarioYear(startYear),
});

/**
 * Classic Micropolis scenario table.
 * Mirrors the switch rows in `LoadScenario` in `ref/micropolis/src/sim/s_fileio.c` (1:1 values).
 */
export const SCENARIO_TABLE: readonly ScenarioDefinition[] = Object.freeze([
  createScenarioDefinition(1, 'Dullsville', 'snro.111', 1900, 5000),
  createScenarioDefinition(2, 'San Francisco', 'snro.222', 1906, 20000),
  createScenarioDefinition(3, 'Hamburg', 'snro.333', 1944, 20000),
  createScenarioDefinition(4, 'Bern', 'snro.444', 1965, 20000),
  createScenarioDefinition(5, 'Tokyo', 'snro.555', 1957, 20000),
  createScenarioDefinition(6, 'Detroit', 'snro.666', 1972, 20000),
  createScenarioDefinition(7, 'Boston', 'snro.777', 2010, 20000),
  createScenarioDefinition(8, 'Rio de Janeiro', 'snro.888', 2047, 20000),
]);

/**
 * Resolve one scenario row by id with C-style clamping.
 * Mirrors `LoadScenario` id normalization + table lookup in
 * `ref/micropolis/src/sim/s_fileio.c`.
 */
export function getScenarioDefinition(value: number): ScenarioDefinition {
  const id = normalizeScenarioId(value);
  return getOrThrow(
    SCENARIO_TABLE[id - 1],
    `expected scenario table entry for id ${id} from s_fileio.c`,
  );
}

/**
 * Resolve the `snro.*` filename for a requested id.
 * Mirrors the `fname = "snro.xxx"` assignment in `LoadScenario`
 * in `ref/micropolis/src/sim/s_fileio.c`.
 */
export function scenarioFileNameForId(value: number): string {
  return getScenarioDefinition(value).fileName;
}

/**
 * Resolve the scenario disaster countdown in ticks.
 * Mirrors `DISASTER_WAIT_TABLE` consumed by `simLoadInit` in
 * `packages/sim-core/src/systems/init.ts`, which ports
 * `ScenarioID` disaster timing from `ref/micropolis/src/sim/s_sim.c`.
 */
export function scenarioDisasterWaitForId(value: number): number {
  const id = normalizeScenarioId(value);
  return getOrThrow(DISASTER_WAIT_TABLE[id], `expected disaster wait for scenario id ${id}`);
}

/**
 * Resolve the scenario score countdown in ticks.
 * Mirrors `SCORE_WAIT_TABLE` consumed by `simLoadInit` in
 * `packages/sim-core/src/systems/init.ts`, which ports
 * scenario score timing from `ref/micropolis/src/sim/s_sim.c`.
 */
export function scenarioScoreWaitForId(value: number): number {
  const id = normalizeScenarioId(value);
  return getOrThrow(SCORE_WAIT_TABLE[id], `expected score wait for scenario id ${id}`);
}
