import { describe, expect, it } from 'vitest';

import { getPlaySoundToken, parseSugarStdoutLine } from './stdout-protocol.ts';

describe('stdout PlaySound strict-mode parity', () => {
  it('throws on malformed PlaySound without an argument in strict mode', () => {
    // Mirrors micropolisactivity.py `_stdout_thread_function`:
    // `play_sound(words[1])` raises IndexError when `words[1]` is missing.
    const parsedLine = parseSugarStdoutLine('PlaySound');
    if (parsedLine === undefined) {
      throw new Error('Expected parseSugarStdoutLine to parse PlaySound command');
    }

    expect(() => getPlaySoundToken(parsedLine, 'strict')).toThrow(RangeError);
  });
});
