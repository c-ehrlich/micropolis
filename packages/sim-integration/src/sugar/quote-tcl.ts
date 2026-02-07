/**
 * Tcl outbound string quoting helper for Sugar bridge commands.
 * Mirrors `QuoteTCL` in `ref/micropolis/micropolisactivity.py` as a 1:1 port:
 * only `"` is escaped to `\\"`; backslashes/braces are intentionally not escaped.
 */
export function quoteTcl(value: string): string {
  return value.replaceAll('"', '\\"');
}
