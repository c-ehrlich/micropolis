import { createUdpHookRuntime, type UdpListenPlatform } from './net/udp-hooks.ts';
import {
  serializeSugarActivateCommand,
  serializeSugarBuddyAddCommand,
  serializeSugarBuddyDelCommand,
  serializeSugarDeactivateCommand,
  serializeSugarQuitCommand,
  serializeSugarShareCommand,
} from './sugar/activity-bridge.ts';
import {
  getPlaySoundToken,
  parseSugarStdoutLine,
  SugarStdoutMalformedLineError,
} from './sugar/stdout-protocol.ts';
import { StdinChannel } from './tty/stdin-channel.ts';
import type {
  IntegrationFeatureFlagOptions,
  IntegrationFeatureFlags,
  ParityMode,
  SugarBuddy,
  TtyEvaluatorResult,
  UdpHooks,
} from './types.ts';

/**
 * Default parity mode for integration runtime behavior.
 * Mirrors startup defaults in `ref/micropolis/src/sim/sim.c` where optional
 * integration paths are opt-in, with strict parity as the baseline.
 */
export const DEFAULT_PARITY_MODE: ParityMode = 'strict';

/**
 * Default feature toggles for integration subsystems.
 * Mirrors optional Sugar/TTY/NET surfaces from `ref/micropolis/micropolisactivity.py`,
 * `ref/micropolis/src/sim/w_tk.c`, and `ref/micropolis/src/sim/w_net.c`.
 * This is intentionally different from C globals/compile flags by using a
 * normalized runtime object.
 */
export const DEFAULT_INTEGRATION_FEATURE_FLAGS: IntegrationFeatureFlags = {
  sugar: false,
  tty: false,
  net: false,
};

/**
 * Hooks consumed by the integration runtime orchestration.
 * Mirrors Sugar command transport (`micropolisactivity.py`), TTY evaluation
 * (`ref/micropolis/src/sim/w_tk.c`), and UDP callbacks/setup
 * (`ref/micropolis/src/sim/w_net.c`). This is a TypeScript adapter surface,
 * not a direct 1:1 C struct.
 */
export interface IntegrationRuntimeHooks {
  onSugarCommand?: (command: string) => void;
  onSoundToken?: (soundName: string) => void;
  evaluateTtyCommand?: (command: string) => TtyEvaluatorResult;
  tty?: IntegrationRuntimeTtyHooks;
  udp?: UdpHooks;
  udpPlatform?: UdpListenPlatform;
}

/**
 * Optional TTY channel hooks consumed by runtime orchestration.
 * Mirrors stdin loop side effects in `ref/micropolis/src/sim/w_tk.c`
 * (`StdinProc` stdout writes, exit behavior, and read-disable branch).
 * Parity note: this is intentionally adapter-based in TypeScript instead of
 * directly invoking Tk file-handler APIs.
 */
export interface IntegrationRuntimeTtyHooks {
  isTty?: boolean;
  onWriteStdout?: (chunk: string) => void;
  onExit?: (exitCode: number) => void;
  onDisableReads?: () => void;
}

/**
 * Input contract for creating the integration runtime.
 * Mirrors command-line/config toggles from `ref/micropolis/src/sim/sim.c`
 * (`-S`, `-t`, and NET presence), while exposing an explicit object for
 * TypeScript composition.
 */
export interface IntegrationRuntimeOptions {
  mode?: ParityMode;
  features?: IntegrationFeatureFlagOptions;
  hooks?: IntegrationRuntimeHooks;
}

/**
 * Runtime API surface for integration orchestration.
 * Mirrors the external integration entry points spread across
 * `micropolisactivity.py`, `w_tk.c`, and `w_net.c`, with adapter-driven
 * boundaries for transport and platform-specific IO.
 */
export interface IntegrationRuntime {
  readonly mode: ParityMode;
  readonly features: IntegrationFeatureFlags;
  /**
   * Feed one stdin line (or EOF as `null`) into the TTY command channel.
   * Mirrors `StdinProc` `fgets`/EOF handling in `ref/micropolis/src/sim/w_tk.c`.
   * Parity note: this API is intentionally direct input injection rather than
   * Tk file-handler callbacks.
   */
  handleInputLine(line: string | null): TtyEvaluatorResult | undefined;
  /**
   * Feed one stdout line from the Sugar bridge into command dispatch.
   * Mirrors `_stdout_thread_function` in `ref/micropolis/micropolisactivity.py`:
   * trim, explicit-space split, `PlaySound` dispatch, and strict fatal behavior
   * for missing `words[1]`.
   * Parity note: `safe` mode intentionally hardens malformed `PlaySound` lines
   * by swallowing typed parse errors instead of throwing.
   */
  handleOutputLine(line: string): void;
  /**
   * Emit the Sugar share command into the outbound bridge.
   * Mirrors `share()` in `ref/micropolis/micropolisactivity.py`, which sends
   * `SugarShare\n` after activity-level share handling.
   * Parity note: this runtime only covers sim-process transport, so UI-level
   * `Activity.share(self)` side effects are intentionally out of scope.
   */
  share(): void;
  /**
   * Emit the Sugar focus-in activation command.
   * Mirrors `_focus_in_cb()` in `ref/micropolis/micropolisactivity.py`, which
   * writes `SugarActivate\n` to the sim process.
   * Parity note: callback args (`window`, `event`) are intentionally omitted in
   * this transport-level API.
   */
  focusIn(): void;
  /**
   * Emit the Sugar focus-out deactivation command.
   * Mirrors `_focus_out_cb()` in `ref/micropolis/micropolisactivity.py`, which
   * writes `SugarDeactivate\n` to the sim process.
   * Parity note: callback args (`window`, `event`) are intentionally omitted in
   * this transport-level API.
   */
  focusOut(): void;
  /**
   * Emit the Sugar quit command into the outbound bridge.
   * Mirrors `quit_process()` in `ref/micropolis/micropolisactivity.py`, which
   * sends `SugarQuit\n` before a delayed teardown.
   * Parity note: this runtime emits only the command; the original sleep/GUI
   * teardown ordering is intentionally left to callers.
   */
  quit(): void;
  /**
   * Emit the Sugar buddy-appeared command into the outbound bridge.
   * Mirrors `_buddy_appeared_cb` in `ref/micropolis/micropolisactivity.py`,
   * which sends `SugarBuddyAdd "<key>" "<nick>" "<color>" "<address>"\n`.
   * Parity note: accepts normalized `SugarBuddy` or legacy Sugar buddy objects;
   * field extraction/precedence parity is delegated to activity-bridge helpers.
   */
  buddyAppeared(buddy: SugarBuddy | unknown): void;
  /**
   * Emit the Sugar buddy-disappeared command into the outbound bridge.
   * Mirrors `_buddy_disappeared_cb` in `ref/micropolis/micropolisactivity.py`,
   * which sends `SugarBuddyDel "<key>" "<nick>" "<color>" "<address>"\n`.
   * Parity note: accepts normalized `SugarBuddy` or legacy Sugar buddy objects;
   * field extraction/precedence parity is delegated to activity-bridge helpers.
   */
  buddyDisappeared(buddy: SugarBuddy | unknown): void;
  /**
   * Open/listen on one UDP socket for NET packet intake.
   * Mirrors `sim ListenTo` in `ref/micropolis/src/sim/w_sim.c`, which forwards
   * to `udp_listen(port)` in `ref/micropolis/src/sim/w_net.c` and returns the
   * socket descriptor (or `0` on setup failure).
   * Parity note: returns `0` when NET wiring is disabled or no UDP platform
   * adapter is provided, preserving Micropolis-style failure semantics.
   */
  listenTo(port: number): number;
  /**
   * Drain pending packets for a Tcl `file<sock>` token.
   * Mirrors `sim HearFrom file<sock>` in `ref/micropolis/src/sim/w_sim.c`,
   * which validates the `file` prefix and dispatches to `udp_hear(sock)` in
   * `ref/micropolis/src/sim/w_net.c`.
   * Parity note: this is a no-op when NET wiring is disabled or no UDP
   * platform adapter is provided.
   */
  hearFrom(fileSock: string): void;
}

/**
 * Create the integration runtime with feature-gated Sugar/TTY/NET wiring.
 * Mirrors integration startup branching in `ref/micropolis/src/sim/sim.c`
 * and routes commands/events through parity ports from
 * `ref/micropolis/micropolisactivity.py`, `ref/micropolis/src/sim/w_tk.c`,
 * and `ref/micropolis/src/sim/w_net.c`.
 * Parity note: unlike C globals, TypeScript wiring is adapter-based and NET
 * hooks require an explicit `udpPlatform` implementation.
 */
export function createIntegrationRuntime(
  options: IntegrationRuntimeOptions = {},
): IntegrationRuntime {
  const mode = options.mode ?? DEFAULT_PARITY_MODE;
  const features = normalizeFeatureFlags(options.features);
  const hooks = options.hooks;
  let lastTtyEvaluation: TtyEvaluatorResult | undefined;

  const ttyChannel = features.tty
    ? new StdinChannel({
        isTty: hooks?.tty?.isTty ?? false,
        evaluateCommand(command) {
          const evaluation =
            hooks?.evaluateTtyCommand?.(command) ?? createDefaultTtyEvaluatorResult();
          lastTtyEvaluation = evaluation;
          return evaluation;
        },
        onWriteStdout: hooks?.tty?.onWriteStdout,
        onExit: hooks?.tty?.onExit,
        onDisableReads: hooks?.tty?.onDisableReads,
      })
    : undefined;
  ttyChannel?.start();

  const udpRuntime =
    features.net && hooks?.udpPlatform !== undefined
      ? createUdpHookRuntime({
          mode,
          platform: hooks.udpPlatform,
          hooks: hooks.udp,
        })
      : undefined;

  return {
    mode,
    features,
    handleInputLine(line) {
      if (!features.tty || ttyChannel === undefined) {
        return undefined;
      }

      lastTtyEvaluation = undefined;
      ttyChannel.consumeLine(line);
      return lastTtyEvaluation;
    },
    handleOutputLine(line) {
      if (!features.sugar) {
        return;
      }

      const stdoutLine = parseSugarStdoutLine(line);
      if (stdoutLine === undefined) {
        return;
      }

      const soundToken = getPlaySoundToken(stdoutLine, mode);
      if (soundToken === undefined) {
        return;
      }

      if (soundToken instanceof SugarStdoutMalformedLineError) {
        return;
      }

      hooks?.onSoundToken?.(soundToken.toLowerCase());
    },
    share() {
      if (!features.sugar) {
        return;
      }

      hooks?.onSugarCommand?.(serializeSugarShareCommand());
    },
    focusIn() {
      if (!features.sugar) {
        return;
      }

      hooks?.onSugarCommand?.(serializeSugarActivateCommand());
    },
    focusOut() {
      if (!features.sugar) {
        return;
      }

      hooks?.onSugarCommand?.(serializeSugarDeactivateCommand());
    },
    quit() {
      if (!features.sugar) {
        return;
      }

      hooks?.onSugarCommand?.(serializeSugarQuitCommand());
    },
    buddyAppeared(buddy) {
      if (!features.sugar) {
        return;
      }

      hooks?.onSugarCommand?.(serializeSugarBuddyAddCommand(buddy));
    },
    buddyDisappeared(buddy) {
      if (!features.sugar) {
        return;
      }

      hooks?.onSugarCommand?.(serializeSugarBuddyDelCommand(buddy));
    },
    listenTo(port) {
      if (!features.net || udpRuntime === undefined) {
        return 0;
      }

      return udpRuntime.listenTo(port);
    },
    hearFrom(fileSock) {
      if (!features.net || udpRuntime === undefined) {
        return;
      }

      udpRuntime.hearFrom(fileSock);
    },
  };
}

function normalizeFeatureFlags(
  options: IntegrationFeatureFlagOptions | undefined,
): IntegrationFeatureFlags {
  return {
    sugar: options?.sugar ?? DEFAULT_INTEGRATION_FEATURE_FLAGS.sugar,
    tty: options?.tty ?? DEFAULT_INTEGRATION_FEATURE_FLAGS.tty,
    net: options?.net ?? DEFAULT_INTEGRATION_FEATURE_FLAGS.net,
  };
}

function createDefaultTtyEvaluatorResult(): TtyEvaluatorResult {
  return {
    ok: true,
    result: '',
  };
}
