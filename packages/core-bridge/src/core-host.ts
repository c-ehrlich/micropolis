import type {
  ClientCommandEnvelope,
  ClientHelloEnvelope,
  ClientPingEnvelope,
  ClientRequestSnapshotEnvelope,
  CoreHostEnvelope,
} from './types.ts';

/**
 * Standard async/sync return for host lifecycle and command methods.
 * Mirrors command execution entry style from `ref/micropolis/src/sim/w_sim.c`,
 * where operations may complete immediately or after transport scheduling.
 * Parity note: Promise-capable typing is intentionally different from C's
 * immediate Tcl return codes.
 */
export type CoreHostResult = void | Promise<void>;

/**
 * Callback used to receive host outbound events.
 * Mirrors callback-style event fanout intent from NET packet handling in
 * `ref/micropolis/src/sim/w_net.c` (`Eval` per packet) wrapped into a typed
 * bridge contract.
 */
export type CoreHostEventListener = (event: CoreHostEnvelope) => void;

/**
 * Callback returned by event subscription registration.
 * Mirrors disconnect/remove-handler semantics from stream integration points in
 * `ref/micropolis/src/sim/w_net.c` and `ref/micropolis/src/sim/w_sim.c`.
 * Parity note: explicit unsubscribe callbacks are intentionally different from
 * C file-descriptor handler teardown.
 */
export type CoreHostUnsubscribe = () => void;

/**
 * Client-facing host API consumed by web/runtime callers.
 * Mirrors command/lifecycle entry points from `ref/micropolis/src/sim/w_sim.c`
 * (`SimCmd`, version query, command dispatch) and NET transport wakeups from
 * `ref/micropolis/src/sim/w_net.c` (`udp_listen`/`udp_hear`).
 * Parity note: this is intentionally not 1:1 with Tcl/NET C APIs; it provides
 * a deterministic typed boundary for local and remote host implementations.
 */
export interface CoreHost {
  /**
   * Establish transport/session readiness for host interaction.
   * Mirrors setup semantics from C integration startup before command handling.
   */
  connect(): CoreHostResult;
  /**
   * Tear down host transport/session resources.
   * Mirrors teardown paths where C integrations stop reading sockets/stdin.
   */
  disconnect(): CoreHostResult;
  /**
   * Perform protocol/core handshake between client and host.
   * Mirrors `SimCmdVersion` compatibility intent from `w_sim.c`.
   */
  hello(envelope: ClientHelloEnvelope): CoreHostResult;
  /**
   * Send one gameplay command envelope to the authoritative host.
   * Mirrors `sim` command dispatch entry in `w_sim.c`.
   */
  sendCommand(envelope: ClientCommandEnvelope): CoreHostResult;
  /**
   * Request a fresh authoritative snapshot for bootstrap/recovery.
   * Mirrors integration recovery intent around command/NET boundaries.
   */
  requestSnapshot(envelope: ClientRequestSnapshotEnvelope): CoreHostResult;
  /**
   * Optionally send liveness pings for hosted transports.
   * Mirrors heartbeat/liveness concerns from NET socket integration.
   */
  ping?(envelope: ClientPingEnvelope): CoreHostResult;
  /**
   * Subscribe to ordered host events (`ack`, `reject`, `patch`, etc.).
   * Mirrors callback-driven integration message delivery in `w_net.c`.
   */
  subscribe(listener: CoreHostEventListener): CoreHostUnsubscribe;
}
