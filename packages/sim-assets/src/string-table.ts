/**
 * Parsed `stri.*` table payload indexed by Micropolis message/query call sites.
 * Mirrors newline-delimited string resources used from `ref/micropolis/src/sim/s_msg.c`
 * and `ref/micropolis/src/sim/w_tool.c` (1:1 data model with immutable entries).
 */
export interface StringTable {
  readonly id: number;
  readonly lines: readonly string[];
}

/**
 * Parse a raw `stri.*` file payload into lines.
 * Mirrors string-table loading expectations from `ref/micropolis/src/sim/w_resrc.c`
 * and downstream 1-based access in `s_msg.c`/`w_tool.c` (TypeScript exposes line arrays).
 */
export function parseStringTable(id: number, content: string): StringTable {
  const normalized = content.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
  const lines = normalized.endsWith('\n')
    ? normalized.slice(0, -1).split('\n')
    : normalized.split('\n');

  return {
    id,
    lines,
  };
}

/**
 * Resolve a 1-based string-table entry used by Micropolis UI/tool code.
 * Mirrors index usage in `ref/micropolis/src/sim/s_msg.c` and
 * `ref/micropolis/src/sim/w_tool.c` (same 1-based convention, returns `undefined` on miss).
 */
export function lookupStringTableLine(
  table: StringTable,
  oneBasedIndex: number,
): string | undefined {
  if (oneBasedIndex < 1) {
    return undefined;
  }

  return table.lines[oneBasedIndex - 1];
}
