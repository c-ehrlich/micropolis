import type {
  ScenarioObjectiveComparison,
  ScenarioObjectiveMetricKey,
  ScenarioObjectivePredicate,
} from '@city/scenario-runtime';

export type ScenarioEditorObjectivePredicate = ScenarioObjectivePredicate;

/**
 * Predicate kinds supported by Stage 4 objective authoring.
 * Mirrors declarative predicate node kinds from `ScenarioObjectivePredicate` in
 * `packages/scenario-runtime/src/runtime-state.ts`, which ports classic
 * `DoScenarioScore` comparisons from `ref/micropolis/src/sim/s_msg.c` and extends
 * them with composable logical nodes.
 */
export const SCENARIO_EDITOR_OBJECTIVE_PREDICATE_KINDS = [
  'metric',
  'all',
  'any',
  'not',
] as const satisfies readonly ScenarioObjectivePredicate['kind'][];

/**
 * Metric keys available in the Stage 4 objective editor.
 * Mirrors the metrics consumed by `DoScenarioScore` in
 * `ref/micropolis/src/sim/s_msg.c` through the runtime adapter.
 */
export const SCENARIO_EDITOR_OBJECTIVE_METRIC_KEYS = [
  'city-class',
  'traffic-average',
  'city-score',
  'crime-average',
] as const satisfies readonly ScenarioObjectiveMetricKey[];

/**
 * Comparison operators available in the Stage 4 objective editor.
 * Mirrors C relational checks used by `DoScenarioScore` in
 * `ref/micropolis/src/sim/s_msg.c`, represented as runtime predicate operators.
 */
export const SCENARIO_EDITOR_OBJECTIVE_COMPARISONS = [
  'gt',
  'gte',
  'lt',
  'lte',
  'eq',
  'neq',
] as const satisfies readonly ScenarioObjectiveComparison[];

/**
 * Stage 4 editor draft model for optional objective authoring.
 * Parity note: classic Micropolis scenarios always had one hardcoded objective
 * selected by numeric id in `DoScenarioScore`; this editor draft stores a modern
 * predicate tree and an explicit enabled toggle for author control.
 */
export interface ScenarioEditorObjectiveDraft {
  readonly enabled: boolean;
  readonly predicate: ScenarioObjectivePredicate;
}

/**
 * Creates a default metric predicate for new objective drafts and new branch nodes.
 * Magic number mapping: `value: 500` mirrors the classic `CityScore > 500` objective
 * threshold used by Tokyo/Boston/Rio in `DoScenarioScore` in
 * `ref/micropolis/src/sim/s_msg.c`.
 */
export function createScenarioEditorDefaultObjectivePredicate(): ScenarioObjectivePredicate {
  return {
    kind: 'metric',
    metric: 'city-score',
    op: 'gt',
    value: 500,
  };
}

/**
 * Creates the initial objective draft state for a new editor session.
 * Parity note: legacy scenarios did not expose objective authoring UI; Stage 4 starts
 * disabled by default and seeds a C-parity metric predicate template for opt-in edits.
 */
export function createScenarioEditorInitialObjectiveDraft(): ScenarioEditorObjectiveDraft {
  return {
    enabled: false,
    predicate: createScenarioEditorDefaultObjectivePredicate(),
  };
}

/**
 * Converts one predicate node to a requested kind while preserving children where possible.
 * Parity note: `metric` leaves remain `DoScenarioScore`-style comparisons, while
 * `all`/`any`/`not` are declarative composition layers introduced in scenario-runtime.
 */
export function coerceScenarioObjectivePredicateKind(
  predicate: ScenarioObjectivePredicate,
  nextKind: ScenarioObjectivePredicate['kind'],
): ScenarioObjectivePredicate {
  if (predicate.kind === nextKind) {
    return predicate;
  }

  if (nextKind === 'metric') {
    return createScenarioEditorDefaultObjectivePredicate();
  }

  if (nextKind === 'all' || nextKind === 'any') {
    if (predicate.kind === 'not') {
      return {
        kind: nextKind,
        predicates: [predicate.predicate],
      };
    }
    if (predicate.kind === 'metric') {
      return {
        kind: nextKind,
        predicates: [predicate],
      };
    }
    return {
      kind: nextKind,
      predicates:
        predicate.predicates.length > 0
          ? predicate.predicates
          : [createScenarioEditorDefaultObjectivePredicate()],
    };
  }

  if (predicate.kind === 'all' || predicate.kind === 'any') {
    const firstChild = predicate.predicates[0];
    return {
      kind: 'not',
      predicate:
        firstChild === undefined ? createScenarioEditorDefaultObjectivePredicate() : firstChild,
    };
  }

  return {
    kind: 'not',
    predicate,
  };
}

/**
 * Appends one child predicate to an `all` or `any` node.
 * Returns the input unchanged for non-list nodes because they do not have list children.
 */
export function appendScenarioObjectiveChildPredicate(
  predicate: ScenarioObjectivePredicate,
  child: ScenarioObjectivePredicate = createScenarioEditorDefaultObjectivePredicate(),
): ScenarioObjectivePredicate {
  if (predicate.kind !== 'all' && predicate.kind !== 'any') {
    return predicate;
  }

  return {
    ...predicate,
    predicates: [...predicate.predicates, child],
  };
}

/**
 * Replaces one child predicate at index on an `all` or `any` node.
 * Returns the input unchanged when index is out of range or node kind is not list-based.
 */
export function replaceScenarioObjectiveChildPredicate(
  predicate: ScenarioObjectivePredicate,
  index: number,
  child: ScenarioObjectivePredicate,
): ScenarioObjectivePredicate {
  if (predicate.kind !== 'all' && predicate.kind !== 'any') {
    return predicate;
  }
  if (!Number.isInteger(index) || index < 0 || index >= predicate.predicates.length) {
    return predicate;
  }

  return {
    ...predicate,
    predicates: predicate.predicates.map((current, currentIndex) =>
      currentIndex === index ? child : current,
    ),
  };
}

/**
 * Removes one child predicate by index from an `all` or `any` node.
 * Enforces at least one child to prevent invalid empty list nodes during editing.
 */
export function removeScenarioObjectiveChildPredicate(
  predicate: ScenarioObjectivePredicate,
  index: number,
): ScenarioObjectivePredicate {
  if (predicate.kind !== 'all' && predicate.kind !== 'any') {
    return predicate;
  }
  if (!Number.isInteger(index) || index < 0 || index >= predicate.predicates.length) {
    return predicate;
  }
  if (predicate.predicates.length <= 1) {
    return predicate;
  }

  return {
    ...predicate,
    predicates: predicate.predicates.filter((_, currentIndex) => currentIndex !== index),
  };
}

/**
 * Replaces the single child predicate on a `not` node.
 * Returns the input unchanged when the node is not a `not` predicate.
 */
export function replaceScenarioObjectiveNotChildPredicate(
  predicate: ScenarioObjectivePredicate,
  child: ScenarioObjectivePredicate,
): ScenarioObjectivePredicate {
  if (predicate.kind !== 'not') {
    return predicate;
  }

  return {
    kind: 'not',
    predicate: child,
  };
}
