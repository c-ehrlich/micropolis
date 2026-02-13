/**
 * Concatenates optional CSS class tokens into one className string.
 * Mirrors no single Micropolis C/Tcl function; this is React-only glue to keep
 * runtime UI class composition deterministic.
 */
export function joinClassTokens(
  ...tokens: ReadonlyArray<string | false | null | undefined>
): string {
  return tokens
    .filter((token): token is string => typeof token === 'string' && token.length > 0)
    .join(' ');
}
