import { describe, expect, it } from 'vitest';

import {
  cityTimeForScenarioYear,
  getScenarioDefinition,
  normalizeScenarioId,
  SCENARIO_TABLE,
  scenarioDefinitionSchema,
  scenarioFileNameForId,
  scenarioIdSchema,
} from './classic-scenarios.ts';

/**
 * Build expected C `CityTime` from start year.
 *
 * Magic numbers from `LoadScenario` in `ref/micropolis/src/sim/s_fileio.c`:
 * - `1900`: base year
 * - `48`: ticks per year
 * - `2`: starting month offset
 */
function expectedScenarioCityTime(startYear: number): number {
  return (startYear - 1900) * 48 + 2;
}

describe('classic scenario definitions', () => {
  it('matches the C scenario switch table values', () => {
    expect(SCENARIO_TABLE).toHaveLength(8);
    expect(SCENARIO_TABLE.map((entry) => entry.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(SCENARIO_TABLE.map((entry) => entry.fileName)).toEqual([
      'snro.111',
      'snro.222',
      'snro.333',
      'snro.444',
      'snro.555',
      'snro.666',
      'snro.777',
      'snro.888',
    ]);

    for (const entry of SCENARIO_TABLE) {
      expect(entry.startCityTime).toBe(expectedScenarioCityTime(entry.startYear));
    }
  });

  it('validates id and row schemas', () => {
    expect(scenarioIdSchema.safeParse(1).success).toBe(true);
    expect(scenarioIdSchema.safeParse(9).success).toBe(false);
    expect(scenarioDefinitionSchema.safeParse(SCENARIO_TABLE[0]).success).toBe(true);
    expect(
      scenarioDefinitionSchema.safeParse({
        id: 9,
        name: 'Invalid',
        fileName: 'snro.999',
        startYear: 1900,
        startFunds: 20000,
        startCityTime: 2,
      }).success,
    ).toBe(false);
  });

  it('normalizes ids and resolves rows with C clamping behavior', () => {
    expect(normalizeScenarioId(-1)).toBe(1);
    expect(normalizeScenarioId(8)).toBe(8);
    expect(normalizeScenarioId(42)).toBe(1);
    expect(getScenarioDefinition(2).name).toBe('San Francisco');
    expect(getScenarioDefinition(9).name).toBe('Dullsville');
    expect(scenarioFileNameForId(8)).toBe('snro.888');
    expect(scenarioFileNameForId(0)).toBe('snro.111');
  });

  it('computes city time with C arithmetic', () => {
    expect(cityTimeForScenarioYear(1900)).toBe(2);
    expect(cityTimeForScenarioYear(1906)).toBe(290);
    expect(cityTimeForScenarioYear(2047)).toBe(7058);
  });
});
