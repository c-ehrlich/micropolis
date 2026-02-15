import { z } from 'zod';

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

/**
 * Canonical v1 map discriminated union.
 * Not a direct C construct: this adds explicit map-form tagging while preserving
 * the same underlying map domain from `ref/micropolis/src/sim/s_fileio.c`.
 */
export const scenarioMapV1Schema = z.discriminatedUnion('kind', [
  scenarioMapCityFileBytesV1Schema,
  scenarioMapTileWordsV1Schema,
]);

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
 * Canonical Stage 0 scenario bundle contract for JSON interchange.
 * This is a modern contract wrapper around C-parity map/start fields and is not
 * a 1:1 source struct from the Micropolis codebase.
 */
export const scenarioBundleV1Schema = z
  .object({
    version: z.literal(SCENARIO_BUNDLE_V1_VERSION),
    key: z.string().min(1),
    name: z.string().min(1),
    description: z.string(),
    tags: z.array(z.string().min(1)),
    start: scenarioStartParametersV1Schema,
    map: scenarioMapV1Schema,
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
