/**
 * Declarative runtime actions emitted by scenario event/objective state transitions.
 *
 * Parity note:
 * - C dispatches these behaviors imperatively inside `ScenarioDisaster` and
 *   `DoScenarioScore` in `ref/micropolis/src/sim/s_disast.c` and
 *   `ref/micropolis/src/sim/s_msg.c`.
 * - This union is a declarative transport form for the same runtime side effects.
 */
export type ScenarioRuntimeAction =
  | { readonly kind: 'make-earthquake' }
  | { readonly kind: 'drop-fire-bombs' }
  | { readonly kind: 'make-monster' }
  | { readonly kind: 'make-meltdown' }
  | { readonly kind: 'make-flood' }
  | { readonly kind: 'send-message'; readonly messageId: number }
  | { readonly kind: 'lose-game' };

/**
 * Event trigger condition evaluated against the active countdown value.
 *
 * Parity note:
 * - C used fixed `ScenarioID` switch cases (`wait == 1`, `wait % 24 == 0`,
 *   or unconditional-per-tick paths) in `ScenarioDisaster`.
 * - This declarative model keeps the same trigger styles without numeric id branching.
 */
export type ScenarioEventTrigger =
  | { readonly kind: 'always' }
  | { readonly kind: 'countdown-equals'; readonly value: number }
  | { readonly kind: 'countdown-every'; readonly interval: number };

/**
 * One declarative event rule: when the trigger matches, emit the action.
 *
 * Parity note:
 * - Equivalent to one arm/body branch in `ScenarioDisaster` in
 *   `ref/micropolis/src/sim/s_disast.c`.
 */
export interface ScenarioEventRule {
  readonly when: ScenarioEventTrigger;
  readonly action: ScenarioRuntimeAction;
}

/**
 * Declarative event definition with legacy-compatible countdown semantics.
 *
 * Parity note:
 * - `initialCountdown` mirrors `DisasterWait` initialization timing from
 *   `DoSimInit` in `ref/micropolis/src/sim/s_sim.c`.
 * - Rule evaluation timing mirrors `ScenarioDisaster` in
 *   `ref/micropolis/src/sim/s_disast.c`.
 */
export interface ScenarioEventDefinition {
  readonly key: string;
  readonly initialCountdown: number;
  readonly rules: readonly ScenarioEventRule[];
}

/**
 * Mutable-in-time runtime state for one event definition.
 *
 * Parity note:
 * - This state replaces `DisasterEvent` + `DisasterWait` coupling in
 *   `ref/micropolis/src/sim/s_disast.c` with keyed declarative data.
 */
export interface ScenarioEventRuntimeState {
  readonly key: string;
  readonly active: boolean;
  readonly countdown: number;
  readonly rules: readonly ScenarioEventRule[];
}

/**
 * Result of one event runtime tick.
 *
 * Parity note:
 * - `actions` are the same side effects C performed directly in
 *   `ScenarioDisaster`; this package only emits intents.
 */
export interface ScenarioEventTickResult {
  readonly state: ScenarioEventRuntimeState;
  readonly actions: readonly ScenarioRuntimeAction[];
}

/**
 * Objective metric keys currently needed for classic parity checks.
 *
 * Parity note:
 * - Keys mirror `DoScenarioScore` inputs in `ref/micropolis/src/sim/s_msg.c`:
 *   `CityClass`, `TrafficAverage`, `CityScore`, and `CrimeAverage`.
 */
export type ScenarioObjectiveMetricKey =
  | 'city-class'
  | 'traffic-average'
  | 'city-score'
  | 'crime-average';

/**
 * Comparison operators for metric predicates.
 *
 * Parity note:
 * - C used direct relational checks in `DoScenarioScore`; these operators encode
 *   the same comparisons declaratively.
 */
export type ScenarioObjectiveComparison = 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'neq';

/**
 * Leaf predicate comparing one metric to a constant value.
 *
 * Parity note:
 * - Equivalent to one `if (...)` comparison in `DoScenarioScore` in
 *   `ref/micropolis/src/sim/s_msg.c`.
 */
export interface ScenarioObjectiveMetricPredicate {
  readonly kind: 'metric';
  readonly metric: ScenarioObjectiveMetricKey;
  readonly op: ScenarioObjectiveComparison;
  readonly value: number;
}

/**
 * Conjunction predicate for objective checks.
 *
 * Parity note:
 * - Not a direct C struct; this is a declarative extension so multiple C-style
 *   metric checks can be combined without hardcoded switch branches.
 */
export interface ScenarioObjectiveAllPredicate {
  readonly kind: 'all';
  readonly predicates: readonly ScenarioObjectivePredicate[];
}

/**
 * Disjunction predicate for objective checks.
 *
 * Parity note:
 * - Not a direct C struct; this is a declarative extension for future scenario
 *   authoring while preserving deterministic boolean semantics.
 */
export interface ScenarioObjectiveAnyPredicate {
  readonly kind: 'any';
  readonly predicates: readonly ScenarioObjectivePredicate[];
}

/**
 * Negation predicate for objective checks.
 *
 * Parity note:
 * - Not a direct C struct; this supports declarative reuse for conditions that
 *   would require additional C branch logic.
 */
export interface ScenarioObjectiveNotPredicate {
  readonly kind: 'not';
  readonly predicate: ScenarioObjectivePredicate;
}

/**
 * Declarative objective predicate tree.
 *
 * Parity note:
 * - This keeps current `DoScenarioScore` parity via metric predicates and adds
 *   composable forms planned for scenario authoring.
 */
export type ScenarioObjectivePredicate =
  | ScenarioObjectiveMetricPredicate
  | ScenarioObjectiveAllPredicate
  | ScenarioObjectiveAnyPredicate
  | ScenarioObjectiveNotPredicate;

/**
 * Read model for objective metrics at evaluation time.
 *
 * Parity note:
 * - Values come from simulation state fields used by `DoScenarioScore`.
 */
export type ScenarioObjectiveMetricValues = Readonly<Record<ScenarioObjectiveMetricKey, number>>;

/**
 * Declarative objective with countdown and outcome messages.
 *
 * Parity note:
 * - `initialCountdown` mirrors `ScoreWait` initialization from `DoSimInit` in
 *   `ref/micropolis/src/sim/s_sim.c`.
 * - Success/failure message ids mirror `DoScenarioScore` usage in
 *   `ref/micropolis/src/sim/s_msg.c`, but are now data-driven.
 */
export interface ScenarioObjectiveDefinition {
  readonly key: string;
  readonly initialCountdown: number;
  readonly predicate: ScenarioObjectivePredicate;
  readonly successMessageId: number;
  readonly failureMessageId: number;
  readonly loseGameOnFailure: boolean;
}

/**
 * Mutable-in-time runtime state for one objective definition.
 *
 * Parity note:
 * - This state replaces `ScoreType` + `ScoreWait` countdown coupling from
 *   `SendMessages` in `ref/micropolis/src/sim/s_msg.c`.
 */
export interface ScenarioObjectiveRuntimeState {
  readonly key: string;
  readonly active: boolean;
  readonly countdown: number;
  readonly definition: ScenarioObjectiveDefinition;
}

/**
 * Result of one objective runtime tick.
 *
 * Parity note:
 * - `shouldEvaluate` is true exactly when C would call `DoScenarioScore`
 *   after decrementing `ScoreWait` to zero in `SendMessages`.
 */
export interface ScenarioObjectiveTickResult {
  readonly state: ScenarioObjectiveRuntimeState;
  readonly shouldEvaluate: boolean;
}

/**
 * Declarative scenario runtime definition.
 *
 * Parity note:
 * - Replaces `ScenarioID` switch branching with explicit data inputs while
 *   preserving the same countdown/event/objective behavior domains as C.
 */
export interface ScenarioRuntimeDefinition {
  readonly key: string;
  readonly events: readonly ScenarioEventDefinition[];
  readonly objective?: ScenarioObjectiveDefinition;
}

/**
 * Runtime state for one active scenario definition.
 *
 * Parity note:
 * - Holds the state C previously spread across `DisasterEvent`, `DisasterWait`,
 *   `ScoreType`, and `ScoreWait`.
 */
export interface ScenarioRuntimeState {
  readonly key: string;
  readonly events: readonly ScenarioEventRuntimeState[];
  readonly objective?: ScenarioObjectiveRuntimeState;
}

/**
 * Outcome of objective evaluation after countdown completion.
 *
 * Parity note:
 * - Mirrors `DoScenarioScore` outcome split between success (`-100`) and
 *   failure (`-200` + lose-game hook), but message ids are declarative inputs.
 */
export interface ScenarioObjectiveResolution {
  readonly success: boolean;
  readonly messageId: number;
  readonly shouldLoseGame: boolean;
}

/**
 * Result of one scenario runtime tick.
 *
 * Parity note:
 * - `eventActions` are disaster/message intents from event rules.
 * - `objectiveShouldEvaluate` tracks the exact point where C would invoke
 *   `DoScenarioScore` from `SendMessages`.
 */
export interface ScenarioRuntimeAdvanceResult {
  readonly state: ScenarioRuntimeState;
  readonly eventActions: readonly ScenarioRuntimeAction[];
  readonly objectiveShouldEvaluate: boolean;
}

const compareMetricValue = (
  left: number,
  op: ScenarioObjectiveComparison,
  right: number,
): boolean => {
  switch (op) {
    case 'gt':
      return left > right;
    case 'gte':
      return left >= right;
    case 'lt':
      return left < right;
    case 'lte':
      return left <= right;
    case 'eq':
      return left === right;
    case 'neq':
      return left !== right;
    default:
      return false;
  }
};

const isNonNegativeInteger = (value: number): boolean => Number.isInteger(value) && value >= 0;

const assertNonNegativeInteger = (name: string, value: number): void => {
  if (!isNonNegativeInteger(value)) {
    throw new Error(`${name} must be a non-negative integer`);
  }
};

const assertPositiveInteger = (name: string, value: number): void => {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
};

const eventRuleMatchesCountdown = (rule: ScenarioEventRule, countdown: number): boolean => {
  const when = rule.when;
  switch (when.kind) {
    case 'always':
      return true;
    case 'countdown-equals':
      return countdown === when.value;
    case 'countdown-every':
      return countdown % when.interval === 0;
    default:
      return false;
  }
};

/**
 * Initializes event runtime state from a declarative definition.
 *
 * Mirrors C setup of `DisasterEvent` + `DisasterWait` in `DoSimInit`
 * (`ref/micropolis/src/sim/s_sim.c`), with event key/rule metadata replacing
 * hardcoded `ScenarioID` switch logic.
 */
export function createScenarioEventRuntimeState(
  definition: ScenarioEventDefinition,
): ScenarioEventRuntimeState {
  assertNonNegativeInteger('event.initialCountdown', definition.initialCountdown);

  for (const rule of definition.rules) {
    if (rule.when.kind === 'countdown-equals') {
      assertNonNegativeInteger('event.rules[].when.value', rule.when.value);
      continue;
    }
    if (rule.when.kind === 'countdown-every') {
      assertPositiveInteger('event.rules[].when.interval', rule.when.interval);
    }
  }

  return {
    key: definition.key,
    active: true,
    countdown: definition.initialCountdown,
    rules: definition.rules,
  };
}

/**
 * Advances one event countdown tick and emits matching actions.
 *
 * Mirrors `ScenarioDisaster` tick order in `ref/micropolis/src/sim/s_disast.c`:
 * 1. Evaluate rule conditions against current countdown.
 * 2. Decrement when countdown is non-zero.
 * 3. Deactivate when countdown reaches zero and runs once more.
 */
export function tickScenarioEventRuntimeState(
  state: ScenarioEventRuntimeState,
): ScenarioEventTickResult {
  if (!state.active) {
    return {
      state,
      actions: [],
    };
  }

  const actions: ScenarioRuntimeAction[] = [];
  for (const rule of state.rules) {
    if (eventRuleMatchesCountdown(rule, state.countdown)) {
      actions.push(rule.action);
    }
  }

  let nextCountdown = state.countdown;
  let nextActive: boolean = state.active;

  if (nextCountdown > 0) {
    nextCountdown -= 1;
  } else {
    nextActive = false;
  }

  return {
    state: {
      key: state.key,
      active: nextActive,
      countdown: nextCountdown,
      rules: state.rules,
    },
    actions,
  };
}

/**
 * Recursively evaluates one objective predicate tree against metric values.
 *
 * Parity note:
 * - Metric leaf checks are 1:1 with `DoScenarioScore` relational comparisons in
 *   `ref/micropolis/src/sim/s_msg.c`.
 * - Composite nodes (`all`/`any`/`not`) are a declarative extension planned for
 *   authored scenarios.
 */
export function evaluateScenarioObjectivePredicate(
  predicate: ScenarioObjectivePredicate,
  metrics: ScenarioObjectiveMetricValues,
): boolean {
  switch (predicate.kind) {
    case 'metric':
      return compareMetricValue(metrics[predicate.metric], predicate.op, predicate.value);
    case 'all':
      return predicate.predicates.every((child) =>
        evaluateScenarioObjectivePredicate(child, metrics),
      );
    case 'any':
      return predicate.predicates.some((child) =>
        evaluateScenarioObjectivePredicate(child, metrics),
      );
    case 'not':
      return !evaluateScenarioObjectivePredicate(predicate.predicate, metrics);
    default:
      return false;
  }
}

/**
 * Initializes objective runtime state from a declarative definition.
 *
 * Mirrors C setup of `ScoreType` + `ScoreWait` in `DoSimInit`
 * (`ref/micropolis/src/sim/s_sim.c`), with predicate/message details supplied
 * declaratively instead of numeric scenario ids.
 */
export function createScenarioObjectiveRuntimeState(
  definition: ScenarioObjectiveDefinition,
): ScenarioObjectiveRuntimeState {
  assertNonNegativeInteger('objective.initialCountdown', definition.initialCountdown);

  return {
    key: definition.key,
    active: definition.initialCountdown > 0,
    countdown: definition.initialCountdown,
    definition,
  };
}

/**
 * Advances objective countdown by one tick.
 *
 * Mirrors `SendMessages` countdown behavior in `ref/micropolis/src/sim/s_msg.c`:
 * - Decrement only while countdown is non-zero.
 * - Evaluate once exactly when the decremented value reaches zero.
 */
export function tickScenarioObjectiveRuntimeState(
  state: ScenarioObjectiveRuntimeState,
): ScenarioObjectiveTickResult {
  if (!state.active || state.countdown <= 0) {
    return {
      state: {
        key: state.key,
        active: false,
        countdown: state.countdown < 0 ? 0 : state.countdown,
        definition: state.definition,
      },
      shouldEvaluate: false,
    };
  }

  const nextCountdown = state.countdown - 1;
  const shouldEvaluate = nextCountdown === 0;

  return {
    state: {
      key: state.key,
      active: !shouldEvaluate,
      countdown: nextCountdown,
      definition: state.definition,
    },
    shouldEvaluate,
  };
}

/**
 * Resolves objective success/failure outcome once evaluation is due.
 *
 * Mirrors `DoScenarioScore` in `ref/micropolis/src/sim/s_msg.c` for success vs
 * failure branching, while replacing hardcoded message ids with declarative ids.
 */
export function resolveScenarioObjective(
  definition: ScenarioObjectiveDefinition,
  metrics: ScenarioObjectiveMetricValues,
): ScenarioObjectiveResolution {
  const success = evaluateScenarioObjectivePredicate(definition.predicate, metrics);
  if (success) {
    return {
      success: true,
      messageId: definition.successMessageId,
      shouldLoseGame: false,
    };
  }

  return {
    success: false,
    messageId: definition.failureMessageId,
    shouldLoseGame: definition.loseGameOnFailure,
  };
}

/**
 * Initializes full scenario runtime state from declarative inputs.
 *
 * Parity note:
 * - Consolidates the C-initialized countdown fields (`DisasterWait`, `ScoreWait`)
 *   into one keyed state object for id-decoupled runtime wiring.
 */
export function createScenarioRuntimeState(
  definition: ScenarioRuntimeDefinition,
): ScenarioRuntimeState {
  return {
    key: definition.key,
    events: definition.events.map((event) => createScenarioEventRuntimeState(event)),
    objective:
      definition.objective === undefined
        ? undefined
        : createScenarioObjectiveRuntimeState(definition.objective),
  };
}

/**
 * Advances complete scenario runtime state by one tick.
 *
 * Parity note:
 * - Event ticking mirrors `ScenarioDisaster` countdown progression.
 * - Objective ticking mirrors `SendMessages` -> `DoScenarioScore` countdown trigger.
 * - This function emits declarative intents only; host sim systems apply effects.
 */
export function advanceScenarioRuntimeState(
  state: ScenarioRuntimeState,
): ScenarioRuntimeAdvanceResult {
  const nextEvents: ScenarioEventRuntimeState[] = [];
  const eventActions: ScenarioRuntimeAction[] = [];

  for (const eventState of state.events) {
    const tickResult = tickScenarioEventRuntimeState(eventState);
    nextEvents.push(tickResult.state);
    for (const action of tickResult.actions) {
      eventActions.push(action);
    }
  }

  let objectiveShouldEvaluate = false;
  let nextObjective = state.objective;
  if (state.objective !== undefined) {
    const objectiveTick = tickScenarioObjectiveRuntimeState(state.objective);
    nextObjective = objectiveTick.state;
    objectiveShouldEvaluate = objectiveTick.shouldEvaluate;
  }

  return {
    state: {
      key: state.key,
      events: nextEvents,
      objective: nextObjective,
    },
    eventActions,
    objectiveShouldEvaluate,
  };
}
