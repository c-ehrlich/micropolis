import { describe, expect, it } from 'vitest';

import {
  cityTimeForScenarioYear,
  getScenarioDefinition,
  normalizeScenarioId,
  SCENARIO_TABLE,
  scenarioDisasterWaitForId,
  scenarioFileNameForId,
  scenarioScoreWaitForId,
} from './scenarios.ts';

/**
 * Build expected C `CityTime` from start year.
 *
 * Magic numbers from `LoadScenario` in `ref/micropolis/src/sim/s_fileio.c`:
 * - `1900`: base year
 * - `48`: ticks per year
 * - `2`: start month offset used by every scenario case
 */
function expectedScenarioCityTime(startYear: number): number {
  return (startYear - 1900) * 48 + 2;
}

describe('scenario table', () => {
  it('matches the C scenario switch table values', () => {
    expect(SCENARIO_TABLE).toHaveLength(8);

    expect(SCENARIO_TABLE.map((entry) => entry.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(SCENARIO_TABLE.map((entry) => entry.name)).toEqual([
      'Dullsville',
      'San Francisco',
      'Hamburg',
      'Bern',
      'Tokyo',
      'Detroit',
      'Boston',
      'Rio de Janeiro',
    ]);
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

    // `LoadScenario` special-cases scenario 1 with 5000 and all others with 20000.
    expect(SCENARIO_TABLE[0]?.startFunds).toBe(5000);
    for (const entry of SCENARIO_TABLE.slice(1)) {
      expect(entry.startFunds).toBe(20000);
    }
  });

  it('normalizes scenario ids with C clamp semantics', () => {
    expect(normalizeScenarioId(-1)).toBe(1);
    expect(normalizeScenarioId(0)).toBe(1);
    expect(normalizeScenarioId(1)).toBe(1);
    expect(normalizeScenarioId(8)).toBe(8);
    expect(normalizeScenarioId(9)).toBe(1);
  });

  it('resolves scenario metadata by normalized id', () => {
    expect(getScenarioDefinition(2).name).toBe('San Francisco');
    expect(getScenarioDefinition(9).name).toBe('Dullsville');
    expect(scenarioFileNameForId(8)).toBe('snro.888');
    expect(scenarioFileNameForId(0)).toBe('snro.111');
  });

  it('matches scenario timer tables used by C-style sim init', () => {
    // Magic numbers from `DISASTER_WAIT_TABLE` and `SCORE_WAIT_TABLE` in
    // `packages/sim-core/src/systems/init.ts`, ported from Micropolis C timing behavior.
    expect(scenarioDisasterWaitForId(1)).toBe(2);
    expect(scenarioDisasterWaitForId(8)).toBe(96);
    expect(scenarioScoreWaitForId(1)).toBe(1440);
    expect(scenarioScoreWaitForId(8)).toBe(480);
  });

  it('computes scenario city time with C arithmetic', () => {
    expect(cityTimeForScenarioYear(1900)).toBe(2);
    expect(cityTimeForScenarioYear(1906)).toBe(290);
    expect(cityTimeForScenarioYear(2047)).toBe(7058);
  });
});
