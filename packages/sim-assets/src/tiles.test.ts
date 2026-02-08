import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parseTileSheetHeader, TILE_SHEET_HEADERS } from './tiles.ts';

const FIXTURE_IMAGE_ROOT = new URL('../../../ref/micropolis/images/', import.meta.url);

/**
 * Reads the first XPM string entry from a canonical Micropolis image file.
 * The extracted value is the same header tuple consumed by XPM loaders called
 * from `GetViewTiles` in `ref/micropolis/src/sim/g_setup.c`.
 */
async function loadCanonicalXpmHeader(fileName: string): Promise<string> {
  const filePath = fileURLToPath(new URL(fileName, FIXTURE_IMAGE_ROOT));
  const content = await readFile(filePath, 'utf8');
  const lines = content.split('\n');

  for (const line of lines) {
    const match = /^\s*"([^"]+)"/.exec(line);
    if (match !== null) {
      const header = match[1];
      if (header !== undefined) {
        return header;
      }
    }
  }

  throw new Error(`Missing XPM header in ${filePath}`);
}

describe('tile XPM header parity', () => {
  it('reads canonical header literals from tiles.xpm variants', async () => {
    const expectations = [
      { key: 'color' as const, fileName: 'tiles.xpm' },
      { key: 'monochrome' as const, fileName: 'tilesbw.xpm' },
      { key: 'small' as const, fileName: 'tilessm.xpm' },
    ];

    for (const expectation of expectations) {
      const header = await loadCanonicalXpmHeader(expectation.fileName);
      expect(header).toBe(TILE_SHEET_HEADERS[expectation.key]);
    }
  });

  it('parses canonical XPM header tuples into typed numeric metadata', async () => {
    // These dimensions come from the canonical first-line XPM tuples loaded by
    // `GetViewTiles` in `ref/micropolis/src/sim/g_setup.c`.
    const expectations = [
      {
        fileName: 'tiles.xpm',
        expected: { width: 16, height: 15360, colors: 14, charsPerPixel: 1 },
      },
      {
        fileName: 'tilesbw.xpm',
        expected: { width: 16, height: 15360, colors: 2, charsPerPixel: 1 },
      },
      {
        fileName: 'tilessm.xpm',
        expected: { width: 4, height: 2880, colors: 14, charsPerPixel: 1 },
      },
    ];

    for (const expectation of expectations) {
      const header = await loadCanonicalXpmHeader(expectation.fileName);
      expect(parseTileSheetHeader(header)).toEqual(expectation.expected);
    }
  });
});
