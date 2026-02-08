import { describe, expect, it } from 'vitest';

import { createIntegrationRuntime } from '../runtime.ts';
import {
  getPlaySoundToken,
  parseSugarStdoutLine,
  SugarStdoutMalformedLineError,
} from './stdout-protocol.ts';

describe('stdout PlaySound token parsing parity', () => {
  it('parses a normal PlaySound line and extracts the sound token', () => {
    // Mirrors micropolisactivity.py `_stdout_thread_function` tokenization:
    // `words = line.strip().split(' ')` then `play_sound(words[1])`.
    const parsedLine = parseSugarStdoutLine('PlaySound Bulldozer');
    expect(parsedLine).toEqual({
      command: 'PlaySound',
      words: ['PlaySound', 'Bulldozer'],
    });

    if (parsedLine === undefined) {
      throw new Error('Expected parseSugarStdoutLine to parse PlaySound command');
    }

    expect(getPlaySoundToken(parsedLine, 'strict')).toBe('Bulldozer');
  });

  it('preserves empty tokens when repeated spaces appear after PlaySound', () => {
    // Mirrors Python `split(' ')` explicit-space behavior where repeated spaces
    // become empty tokens and `words[1]` can be an empty string.
    const parsedLine = parseSugarStdoutLine('PlaySound   Bulldozer');
    expect(parsedLine).toEqual({
      command: 'PlaySound',
      words: ['PlaySound', '', '', 'Bulldozer'],
    });

    if (parsedLine === undefined) {
      throw new Error('Expected parseSugarStdoutLine to parse PlaySound command');
    }

    expect(getPlaySoundToken(parsedLine, 'strict')).toBe('');
  });
});

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

describe('runtime PlaySound delivery parity', () => {
  it('sends lowercase sound names to the sound hook for wav mapping parity', () => {
    // Mirrors micropolisactivity.py `play_sound(name)` path building:
    // `<bundle>/res/sounds/` + `name.lower()` + `.wav`.
    const soundTokens: string[] = [];
    const runtime = createIntegrationRuntime({
      features: {
        sugar: true,
      },
      hooks: {
        onSoundToken(soundName) {
          soundTokens.push(soundName);
        },
      },
    });

    runtime.handleOutputLine('PlaySound Bulldozer');
    expect(soundTokens).toEqual(['bulldozer']);
  });
});
