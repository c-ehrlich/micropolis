import type { TtyEvaluatorResult } from '../types.ts';

import { TtyCommandBuffer } from './command-buffer.ts';

/**
 * Prompt emitted by the interactive TTY loop.
 * Mirrors `printf("sim:\\n")` in `ref/micropolis/src/sim/w_tk.c`
 * (`tk_main` startup and `StdinProc` post-eval prompt) as a 1:1 string port.
 */
export const TTY_PROMPT = 'sim:\n';

/**
 * Dependencies and hooks for `StdinChannel`.
 * Mirrors `StdinProc` wiring in `ref/micropolis/src/sim/w_tk.c`:
 * line reads are fed through `Tcl_AssembleCmd` then `Tcl_RecordAndEval`,
 * with callbacks for stdout writes, exit, and readable-handler removal.
 * Parity note: this is intentionally adapter-based in TypeScript rather than
 * directly calling Tk/Tcl globals.
 */
export interface StdinChannelOptions {
  isTty: boolean;
  evaluateCommand: (command: string) => TtyEvaluatorResult;
  commandBuffer?: TtyCommandBuffer;
  onWriteStdout?: (chunk: string) => void;
  onExit?: (exitCode: number) => void;
  onDisableReads?: () => void;
}

/**
 * Stateful stdin channel implementing Micropolis `StdinProc` behavior.
 * Mirrors `StdinProc` in `ref/micropolis/src/sim/w_tk.c` as a parity-first
 * port:
 * - EOF behavior depends on `gotPartial` and tty mode,
 * - command assembly uses `Tcl_AssembleCmd`-equivalent buffering,
 * - result printing matches `(result != TCL_OK) || sim_tty`,
 * - tty prompt emission is exactly `sim:\n`.
 * Parity note: this class models the same control flow without direct Tk file
 * handler APIs (`Tk_DeleteFileHandler`, readable masks) by exposing callbacks.
 */
export class StdinChannel {
  private readonly options: StdinChannelOptions;
  private readonly commandBuffer: TtyCommandBuffer;

  private gotPartial = false;
  private readsEnabled = true;

  constructor(options: StdinChannelOptions) {
    this.options = options;
    this.commandBuffer = options.commandBuffer ?? new TtyCommandBuffer();
  }

  /**
   * Start the channel and emit the initial prompt for tty mode.
   * Mirrors `tk_main` startup prompt emission in
   * `ref/micropolis/src/sim/w_tk.c` (`if (sim_tty) printf("sim:\\n");`).
   */
  start(): void {
    if (this.options.isTty) {
      this.writeStdout(TTY_PROMPT);
    }
  }

  /**
   * Process one stdin line read (or EOF as `null`) with `StdinProc` parity.
   * Mirrors `fgets` + EOF handling + `Tcl_AssembleCmd` + `Tcl_RecordAndEval`
   * control flow in `ref/micropolis/src/sim/w_tk.c`.
   */
  consumeLine(line: string | null): void {
    if (!this.readsEnabled) {
      return;
    }

    let lineForAssembly = line;

    if (lineForAssembly === null) {
      if (!this.gotPartial) {
        if (this.options.isTty) {
          this.options.onExit?.(0);
        } else {
          this.readsEnabled = false;
          this.options.onDisableReads?.();
        }
        return;
      }

      lineForAssembly = '';
    }

    const command = this.commandBuffer.assemble(lineForAssembly);
    if (command === undefined) {
      this.gotPartial = true;
      return;
    }

    this.gotPartial = false;
    const evaluation = this.options.evaluateCommand(command);
    if (evaluation.result !== '' && (!evaluation.ok || this.options.isTty)) {
      this.writeStdout(`${evaluation.result}\n`);
    }

    if (this.options.isTty) {
      this.writeStdout(TTY_PROMPT);
    }
  }

  /**
   * Report whether the channel will accept additional read events.
   * Mirrors the `Tk_DeleteFileHandler(0)` branch in
   * `ref/micropolis/src/sim/w_tk.c` where non-tty EOF disables future reads.
   */
  isReadEnabled(): boolean {
    return this.readsEnabled;
  }

  private writeStdout(chunk: string): void {
    this.options.onWriteStdout?.(chunk);
  }
}
