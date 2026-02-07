/**
 * Number of logical base tiles in Micropolis.
 * Mirrors `TILE_COUNT` usage from `ref/micropolis/src/sim/g_setup.c` (1:1 value).
 */
export const TILE_COUNT = 960;

/**
 * Expected XPM headers for the three Micropolis tile sheets.
 * Mirrors header literals consumed by image loading in
 * `ref/micropolis/src/sim/g_setup.c` (1:1 expected strings).
 */
export const TILE_SHEET_HEADERS = {
  color: '16 15360 14 1',
  monochrome: '16 15360 2 1',
  small: '4 2880 14 1',
} as const;

/**
 * Parsed first-line metadata from a tile XPM.
 * Mirrors the width/height/color/chars-per-pixel tuple expected by
 * `read_xpm_file` callers in `ref/micropolis/src/sim/g_setup.c` (1:1 fields).
 */
export interface TileSheetHeader {
  readonly width: number;
  readonly height: number;
  readonly colors: number;
  readonly charsPerPixel: number;
}

/**
 * Parse an XPM header line (`"w h colors cpp"`) into a typed tuple object.
 * Mirrors XPM header interpretation in `ref/micropolis/src/sim/g_setup.c`
 * (same token order, with explicit TypeScript error handling on malformed input).
 */
export function parseTileSheetHeader(headerLine: string): TileSheetHeader {
  const tokens = headerLine.trim().split(/\s+/);
  const widthToken = tokens[0];
  const heightToken = tokens[1];
  const colorsToken = tokens[2];
  const charsPerPixelToken = tokens[3];

  assertDefined(widthToken, `Invalid XPM header width token: "${headerLine}"`);
  assertDefined(heightToken, `Invalid XPM header height token: "${headerLine}"`);
  assertDefined(colorsToken, `Invalid XPM header colors token: "${headerLine}"`);
  assertDefined(charsPerPixelToken, `Invalid XPM header chars-per-pixel token: "${headerLine}"`);

  const width = Number(widthToken);
  const height = Number(heightToken);
  const colors = Number(colorsToken);
  const charsPerPixel = Number(charsPerPixelToken);

  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    !Number.isFinite(colors) ||
    !Number.isFinite(charsPerPixel)
  ) {
    throw new Error(`Invalid XPM header: "${headerLine}"`);
  }

  return {
    width,
    height,
    colors,
    charsPerPixel,
  };
}

function assertDefined<T>(value: T, message: string): asserts value is NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error(message);
  }
}
