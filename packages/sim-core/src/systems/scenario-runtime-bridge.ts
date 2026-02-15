import {
  createScenarioRuntimeState,
  getClassicBuiltinScenarioRuntimeDefinitionByLegacyId,
  getClassicScenarioBehaviorProfileByLegacyId,
  getClassicScenarioBehaviorProfileByScenarioKey,
  getDefaultScenarioBehaviorProfile,
  getScenarioBehaviorProfile,
  type ScenarioBehaviorProfile,
  type ScenarioBehaviorProfileKey,
  type ScenarioRuntimeDefinition,
  type ScenarioRuntimeState,
} from '../../../scenario-runtime/src/index.ts';
import type { SimState } from '../core/sim-state.ts';

interface SimScenarioRuntimeEntry {
  readonly legacyScenarioId: number;
  readonly behaviorProfile: ScenarioBehaviorProfile;
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
  /**
   * Optional closed behavior profile key for runtime-only behavior variants.
   *
   * Mapping note:
   * - Micropolis C used direct global `ScenarioID` checks for behavior variants
   *   (for example ship honk behavior in `ref/micropolis/src/sim/w_sprite.c`).
   * - This optional key is an intentional declarative override for the
   *   decoupled runtime profile registry.
   */
  readonly behaviorProfileKey?: ScenarioBehaviorProfileKey;
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

/**
 * Builds a declarative runtime definition for one classic numeric scenario id.
 *
 * Mapping note:
 * - Legacy ids mirror `LoadScenario(short s)` in `ref/micropolis/src/sim/s_fileio.c`.
 * - Runtime behavior is read from canonical `builtin/*` declarative definitions
 *   in `@city/scenario-runtime`, which port countdown/event/objective parity from
 *   `s_sim.c`, `s_disast.c`, and `s_msg.c`.
 */
export function createLegacyScenarioRuntimeDefinition(
  scenarioId: number,
): ScenarioRuntimeDefinition | undefined {
  const normalizedScenarioId = normalizeLegacyScenarioId(scenarioId);
  if (!normalizedScenarioId) {
    return undefined;
  }

  return getClassicBuiltinScenarioRuntimeDefinitionByLegacyId(normalizedScenarioId);
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
 * Reads active scenario behavior profile for this simulation state.
 *
 * Mapping note:
 * - Replaces direct global `ScenarioID` behavior branching from C sprite logic
 *   (notably `DoShipSprite` in `ref/micropolis/src/sim/w_sprite.c`) with a
 *   closed profile lookup.
 * - Returns the default profile when no declarative scenario runtime is active.
 */
export function getSimScenarioBehaviorProfile(state: SimState): ScenarioBehaviorProfile {
  const current = SCENARIO_RUNTIME_BY_STATE.get(state);
  if (current === undefined) {
    return getDefaultScenarioBehaviorProfile();
  }
  return current.behaviorProfile;
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
    behaviorProfile: current.behaviorProfile,
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

  const legacyScenarioId = normalizeLegacyScenarioId(inputs.legacyScenarioId ?? 0);
  SCENARIO_RUNTIME_BY_STATE.set(state, {
    legacyScenarioId,
    behaviorProfile: resolveScenarioBehaviorProfile({
      runtimeDefinition: inputs.runtimeDefinition,
      legacyScenarioId,
      behaviorProfileKey: inputs.behaviorProfileKey,
    }),
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

interface ResolveScenarioBehaviorProfileInputs {
  readonly runtimeDefinition: ScenarioRuntimeDefinition;
  readonly legacyScenarioId: number;
  readonly behaviorProfileKey: ScenarioBehaviorProfileKey | undefined;
}

const resolveScenarioBehaviorProfile = (
  inputs: ResolveScenarioBehaviorProfileInputs,
): ScenarioBehaviorProfile => {
  if (inputs.behaviorProfileKey !== undefined) {
    const fromExplicitKey = getScenarioBehaviorProfile(inputs.behaviorProfileKey);
    if (fromExplicitKey !== undefined) {
      return fromExplicitKey;
    }
  }

  const fromLegacyId = getClassicScenarioBehaviorProfileByLegacyId(inputs.legacyScenarioId);
  if (fromLegacyId !== undefined) {
    return fromLegacyId;
  }

  const fromScenarioKey = getClassicScenarioBehaviorProfileByScenarioKey(
    inputs.runtimeDefinition.key,
  );
  if (fromScenarioKey !== undefined) {
    return fromScenarioKey;
  }

  return getDefaultScenarioBehaviorProfile();
};
