import type {
  ScenarioEventDefinition,
  ScenarioObjectiveDefinition,
  ScenarioRuntimeDefinition,
} from './runtime-state.ts';

const CLASSIC_SCENARIO_ID_MIN = 1;
const CLASSIC_SCENARIO_ID_MAX = 8;
const SCENARIO_SUCCESS_MESSAGE_ID = -100;
const SCENARIO_FAILURE_MESSAGE_ID = -200;

const DISASTER_WAIT_BY_SCENARIO_ID = [0, 2, 10, 5, 20, 3, 5, 5, 2 * 48] as const;
const SCORE_WAIT_BY_SCENARIO_ID = [
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

/**
 * Canonical runtime-only key for one classic built-in scenario.
 *
 * Mapping note:
 * - Keys follow the Stage 0/1 `builtin/*` convention for canonical scenario identity.
 * - Legacy numeric ids originate from `LoadScenario(short s)` in
 *   `ref/micropolis/src/sim/s_fileio.c`.
 */
export type ClassicBuiltinScenarioKey =
  | 'builtin/dullsville'
  | 'builtin/san-francisco'
  | 'builtin/hamburg'
  | 'builtin/bern'
  | 'builtin/tokyo'
  | 'builtin/detroit'
  | 'builtin/boston'
  | 'builtin/rio-de-janeiro';

interface ClassicBuiltinScenarioRuntimeEntry {
  readonly legacyScenarioId: number;
  readonly runtimeDefinition: ScenarioRuntimeDefinition;
}

/**
 * Normalizes classic scenario ids to the C-supported range `1..8`.
 * Mirrors `LoadScenario(short s)` id bounds from `ref/micropolis/src/sim/s_fileio.c`,
 * using `0` as the non-scenario sentinel in sim-core runtime wiring.
 */
const normalizeClassicScenarioId = (value: number): number => {
  if (!Number.isInteger(value)) {
    return 0;
  }
  if (value < CLASSIC_SCENARIO_ID_MIN || value > CLASSIC_SCENARIO_ID_MAX) {
    return 0;
  }
  return value;
};

/**
 * Builds the classic objective variant used by Tokyo/Boston/Rio.
 * Mirrors `DoScenarioScore` `CityScore > 500` checks for scenario ids 5/7/8 in
 * `ref/micropolis/src/sim/s_msg.c`.
 */
const makeDefaultObjective = (
  scenarioKey: ClassicBuiltinScenarioKey,
): ScenarioObjectiveDefinition => ({
  key: `${scenarioKey}/objective`,
  initialCountdown: scoreCountdownForScenarioKey(scenarioKey),
  predicate: {
    kind: 'metric',
    metric: 'city-score',
    op: 'gt',
    value: 500,
  },
  successMessageId: SCENARIO_SUCCESS_MESSAGE_ID,
  failureMessageId: SCENARIO_FAILURE_MESSAGE_ID,
  loseGameOnFailure: true,
});

/**
 * Builds one classic objective definition by canonical `builtin/*` key.
 * Mirrors scenario-specific checks in `DoScenarioScore` from
 * `ref/micropolis/src/sim/s_msg.c` with declarative predicate payloads.
 */
const objectiveDefinitionForScenarioKey = (
  scenarioKey: ClassicBuiltinScenarioKey,
): ScenarioObjectiveDefinition => {
  switch (scenarioKey) {
    case 'builtin/dullsville':
    case 'builtin/san-francisco':
    case 'builtin/hamburg':
      return {
        key: `${scenarioKey}/objective`,
        initialCountdown: scoreCountdownForScenarioKey(scenarioKey),
        predicate: {
          kind: 'metric',
          metric: 'city-class',
          op: 'gte',
          value: 4,
        },
        successMessageId: SCENARIO_SUCCESS_MESSAGE_ID,
        failureMessageId: SCENARIO_FAILURE_MESSAGE_ID,
        loseGameOnFailure: true,
      };
    case 'builtin/bern':
      return {
        key: `${scenarioKey}/objective`,
        initialCountdown: scoreCountdownForScenarioKey(scenarioKey),
        predicate: {
          kind: 'metric',
          metric: 'traffic-average',
          op: 'lt',
          value: 80,
        },
        successMessageId: SCENARIO_SUCCESS_MESSAGE_ID,
        failureMessageId: SCENARIO_FAILURE_MESSAGE_ID,
        loseGameOnFailure: true,
      };
    case 'builtin/detroit':
      return {
        key: `${scenarioKey}/objective`,
        initialCountdown: scoreCountdownForScenarioKey(scenarioKey),
        predicate: {
          kind: 'metric',
          metric: 'crime-average',
          op: 'lt',
          value: 60,
        },
        successMessageId: SCENARIO_SUCCESS_MESSAGE_ID,
        failureMessageId: SCENARIO_FAILURE_MESSAGE_ID,
        loseGameOnFailure: true,
      };
    case 'builtin/tokyo':
    case 'builtin/boston':
    case 'builtin/rio-de-janeiro':
      return makeDefaultObjective(scenarioKey);
  }
};

/**
 * Builds one classic disaster event definition by canonical `builtin/*` key.
 * Mirrors per-scenario branches in `ScenarioDisaster` from
 * `ref/micropolis/src/sim/s_disast.c`.
 */
const eventDefinitionForScenarioKey = (
  scenarioKey: ClassicBuiltinScenarioKey,
): ScenarioEventDefinition => {
  switch (scenarioKey) {
    case 'builtin/san-francisco':
      return {
        key: `${scenarioKey}/event`,
        initialCountdown: disasterCountdownForScenarioKey(scenarioKey),
        rules: [
          {
            when: { kind: 'countdown-equals', value: 1 },
            action: { kind: 'make-earthquake' },
          },
        ],
      };
    case 'builtin/hamburg':
      return {
        key: `${scenarioKey}/event`,
        initialCountdown: disasterCountdownForScenarioKey(scenarioKey),
        rules: [{ when: { kind: 'always' }, action: { kind: 'drop-fire-bombs' } }],
      };
    case 'builtin/tokyo':
      return {
        key: `${scenarioKey}/event`,
        initialCountdown: disasterCountdownForScenarioKey(scenarioKey),
        rules: [
          {
            when: { kind: 'countdown-equals', value: 1 },
            action: { kind: 'make-monster' },
          },
        ],
      };
    case 'builtin/boston':
      return {
        key: `${scenarioKey}/event`,
        initialCountdown: disasterCountdownForScenarioKey(scenarioKey),
        rules: [
          {
            when: { kind: 'countdown-equals', value: 1 },
            action: { kind: 'make-meltdown' },
          },
        ],
      };
    case 'builtin/rio-de-janeiro':
      return {
        key: `${scenarioKey}/event`,
        initialCountdown: disasterCountdownForScenarioKey(scenarioKey),
        rules: [
          {
            when: { kind: 'countdown-every', interval: 24 },
            action: { kind: 'make-flood' },
          },
        ],
      };
    case 'builtin/dullsville':
    case 'builtin/bern':
    case 'builtin/detroit':
      return {
        key: `${scenarioKey}/event`,
        initialCountdown: disasterCountdownForScenarioKey(scenarioKey),
        rules: [],
      };
  }
};

const CLASSIC_BUILTIN_SCENARIO_KEYS_BY_ID = [
  '',
  'builtin/dullsville',
  'builtin/san-francisco',
  'builtin/hamburg',
  'builtin/bern',
  'builtin/tokyo',
  'builtin/detroit',
  'builtin/boston',
  'builtin/rio-de-janeiro',
] as const;

const CLASSIC_BUILTIN_SCENARIO_KEYS: readonly ClassicBuiltinScenarioKey[] =
  CLASSIC_BUILTIN_SCENARIO_KEYS_BY_ID.slice(1) as readonly ClassicBuiltinScenarioKey[];

/**
 * Builds one declarative runtime definition from canonical `builtin/*` key data.
 * Mirrors classic countdown + disaster + objective setup from
 * `DoSimInit`, `ScenarioDisaster`, and `DoScenarioScore` in
 * `ref/micropolis/src/sim/s_sim.c`, `s_disast.c`, and `s_msg.c`.
 */
const runtimeDefinitionForScenarioKey = (
  scenarioKey: ClassicBuiltinScenarioKey,
): ScenarioRuntimeDefinition => ({
  key: scenarioKey,
  events: [eventDefinitionForScenarioKey(scenarioKey)],
  objective: objectiveDefinitionForScenarioKey(scenarioKey),
});

const CLASSIC_BUILTIN_RUNTIME_ENTRIES: readonly ClassicBuiltinScenarioRuntimeEntry[] =
  Object.freeze(
    CLASSIC_BUILTIN_SCENARIO_KEYS.map((scenarioKey, index) => {
      const legacyScenarioId = index + 1;
      return {
        legacyScenarioId,
        runtimeDefinition: runtimeDefinitionForScenarioKey(scenarioKey),
      };
    }),
  );

const RUNTIME_BY_KEY: Readonly<Record<ClassicBuiltinScenarioKey, ScenarioRuntimeDefinition>> =
  CLASSIC_BUILTIN_RUNTIME_ENTRIES.reduce(
    (accumulator, entry) => ({
      ...accumulator,
      [entry.runtimeDefinition.key]: entry.runtimeDefinition,
    }),
    {} as Record<ClassicBuiltinScenarioKey, ScenarioRuntimeDefinition>,
  );

const RUNTIME_BY_LEGACY_ID: Readonly<Record<number, ScenarioRuntimeDefinition>> =
  CLASSIC_BUILTIN_RUNTIME_ENTRIES.reduce(
    (accumulator, entry) => ({
      ...accumulator,
      [entry.legacyScenarioId]: entry.runtimeDefinition,
    }),
    {} as Record<number, ScenarioRuntimeDefinition>,
  );

/**
 * Declarative runtime definitions for all 8 classic built-in scenarios.
 *
 * Mapping note:
 * - Disaster countdown constants mirror `DisTab` in `ref/micropolis/src/sim/s_sim.c`.
 * - Objective countdown constants mirror `ScoreWaitTab` in `ref/micropolis/src/sim/s_sim.c`.
 * - Event rules mirror `ScenarioDisaster` in `ref/micropolis/src/sim/s_disast.c`.
 * - Objective predicates mirror `DoScenarioScore` in `ref/micropolis/src/sim/s_msg.c`.
 * - This replaces numeric-id runtime branching with canonical `builtin/*` keys.
 */
export const CLASSIC_BUILTIN_SCENARIO_RUNTIMES: readonly ScenarioRuntimeDefinition[] =
  CLASSIC_BUILTIN_RUNTIME_ENTRIES.map((entry) => entry.runtimeDefinition);

/**
 * Resolves the `builtin/*` key for a classic legacy numeric scenario id.
 *
 * Mapping note:
 * - Legacy ids mirror `LoadScenario(short s)` range `1..8` from
 *   `ref/micropolis/src/sim/s_fileio.c`.
 * - Returns `undefined` for non-integral/out-of-range ids to match
 *   sim-core's non-scenario (`0`) semantics.
 */
export function classicBuiltinScenarioKeyForLegacyId(
  scenarioId: number,
): ClassicBuiltinScenarioKey | undefined {
  const normalizedId = normalizeClassicScenarioId(scenarioId);
  if (!normalizedId) {
    return undefined;
  }

  return CLASSIC_BUILTIN_SCENARIO_KEYS_BY_ID[normalizedId] as ClassicBuiltinScenarioKey;
}

/**
 * Reads a classic declarative runtime definition by canonical `builtin/*` key.
 *
 * Mapping note:
 * - Definitions port C scenario logic from `s_sim.c`, `s_disast.c`, and `s_msg.c`.
 * - Returns `undefined` when the key is not one of the 8 classic built-ins.
 */
export function getClassicBuiltinScenarioRuntimeDefinition(
  scenarioKey: string,
): ScenarioRuntimeDefinition | undefined {
  return RUNTIME_BY_KEY[scenarioKey as ClassicBuiltinScenarioKey];
}

/**
 * Reads a classic declarative runtime definition by legacy numeric scenario id.
 *
 * Mapping note:
 * - Legacy ids mirror `LoadScenario(short s)` ids from
 *   `ref/micropolis/src/sim/s_fileio.c`.
 * - Returned definition is keyed by `builtin/*`, not `legacy/*`.
 */
export function getClassicBuiltinScenarioRuntimeDefinitionByLegacyId(
  scenarioId: number,
): ScenarioRuntimeDefinition | undefined {
  const normalizedId = normalizeClassicScenarioId(scenarioId);
  if (!normalizedId) {
    return undefined;
  }

  return RUNTIME_BY_LEGACY_ID[normalizedId];
}

/**
 * Returns C-parity scenario disaster countdown for one `builtin/*` key.
 *
 * Mapping note:
 * - Mirrors `DisTab` initialization in `DoSimInit` (`ref/micropolis/src/sim/s_sim.c`).
 */
export function disasterCountdownForScenarioKey(scenarioKey: ClassicBuiltinScenarioKey): number {
  const legacyId = CLASSIC_BUILTIN_SCENARIO_KEYS_BY_ID.indexOf(scenarioKey);
  const countdown = DISASTER_WAIT_BY_SCENARIO_ID[legacyId];
  if (countdown === undefined) {
    throw new Error(`missing disaster countdown for scenario key: ${scenarioKey}`);
  }
  return countdown;
}

/**
 * Returns C-parity scenario score countdown for one `builtin/*` key.
 *
 * Mapping note:
 * - Mirrors `ScoreWaitTab` initialization in `DoSimInit`
 *   (`ref/micropolis/src/sim/s_sim.c`).
 */
export function scoreCountdownForScenarioKey(scenarioKey: ClassicBuiltinScenarioKey): number {
  const legacyId = CLASSIC_BUILTIN_SCENARIO_KEYS_BY_ID.indexOf(scenarioKey);
  const countdown = SCORE_WAIT_BY_SCENARIO_ID[legacyId];
  if (countdown === undefined) {
    throw new Error(`missing score countdown for scenario key: ${scenarioKey}`);
  }
  return countdown;
}
