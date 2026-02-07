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
 * Format the historical `snro.<id>` scenario basename used by Micropolis.
 * Mirrors filename construction in `LoadScenario` from `ref/micropolis/src/sim/s_fileio.c`
 * (same pattern, surfaced as a reusable TypeScript helper).
 */
export function formatLegacyScenarioResourceName(id: number): string {
  return `${LEGACY_RESOURCE_TYPE_SNRO}.${id}`;
}
