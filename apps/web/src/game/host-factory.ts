import type { CoreHost, HostMode } from './core-host';
import { DoHost } from './do-host';
import { LocalHost } from './local-host';
import type { AuthorityMode } from './sim-core-command-authority';

/**
 * Default host mode for `apps/web`.
 * Mirrors Micropolis single-process default behavior in `ref/micropolis/src/sim/w_sim.c`
 * where simulation runs locally unless NET pathways are explicitly used.
 * Parity note: this intentionally defaults to LocalHost for in-process authority play.
 */
export const DEFAULT_HOST_MODE: HostMode = 'local';
/**
 * Default Authoritative Runtime authority engine for web runtime host wiring.
 * Mirrors Sim-Core Authority migration intent to make sim-core the authoritative owner of
 * simulation state/ticking, aligned with `ref/micropolis/src/sim/s_sim.c`.
 * Parity note: deterministic fallback remains available only as an explicit opt-in.
 */
export const DEFAULT_AUTHORITY_MODE: AuthorityMode = 'sim-core';

/**
 * Minimal environment input used for host mode resolution.
 * Mirrors runtime feature toggles around NET command availability in
 * `ref/micropolis/src/sim/w_sim.c`.
 * Parity note: this is a web/Vite configuration adapter surface, not a C global.
 */
export interface HostFactoryEnv {
  readonly VITE_CORE_HOST_MODE?: string;
  // Sim-Core Authority dev/runtime opt-in flag for sim-core authority ownership.
  readonly VITE_REAL_AUTHORITY?: string;
}

/**
 * Host factory options for explicit mode/config composition.
 * Mirrors Micropolis transport-path selection intent in `ref/micropolis/src/sim/w_sim.c`.
 * Parity note: dependency injection hooks are an intentional TypeScript testing seam.
 */
export interface CreateCoreHostOptions {
  readonly mode?: HostMode;
  readonly authorityMode?: AuthorityMode;
  readonly allowDeterministicFallback?: boolean;
  readonly env?: HostFactoryEnv;
  readonly createLocalHost?: () => CoreHost;
  readonly createDoHost?: () => CoreHost;
}

/**
 * Resolve host mode from explicit options, then env, then deterministic default.
 * Mirrors Micropolis runtime behavior where NET pathways are optional additions
 * to the same simulation command surface in `ref/micropolis/src/sim/w_sim.c`.
 * Parity note: strict string validation is an intentional TypeScript hardening step.
 */
export function resolveHostMode(options: CreateCoreHostOptions = {}): HostMode {
  const configuredMode =
    options.mode ?? options.env?.VITE_CORE_HOST_MODE ?? import.meta.env.VITE_CORE_HOST_MODE;
  if (configuredMode === undefined || configuredMode === '') {
    return DEFAULT_HOST_MODE;
  }

  if (!isHostMode(configuredMode)) {
    throw new Error(`Unsupported host mode: ${configuredMode}`);
  }

  return configuredMode;
}

/**
 * Resolve Authoritative Runtime authority mode from explicit options, then legacy opt-in validation.
 * Mirrors Sim-Core Authority host-authority migration intent rooted in `ref/micropolis/src/sim/w_sim.c`
 * and simulation ownership in `ref/micropolis/src/sim/s_sim.c`.
 * Parity note: deterministic fallback remains explicit test wiring only and is not
 * selected from browser env flags on the shipping path.
 */
export function resolveAuthorityMode(options: CreateCoreHostOptions = {}): AuthorityMode {
  if (options.authorityMode !== undefined) {
    return options.authorityMode;
  }

  const realAuthorityOptIn =
    options.env?.VITE_REAL_AUTHORITY ?? import.meta.env.VITE_REAL_AUTHORITY;
  if (realAuthorityOptIn !== undefined && realAuthorityOptIn !== '') {
    if (isEnabledFlag(realAuthorityOptIn)) {
      return 'sim-core';
    }
    if (!isDisabledFlag(realAuthorityOptIn)) {
      throw new Error(`Unsupported runtime real authority flag: ${realAuthorityOptIn}`);
    }
  }
  return DEFAULT_AUTHORITY_MODE;
}

/**
 * Create the selected `CoreHost` implementation from one centralized path.
 * Mirrors Micropolis command routing consistency in `ref/micropolis/src/sim/w_sim.c`,
 * where UI-facing command flow does not branch by transport-specific business logic.
 * Parity note: host class selection is a TypeScript composition concern.
 */
export function createCoreHost(options: CreateCoreHostOptions = {}): CoreHost {
  const mode = resolveHostMode(options);
  const authorityMode = resolveAuthorityMode(options);
  const createLocalHost =
    options.createLocalHost ??
    (() =>
      new LocalHost({
        authorityMode,
        allowDeterministicFallback: options.allowDeterministicFallback,
      }));
  const createDoHost =
    options.createDoHost ??
    (() =>
      new DoHost({
        authorityMode,
        allowDeterministicFallback: options.allowDeterministicFallback,
      }));
  return mode === 'do' ? createDoHost() : createLocalHost();
}

function isHostMode(value: string): value is HostMode {
  return value === 'local' || value === 'do';
}

function isEnabledFlag(value: string): boolean {
  return value === '1' || value.toLowerCase() === 'true';
}

function isDisabledFlag(value: string): boolean {
  return value === '0' || value.toLowerCase() === 'false';
}
