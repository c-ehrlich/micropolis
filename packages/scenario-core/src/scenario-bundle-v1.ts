import { z } from 'zod';

const SCENARIO_KEY_NAMESPACE_PREFIXES = ['builtin/', 'user/'] as const;
const MAP_FORM_CONFLICT_ERROR = 'map must include exactly one map form: cityFileBytes or tileWords';
const SCENARIO_OBJECTIVE_METRIC_KEYS = [
  'city-class',
  'traffic-average',
  'city-score',
  'crime-average',
] as const;
const SCENARIO_OBJECTIVE_COMPARISONS = ['gt', 'gte', 'lt', 'lte', 'eq', 'neq'] as const;
const SCENARIO_BEHAVIOR_PROFILE_KEYS = ['classic/default', 'classic/sf-ship-honk'] as const;

/**
 * Objective metric key domain persisted in Stage 4 authored bundle objectives.
 * Mirrors metrics read by `DoScenarioScore` in `ref/micropolis/src/sim/s_msg.c`,
 * represented as declarative keys for authored scenarios.
 */
export type ScenarioObjectiveMetricKeyV1 = (typeof SCENARIO_OBJECTIVE_METRIC_KEYS)[number];

/**
 * Objective comparison operators persisted in Stage 4 authored objectives.
 * Mirrors relational checks from `DoScenarioScore` in `ref/micropolis/src/sim/s_msg.c`.
 */
export type ScenarioObjectiveComparisonV1 = (typeof SCENARIO_OBJECTIVE_COMPARISONS)[number];

/**
 * Leaf objective predicate persisted for Stage 4 authored scenarios.
 * Mirrors one C-style objective comparison from `DoScenarioScore` in
 * `ref/micropolis/src/sim/s_msg.c`.
 */
export interface ScenarioObjectiveMetricPredicateV1 {
  readonly kind: 'metric';
  readonly metric: ScenarioObjectiveMetricKeyV1;
  readonly op: ScenarioObjectiveComparisonV1;
  readonly value: number;
}

/**
 * Conjunction objective predicate persisted for Stage 4 authored scenarios.
 * Not a direct Micropolis C struct: declarative composition over C-parity metric leaves.
 */
export interface ScenarioObjectiveAllPredicateV1 {
  readonly kind: 'all';
  readonly predicates: readonly ScenarioObjectivePredicateV1[];
}

/**
 * Disjunction objective predicate persisted for Stage 4 authored scenarios.
 * Not a direct Micropolis C struct: declarative composition over C-parity metric leaves.
 */
export interface ScenarioObjectiveAnyPredicateV1 {
  readonly kind: 'any';
  readonly predicates: readonly ScenarioObjectivePredicateV1[];
}

/**
 * Negation objective predicate persisted for Stage 4 authored scenarios.
 * Not a direct Micropolis C struct: declarative composition over C-parity metric leaves.
 */
export interface ScenarioObjectiveNotPredicateV1 {
  readonly kind: 'not';
  readonly predicate: ScenarioObjectivePredicateV1;
}

/**
 * Declarative objective predicate tree persisted in Stage 4 bundle exports.
 * Metric leaves preserve `DoScenarioScore` comparison domains from
 * `ref/micropolis/src/sim/s_msg.c`; composite nodes are declarative extensions.
 */
export type ScenarioObjectivePredicateV1 =
  | ScenarioObjectiveMetricPredicateV1
  | ScenarioObjectiveAllPredicateV1
  | ScenarioObjectiveAnyPredicateV1
  | ScenarioObjectiveNotPredicateV1;

/**
 * Stage 4 script trigger union persisted in scenario bundles.
 * Maps to `ScenarioDisaster` trigger styles from `ref/micropolis/src/sim/s_disast.c`,
 * represented as authoring-friendly JSON fields.
 */
export type ScenarioScriptTriggerV1 = { readonly atTick: number } | { readonly everyTicks: number };

/**
 * Stage 4 script action union persisted in scenario bundles.
 * Action kinds mirror disaster/objective side effects from
 * `ref/micropolis/src/sim/s_disast.c` and `ref/micropolis/src/sim/s_msg.c`.
 */
export type ScenarioScriptActionV1 =
  | { readonly kind: 'make-earthquake' }
  | { readonly kind: 'drop-fire-bombs' }
  | { readonly kind: 'make-monster' }
  | { readonly kind: 'make-meltdown' }
  | { readonly kind: 'make-flood' }
  | { readonly kind: 'send-message'; readonly messageId: number }
  | { readonly kind: 'lose-game' };

/**
 * One Stage 4 authored script event row persisted in scenario bundles.
 * This stores authoring trigger/action rows that map to scenario runtime event behavior.
 */
export interface ScenarioScriptEventV1 {
  readonly trigger: ScenarioScriptTriggerV1;
  readonly actions: readonly ScenarioScriptActionV1[];
}

/**
 * Closed behavior-profile key domain persisted in Stage 4 authored bundles.
 * Mirrors `ScenarioID` behavior branching in `DoShipSprite` from
 * `ref/micropolis/src/sim/w_sprite.c`, represented as declarative profile keys.
 */
export type ScenarioBehaviorProfileKeyV1 = (typeof SCENARIO_BEHAVIOR_PROFILE_KEYS)[number];

/**
 * Canonical scenario bundle version for Stage 0 contracts.
 * Not a 1:1 Micropolis C field: this wraps modern JSON metadata around map
 * payload semantics from `saveFile`/`loadFile` in `ref/micropolis/src/sim/s_fileio.c`.
 */
export const SCENARIO_BUNDLE_V1_VERSION = 1 as const;

/**
 * Fixed scenario map width for v1 contracts.
 * Mirrors classic Micropolis map width (`WORLD_X = 120`) used by
 * `Map[WORLD_X][WORLD_Y]` storage in `ref/micropolis/src/sim/s_alloc.c`.
 */
export const SCENARIO_BUNDLE_V1_MAP_WIDTH = 120 as const;

/**
 * Fixed scenario map height for v1 contracts.
 * Mirrors classic Micropolis map height (`WORLD_Y = 100`) used by
 * `Map[WORLD_X][WORLD_Y]` storage in `ref/micropolis/src/sim/s_alloc.c`.
 */
export const SCENARIO_BUNDLE_V1_MAP_HEIGHT = 100 as const;

/**
 * Fixed tile count for v1 scenario map payloads.
 * Mirrors classic map cardinality persisted by `saveFile` in
 * `ref/micropolis/src/sim/s_fileio.c` (120 * 100 words).
 */
export const SCENARIO_BUNDLE_V1_TILE_COUNT =
  SCENARIO_BUNDLE_V1_MAP_WIDTH * SCENARIO_BUNDLE_V1_MAP_HEIGHT;

/**
 * Unsigned 16-bit tile word persisted by classic `.cty`/`snro.*` files.
 * Mirrors one `short` map word written/read by `saveFile`/`loadFile` in
 * `ref/micropolis/src/sim/s_fileio.c` (1:1 value range).
 */
export const scenarioTileWordSchema = z.number().int().min(0).max(0xffff);

/**
 * Canonical map payload that stores compiled map bytes as base64 text.
 * Parity note: payload bytes map to the same map persistence domain as
 * `.cty`/`snro.*` in `ref/micropolis/src/sim/s_fileio.c`, but transport
 * encoding is JSON/base64 (not raw binary files).
 */
export const scenarioMapCityFileBytesV1Schema = z
  .object({
    kind: z.literal('city-file-bytes'),
    width: z.literal(SCENARIO_BUNDLE_V1_MAP_WIDTH),
    height: z.literal(SCENARIO_BUNDLE_V1_MAP_HEIGHT),
    cityFileBytes: z.string().min(1),
  })
  .strict();

/**
 * Canonical map payload that stores deterministic tile words directly.
 * Mirrors the classic x-major `Map[x][y]` word ordering from
 * `ref/micropolis/src/sim/s_fileio.c` when serialized linearly.
 */
export const scenarioMapTileWordsV1Schema = z
  .object({
    kind: z.literal('tile-words'),
    width: z.literal(SCENARIO_BUNDLE_V1_MAP_WIDTH),
    height: z.literal(SCENARIO_BUNDLE_V1_MAP_HEIGHT),
    tileWords: z.array(scenarioTileWordSchema).length(SCENARIO_BUNDLE_V1_TILE_COUNT),
  })
  .strict();

const scenarioMapV1FormExclusivitySchema = z.unknown().superRefine((value, context) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return;
  }

  const hasCityFileBytes = Object.prototype.hasOwnProperty.call(value, 'cityFileBytes');
  const hasTileWords = Object.prototype.hasOwnProperty.call(value, 'tileWords');

  if (hasCityFileBytes && hasTileWords) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: MAP_FORM_CONFLICT_ERROR,
    });
  }
});

/**
 * Canonical v1 map discriminated union.
 * Not a direct C construct: this adds explicit map-form tagging while preserving
 * the same underlying map domain from `ref/micropolis/src/sim/s_fileio.c`.
 */
export const scenarioMapV1Schema = scenarioMapV1FormExclusivitySchema.pipe(
  z.discriminatedUnion('kind', [scenarioMapCityFileBytesV1Schema, scenarioMapTileWordsV1Schema]),
);

/**
 * Start-state fields authored per scenario.
 * Mirrors `LoadScenario` scenario-row year/funds initialization in
 * `ref/micropolis/src/sim/s_fileio.c` (parity on represented fields only).
 */
export const scenarioStartParametersV1Schema = z
  .object({
    startYear: z.number().int(),
    startFunds: z.number().int().min(0),
  })
  .strict();

/**
 * Stage 4 objective metric key schema for authored bundle payloads.
 * Mirrors `DoScenarioScore` metric domains from `ref/micropolis/src/sim/s_msg.c`.
 */
export const scenarioObjectiveMetricKeyV1Schema = z.enum(SCENARIO_OBJECTIVE_METRIC_KEYS);

/**
 * Stage 4 objective comparison schema for authored bundle payloads.
 * Mirrors `DoScenarioScore` relational operator domains from `ref/micropolis/src/sim/s_msg.c`.
 */
export const scenarioObjectiveComparisonV1Schema = z.enum(SCENARIO_OBJECTIVE_COMPARISONS);

/**
 * Stage 4 objective predicate schema for authored bundle payloads.
 * Metric leaves are C-parity (`DoScenarioScore`), while `all`/`any`/`not` nodes
 * are declarative composition layers.
 */
export const scenarioObjectivePredicateV1Schema: z.ZodType<ScenarioObjectivePredicateV1> = z.lazy(
  () =>
    z.discriminatedUnion('kind', [
      z
        .object({
          kind: z.literal('metric'),
          metric: scenarioObjectiveMetricKeyV1Schema,
          op: scenarioObjectiveComparisonV1Schema,
          value: z.number().int(),
        })
        .strict(),
      z
        .object({
          kind: z.literal('all'),
          predicates: z.array(scenarioObjectivePredicateV1Schema),
        })
        .strict(),
      z
        .object({
          kind: z.literal('any'),
          predicates: z.array(scenarioObjectivePredicateV1Schema),
        })
        .strict(),
      z
        .object({
          kind: z.literal('not'),
          predicate: scenarioObjectivePredicateV1Schema,
        })
        .strict(),
    ]),
);

/**
 * Stage 4 script trigger schema for authored bundle payloads.
 * `atTick` and `everyTicks` mirror one-shot and periodic countdown trigger domains
 * from `ScenarioDisaster` in `ref/micropolis/src/sim/s_disast.c`.
 */
export const scenarioScriptTriggerV1Schema = z.union([
  z
    .object({
      atTick: z.number().int().min(0),
    })
    .strict(),
  z
    .object({
      everyTicks: z.number().int().positive(),
    })
    .strict(),
]);

/**
 * Stage 4 script action schema for authored bundle payloads.
 * Action kinds mirror declarative runtime side effects mapped from
 * `ref/micropolis/src/sim/s_disast.c` and `ref/micropolis/src/sim/s_msg.c`.
 */
export const scenarioScriptActionV1Schema: z.ZodType<ScenarioScriptActionV1> = z.discriminatedUnion(
  'kind',
  [
    z.object({ kind: z.literal('make-earthquake') }).strict(),
    z.object({ kind: z.literal('drop-fire-bombs') }).strict(),
    z.object({ kind: z.literal('make-monster') }).strict(),
    z.object({ kind: z.literal('make-meltdown') }).strict(),
    z.object({ kind: z.literal('make-flood') }).strict(),
    z
      .object({
        kind: z.literal('send-message'),
        messageId: z.number().int(),
      })
      .strict(),
    z.object({ kind: z.literal('lose-game') }).strict(),
  ],
);

/**
 * Stage 4 authored script event schema for bundle payloads.
 * Trigger/action rows map to scenario disaster/message side-effect domains from
 * `ref/micropolis/src/sim/s_disast.c` and `ref/micropolis/src/sim/s_msg.c`.
 */
export const scenarioScriptEventV1Schema = z
  .object({
    trigger: scenarioScriptTriggerV1Schema,
    actions: z.array(scenarioScriptActionV1Schema).min(1),
  })
  .strict();

/**
 * Stage 4 authored script list schema for bundle payloads.
 * Requires at least one event row when script authoring is enabled/persisted.
 */
export const scenarioScriptV1Schema = z.array(scenarioScriptEventV1Schema).min(1);

/**
 * Stage 4 behavior-profile key schema for authored bundle payloads.
 * Mirrors the closed behavior variants from `DoShipSprite` in
 * `ref/micropolis/src/sim/w_sprite.c` (`default` and San-Francisco-specific ship honk).
 */
export const scenarioBehaviorProfileKeyV1Schema = z.enum(SCENARIO_BEHAVIOR_PROFILE_KEYS);

/**
 * Canonical Stage 0 scenario bundle contract for JSON interchange.
 * This is a modern contract wrapper around C-parity map/start fields and is not
 * a 1:1 source struct from the Micropolis codebase.
 */
export const scenarioBundleV1Schema = z
  .object({
    version: z.literal(SCENARIO_BUNDLE_V1_VERSION),
    key: z
      .string()
      .refine(
        (value) =>
          SCENARIO_KEY_NAMESPACE_PREFIXES.some(
            (prefix) => value.startsWith(prefix) && value.length > prefix.length,
          ),
        {
          message: 'key must use builtin/* or user/* namespace',
        },
      ),
    name: z.string().min(1),
    description: z.string(),
    tags: z.array(z.string().min(1)),
    start: scenarioStartParametersV1Schema,
    map: scenarioMapV1Schema,
    objective: scenarioObjectivePredicateV1Schema.optional(),
    script: scenarioScriptV1Schema.optional(),
    behaviorProfileKey: scenarioBehaviorProfileKeyV1Schema.optional(),
  })
  .strict();

export type ScenarioTileWord = z.infer<typeof scenarioTileWordSchema>;
export type ScenarioMapCityFileBytesV1 = z.infer<typeof scenarioMapCityFileBytesV1Schema>;
export type ScenarioMapTileWordsV1 = z.infer<typeof scenarioMapTileWordsV1Schema>;
export type ScenarioMapV1 = z.infer<typeof scenarioMapV1Schema>;
export type ScenarioStartParametersV1 = z.infer<typeof scenarioStartParametersV1Schema>;
export type ScenarioBundleV1 = z.infer<typeof scenarioBundleV1Schema>;

/**
 * Parse unknown JSON-like input as canonical `ScenarioBundleV1`.
 * Parity note: unlike C `LoadScenario` file IO entry points in
 * `ref/micropolis/src/sim/s_fileio.c`, this validates typed JSON before runtime use.
 */
export function parseScenarioBundleV1(value: unknown): ScenarioBundleV1 {
  return scenarioBundleV1Schema.parse(value);
}

/**
 * Runtime type guard for canonical scenario bundles.
 * Parity note: Micropolis C accepted raw file bytes; this guard is an intentional
 * TypeScript safety layer for the new JSON contract.
 */
export function isScenarioBundleV1(value: unknown): value is ScenarioBundleV1 {
  return scenarioBundleV1Schema.safeParse(value).success;
}
