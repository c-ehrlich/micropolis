import { describe, expect, it } from 'vitest';

import {
  SugarStdoutMalformedLineError,
  getPlaySoundToken,
  parseSugarStdoutLine,
} from './stdout-protocol.ts';

describe('stdout PlaySound strict-mode parity', () => {
  it('throws an IndexError-equivalent failure on malformed PlaySound in strict mode', () => {
    // Mirrors micropolisactivity.py `_stdout_thread_function`:
    // `play_sound(words[1])` raises IndexError when `words[1]` is missing.
    const parsedLine = parseSugarStdoutLine('PlaySound');
    if (parsedLine === undefined) {
      throw new Error('Expected parseSugarStdoutLine to parse PlaySound command');
    }

    expect(() => getPlaySoundToken(parsedLine, 'strict')).toThrowError(
      new RangeError('list index out of range'),
    );
  });
});

describe('stdout PlaySound safe-mode hardening', () => {
  it('returns a typed malformed-line error instead of throwing for missing argument', () => {
    // Diverges intentionally from micropolisactivity.py fatal IndexError path:
    // safe mode returns a typed error object to keep line processing alive.
    const parsedLine = parseSugarStdoutLine('PlaySound');
    if (parsedLine === undefined) {
      throw new Error('Expected parseSugarStdoutLine to parse PlaySound command');
    }

    const result = getPlaySoundToken(parsedLine, 'safe');
    expect(result).toBeInstanceOf(SugarStdoutMalformedLineError);
    if (!(result instanceof SugarStdoutMalformedLineError)) {
      throw new Error('Expected SugarStdoutMalformedLineError result');
    }

    expect(result.code).toBe('PLAY_SOUND_MISSING_ARGUMENT');
    expect(result.command).toBe('PlaySound');
    expect(result.words).toEqual(['PlaySound']);
  });
});
