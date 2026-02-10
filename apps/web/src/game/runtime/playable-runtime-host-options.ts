/**
 * Compatibility option surface for `createPlayableRuntimeHost(...)` during host migration.
 * Mirrors runtime wiring seams used around Micropolis update/sprite/scenario systems in
 * `ref/micropolis/src/sim/w_util.c`, `ref/micropolis/src/sim/w_sprite.c`, and
 * `ref/micropolis/src/sim/s_fileio.c`.
 * Parity note: this preserves legacy option names and defaults while call sites/tests migrate;
 * `SimCoreEnvelopeHost` may temporarily accept options before each behavior is fully ported.
 */
export interface PlayableRuntimeHostOptions {
  enableAmbientTicks?: boolean;
  patchIntervalMs?: number;
  seedRealtimeDemoObject?: boolean;
  scenarioResourceLoader?: (fileName: string) => Uint8Array | Promise<Uint8Array>;
}
