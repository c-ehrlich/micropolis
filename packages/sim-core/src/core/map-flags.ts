/**
 * Map mode flag indexes used by `NewMapFlags`.
 * Mirrors the map-mode table order (`ALMAP`..`DYMAP`) set in
 * `setUpMapProcs` from `ref/micropolis/src/sim/g_map.c`.
 * Parity note: this is a 1:1 symbolic mapping of C flag slots.
 */
export const MAP_FLAGS = {
  ALMAP: 0,
  REMAP: 1,
  COMAP: 2,
  INMAP: 3,
  PRMAP: 4,
  RDMAP: 5,
  PDMAP: 6,
  RGMAP: 7,
  TDMAP: 8,
  PLMAP: 9,
  CRMAP: 10,
  LVMAP: 11,
  FIMAP: 12,
  POMAP: 13,
  DYMAP: 14,
} as const;

/**
 * Total number of map flags in the C map mode table (`NMAPS`).
 * Mirrors `ref/micropolis/src/sim/g_map.c` / map-state handling in
 * `ref/micropolis/src/sim/w_map.c`.
 */
export const MAP_FLAG_COUNT = 15;

/**
 * Type-safe union of map flag keys.
 * Mirrors C map mode names while providing TypeScript key safety.
 */
export type MapFlagId = keyof typeof MAP_FLAGS;
