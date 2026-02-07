/**
 * Runtime feature flags for optional Micropolis scripting surfaces.
 * Mirrors compile-time `#ifdef` gates in:
 * - `ref/micropolis/src/sim/w_tk.c` (`CAM` controls `cam_command_init`)
 * - `ref/micropolis/src/sim/w_sim.c` (`CAM`/`NET` optional `sim` entries)
 * Difference from C: TypeScript resolves these as runtime booleans instead of
 * requiring separate compiled binaries.
 */
export interface SimScriptingFeatureFlags {
  CAM?: boolean;
  NET?: boolean;
  legacyExtras?: boolean;
}

/**
 * Fully-resolved feature flags used during command registration.
 * Mirrors the same optional C feature gates (`CAM`, `NET`) while keeping
 * source-delta extras (`legacyExtras`) explicit and deterministic.
 */
export interface ResolvedSimScriptingFeatureFlags {
  readonly CAM: boolean;
  readonly NET: boolean;
  readonly legacyExtras: boolean;
}

/**
 * Default optional-feature mode for the scripting bridge.
 * Mirrors non-`CAM`/non-`NET` builds from `w_tk.c`/`w_sim.c`, and keeps
 * source-delta extras disabled unless explicitly requested.
 */
export const DEFAULT_SIM_SCRIPTING_FEATURE_FLAGS: ResolvedSimScriptingFeatureFlags = {
  CAM: false,
  NET: false,
  legacyExtras: false,
};

/**
 * Resolves optional runtime flags into explicit booleans.
 * Mirrors C compile-time default-off behavior for `CAM`/`NET` in
 * `ref/micropolis/src/sim/w_tk.c` and `ref/micropolis/src/sim/w_sim.c`.
 * Difference from C: flag resolution is runtime-configurable per bootstrap.
 */
export function resolveSimScriptingFeatureFlags(
  flags: SimScriptingFeatureFlags = {},
): ResolvedSimScriptingFeatureFlags {
  return {
    CAM: flags.CAM ?? DEFAULT_SIM_SCRIPTING_FEATURE_FLAGS.CAM,
    NET: flags.NET ?? DEFAULT_SIM_SCRIPTING_FEATURE_FLAGS.NET,
    legacyExtras: flags.legacyExtras ?? DEFAULT_SIM_SCRIPTING_FEATURE_FLAGS.legacyExtras,
  };
}
