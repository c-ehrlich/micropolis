import type { CoreHost, HostMode } from './core-host';
import { DoHost } from './do-host';
import { LocalHost } from './local-host';

/**
 * Default host mode for `apps/web`.
 * Mirrors Micropolis single-process default behavior in `ref/micropolis/src/sim/w_sim.c`
 * where simulation runs locally unless NET pathways are explicitly used.
 * Parity note: this intentionally defaults to LocalHost for deterministic local play.
 */
export const DEFAULT_HOST_MODE: HostMode = 'local';

/**
 * Minimal environment input used for host mode resolution.
 * Mirrors runtime feature toggles around NET command availability in
 * `ref/micropolis/src/sim/w_sim.c`.
 * Parity note: this is a web/Vite configuration adapter surface, not a C global.
 */
export interface HostFactoryEnv {
  readonly VITE_CORE_HOST_MODE?: string;
}

/**
 * Host factory options for explicit mode/config composition.
 * Mirrors Micropolis transport-path selection intent in `ref/micropolis/src/sim/w_sim.c`.
 * Parity note: dependency injection hooks are an intentional TypeScript testing seam.
 */
export interface CreateCoreHostOptions {
  readonly mode?: HostMode;
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
 * Create the selected `CoreHost` implementation from one centralized path.
 * Mirrors Micropolis command routing consistency in `ref/micropolis/src/sim/w_sim.c`,
 * where UI-facing command flow does not branch by transport-specific business logic.
 * Parity note: host class selection is a TypeScript composition concern.
 */
export function createCoreHost(options: CreateCoreHostOptions = {}): CoreHost {
  const mode = resolveHostMode(options);
  const createLocalHost = options.createLocalHost ?? (() => new LocalHost());
  const createDoHost = options.createDoHost ?? (() => new DoHost());
  return mode === 'do' ? createDoHost() : createLocalHost();
}

function isHostMode(value: string): value is HostMode {
  return value === 'local' || value === 'do';
}
