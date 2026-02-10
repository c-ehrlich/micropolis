/**
 * Runtime host option surface for playable route envelope-host construction.
 * Mirrors scenario file resource loading ownership in
 * `ref/micropolis/src/sim/s_fileio.c` (`LoadScenario`) where bytes are loaded
 * before scenario decode/apply.
 * Parity note: demo-only synthetic bootstrap/custom-tool compatibility options
 * were removed once route `/` fully migrated to sim-core-authoritative behavior.
 */
export interface PlayableRuntimeHostOptions {
  scenarioResourceLoader?: (fileName: string) => Uint8Array | Promise<Uint8Array>;
}
