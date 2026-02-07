/**
 * Runtime parity mode for integration shims.
 * Mirrors legacy behavior in `ref/micropolis/micropolisactivity.py`,
 * `ref/micropolis/src/sim/w_tk.c`, and `ref/micropolis/src/sim/w_net.c`:
 * `strict` is parity-first (1:1 quirks), `safe` allows intentional hardening.
 */
export type ParityMode = 'strict' | 'safe';

/**
 * Feature gates for optional integration subsystems.
 * Mirrors compile/runtime toggles in `ref/micropolis/src/sim/sim.c` and
 * `ref/micropolis/src/sim/w_sim.c` (`-S`, TTY path, and NET hooks).
 * This is intentionally different from C preprocessor flags by exposing
 * an explicit runtime object for TypeScript composition.
 */
export interface IntegrationFeatureFlags {
  sugar: boolean;
  tty: boolean;
  net: boolean;
}

/**
 * Partial feature flag input for runtime creation.
 * Mirrors the same subsystems as `IntegrationFeatureFlags`, but allows
 * per-feature opt-in/opt-out overrides during setup.
 */
export type IntegrationFeatureFlagOptions = Partial<IntegrationFeatureFlags>;

/**
 * Normalized Sugar buddy payload.
 * Mirrors the field ordering used by `SugarBuddyAdd`/`SugarBuddyDel` in
 * `ref/micropolis/micropolisactivity.py` (key, nick, color, address).
 */
export interface SugarBuddy {
  key: string;
  nick: string;
  color: string;
  address: string;
}

/**
 * Result contract for one TTY command evaluation.
 * Mirrors `Tcl_RecordAndEval` status/result usage in
 * `ref/micropolis/src/sim/w_tk.c` `StdinProc` (1:1 shape at the API level).
 */
export interface TtyEvaluatorResult {
  ok: boolean;
  result: string;
}

/**
 * Hooks used by NET UDP integration points.
 * Mirrors `udp_listen`/`udp_hear` callback behavior in
 * `ref/micropolis/src/sim/w_net.c` where packets are surfaced as
 * `HandlePacket <sock> {<ip>} {...}` command strings for Tcl eval.
 */
export interface UdpHooks {
  onPacketCommand?: (command: string) => void;
  onError?: (error: Error, phase: 'listen' | 'hear') => void;
}
