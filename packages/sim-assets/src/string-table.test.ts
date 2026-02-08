import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { lookupStringTableLine, parseStringTable } from './string-table.ts';

const FIXTURE_RESOURCE_ROOT = new URL('../../../ref/micropolis/res/', import.meta.url);

/**
 * Loads canonical `stri.*` fixture files from `ref/micropolis/res` so tests
 * validate the same payloads parsed by `GetIndString` in `w_resrc.c`.
 */
async function loadFixtureTable(id: 202 | 219 | 301 | 356) {
  const fixturePath = fileURLToPath(new URL(`stri.${id}`, FIXTURE_RESOURCE_ROOT));
  const fixtureContent = await readFile(fixturePath, 'utf8');

  return parseStringTable(id, fixtureContent);
}

describe('string table fixture parity', () => {
  it('parses canonical line counts for stri.202/.219/.301/.356', async () => {
    // These counts come from newline-delimited splitting in `GetIndString`
    // (`ref/micropolis/src/sim/w_resrc.c`) applied to canonical `stri.*` files.
    const expectations = [
      { id: 202 as const, lineCount: 20 },
      { id: 219 as const, lineCount: 27 },
      { id: 301 as const, lineCount: 64 },
      { id: 356 as const, lineCount: 19 },
    ];

    for (const expectation of expectations) {
      const table = await loadFixtureTable(expectation.id);
      expect(table.id).toBe(expectation.id);
      expect(table.lines).toHaveLength(expectation.lineCount);
    }
  });

  it('matches canonical stri.202 entries', async () => {
    const table = await loadFixtureTable(202);

    expect(table.lines).toEqual([
      'Low',
      'Medium',
      'High',
      'Very High',
      'Slum',
      'Lower Class',
      'Middle Class',
      'High',
      'Safe',
      'Light',
      'Moderate',
      'Dangerous',
      'None',
      'Moderate',
      'Heavy',
      'Very Heavy',
      'Declining',
      'Stable',
      'Slow Growth',
      'Fast Growth',
    ]);
  });

  it('matches canonical stri.219 entries', async () => {
    const table = await loadFixtureTable(219);

    expect(table.lines).toEqual([
      'Clear',
      'Water',
      'Trees',
      'Rubble',
      'Flood',
      'Radioactive Waste',
      'Fire',
      'Road',
      'Power',
      'Rail',
      'Residential',
      'Commercial',
      'Industrial',
      'Seaport',
      'Airport',
      'Coal Power',
      'Fire Department',
      'Police Department',
      'Stadium',
      'Nuclear Power',
      'Draw Bridge',
      'Radar Dish',
      'Fountain',
      'Industrial',
      'Steelers 38  Bears 3',
      'Draw Bridge',
      'Ur 238',
    ]);
  });

  it('matches canonical stri.301 entries used by city message lookups', async () => {
    const table = await loadFixtureTable(301);

    // Message IDs map into `stri.301` via `GetIndString(..., 301, MesNum)` in
    // `ref/micropolis/src/sim/s_msg.c`, so key messages and tail sentinels must stay exact.
    expect(lookupStringTableLine(table, 1)).toBe('More residential zones needed.');
    expect(lookupStringTableLine(table, 20)).toBe('Fire reported !');
    expect(lookupStringTableLine(table, 43)).toBe('A Nuclear Meltdown has occurred !!!');
    expect(lookupStringTableLine(table, 49)).toBe('Restored a Saved City.');
    expect(lookupStringTableLine(table, 50)).toBe('x');
    expect(lookupStringTableLine(table, 64)).toBe('x');
    expect(table.lines.slice(49).every((line) => line === 'x')).toBe(true);
  });

  it('matches canonical stri.356 entries including trailing blank line', async () => {
    const table = await loadFixtureTable(356);

    // Tool labels are fetched by `GetIndString(..., 356, ...)` from `w_tool.c`.
    expect(table.lines).toEqual([
      'Residential Zone',
      'Commercial Zone',
      'Industrial Zone',
      'Fire Station',
      'Query',
      'Police Station',
      'Wire Power',
      'Bulldozer',
      'Rail',
      'Road',
      'Chalk',
      'Eraser',
      'Stadium',
      'Park',
      'Seaport',
      'Coal Power',
      'Nuclear Power',
      'Airport',
      '',
    ]);
  });

  it('keeps 1-based lookup semantics with undefined for misses', async () => {
    const table = await loadFixtureTable(219);

    // `GetIndString` is 1-based; this TypeScript port mirrors indexing but returns
    // `undefined` instead of writing fallback text for out-of-range values.
    expect(lookupStringTableLine(table, 1)).toBe('Clear');
    expect(lookupStringTableLine(table, 27)).toBe('Ur 238');
    expect(lookupStringTableLine(table, 0)).toBeUndefined();
    expect(lookupStringTableLine(table, 28)).toBeUndefined();
  });
});
