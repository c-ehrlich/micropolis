/**
 * Stateful Tcl command assembler for stdin line fragments.
 * Mirrors `Tcl_CreateCmdBuf` + `Tcl_AssembleCmd` usage in
 * `ref/micropolis/src/sim/w_tk.c` `StdinProc`, and ports the completion
 * scan in `ref/micropolis/src/tcl/tclassem.c` with word parsing behavior from
 * `ref/micropolis/src/tcl/tclparse.c` (`TclWordEnd`, `QuoteEnd`,
 * `VarNameEnd`, and `Tcl_Backslash`).
 * Parity note: this is a behavior-first TypeScript port (no pointer-lifetime
 * semantics from C command buffers).
 */
export class TtyCommandBuffer {
  private bufferedCommand = '';

  /**
   * Append one stdin fragment and return a completed command when available.
   * Mirrors `Tcl_AssembleCmd(buffer, string)` in
   * `ref/micropolis/src/tcl/tclassem.c`:
   * - non-empty input appends to the current buffer,
   * - returns `undefined` when the command is still incomplete,
   * - returns a command string when complete,
   * - empty input forces completion of any buffered partial command.
   * Parity note: returns a plain string value instead of a transient C pointer.
   */
  assemble(string: string): string | undefined {
    if (string.length === 0) {
      const forcedCommand = this.bufferedCommand;
      this.bufferedCommand = '';
      return forcedCommand;
    }

    this.bufferedCommand += string;
    if (!isAssembledCommandComplete(this.bufferedCommand)) {
      return undefined;
    }

    const completeCommand = this.bufferedCommand;
    this.bufferedCommand = '';
    return completeCommand;
  }
}

function isAssembledCommandComplete(command: string): boolean {
  let cursor = 0;

  while (true) {
    let gotNewline = false;
    while (isTclWhitespace(command[cursor])) {
      if (command[cursor] === '\n') {
        gotNewline = true;
      }
      cursor += 1;
    }

    if (cursor >= command.length) {
      return gotNewline;
    }

    cursor = tclWordEnd(command, cursor, false);
  }
}

function tclWordEnd(command: string, start: number, nested: boolean): number {
  const originalStart = start;
  let cursor = start;

  while (isTclWhitespace(command[cursor])) {
    cursor += 1;
  }

  if (command[cursor] === '"') {
    cursor = quoteEnd(command, cursor + 1, '"');
  } else if (command[cursor] === '{') {
    let braces = 1;
    while (braces !== 0) {
      cursor += 1;
      while (command[cursor] === '\\') {
        cursor += tclBackslashLength(command, cursor);
      }

      if (command[cursor] === '}') {
        braces -= 1;
      } else if (command[cursor] === '{') {
        braces += 1;
      } else if (cursor >= command.length) {
        return cursor;
      }
    }
  }

  while (cursor < command.length) {
    if (command[cursor] === '[') {
      cursor += 1;
      while (command[cursor] !== ']' && cursor < command.length) {
        cursor = tclWordEnd(command, cursor, true);
      }
      if (command[cursor] === ']') {
        cursor += 1;
      }
    } else if (command[cursor] === '\\') {
      cursor += tclBackslashLength(command, cursor);
    } else if (command[cursor] === '$') {
      cursor = varNameEnd(command, cursor);
    } else if (command[cursor] === ';') {
      if (cursor === originalStart) {
        cursor += 1;
      }
      break;
    } else if (isTclWhitespace(command[cursor])) {
      break;
    } else if (nested && command[cursor] === ']') {
      break;
    } else {
      cursor += 1;
    }
  }

  return cursor;
}

function quoteEnd(command: string, start: number, terminator: '"' | ')'): number {
  let cursor = start;

  while (cursor < command.length && command[cursor] !== terminator) {
    if (command[cursor] === '\\') {
      cursor += tclBackslashLength(command, cursor);
    } else if (command[cursor] === '[') {
      cursor += 1;
      while (command[cursor] !== ']' && cursor < command.length) {
        cursor = tclWordEnd(command, cursor, true);
      }
      if (command[cursor] === ']') {
        cursor += 1;
      }
    } else if (command[cursor] === '$') {
      cursor = varNameEnd(command, cursor);
    } else {
      cursor += 1;
    }
  }

  return cursor;
}

function varNameEnd(command: string, start: number): number {
  let cursor = start + 1;

  if (command[cursor] === '{') {
    do {
      cursor += 1;
    } while (cursor < command.length && command[cursor] !== '}');
  } else {
    while (isAsciiAlphaNumeric(command[cursor]) || command[cursor] === '_') {
      cursor += 1;
    }
    if (command[cursor] === '(' && cursor !== start + 1) {
      cursor = quoteEnd(command, cursor + 1, ')');
    }
  }

  return cursor;
}

function tclBackslashLength(command: string, start: number): number {
  const first = command[start + 1];
  if (first === undefined) {
    return 1;
  }

  if (
    first === 'b' ||
    first === 'e' ||
    first === 'f' ||
    first === 'n' ||
    first === 'r' ||
    first === 't' ||
    first === 'v' ||
    first === '}' ||
    first === '{' ||
    first === ']' ||
    first === '[' ||
    first === '$' ||
    first === ' ' ||
    first === ';' ||
    first === '"' ||
    first === '\\' ||
    first === '\n'
  ) {
    return 2;
  }

  if (first === 'C') {
    const next = command[start + 2];
    if (next === undefined || isTclWhitespace(next)) {
      return 1;
    }

    if (next === 'M') {
      const controlMetaTarget = command[start + 3];
      if (controlMetaTarget === undefined || isTclWhitespace(controlMetaTarget)) {
        return 3;
      }
      return 4;
    }

    return 3;
  }

  if (first === 'M') {
    const metaTarget = command[start + 2];
    if (metaTarget === undefined || isTclWhitespace(metaTarget)) {
      return 1;
    }
    return 3;
  }

  if (!isAsciiDigit(first)) {
    return 1;
  }

  const second = command[start + 2];
  if (second === undefined || !isAsciiDigit(second)) {
    return 2;
  }

  const third = command[start + 3];
  if (third === undefined || !isAsciiDigit(third)) {
    return 3;
  }

  return 4;
}

function isAsciiDigit(character: string | undefined): boolean {
  if (character === undefined) {
    return false;
  }
  const code = character.charCodeAt(0);
  return code >= 48 && code <= 57;
}

function isAsciiAlphaNumeric(character: string | undefined): boolean {
  if (character === undefined) {
    return false;
  }

  const code = character.charCodeAt(0);
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isTclWhitespace(character: string | undefined): boolean {
  return (
    character === ' ' ||
    character === '\f' ||
    character === '\n' ||
    character === '\r' ||
    character === '\t' ||
    character === '\v'
  );
}
