/**
 * Four-character resource type for string-table resources.
 * Mirrors `stri` loads from `GetResource` call sites in
 * `ref/micropolis/src/sim/s_msg.c` and `ref/micropolis/src/sim/w_tool.c` (1:1 token).
 */
export const LEGACY_RESOURCE_TYPE_STRI = 'stri';

/**
 * Four-character resource type for scenario map resources.
 * Mirrors `snro` scenario filename usage in `ref/micropolis/src/sim/s_fileio.c` (1:1 token).
 */
export const LEGACY_RESOURCE_TYPE_SNRO = 'snro';

/**
 * Inclusive lower bound for classic Micropolis scenario ids.
 * Mirrors `if ((s < 1) || (s > 8)) s = 1;` in `LoadScenario`
 * from `ref/micropolis/src/sim/s_fileio.c` (1:1 bound constant).
 */
export const LEGACY_SCENARIO_ID_MIN = 1;

/**
 * Inclusive upper bound for classic Micropolis scenario ids.
 * Mirrors `if ((s < 1) || (s > 8)) s = 1;` in `LoadScenario`
 * from `ref/micropolis/src/sim/s_fileio.c` (1:1 bound constant).
 */
export const LEGACY_SCENARIO_ID_MAX = 8;

/**
 * Canonical scenario-id domain consumed by `LoadScenario`.
 * Mirrors `switch (s) { case 1..8: ... }` in `ref/micropolis/src/sim/s_fileio.c` (1:1 ids).
 */
export type LegacyScenarioId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

/**
 * Normalize a requested scenario id with C-style clamp behavior.
 * Mirrors `if ((s < 1) || (s > 8)) s = 1;` in `LoadScenario`
 * from `ref/micropolis/src/sim/s_fileio.c` (1:1 behavior).
 */
export function normalizeLegacyScenarioId(value: number): LegacyScenarioId {
  if (value < LEGACY_SCENARIO_ID_MIN || value > LEGACY_SCENARIO_ID_MAX) {
    return LEGACY_SCENARIO_ID_MIN;
  }
  return value as LegacyScenarioId;
}

/**
 * Resolve the numeric `snro.*` resource id for a scenario id.
 * Mirrors the `LoadScenario` switch mapping in `ref/micropolis/src/sim/s_fileio.c`:
 * `1->111`, `2->222`, ... `8->888` (1:1 values), with C-style id normalization.
 */
export function resolveLegacyScenarioResourceId(value: number): number {
  switch (normalizeLegacyScenarioId(value)) {
    case 1:
      return 111;
    case 2:
      return 222;
    case 3:
      return 333;
    case 4:
      return 444;
    case 5:
      return 555;
    case 6:
      return 666;
    case 7:
      return 777;
    case 8:
      return 888;
  }
}

/**
 * Format the historical `snro.<id>` scenario basename used by Micropolis.
 * Mirrors filename construction in `LoadScenario` from `ref/micropolis/src/sim/s_fileio.c`
 * (same pattern, surfaced as a reusable TypeScript helper).
 */
export function formatLegacyScenarioResourceName(id: number): string {
  return `${LEGACY_RESOURCE_TYPE_SNRO}.${id}`;
}

/**
 * Resolve the canonical `snro.xxx` filename for a scenario id.
 * Mirrors `fname = "snro.111" ... "snro.888"` assignments in
 * `LoadScenario` from `ref/micropolis/src/sim/s_fileio.c` (1:1 names),
 * while preserving C-style out-of-range normalization.
 */
export function resolveLegacyScenarioResourceName(value: number): string {
  return formatLegacyScenarioResourceName(resolveLegacyScenarioResourceId(value));
}

/**
 * Typed `(type,id)` key for loading a string-table resource via `GetResource`.
 * Mirrors `GetResource("stri", id)` in `ref/micropolis/src/sim/w_resrc.c` (1:1 fields).
 */
export function resolveLegacyStringTableResourceIdentifier(id: number): {
  readonly type: typeof LEGACY_RESOURCE_TYPE_STRI;
  readonly id: number;
} {
  return { type: LEGACY_RESOURCE_TYPE_STRI, id };
}

/**
 * Typed `(type,id)` key for loading a scenario resource via `GetResource`.
 * Parity notes:
 * - C `LoadScenario` opens `snro.xxx` directly from the resource dir
 *   (`ref/micropolis/src/sim/s_fileio.c`).
 * - `GetResource` consumes the same `(name,id)` identity format
 *   (`ref/micropolis/src/sim/w_resrc.c`).
 * This helper bridges both semantics with normalized scenario ids.
 */
export function resolveLegacyScenarioResourceIdentifier(value: number): {
  readonly type: typeof LEGACY_RESOURCE_TYPE_SNRO;
  readonly id: number;
} {
  return {
    type: LEGACY_RESOURCE_TYPE_SNRO,
    id: resolveLegacyScenarioResourceId(value),
  };
}
