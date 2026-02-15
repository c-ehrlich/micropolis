import { describe, expect, it } from 'vitest';

import {
  CLASSIC_BUILTIN_SCENARIO_RUNTIMES,
  type ClassicBuiltinScenarioKey,
  classicBuiltinScenarioKeyForLegacyId,
  disasterCountdownForScenarioKey,
  getClassicBuiltinScenarioRuntimeDefinition,
  getClassicBuiltinScenarioRuntimeDefinitionByLegacyId,
  scoreCountdownForScenarioKey,
} from './builtin-classic-scenarios.ts';

describe('classic built-in scenario runtime catalog', () => {
  it('provides one canonical builtin/* runtime definition per classic scenario id', () => {
    expect(CLASSIC_BUILTIN_SCENARIO_RUNTIMES).toHaveLength(8);
    expect(CLASSIC_BUILTIN_SCENARIO_RUNTIMES.map((entry) => entry.key)).toEqual([
      'builtin/dullsville',
      'builtin/san-francisco',
      'builtin/hamburg',
      'builtin/bern',
      'builtin/tokyo',
      'builtin/detroit',
      'builtin/boston',
      'builtin/rio-de-janeiro',
    ]);
  });

  it('maps legacy numeric ids to builtin/* keys and definitions', () => {
    expect(classicBuiltinScenarioKeyForLegacyId(1)).toBe('builtin/dullsville');
    expect(classicBuiltinScenarioKeyForLegacyId(8)).toBe('builtin/rio-de-janeiro');
    expect(classicBuiltinScenarioKeyForLegacyId(0)).toBeUndefined();
    expect(classicBuiltinScenarioKeyForLegacyId(9)).toBeUndefined();

    const byLegacyId = getClassicBuiltinScenarioRuntimeDefinitionByLegacyId(2);
    expect(byLegacyId?.key).toBe('builtin/san-francisco');
    expect(getClassicBuiltinScenarioRuntimeDefinition('builtin/san-francisco')).toBe(byLegacyId);
    expect(getClassicBuiltinScenarioRuntimeDefinitionByLegacyId(-1)).toBeUndefined();
    expect(getClassicBuiltinScenarioRuntimeDefinition('builtin/unknown')).toBeUndefined();
  });

  it('keeps C parity for scenario countdown tables', () => {
    /**
     * Magic numbers from `DoSimInit` tables in `ref/micropolis/src/sim/s_sim.c`:
     * - Disaster waits: `DisTab = { 0, 2, 10, 5, 20, 3, 5, 5, 2*48 }`.
     * - Score waits: `ScoreWaitTab = { 0, 30*48, 5*48, 5*48, 10*48, 5*48, 10*48, 5*48, 10*48 }`.
     */
    const expectedDisasterWaitByKey: Readonly<Record<ClassicBuiltinScenarioKey, number>> = {
      'builtin/dullsville': 2,
      'builtin/san-francisco': 10,
      'builtin/hamburg': 5,
      'builtin/bern': 20,
      'builtin/tokyo': 3,
      'builtin/detroit': 5,
      'builtin/boston': 5,
      'builtin/rio-de-janeiro': 2 * 48,
    };

    const expectedScoreWaitByKey: Readonly<Record<ClassicBuiltinScenarioKey, number>> = {
      'builtin/dullsville': 30 * 48,
      'builtin/san-francisco': 5 * 48,
      'builtin/hamburg': 5 * 48,
      'builtin/bern': 10 * 48,
      'builtin/tokyo': 5 * 48,
      'builtin/detroit': 10 * 48,
      'builtin/boston': 5 * 48,
      'builtin/rio-de-janeiro': 10 * 48,
    };

    for (const scenario of CLASSIC_BUILTIN_SCENARIO_RUNTIMES) {
      const key = scenario.key as ClassicBuiltinScenarioKey;
      expect(disasterCountdownForScenarioKey(key)).toBe(expectedDisasterWaitByKey[key]);
      expect(scoreCountdownForScenarioKey(key)).toBe(expectedScoreWaitByKey[key]);
      expect(scenario.events[0]?.initialCountdown).toBe(expectedDisasterWaitByKey[key]);
      expect(scenario.objective?.initialCountdown).toBe(expectedScoreWaitByKey[key]);
    }
  });

  it('keeps C parity for per-scenario disaster rules and objective predicates', () => {
    const dullsville = getClassicBuiltinScenarioRuntimeDefinition('builtin/dullsville');
    expect(dullsville?.events[0]?.rules).toEqual([]);
    expect(dullsville?.objective?.predicate).toEqual({
      kind: 'metric',
      metric: 'city-class',
      op: 'gte',
      value: 4,
    });

    const sanFrancisco = getClassicBuiltinScenarioRuntimeDefinition('builtin/san-francisco');
    expect(sanFrancisco?.events[0]?.rules).toEqual([
      { when: { kind: 'countdown-equals', value: 1 }, action: { kind: 'make-earthquake' } },
    ]);
    expect(sanFrancisco?.objective?.predicate).toEqual({
      kind: 'metric',
      metric: 'city-class',
      op: 'gte',
      value: 4,
    });

    const hamburg = getClassicBuiltinScenarioRuntimeDefinition('builtin/hamburg');
    expect(hamburg?.events[0]?.rules).toEqual([
      { when: { kind: 'always' }, action: { kind: 'drop-fire-bombs' } },
    ]);
    expect(hamburg?.objective?.predicate).toEqual({
      kind: 'metric',
      metric: 'city-class',
      op: 'gte',
      value: 4,
    });

    const bern = getClassicBuiltinScenarioRuntimeDefinition('builtin/bern');
    expect(bern?.events[0]?.rules).toEqual([]);
    expect(bern?.objective?.predicate).toEqual({
      kind: 'metric',
      metric: 'traffic-average',
      op: 'lt',
      value: 80,
    });

    const tokyo = getClassicBuiltinScenarioRuntimeDefinition('builtin/tokyo');
    expect(tokyo?.events[0]?.rules).toEqual([
      { when: { kind: 'countdown-equals', value: 1 }, action: { kind: 'make-monster' } },
    ]);
    expect(tokyo?.objective?.predicate).toEqual({
      kind: 'metric',
      metric: 'city-score',
      op: 'gt',
      value: 500,
    });

    const detroit = getClassicBuiltinScenarioRuntimeDefinition('builtin/detroit');
    expect(detroit?.events[0]?.rules).toEqual([]);
    expect(detroit?.objective?.predicate).toEqual({
      kind: 'metric',
      metric: 'crime-average',
      op: 'lt',
      value: 60,
    });

    const boston = getClassicBuiltinScenarioRuntimeDefinition('builtin/boston');
    expect(boston?.events[0]?.rules).toEqual([
      { when: { kind: 'countdown-equals', value: 1 }, action: { kind: 'make-meltdown' } },
    ]);
    expect(boston?.objective?.predicate).toEqual({
      kind: 'metric',
      metric: 'city-score',
      op: 'gt',
      value: 500,
    });

    const rio = getClassicBuiltinScenarioRuntimeDefinition('builtin/rio-de-janeiro');
    expect(rio?.events[0]?.rules).toEqual([
      { when: { kind: 'countdown-every', interval: 24 }, action: { kind: 'make-flood' } },
    ]);
    expect(rio?.objective?.predicate).toEqual({
      kind: 'metric',
      metric: 'city-score',
      op: 'gt',
      value: 500,
    });
  });
});
