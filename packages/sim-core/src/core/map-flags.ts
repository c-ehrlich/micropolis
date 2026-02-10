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

/**
 * Draw procedure identifiers used by the C map-state table.
 * Mirrors `setUpMapProcs` assignments in `ref/micropolis/src/sim/g_map.c`.
 * Parity note: this is a 1:1 symbolic list of C draw proc names.
 */
export type MapDrawProcId =
  | 'drawAll'
  | 'drawRes'
  | 'drawCom'
  | 'drawInd'
  | 'drawPower'
  | 'drawLilTransMap'
  | 'drawPopDensity'
  | 'drawRateOfGrowth'
  | 'drawTrafMap'
  | 'drawPolMap'
  | 'drawCrimeMap'
  | 'drawLandMap'
  | 'drawFireRadius'
  | 'drawPoliceRadius'
  | 'drawDynamic';

/**
 * One C map-state draw-mode table row.
 * Mirrors one `mapProcs[MAP_STATE] = drawProc` entry in
 * `setUpMapProcs` from `ref/micropolis/src/sim/g_map.c`.
 */
export interface MapStateDrawModeEntry {
  readonly mapFlag: MapFlagId;
  readonly drawProc: MapDrawProcId;
}

/**
 * C map-state draw mode table in strict `map_state` index order (`ALMAP..DYMAP`).
 * Mirrors `setUpMapProcs` in `ref/micropolis/src/sim/g_map.c` and bounds checks
 * in `MapCmdMapState` (`ref/micropolis/src/sim/w_map.c`).
 * Parity note: this is a 1:1 port of the C table metadata; browser rendering can
 * map these symbolic entries to runtime-specific draw paths.
 */
export const MAP_STATE_DRAW_MODE_TABLE: ReadonlyArray<MapStateDrawModeEntry> = Object.freeze([
  { mapFlag: 'ALMAP', drawProc: 'drawAll' },
  { mapFlag: 'REMAP', drawProc: 'drawRes' },
  { mapFlag: 'COMAP', drawProc: 'drawCom' },
  { mapFlag: 'INMAP', drawProc: 'drawInd' },
  { mapFlag: 'PRMAP', drawProc: 'drawPower' },
  { mapFlag: 'RDMAP', drawProc: 'drawLilTransMap' },
  { mapFlag: 'PDMAP', drawProc: 'drawPopDensity' },
  { mapFlag: 'RGMAP', drawProc: 'drawRateOfGrowth' },
  { mapFlag: 'TDMAP', drawProc: 'drawTrafMap' },
  { mapFlag: 'PLMAP', drawProc: 'drawPolMap' },
  { mapFlag: 'CRMAP', drawProc: 'drawCrimeMap' },
  { mapFlag: 'LVMAP', drawProc: 'drawLandMap' },
  { mapFlag: 'FIMAP', drawProc: 'drawFireRadius' },
  { mapFlag: 'POMAP', drawProc: 'drawPoliceRadius' },
  { mapFlag: 'DYMAP', drawProc: 'drawDynamic' },
]);

/**
 * Resolve one C `map_state` index to draw-mode table metadata.
 * Mirrors `view->map_state` table lookup in `MemDrawMap` from
 * `ref/micropolis/src/sim/g_map.c`.
 * Parity note: out-of-range values return `null` like C command-side bounds
 * guards in `MapCmdMapState` (`state < 0 || state >= NMAPS`).
 */
export function getMapStateDrawModeEntry(mapState: number): MapStateDrawModeEntry | null {
  if (!Number.isInteger(mapState) || mapState < 0 || mapState >= MAP_FLAG_COUNT) {
    return null;
  }
  return MAP_STATE_DRAW_MODE_TABLE[mapState] ?? null;
}
