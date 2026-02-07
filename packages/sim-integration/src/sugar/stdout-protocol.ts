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
