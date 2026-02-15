import { describe, expect, test } from 'vitest';

import {
  appendScenarioObjectiveChildPredicate,
  coerceScenarioObjectivePredicateKind,
  createScenarioEditorDefaultObjectivePredicate,
  createScenarioEditorInitialObjectiveDraft,
  createScenarioEditorObjectiveDraftFromBundle,
  getScenarioEditorObjectiveValidationIssues,
  removeScenarioObjectiveChildPredicate,
  replaceScenarioObjectiveChildPredicate,
  replaceScenarioObjectiveNotChildPredicate,
} from './editor-objective.ts';

/**
 * Stage 4.1 objective DSL authoring tests.
 * Parity anchor:
 * - Metric leaves map to `DoScenarioScore` comparisons in `ref/micropolis/src/sim/s_msg.c`.
 * - Logical composition nodes are declarative runtime extensions layered on top of those checks.
 */
describe('scenario editor objective predicate drafting', () => {
  test('creates a default C-parity metric predicate template', () => {
    const predicate = createScenarioEditorDefaultObjectivePredicate();

    // Magic number source: Tokyo/Boston/Rio objective threshold `CityScore > 500`
    // in `DoScenarioScore` from `ref/micropolis/src/sim/s_msg.c`.
    expect(predicate).toEqual({
      kind: 'metric',
      metric: 'city-score',
      op: 'gt',
      value: 500,
    });
  });

  test('creates initial objective draft in disabled state', () => {
    const objective = createScenarioEditorInitialObjectiveDraft();

    expect(objective.enabled).toBe(false);
    expect(objective.predicate.kind).toBe('metric');
  });

  test('hydrates enabled objective draft state from imported bundle payloads', () => {
    const objective = createScenarioEditorObjectiveDraftFromBundle({
      objective: {
        kind: 'metric',
        metric: 'traffic-average',
        op: 'lt',
        // Magic number source: Bern objective threshold `TrafficAverage < 80`
        // from `DoScenarioScore` in `ref/micropolis/src/sim/s_msg.c`.
        value: 80,
      },
    });

    expect(objective.enabled).toBe(true);
    expect(objective.predicate).toEqual({
      kind: 'metric',
      metric: 'traffic-average',
      op: 'lt',
      value: 80,
    });
  });

  test('coerces metric predicates to list and negation forms', () => {
    const metricPredicate = {
      kind: 'metric',
      metric: 'city-class',
      op: 'gte',
      value: 4,
    } as const;

    const asAll = coerceScenarioObjectivePredicateKind(metricPredicate, 'all');
    expect(asAll).toEqual({
      kind: 'all',
      predicates: [metricPredicate],
    });

    const asNot = coerceScenarioObjectivePredicateKind(metricPredicate, 'not');
    expect(asNot).toEqual({
      kind: 'not',
      predicate: metricPredicate,
    });
  });

  test('coerces list predicates to not using the first child', () => {
    const predicate = {
      kind: 'all',
      predicates: [
        {
          kind: 'metric',
          metric: 'city-score',
          op: 'gt',
          value: 500,
        },
        {
          kind: 'metric',
          metric: 'traffic-average',
          op: 'lt',
          value: 80,
        },
      ],
    } as const;

    const asNot = coerceScenarioObjectivePredicateKind(predicate, 'not');
    expect(asNot).toEqual({
      kind: 'not',
      predicate: predicate.predicates[0],
    });
  });

  test('appends, replaces, and removes list children immutably', () => {
    const initial = {
      kind: 'any',
      predicates: [
        {
          kind: 'metric',
          metric: 'city-score',
          op: 'gt',
          value: 500,
        },
      ],
    } as const;

    const appended = appendScenarioObjectiveChildPredicate(initial, {
      kind: 'metric',
      metric: 'crime-average',
      op: 'lt',
      value: 60,
    });
    expect(appended.kind).toBe('any');
    if (appended.kind !== 'any') {
      throw new Error('Expected any predicate');
    }
    expect(appended.predicates).toHaveLength(2);

    const replaced = replaceScenarioObjectiveChildPredicate(appended, 1, {
      kind: 'metric',
      metric: 'traffic-average',
      op: 'lt',
      value: 80,
    });
    expect(replaced.kind).toBe('any');
    if (replaced.kind !== 'any') {
      throw new Error('Expected any predicate');
    }
    expect(replaced.predicates[1]).toEqual({
      kind: 'metric',
      metric: 'traffic-average',
      op: 'lt',
      value: 80,
    });

    const removed = removeScenarioObjectiveChildPredicate(replaced, 1);
    expect(removed.kind).toBe('any');
    if (removed.kind !== 'any') {
      throw new Error('Expected any predicate');
    }
    expect(removed.predicates).toHaveLength(1);
  });

  test('does not remove the final child from list predicates', () => {
    const initial = {
      kind: 'all',
      predicates: [{ kind: 'metric', metric: 'city-score', op: 'gt', value: 500 }],
    } as const;

    const removed = removeScenarioObjectiveChildPredicate(initial, 0);
    expect(removed).toBe(initial);
  });

  test('replaces the child on not predicates', () => {
    const initial = {
      kind: 'not',
      predicate: { kind: 'metric', metric: 'city-score', op: 'gt', value: 500 },
    } as const;
    const updated = replaceScenarioObjectiveNotChildPredicate(initial, {
      kind: 'metric',
      metric: 'city-class',
      op: 'gte',
      value: 4,
    });

    expect(updated).toEqual({
      kind: 'not',
      predicate: { kind: 'metric', metric: 'city-class', op: 'gte', value: 4 },
    });
  });

  test('validates enabled objective drafts and accepts C-parity metric leaves', () => {
    const issues = getScenarioEditorObjectiveValidationIssues({
      enabled: true,
      predicate: createScenarioEditorDefaultObjectivePredicate(),
    });

    expect(issues).toEqual([]);
  });

  test('reports semantic validation issues for malformed predicate trees', () => {
    const issues = getScenarioEditorObjectiveValidationIssues({
      enabled: true,
      predicate: {
        kind: 'all',
        predicates: [
          {
            kind: 'metric',
            metric: 'unknown-metric',
            op: 'gt',
            value: 500,
          },
          {
            kind: 'metric',
            metric: 'city-score',
            op: 'unknown-op',
            value: 500,
          },
          {
            kind: 'metric',
            metric: 'city-score',
            op: 'gt',
            value: Number.NaN,
          },
          {
            kind: 'any',
            predicates: [],
          },
        ],
      } as unknown as ReturnType<typeof createScenarioEditorDefaultObjectivePredicate>,
    });

    expect(issues).toEqual([
      {
        path: 'objective.predicate.predicates.0.metric',
        message: 'metric must be one of: city-class, traffic-average, city-score, crime-average',
      },
      {
        path: 'objective.predicate.predicates.1.op',
        message: 'comparison op must be one of: gt, gte, lt, lte, eq, neq',
      },
      {
        path: 'objective.predicate.predicates.2.value',
        message: 'metric predicate value must be a finite integer',
      },
      {
        path: 'objective.predicate.predicates.3.predicates',
        message: 'any predicate must include at least one child predicate',
      },
    ]);
  });

  test('reports invalid kind/field combinations in predicate nodes', () => {
    const issues = getScenarioEditorObjectiveValidationIssues({
      enabled: true,
      predicate: {
        kind: 'not',
        metric: 'city-score',
        op: 'gt',
        value: 500,
        predicates: [],
        predicate: {
          kind: 'metric',
          metric: 'city-score',
          op: 'gt',
          value: 500,
        },
      } as unknown as ReturnType<typeof createScenarioEditorDefaultObjectivePredicate>,
    });

    expect(issues).toEqual([
      {
        path: 'objective.predicate.metric',
        message: 'metric field is only valid for metric predicates',
      },
      {
        path: 'objective.predicate.op',
        message: 'comparison op is only valid for metric predicates',
      },
      {
        path: 'objective.predicate.value',
        message: 'value field is only valid for metric predicates',
      },
      {
        path: 'objective.predicate.predicates',
        message: 'predicates array is only valid for all/any predicates',
      },
    ]);
  });

  test('skips semantic validation while objective authoring is disabled', () => {
    const issues = getScenarioEditorObjectiveValidationIssues({
      enabled: false,
      predicate: {
        kind: 'metric',
        metric: 'unknown-metric',
        op: 'unknown-op',
        value: Number.NaN,
      } as unknown as ReturnType<typeof createScenarioEditorDefaultObjectivePredicate>,
    });

    expect(issues).toEqual([]);
  });
});
