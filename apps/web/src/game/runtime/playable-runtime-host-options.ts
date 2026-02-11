/**
 * Runtime host option surface for playable route envelope-host construction.
 * Mirrors scenario file resource loading ownership in
 * `ref/micropolis/src/sim/s_fileio.c` (`LoadScenario`) where bytes are loaded
 * before scenario decode/apply.
 * Parity note: demo-only synthetic bootstrap/custom-tool compatibility options
 * were removed once route `/` fully migrated to sim-core-authoritative behavior.
 */
export interface PlayableRuntimeHostOptions {
  /**
   * Enables authority-owned ambient simulation ticks for playable browser sessions.
   * Mirrors timer start/stop ownership in `ref/micropolis/src/sim/w_util.c`
   * (`StartMicropolisTimer` / `StopMicropolisTimer`) and frame-loop cadence in
   * `ref/micropolis/src/sim/s_sim.c`.
   * Parity note: this is a host wiring seam; core simulation behavior stays in sim-core.
   */
  enableAmbientTicks?: boolean;
  /**
   * Ambient tick interval in milliseconds for authority-owned simulation stepping.
   * Mirrors browser timer cadence adaptation for Micropolis timer ownership in
   * `ref/micropolis/src/sim/w_util.c`.
   * Parity note: this is a TypeScript scheduling seam, not a C gameplay constant.
   */
  patchIntervalMs?: number;
  scenarioResourceLoader?: (fileName: string) => Uint8Array | Promise<Uint8Array>;
}
