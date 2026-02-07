import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';

/**
 * Minimal stdin/stdout stream pair for process bridge wiring.
 * Mirrors Sugar subprocess pipe usage in `ref/micropolis/micropolisactivity.py`
 * (`subprocess.Popen(..., stdin=PIPE, stdout=PIPE)`).
 * Parity note: this is intentionally different from Python's concrete
 * `Popen` object by exposing only the stream fields needed by integration.
 */
export interface ProcessStdioStreams {
  stdin: Writable;
  stdout: Readable;
}

/**
 * Optional lifecycle hooks for stdout line subscription.
 * Mirrors `_stdout_thread_function` lifecycle in
 * `ref/micropolis/micropolisactivity.py`:
 * read lines until EOF/exception, then stop.
 * Parity note: unlike Python's implicit thread exit, Node wiring surfaces
 * explicit close/error hooks to callers.
 */
export interface ProcessStdoutLineHooks {
  onLine: (line: string) => void;
  onClose?: () => void;
  onError?: (error: Error) => void;
}

/**
 * Disposable stdout subscription handle.
 * Mirrors the effective lifecycle boundary of `_stdout_thread_function` in
 * `ref/micropolis/micropolisactivity.py` while being intentionally explicit
 * for TypeScript adapter control.
 */
export interface ProcessStdoutSubscription {
  close(): void;
}

/**
 * Node process stdin/stdout transport adapter contract.
 * Mirrors `send_process(message)` (stdin writes) and
 * `_stdout_thread_function` (line reads) from
 * `ref/micropolis/micropolisactivity.py`.
 * Parity note: protocol parsing remains outside this adapter by design.
 */
export interface ProcessIoAdapter {
  writeStdin(message: string): void;
  subscribeStdoutLines(hooks: ProcessStdoutLineHooks): ProcessStdoutSubscription;
}

/**
 * Create a Node stdin/stdout transport adapter for integration wiring.
 * Mirrors Micropolis Sugar transport behavior in
 * `ref/micropolis/micropolisactivity.py`:
 * - `send_process` writes bytes directly to child stdin without flush calls.
 * - `_stdout_thread_function` consumes stdout line-by-line until EOF/error.
 * Parity note: this adapter is intentionally transport-only and does not
 * trim, split, or interpret lines (those parity behaviors live in
 * `src/sugar/stdout-protocol.ts`).
 */
export function createNodeProcessIoAdapter(streams: ProcessStdioStreams): ProcessIoAdapter {
  return {
    writeStdin(message) {
      if (!streams.stdin.writable) {
        throw new Error('process stdin is not writable');
      }

      streams.stdin.write(message);
    },
    subscribeStdoutLines(hooks) {
      const lineReader = createInterface({
        input: streams.stdout,
        crlfDelay: Number.POSITIVE_INFINITY,
      });

      let active = true;

      const handleLine = (line: string): void => {
        if (!active) {
          return;
        }

        hooks.onLine(line);
      };

      const handleClose = (): void => {
        if (!active) {
          return;
        }

        active = false;
        hooks.onClose?.();
      };

      const handleError = (error: Error): void => {
        if (!active) {
          return;
        }

        hooks.onError?.(error);
      };

      lineReader.on('line', handleLine);
      lineReader.on('close', handleClose);
      streams.stdout.on('error', handleError);

      return {
        close() {
          if (!active) {
            return;
          }

          active = false;
          lineReader.off('line', handleLine);
          lineReader.off('close', handleClose);
          streams.stdout.off('error', handleError);
          lineReader.close();
        },
      };
    },
  };
}
