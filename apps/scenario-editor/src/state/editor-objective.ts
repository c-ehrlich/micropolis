import type { ScenarioBundleV1 } from '@city/scenario-core';
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
const SCENARIO_EDITOR_OBJECTIVE_PREDICATE_KIND_SET = new Set<ScenarioObjectivePredicate['kind']>(
  SCENARIO_EDITOR_OBJECTIVE_PREDICATE_KINDS,
);
const SCENARIO_EDITOR_OBJECTIVE_METRIC_KEY_SET = new Set<ScenarioObjectiveMetricKey>(
  SCENARIO_EDITOR_OBJECTIVE_METRIC_KEYS,
);
const SCENARIO_EDITOR_OBJECTIVE_COMPARISON_SET = new Set<ScenarioObjectiveComparison>(
  SCENARIO_EDITOR_OBJECTIVE_COMPARISONS,
);

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
 * Authoring-time semantic issue for Stage 4 objective predicate drafts.
 * Metric/op domains mirror `DoScenarioScore` comparisons in
 * `ref/micropolis/src/sim/s_msg.c`; additional structural diagnostics
 * (`all`/`any` emptiness, malformed nodes) are editor-only guardrails.
 */
export interface ScenarioEditorObjectiveValidationIssue {
  readonly message: string;
  readonly path: string;
}

/**
 * Validates Stage 4 objective draft semantics before export integration.
 * Parity note: metric/op checks preserve the `DoScenarioScore` field/comparison
 * space from `ref/micropolis/src/sim/s_msg.c`, while composite-node shape checks
 * are modern authoring-time validation with no direct C UI equivalent.
 */
export function getScenarioEditorObjectiveValidationIssues(
  draft: ScenarioEditorObjectiveDraft,
): readonly ScenarioEditorObjectiveValidationIssue[] {
  if (!draft.enabled) {
    return [];
  }

  return collectScenarioObjectivePredicateValidationIssues(
    draft.predicate as unknown,
    'objective.predicate',
  );
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
 * Creates Stage 4 objective draft state from an imported bundle payload.
 * Mapping note: imports persisted objective predicates that correspond to
 * `DoScenarioScore` metric/comparison domains in `ref/micropolis/src/sim/s_msg.c`,
 * while defaulting to disabled authoring when no objective payload is present.
 */
export function createScenarioEditorObjectiveDraftFromBundle(
  bundle: Pick<ScenarioBundleV1, 'objective'>,
): ScenarioEditorObjectiveDraft {
  if (bundle.objective === undefined) {
    return createScenarioEditorInitialObjectiveDraft();
  }

  return {
    enabled: true,
    predicate: bundle.objective,
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

const collectScenarioObjectivePredicateValidationIssues = (
  predicate: unknown,
  path: string,
): ScenarioEditorObjectiveValidationIssue[] => {
  const issues: ScenarioEditorObjectiveValidationIssue[] = [];
  if (!isRecord(predicate)) {
    issues.push({
      path,
      message: 'predicate node must be an object',
    });
    return issues;
  }

  const kind = predicate.kind;
  if (!isScenarioObjectivePredicateKind(kind)) {
    issues.push({
      path: `${path}.kind`,
      message:
        'predicate kind must be one of: metric, all, any, not (unknown kind found at authoring time)',
    });
    return issues;
  }

  if (kind === 'metric') {
    if (Object.prototype.hasOwnProperty.call(predicate, 'predicates')) {
      issues.push({
        path: `${path}.predicates`,
        message: 'predicates array is only valid for all/any predicates',
      });
    }
    if (Object.prototype.hasOwnProperty.call(predicate, 'predicate')) {
      issues.push({
        path: `${path}.predicate`,
        message: 'predicate child is only valid for not predicates',
      });
    }

    const metric = predicate.metric;
    if (!isScenarioObjectiveMetricKey(metric)) {
      issues.push({
        path: `${path}.metric`,
        message: 'metric must be one of: city-class, traffic-average, city-score, crime-average',
      });
    }

    const op = predicate.op;
    if (!isScenarioObjectiveComparison(op)) {
      issues.push({
        path: `${path}.op`,
        message: 'comparison op must be one of: gt, gte, lt, lte, eq, neq',
      });
    }

    const value = predicate.value;
    if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
      issues.push({
        path: `${path}.value`,
        message: 'metric predicate value must be a finite integer',
      });
    }

    return issues;
  }

  if (kind === 'all' || kind === 'any') {
    if (Object.prototype.hasOwnProperty.call(predicate, 'metric')) {
      issues.push({
        path: `${path}.metric`,
        message: 'metric field is only valid for metric predicates',
      });
    }
    if (Object.prototype.hasOwnProperty.call(predicate, 'op')) {
      issues.push({
        path: `${path}.op`,
        message: 'comparison op is only valid for metric predicates',
      });
    }
    if (Object.prototype.hasOwnProperty.call(predicate, 'value')) {
      issues.push({
        path: `${path}.value`,
        message: 'value field is only valid for metric predicates',
      });
    }
    if (Object.prototype.hasOwnProperty.call(predicate, 'predicate')) {
      issues.push({
        path: `${path}.predicate`,
        message: 'predicate child is only valid for not predicates',
      });
    }

    const predicates = predicate.predicates;
    if (!Array.isArray(predicates)) {
      issues.push({
        path: `${path}.predicates`,
        message: `${kind} predicate requires a predicates array`,
      });
      return issues;
    }

    if (predicates.length === 0) {
      issues.push({
        path: `${path}.predicates`,
        message: `${kind} predicate must include at least one child predicate`,
      });
      return issues;
    }

    for (let index = 0; index < predicates.length; index += 1) {
      const childPredicate = predicates[index];
      issues.push(
        ...collectScenarioObjectivePredicateValidationIssues(
          childPredicate,
          `${path}.predicates.${index}`,
        ),
      );
    }
    return issues;
  }

  if (Object.prototype.hasOwnProperty.call(predicate, 'metric')) {
    issues.push({
      path: `${path}.metric`,
      message: 'metric field is only valid for metric predicates',
    });
  }
  if (Object.prototype.hasOwnProperty.call(predicate, 'op')) {
    issues.push({
      path: `${path}.op`,
      message: 'comparison op is only valid for metric predicates',
    });
  }
  if (Object.prototype.hasOwnProperty.call(predicate, 'value')) {
    issues.push({
      path: `${path}.value`,
      message: 'value field is only valid for metric predicates',
    });
  }
  if (Object.prototype.hasOwnProperty.call(predicate, 'predicates')) {
    issues.push({
      path: `${path}.predicates`,
      message: 'predicates array is only valid for all/any predicates',
    });
  }

  const childPredicate = predicate.predicate;
  if (childPredicate === undefined) {
    issues.push({
      path: `${path}.predicate`,
      message: 'not predicate requires one child predicate',
    });
    return issues;
  }

  issues.push(
    ...collectScenarioObjectivePredicateValidationIssues(childPredicate, `${path}.predicate`),
  );
  return issues;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isScenarioObjectivePredicateKind = (
  value: unknown,
): value is ScenarioObjectivePredicate['kind'] =>
  typeof value === 'string' &&
  SCENARIO_EDITOR_OBJECTIVE_PREDICATE_KIND_SET.has(value as ScenarioObjectivePredicate['kind']);

const isScenarioObjectiveMetricKey = (value: unknown): value is ScenarioObjectiveMetricKey =>
  typeof value === 'string' &&
  SCENARIO_EDITOR_OBJECTIVE_METRIC_KEY_SET.has(value as ScenarioObjectiveMetricKey);

const isScenarioObjectiveComparison = (value: unknown): value is ScenarioObjectiveComparison =>
  typeof value === 'string' &&
  SCENARIO_EDITOR_OBJECTIVE_COMPARISON_SET.has(value as ScenarioObjectiveComparison);
