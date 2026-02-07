import type { ParityMode } from '../types.ts';

/**
 * Tokenized stdout line from the Sugar subprocess bridge.
 * Mirrors `_stdout_thread_function` parsing in
 * `ref/micropolis/micropolisactivity.py` and
 * `ref/micropolis/spec/integration/SPEC.md`:
 * command dispatch uses `line.strip().split(' ')` with explicit-space parity.
 * This is intentionally different from the Python thread loop by returning
 * structured parse output without side effects.
 */
export interface SugarStdoutLine {
  command: string;
  words: string[];
}

/**
 * Error code emitted by safe-mode Sugar stdout parsing hardening.
 * Mirrors the malformed `PlaySound` source condition in
 * `ref/micropolis/micropolisactivity.py` where `words[1]` can be missing.
 * Parity note: this explicit code is intentionally different from Python's
 * untyped `IndexError` to support non-fatal safe-mode handling.
 */
export type SugarStdoutProtocolErrorCode = 'PLAY_SOUND_MISSING_ARGUMENT';

/**
 * Typed malformed-line error for safe-mode Sugar stdout handling.
 * Mirrors `_stdout_thread_function` in `ref/micropolis/micropolisactivity.py`:
 * the legacy strict path fails when `PlaySound` directly indexes `words[1]`.
 * Parity note: strict mode still throws `RangeError('list index out of range')`
 * for fatal parity, while safe mode intentionally returns this typed error
 * object so callers can continue processing subsequent lines.
 */
export class SugarStdoutMalformedLineError extends Error {
  readonly code: SugarStdoutProtocolErrorCode;
  readonly command: string;
  readonly words: readonly string[];

  constructor(
    code: SugarStdoutProtocolErrorCode,
    command: string,
    words: string[],
    message: string,
  ) {
    super(message);
    this.name = 'SugarStdoutMalformedLineError';
    this.code = code;
    this.command = command;
    this.words = [...words];
  }
}

/**
 * Parse one stdout line using Micropolis Sugar parity tokenization.
 * Mirrors `line.strip().split(' ')` in
 * `ref/micropolis/micropolisactivity.py` as a 1:1 tokenization port:
 * repeated spaces produce empty tokens and only empty/whitespace-only lines
 * are skipped.
 */
export function parseSugarStdoutLine(line: string): SugarStdoutLine | undefined {
  const words = splitSugarStdoutWords(line);
  const [command] = words;
  if (command === undefined) {
    return undefined;
  }

  return {
    command,
    words,
  };
}

/**
 * Split one stdout line with explicit-space delimiter parity.
 * Mirrors `line.strip().split(' ')` in
 * `ref/micropolis/micropolisactivity.py` as a 1:1 port:
 * no regex splitting, no whitespace collapsing, and no filtering of
 * empty interior tokens.
 */
export function splitSugarStdoutWords(line: string): string[] {
  const strippedLine = line.trim();
  if (strippedLine === '') {
    return [];
  }

  return strippedLine.split(' ');
}

/**
 * Extract `PlaySound` argument token with Micropolis strict-parity failure mode.
 * Mirrors `_stdout_thread_function` in `ref/micropolis/micropolisactivity.py`,
 * where `PlaySound` dispatch directly indexes `words[1]`.
 * Parity note: in `strict` mode, missing token throws a JS `RangeError` with
 * Python-style `IndexError` text (`list index out of range`) so malformed
 * input still surfaces as a fatal parsing failure; in `safe` mode the same
 * malformed line returns a typed `SugarStdoutMalformedLineError` so processing
 * can continue without killing the caller loop.
 */
export function getPlaySoundToken(
  stdoutLine: SugarStdoutLine,
  mode: ParityMode,
): string | SugarStdoutMalformedLineError | undefined {
  if (stdoutLine.command !== 'PlaySound') {
    return undefined;
  }

  const playSoundToken = stdoutLine.words[1];
  if (playSoundToken !== undefined) {
    return playSoundToken;
  }

  if (mode === 'strict') {
    throw new RangeError('list index out of range');
  }

  return new SugarStdoutMalformedLineError(
    'PLAY_SOUND_MISSING_ARGUMENT',
    stdoutLine.command,
    stdoutLine.words,
    'PlaySound missing required argument at words[1]',
  );
}
