import { describe, expect, it } from 'vitest';

import { quoteTcl } from './quote-tcl.ts';

describe('quoteTcl QuoteTCL parity', () => {
  it('escapes double quotes', () => {
    // Mirrors QuoteTCL in ref/micropolis/micropolisactivity.py:
    // s.replace('"', '\\"')
    expect(quoteTcl('He said "hello".')).toBe('He said \\"hello\\".');
  });

  it('does not escape backslashes', () => {
    // Parity behavior: only double quotes are escaped.
    expect(quoteTcl('C:\\Micropolis\\Data')).toBe('C:\\Micropolis\\Data');
  });

  it('does not escape braces', () => {
    // Parity behavior: braces remain unchanged.
    expect(quoteTcl('{buddy color}')).toBe('{buddy color}');
  });

  it('keeps non-quote characters intact while escaping quotes', () => {
    expect(quoteTcl('{path} "nick" C:\\tmp')).toBe('{path} \\"nick\\" C:\\tmp');
  });
});
