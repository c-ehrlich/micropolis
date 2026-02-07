import { describe, expect, it } from 'vitest';

import { TtyCommandBuffer } from './command-buffer.ts';

describe('TtyCommandBuffer Tcl_AssembleCmd parity', () => {
  it('returns undefined for continuation lines and yields one command once complete', () => {
    // Mirrors Tcl_AssembleCmd + TclWordEnd behavior from
    // ref/micropolis/src/tcl/tclassem.c and ref/micropolis/src/tcl/tclparse.c:
    // unmatched braces keep accumulating until the closing brace and newline.
    const buffer = new TtyCommandBuffer();

    expect(buffer.assemble('if {1} {\n')).toBeUndefined();
    expect(buffer.assemble('  puts ok\n')).toBeUndefined();
    expect(buffer.assemble('}\n')).toBe('if {1} {\n  puts ok\n}\n');
  });

  it('treats backslash-newline as continuation and waits for a later completion newline', () => {
    // Mirrors Tcl_Backslash scanning used by TclWordEnd in Tcl_AssembleCmd:
    // a trailing "\\\n" keeps the command incomplete until later input arrives.
    const buffer = new TtyCommandBuffer();

    expect(buffer.assemble('set msg hello\\\n')).toBeUndefined();
    expect(buffer.assemble('world\n')).toBe('set msg hello\\\nworld\n');
  });

  it('forces completion on empty input after a partial command', () => {
    // Mirrors Tcl_AssembleCmd special case:
    // if string length is zero, buffered partial is treated as complete.
    const buffer = new TtyCommandBuffer();

    expect(buffer.assemble('set city "Micropolis')).toBeUndefined();
    expect(buffer.assemble('')).toBe('set city "Micropolis');
  });
});
