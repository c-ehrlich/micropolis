import type {
  IntegrationFeatureFlagOptions,
  IntegrationFeatureFlags,
  ParityMode,
  SugarBuddy,
  TtyEvaluatorResult,
  UdpHooks,
} from './types.ts';
import {
  SugarStdoutMalformedLineError,
  getPlaySoundToken,
  parseSugarStdoutLine,
} from './sugar/stdout-protocol.ts';

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
 * Hooks exposed for upcoming subsystem wiring.
 * Mirrors Sugar command transport (`micropolisactivity.py`), TTY evaluation
 * (`ref/micropolis/src/sim/w_tk.c`), and UDP callbacks
 * (`ref/micropolis/src/sim/w_net.c`). This is a TypeScript adapter surface,
 * not a direct 1:1 C struct.
 */
export interface IntegrationRuntimeHooks {
  onSugarCommand?: (command: string) => void;
  onSoundToken?: (soundName: string) => void;
  evaluateTtyCommand?: (command: string) => TtyEvaluatorResult;
  udp?: UdpHooks;
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
 * `micropolisactivity.py`, `w_tk.c`, and `w_net.c`. This skeleton is
 * intentionally different for now: methods are feature-gated no-ops until
 * subsystem modules are wired in later phases.
 */
export interface IntegrationRuntime {
  readonly mode: ParityMode;
  readonly features: IntegrationFeatureFlags;
  handleInputLine(line: string): TtyEvaluatorResult | undefined;
  handleOutputLine(line: string): void;
  share(): void;
  focusIn(): void;
  focusOut(): void;
  quit(): void;
  buddyAppeared(buddy: SugarBuddy): void;
  buddyDisappeared(buddy: SugarBuddy): void;
  listenTo(port: number): number;
  hearFrom(fileSock: string): void;
}

/**
 * Create an integration runtime scaffold with normalized defaults.
 * Mirrors integration startup branching in `ref/micropolis/src/sim/sim.c`
 * and no-op command availability expectations in
 * `ref/micropolis/spec/integration/SPEC.md`. This implementation is
 * intentionally different from C today: all feature paths are stubbed no-ops
 * until dedicated Sugar/TTY/NET modules are connected.
 */
export function createIntegrationRuntime(
  options: IntegrationRuntimeOptions = {},
): IntegrationRuntime {
  const mode = options.mode ?? DEFAULT_PARITY_MODE;
  const features = normalizeFeatureFlags(options.features);
  const hooks = options.hooks;

  return {
    mode,
    features,
    handleInputLine(line) {
      if (!features.tty) {
        return undefined;
      }

      void line;
      void hooks;
      return undefined;
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

      hooks?.onSoundToken?.(soundToken);
    },
    share() {
      if (!features.sugar) {
        return;
      }

      void hooks;
    },
    focusIn() {
      if (!features.sugar) {
        return;
      }

      void hooks;
    },
    focusOut() {
      if (!features.sugar) {
        return;
      }

      void hooks;
    },
    quit() {
      if (!features.sugar) {
        return;
      }

      void hooks;
    },
    buddyAppeared(buddy) {
      if (!features.sugar) {
        return;
      }

      void buddy;
      void hooks;
    },
    buddyDisappeared(buddy) {
      if (!features.sugar) {
        return;
      }

      void buddy;
      void hooks;
    },
    listenTo(port) {
      if (!features.net) {
        return 0;
      }

      void port;
      void hooks;
      return 0;
    },
    hearFrom(fileSock) {
      if (!features.net) {
        return;
      }

      void fileSock;
      void hooks;
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
