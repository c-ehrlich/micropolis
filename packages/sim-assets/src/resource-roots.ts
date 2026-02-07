/**
 * Default `SIMHOME` value used by Micropolis when no environment override is present.
 * Mirrors `if (!simhome) simhome = ".";` in `ref/micropolis/src/sim/sim.c` (1:1 value).
 */
export const DEFAULT_SIMHOME = '.';

/**
 * Canonical resource roots used by Micropolis file lookups.
 * Mirrors `ResourceDir = "%s/res/"` and image-path usage in
 * `ref/micropolis/src/sim/sim.c` and `ref/micropolis/src/sim/g_setup.c` (1:1 fields).
 */
export interface ResourceRoots {
  readonly simHome: string;
  readonly resourceDir: string;
  readonly imagesDir: string;
}

/**
 * Optional root override for resource lookups.
 * Mirrors `SIMHOME` environment override behavior in `ref/micropolis/src/sim/sim.c`
 * (same source, with explicit TypeScript option shape).
 */
export interface ResolveResourceRootsOptions {
  readonly simHome?: string;
}

/**
 * Resolve Micropolis-style resource roots for resource and image loads.
 * Mirrors `sim.c` path construction semantics for `res` and `images` directories
 * in `ref/micropolis/src/sim/sim.c` (1:1 path forms, surfaced as typed return data).
 */
export function resolveResourceRoots(options: ResolveResourceRootsOptions = {}): ResourceRoots {
  const simHome = options.simHome ?? DEFAULT_SIMHOME;

  return {
    simHome,
    resourceDir: `${simHome}/res/`,
    imagesDir: `${simHome}/images`,
  };
}
