/**
 * Parsed `stri.*` table payload indexed by Micropolis message/query call sites.
 * Mirrors the cached `struct StringTable` built by `GetIndString` in
 * `ref/micropolis/src/sim/w_resrc.c` and consumed by
 * `ref/micropolis/src/sim/s_msg.c` / `ref/micropolis/src/sim/w_tool.c`.
 * Parity notes: C stores mutable `char *` pointers into an in-place `'\n'`-split
 * buffer; TypeScript stores immutable line strings with the same 1-based lookup
 * identity semantics.
 */
export interface StringTable {
  readonly id: number;
  readonly lines: readonly string[];
}

/**
 * Parse a raw `stri.*` file payload into lines.
 * Mirrors `GetIndString` line-splitting behavior in
 * `ref/micropolis/src/sim/w_resrc.c`, where `lines` is computed by counting `'\n'`
 * delimiters and each line is the bytes before each newline.
 * Parity notes: this port normalizes CRLF/CR to LF before splitting, and only
 * emits newline-terminated records (unterminated trailing text is ignored, as in C).
 */
export function parseStringTable(id: number, content: string): StringTable {
  const normalized = content.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
  const lines: string[] = [];
  let lineStart = 0;

  for (let index = 0; index < normalized.length; index += 1) {
    if (normalized.charCodeAt(index) !== 0x0a) {
      continue;
    }

    lines.push(normalized.slice(lineStart, index));
    lineStart = index + 1;
  }

  return {
    id,
    lines,
  };
}

/**
 * Resolve a 1-based string-table entry used by Micropolis UI/tool code.
 * Mirrors `GetIndString(..., num)` indexing in `ref/micropolis/src/sim/w_resrc.c`
 * and call-site usage in `ref/micropolis/src/sim/s_msg.c` / `ref/micropolis/src/sim/w_tool.c`.
 * Parity notes: C writes into a caller buffer and logs on out-of-range `num`;
 * this port returns `undefined` on miss so callers can branch without stderr side-effects.
 */
export function lookupStringTableLine(
  table: StringTable,
  oneBasedIndex: number,
): string | undefined {
  if (oneBasedIndex < 1 || oneBasedIndex > table.lines.length) {
    return undefined;
  }

  return table.lines[oneBasedIndex - 1];
}
