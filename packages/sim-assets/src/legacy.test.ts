import { describe, expect, it } from 'vitest';

import {
  formatLegacyScenarioResourceName,
  normalizeLegacyScenarioId,
  resolveLegacyScenarioResourceId,
  resolveLegacyScenarioResourceIdentifier,
  resolveLegacyScenarioResourceName,
  resolveLegacyStringTableResourceIdentifier,
} from './legacy.ts';

describe('legacy resource helpers', () => {
  it('normalizes scenario ids with C clamp semantics', () => {
    // `LoadScenario`: if ((s < 1) || (s > 8)) s = 1;
    // Source: ref/micropolis/src/sim/s_fileio.c.
    expect(normalizeLegacyScenarioId(0)).toBe(1);
    expect(normalizeLegacyScenarioId(1)).toBe(1);
    expect(normalizeLegacyScenarioId(8)).toBe(8);
    expect(normalizeLegacyScenarioId(9)).toBe(1);
  });

  it('maps scenarios to the exact C snro resource ids', () => {
    // `LoadScenario` switch table assigns `snro.111` through `snro.888`
    // for scenarios 1..8 in s_fileio.c.
    expect(resolveLegacyScenarioResourceId(1)).toBe(111);
    expect(resolveLegacyScenarioResourceId(2)).toBe(222);
    expect(resolveLegacyScenarioResourceId(3)).toBe(333);
    expect(resolveLegacyScenarioResourceId(4)).toBe(444);
    expect(resolveLegacyScenarioResourceId(5)).toBe(555);
    expect(resolveLegacyScenarioResourceId(6)).toBe(666);
    expect(resolveLegacyScenarioResourceId(7)).toBe(777);
    expect(resolveLegacyScenarioResourceId(8)).toBe(888);
    expect(resolveLegacyScenarioResourceId(99)).toBe(111);
  });

  it('resolves scenario names and typed identifiers for GetResource-style loads', () => {
    expect(formatLegacyScenarioResourceName(222)).toBe('snro.222');
    expect(resolveLegacyScenarioResourceName(8)).toBe('snro.888');
    expect(resolveLegacyScenarioResourceName(0)).toBe('snro.111');
    expect(resolveLegacyScenarioResourceIdentifier(5)).toEqual({
      type: 'snro',
      id: 555,
    });
    expect(resolveLegacyStringTableResourceIdentifier(301)).toEqual({
      type: 'stri',
      id: 301,
    });
  });
});
