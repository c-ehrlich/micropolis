import { Tile, TileFlag, TileMask } from '../../../../../packages/sim-core/src/core/constants.ts';

const STAGE4_TILE_DEBUG_FALLBACK = '#475569';

const TILE_ID_DEBUG_COLOR_LOOKUP = buildStage4TileDebugColorLookup();

/**
 * Resolves one authoritative tile word to the draw-time tile id.
 * Mirrors tile-to-graphic selection in `MemDrawBeegMapRect` and
 * `WireDrawBeegMapRect` from `ref/micropolis/src/sim/g_bigmap.c`:
 * `(tile & LOMASK)`, wrap `[TILE_COUNT, 1023]` by subtracting `TILE_COUNT`,
 * then optional blink-phase override to `LIGHTNINGBOLT` for unpowered zones.
 * Parity note: this is a 1:1 port of C draw-id selection, parameterizing
 * `flagBlink <= 0` as an explicit option for deterministic tests.
 */
export function toStage4DrawTileId(
  tileWord: number,
  options: Readonly<{ blinkUnpoweredZoneCenter?: boolean }> = {},
): number {
  const blinkUnpoweredZoneCenter = options.blinkUnpoweredZoneCenter ?? false;
  let tile = tileWord & 0xffff;
  if ((tile & TileMask.LOMASK) >= Tile.TILE_COUNT) {
    tile -= Tile.TILE_COUNT;
  }

  if (
    blinkUnpoweredZoneCenter &&
    (tile & TileFlag.ZONEBIT) !== 0 &&
    (tile & TileFlag.PWRBIT) === 0
  ) {
    return Tile.LIGHTNINGBOLT;
  }

  return tile & TileMask.LOMASK;
}

/**
 * Normalizes one authoritative map tile word into a drawable tile id.
 * Mirrors `animateTiles` in `ref/micropolis/src/sim/g_ani.c` (tile id masked
 * with `LOMASK` before draw-time lookup) and `MemDrawBeegMapRect` /
 * `WireDrawBeegMapRect` in `ref/micropolis/src/sim/g_bigmap.c` (wrap ids in
 * `[TILE_COUNT, 1023]` back into the base tile page).
 * Parity note: this helper intentionally excludes `flagBlink` draw-time
 * substitution; use `toStage4DrawTileId` when blink-phase parity is required.
 */
export function toStage4RenderableTileId(tileWord: number): number {
  return toStage4DrawTileId(tileWord);
}

/**
 * Resolves one authoritative map tile word to a stable Stage 4 debug color.
 * Mirrors C tile lookup masking in `ref/micropolis/src/sim/g_bigmap.c` and
 * animation-flag masking in `ref/micropolis/src/sim/g_ani.c`.
 * Parity note: intentionally diverges from C sprite rendering by mapping tile
 * classes to debug colors (Stage 4 scope before sprite-atlas work).
 */
export function getStage4TileDebugColor(tileWord: number): string {
  const tileId = toStage4DrawTileId(tileWord);
  return TILE_ID_DEBUG_COLOR_LOOKUP[tileId] ?? STAGE4_TILE_DEBUG_FALLBACK;
}

function buildStage4TileDebugColorLookup(): string[] {
  const lookup = new Array<string>(Tile.TILE_COUNT);
  for (let tileId = 0; tileId < Tile.TILE_COUNT; tileId += 1) {
    lookup[tileId] = classifyStage4TileDebugColor(tileId);
  }
  return lookup;
}

function classifyStage4TileDebugColor(tileId: number): string {
  if (tileId >= Tile.RIVER && tileId <= Tile.LASTRIVEDGE) {
    return '#0ea5e9';
  }
  if (tileId >= Tile.TREEBASE && tileId <= Tile.WOODS5) {
    return '#22c55e';
  }
  if ((tileId >= Tile.RUBBLE && tileId <= Tile.LASTFLOOD) || tileId === Tile.RADTILE) {
    return '#94a3b8';
  }
  if (tileId >= Tile.FIREBASE && tileId <= Tile.LASTFIRE) {
    return '#ef4444';
  }
  if (tileId >= Tile.ROADBASE && tileId <= Tile.LASTROAD) {
    return '#f59e0b';
  }
  if (tileId >= Tile.POWERBASE && tileId <= Tile.LASTPOWER) {
    return '#eab308';
  }
  if (tileId >= Tile.RAILBASE && tileId <= Tile.ROADVPOWERH) {
    return '#64748b';
  }
  if (tileId >= Tile.RESBASE && tileId < Tile.COMBASE) {
    return '#84cc16';
  }
  if (tileId >= Tile.COMBASE && tileId < Tile.INDBASE) {
    return '#38bdf8';
  }
  if (tileId >= Tile.INDBASE && tileId <= Tile.LASTIND) {
    return '#f97316';
  }
  if (tileId > Tile.LASTIND && tileId <= Tile.LASTZONE) {
    return '#facc15';
  }
  if (tileId >= Tile.HBRDG0 && tileId <= Tile.VBRDG3) {
    return '#f43f5e';
  }
  if (tileId === Tile.DIRT) {
    return '#334155';
  }
  return STAGE4_TILE_DEBUG_FALLBACK;
}
