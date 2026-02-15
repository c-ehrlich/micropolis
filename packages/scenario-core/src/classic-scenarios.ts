import { z } from 'zod';

const CLASSIC_SCENARIO_ID_VALUES = [1, 2, 3, 4, 5, 6, 7, 8] as const;

/**
 * Canonical Micropolis scenario id range.
 * Mirrors `LoadScenario(short s)` bounds checks in `ref/micropolis/src/sim/s_fileio.c`.
 */
export type ScenarioId = (typeof CLASSIC_SCENARIO_ID_VALUES)[number];

/**
 * Classic scenario id schema.
 * Mirrors `LoadScenario` accepted ids (`1..8`) in `ref/micropolis/src/sim/s_fileio.c`
 * with explicit literal typing for TypeScript contract reuse.
 */
export const scenarioIdSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
  z.literal(6),
  z.literal(7),
  z.literal(8),
]);

/**
 * Metadata for one classic Micropolis scenario row.
 * Mirrors the `LoadScenario` switch-table row values in
 * `ref/micropolis/src/sim/s_fileio.c` (1:1 fields/values).
 */
export const scenarioDefinitionSchema = z
  .object({
    id: scenarioIdSchema,
    name: z.string().min(1),
    fileName: z.string().min(1),
    startYear: z.number().int(),
    startFunds: z.number().int().min(0),
    startCityTime: z.number().int(),
  })
  .strict();

export type ScenarioDefinition = z.infer<typeof scenarioDefinitionSchema>;

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
  if (!CLASSIC_SCENARIO_ID_VALUES.includes(value as ScenarioId)) {
    return 1;
  }
  return value as ScenarioId;
}

/**
 * Build one immutable scenario row from C switch-table constants.
 * Mirrors each `case` assignment in `LoadScenario` in
 * `ref/micropolis/src/sim/s_fileio.c`.
 */
const createScenarioDefinition = (
  id: ScenarioId,
  name: string,
  fileName: string,
  startYear: number,
  startFunds: number,
): ScenarioDefinition =>
  scenarioDefinitionSchema.parse({
    id,
    name,
    fileName,
    startYear,
    startFunds,
    startCityTime: cityTimeForScenarioYear(startYear),
  });

/**
 * Classic Micropolis scenario table.
 * Mirrors the switch rows in `LoadScenario` in
 * `ref/micropolis/src/sim/s_fileio.c` (1:1 values).
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
  const scenario = SCENARIO_TABLE[id - 1];
  if (scenario !== undefined) {
    return scenario;
  }
  throw new Error(`expected scenario table entry for id ${id} from s_fileio.c`);
}

/**
 * Resolve the `snro.*` filename for a requested id.
 * Mirrors the `fname = "snro.xxx"` assignment in `LoadScenario`
 * in `ref/micropolis/src/sim/s_fileio.c`.
 */
export function scenarioFileNameForId(value: number): string {
  return getScenarioDefinition(value).fileName;
}
