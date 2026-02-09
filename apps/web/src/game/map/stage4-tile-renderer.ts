import { Tile, TileMask } from '../../../../../packages/sim-core/src/core/constants.ts';

const STAGE4_TILE_DEBUG_FALLBACK = '#475569';

const TILE_ID_DEBUG_COLOR_LOOKUP = buildStage4TileDebugColorLookup();

/**
 * Normalizes one authoritative map tile word into a drawable tile id.
 * Mirrors `MemDrawBeegMapRect` / `WireDrawBeegMapRect` in
 * `ref/micropolis/src/sim/g_bigmap.c` where lookup uses `LOMASK` and wraps
 * values in `[TILE_COUNT, 1023]` back into the base tile page.
 * Parity note: this is a 1:1 port of the C lookup normalization path.
 */
export function toStage4RenderableTileId(tileWord: number): number {
  let tileId = tileWord & TileMask.LOMASK;
  if (tileId >= Tile.TILE_COUNT) {
    tileId -= Tile.TILE_COUNT;
  }
  return tileId;
}

/**
 * Resolves one authoritative map tile word to a stable Stage 4 debug color.
 * Mirrors C tile lookup masking in `ref/micropolis/src/sim/g_bigmap.c` and
 * animation-flag masking in `ref/micropolis/src/sim/g_ani.c`.
 * Parity note: intentionally diverges from C sprite rendering by mapping tile
 * classes to debug colors (Stage 4 scope before sprite-atlas work).
 */
export function getStage4TileDebugColor(tileWord: number): string {
  const tileId = toStage4RenderableTileId(tileWord);
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
