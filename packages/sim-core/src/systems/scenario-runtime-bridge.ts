import {
  createScenarioRuntimeState,
  type ScenarioEventDefinition,
  type ScenarioObjectiveDefinition,
  type ScenarioRuntimeDefinition,
  type ScenarioRuntimeState,
} from '../../../scenario-runtime/src/index.ts';
import type { SimState } from '../core/sim-state.ts';

const LEGACY_DISASTER_WAIT_BY_ID = [0, 2, 10, 5, 20, 3, 5, 5, 2 * 48] as const;
const LEGACY_SCORE_WAIT_BY_ID = [
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

interface SimScenarioRuntimeEntry {
  readonly legacyScenarioId: number;
  readonly runtimeDefinition: ScenarioRuntimeDefinition;
  readonly runtimeState: ScenarioRuntimeState;
}

const SCENARIO_RUNTIME_BY_STATE = new WeakMap<SimState, SimScenarioRuntimeEntry>();

/**
 * Declarative scenario-runtime inputs injected into sim-core runtime paths.
 *
 * Mapping note:
 * - Replaces direct `ScenarioID` branch coupling in `DoSimInit`, `ScenarioDisaster`,
 *   and `SendMessages` from `ref/micropolis/src/sim/s_sim.c`,
 *   `ref/micropolis/src/sim/s_disast.c`, and `ref/micropolis/src/sim/s_msg.c`.
 * - `legacyScenarioId` is optional metadata used only to preserve legacy mirror
 *   fields (`DisasterEvent`, `ScoreType`) for compatibility while runtime logic
 *   executes from declarative state.
 */
export interface SimScenarioRuntimeInputs {
  readonly runtimeDefinition: ScenarioRuntimeDefinition;
  readonly legacyScenarioId?: number;
}

const normalizeLegacyScenarioId = (value: number): number => {
  if (!Number.isInteger(value)) {
    return 0;
  }
  if (value < 1 || value > 8) {
    return 0;
  }
  return value;
};

const legacyScenarioObjectiveDefinition = (
  scenarioId: number,
  initialCountdown: number,
): ScenarioObjectiveDefinition => {
  switch (scenarioId) {
    case 1:
    case 2:
    case 3:
      return {
        key: `legacy/scenario-${scenarioId}-objective`,
        initialCountdown,
        predicate: {
          kind: 'metric',
          metric: 'city-class',
          op: 'gte',
          value: 4,
        },
        successMessageId: -100,
        failureMessageId: -200,
        loseGameOnFailure: true,
      };
    case 4:
      return {
        key: 'legacy/scenario-4-objective',
        initialCountdown,
        predicate: {
          kind: 'metric',
          metric: 'traffic-average',
          op: 'lt',
          value: 80,
        },
        successMessageId: -100,
        failureMessageId: -200,
        loseGameOnFailure: true,
      };
    case 6:
      return {
        key: 'legacy/scenario-6-objective',
        initialCountdown,
        predicate: {
          kind: 'metric',
          metric: 'crime-average',
          op: 'lt',
          value: 60,
        },
        successMessageId: -100,
        failureMessageId: -200,
        loseGameOnFailure: true,
      };
    case 5:
    case 7:
    case 8:
      return {
        key: `legacy/scenario-${scenarioId}-objective`,
        initialCountdown,
        predicate: {
          kind: 'metric',
          metric: 'city-score',
          op: 'gt',
          value: 500,
        },
        successMessageId: -100,
        failureMessageId: -200,
        loseGameOnFailure: true,
      };
    default:
      throw new Error(`unsupported legacy scenario objective: ${scenarioId}`);
  }
};

const legacyScenarioEventDefinition = (
  scenarioId: number,
  initialCountdown: number,
): ScenarioEventDefinition => {
  switch (scenarioId) {
    case 2:
      return {
        key: 'legacy/scenario-2-disaster',
        initialCountdown,
        rules: [
          {
            when: { kind: 'countdown-equals', value: 1 },
            action: { kind: 'make-earthquake' },
          },
        ],
      };
    case 3:
      return {
        key: 'legacy/scenario-3-disaster',
        initialCountdown,
        rules: [{ when: { kind: 'always' }, action: { kind: 'drop-fire-bombs' } }],
      };
    case 5:
      return {
        key: 'legacy/scenario-5-disaster',
        initialCountdown,
        rules: [
          {
            when: { kind: 'countdown-equals', value: 1 },
            action: { kind: 'make-monster' },
          },
        ],
      };
    case 7:
      return {
        key: 'legacy/scenario-7-disaster',
        initialCountdown,
        rules: [
          {
            when: { kind: 'countdown-equals', value: 1 },
            action: { kind: 'make-meltdown' },
          },
        ],
      };
    case 8:
      return {
        key: 'legacy/scenario-8-disaster',
        initialCountdown,
        rules: [
          {
            when: { kind: 'countdown-every', interval: 24 },
            action: { kind: 'make-flood' },
          },
        ],
      };
    case 1:
    case 4:
    case 6:
      return {
        key: `legacy/scenario-${scenarioId}-disaster`,
        initialCountdown,
        rules: [],
      };
    default:
      throw new Error(`unsupported legacy scenario event: ${scenarioId}`);
  }
};

/**
 * Builds a declarative runtime definition for one classic numeric scenario id.
 *
 * Mapping note:
 * - Mirrors classic countdown setup from `DisTab`/`ScoreWaitTab` in
 *   `ref/micropolis/src/sim/s_sim.c` and condition logic in
 *   `ref/micropolis/src/sim/s_disast.c` + `ref/micropolis/src/sim/s_msg.c`.
 * - This is a transition adapter for id-decoupled runtime wiring; Stage 1.3
 *   will replace this legacy-id builder with canonical `builtin/*` definitions.
 */
export function createLegacyScenarioRuntimeDefinition(
  scenarioId: number,
): ScenarioRuntimeDefinition | undefined {
  const normalizedScenarioId = normalizeLegacyScenarioId(scenarioId);
  if (!normalizedScenarioId) {
    return undefined;
  }

  const initialDisasterCountdown = LEGACY_DISASTER_WAIT_BY_ID[normalizedScenarioId];
  const initialScoreCountdown = LEGACY_SCORE_WAIT_BY_ID[normalizedScenarioId];
  if (initialDisasterCountdown === undefined || initialScoreCountdown === undefined) {
    return undefined;
  }

  return {
    key: `legacy/scenario-${normalizedScenarioId}`,
    events: [legacyScenarioEventDefinition(normalizedScenarioId, initialDisasterCountdown)],
    objective: legacyScenarioObjectiveDefinition(normalizedScenarioId, initialScoreCountdown),
  };
}

/**
 * Returns true when this sim state has declarative scenario-runtime state.
 *
 * Mapping note:
 * - This tracks whether sim-core should run scenario countdown logic through the
 *   declarative runtime instead of direct `ScenarioID` branches.
 */
export function hasSimScenarioRuntimeState(state: SimState): boolean {
  return SCENARIO_RUNTIME_BY_STATE.has(state);
}

/**
 * Reads the active declarative runtime state for this simulation state.
 *
 * Mapping note:
 * - Runtime state replaces repeated `DisasterEvent`/`DisasterWait` and
 *   `ScoreType`/`ScoreWait` branching in C tick paths.
 */
export function getSimScenarioRuntimeState(state: SimState): ScenarioRuntimeState | undefined {
  return SCENARIO_RUNTIME_BY_STATE.get(state)?.runtimeState;
}

/**
 * Writes updated declarative runtime state and refreshes compatibility mirrors.
 *
 * Mapping note:
 * - Keeps legacy scalar mirrors aligned so save/load and compatibility tests can
 *   continue reading the same countdown fields while runtime logic is decoupled.
 */
export function setSimScenarioRuntimeState(
  state: SimState,
  runtimeState: ScenarioRuntimeState,
): void {
  const current = SCENARIO_RUNTIME_BY_STATE.get(state);
  if (current === undefined) {
    return;
  }

  SCENARIO_RUNTIME_BY_STATE.set(state, {
    legacyScenarioId: current.legacyScenarioId,
    runtimeDefinition: current.runtimeDefinition,
    runtimeState,
  });

  syncLegacyScenarioRuntimeMirrors(state);
}

/**
 * Configures scenario-runtime inputs directly and initializes runtime state.
 *
 * Mapping note:
 * - Replaces C's numeric scenario bootstrap with declarative `ScenarioRuntimeDefinition`
 *   input while preserving compatibility mirrors.
 */
export function setSimScenarioRuntimeInputs(
  state: SimState,
  inputs: SimScenarioRuntimeInputs | undefined,
): void {
  if (inputs === undefined) {
    SCENARIO_RUNTIME_BY_STATE.delete(state);
    state.DisasterEvent = 0;
    state.DisasterWait = 0;
    state.ScoreType = 0;
    state.ScoreWait = 0;
    return;
  }

  SCENARIO_RUNTIME_BY_STATE.set(state, {
    legacyScenarioId: normalizeLegacyScenarioId(inputs.legacyScenarioId ?? 0),
    runtimeDefinition: inputs.runtimeDefinition,
    runtimeState: createScenarioRuntimeState(inputs.runtimeDefinition),
  });

  syncLegacyScenarioRuntimeMirrors(state);
}

/**
 * Configures legacy scenario runtime by numeric id.
 *
 * Mapping note:
 * - Mirrors `DoSimInit` legacy `ScenarioID` setup in `ref/micropolis/src/sim/s_sim.c`.
 * - Used as a compatibility fallback while Stage 1 transitions all callers to
 *   explicit scenario-runtime inputs.
 */
export function setLegacySimScenarioRuntimeById(state: SimState, scenarioId: number): void {
  const runtimeDefinition = createLegacyScenarioRuntimeDefinition(scenarioId);
  if (runtimeDefinition === undefined) {
    setSimScenarioRuntimeInputs(state, undefined);
    return;
  }

  setSimScenarioRuntimeInputs(state, {
    legacyScenarioId: scenarioId,
    runtimeDefinition,
  });
}

/**
 * Syncs compatibility scalar mirrors from declarative runtime state.
 *
 * Mapping note:
 * - Preserves observable `DisasterEvent`/`DisasterWait` and
 *   `ScoreType`/`ScoreWait` behavior expected by existing save/parity tests,
 *   while tick execution is driven by declarative runtime state.
 */
export function syncLegacyScenarioRuntimeMirrors(state: SimState): void {
  const current = SCENARIO_RUNTIME_BY_STATE.get(state);
  if (current === undefined) {
    state.DisasterEvent = 0;
    state.DisasterWait = 0;
    state.ScoreType = 0;
    state.ScoreWait = 0;
    return;
  }

  const firstEvent = current.runtimeState.events[0];
  const hasActiveEvent = current.runtimeState.events.some((eventState) => eventState.active);

  state.DisasterEvent = hasActiveEvent ? current.legacyScenarioId : 0;
  state.DisasterWait = firstEvent?.countdown ?? 0;

  const objectiveState = current.runtimeState.objective;
  state.ScoreType = objectiveState === undefined ? 0 : current.legacyScenarioId;
  state.ScoreWait = objectiveState?.countdown ?? 0;
}
