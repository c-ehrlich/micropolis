/**
 * Shared identity fields attached to bridge envelopes.
 * Mirrors the command-routing context in `ref/micropolis/src/sim/w_sim.c`
 * (`SimCmd`) and NET callback context from `ref/micropolis/src/sim/w_net.c`.
 * Parity note: this is intentionally different from C globals/Tcl state by
 * carrying explicit per-envelope identity fields.
 */
export interface BridgeEnvelopeIdentity {
  roomId: string;
  clientId: string;
}

/**
 * Sequencing fields for authoritative outbound ordering.
 * Mirrors ordered command/result flow assumptions from
 * `ref/micropolis/src/sim/w_sim.c` and packet-drain ordering in
 * `ref/micropolis/src/sim/w_net.c` (`udp_hear`).
 * Parity note: Micropolis does not expose `serverSeq`; this is an intentional
 * bridge contract addition for deterministic replay/resync.
 */
export interface BridgeEnvelopeSequence {
  tick: number;
  serverSeq: number;
}

/**
 * Handshake envelope sent from client to host.
 * Mirrors version exposure intent in `SimCmdVersion` from
 * `ref/micropolis/src/sim/w_sim.c`.
 * Parity note: explicit hello negotiation is intentionally different from C's
 * command-style version query.
 */
export interface ClientHelloEnvelope extends BridgeEnvelopeIdentity {
  kind: 'hello';
  protocolVersion: string;
  coreVersion: string;
}

/**
 * High-level gameplay command envelope sent from client to host.
 * Mirrors `sim` command dispatch entry in `ref/micropolis/src/sim/w_sim.c`.
 * Parity note: this contract wraps the Tcl command surface into typed message
 * payloads instead of variadic argv parsing.
 */
export interface ClientCommandEnvelope extends BridgeEnvelopeIdentity {
  kind: 'command';
  commandId: string;
  command: CoreCommandPayload;
}

/**
 * Snapshot request envelope sent from client to host.
 * Mirrors recovery intent from C's command-driven host integration in
 * `ref/micropolis/src/sim/w_sim.c` while adding explicit replay metadata.
 * Parity note: there is no 1:1 C command for bridge snapshot replay.
 */
export interface ClientRequestSnapshotEnvelope extends BridgeEnvelopeIdentity {
  kind: 'request_snapshot';
  afterServerSeq?: number;
}

/**
 * Ping envelope sent from client to host.
 * Mirrors liveness expectations from stream/socket integration in
 * `ref/micropolis/src/sim/w_net.c`.
 * Parity note: this message type is intentionally new for bridge transport.
 */
export interface ClientPingEnvelope extends BridgeEnvelopeIdentity {
  kind: 'ping';
  sentAtMs: number;
}

/**
 * Host hello response envelope.
 * Mirrors version compatibility checks around `SimCmdVersion` in
 * `ref/micropolis/src/sim/w_sim.c`.
 * Parity note: C does not perform strict hello lockstep as a first-class
 * protocol exchange; this is intentionally different.
 */
export interface HostHelloEnvelope extends BridgeEnvelopeIdentity {
  kind: 'hello';
  protocolVersion: string;
  coreVersion: string;
  accepted: boolean;
  message?: string;
}

/**
 * Successful command acknowledgement envelope.
 * Mirrors successful command completion after dispatch in
 * `ref/micropolis/src/sim/w_sim.c`.
 * Parity note: explicit `ack` events are intentionally different from Tcl
 * command return strings in C.
 */
export interface HostAckEnvelope extends BridgeEnvelopeIdentity, BridgeEnvelopeSequence {
  kind: 'ack';
  commandId: string;
}

/**
 * Canonical host reject codes for expected command denials.
 * Mirrors tool return-code branches in `ref/micropolis/src/sim/w_tool.c`
 * (`-1`, `-2`, `-3`) and projects them into stable bridge identifiers.
 * Parity note: string codes are intentionally different from C integer returns
 * so clients can branch deterministically without transport-specific parsing.
 */
export const HOST_REJECT_CODE = {
  TOOL_OUT_OF_BOUNDS: 'tool/out-of-bounds',
  TOOL_NO_FUNDS: 'tool/no-funds',
  TOOL_RULE_REJECT: 'tool/reject',
  TOOL_PENDING_APPROVAL: 'tool/pending-approval',
  MOCK_REJECTED_COMMAND_TYPE: 'mock/rejected-command-type',
} as const;

/**
 * Canonical host reject reason tags for rollback UX.
 * Mirrors expected tool-denial classes in `ref/micropolis/src/sim/w_tool.c`
 * (bounds/funds/pending approval) while exposing typed UI-facing categories.
 * Parity note: these labels are bridge-level metadata, not a 1:1 C enum.
 */
export const HOST_REJECT_REASON = {
  OUT_OF_BOUNDS: 'out-of-bounds',
  INSUFFICIENT_FUNDS: 'insufficient-funds',
  RULES: 'rules',
  PENDING_APPROVAL: 'pending-approval',
  COMMAND_TYPE_REJECTED: 'command-type-rejected',
} as const;

/**
 * Union of canonical host reject code values.
 * Mirrors `HOST_REJECT_CODE` mapping and keeps envelope code branching strict.
 */
export type HostRejectCode = (typeof HOST_REJECT_CODE)[keyof typeof HOST_REJECT_CODE];

/**
 * Union of canonical host reject reason values.
 * Mirrors `HOST_REJECT_REASON` mapping for typed reject semantics.
 */
export type HostRejectReason = (typeof HOST_REJECT_REASON)[keyof typeof HOST_REJECT_REASON];

/**
 * Pending-visual rollback directive carried with expected command denials.
 * Mirrors pending-tool UX intent in `ToolDown`/`DoPendTool` from
 * `ref/micropolis/src/sim/w_tool.c`.
 * Parity note: this explicit payload is intentionally different from C's
 * direct UI callback side effect so host-driven bridge UIs can stay transport
 * agnostic.
 */
export interface HostRejectPendingVisualDirective {
  action: 'rollback';
  commandId: string;
}

/**
 * Structured reject payload for UI rollback and messaging semantics.
 * Mirrors expected command-denial handling from `ref/micropolis/src/sim/w_tool.c`
 * plus bridge-level pending visual coordination.
 */
export interface HostRejectPayload {
  reason: HostRejectReason;
  pendingVisual: HostRejectPendingVisualDirective;
}

/**
 * Expected command denial envelope.
 * Mirrors failure branches from command validation in `w_sim.c` command
 * handlers (argument/range checks returning `TCL_ERROR`).
 * Parity note: reject reason codes and rollback directives are a typed
 * bridge-layer projection.
 */
export interface HostRejectEnvelope extends BridgeEnvelopeIdentity, BridgeEnvelopeSequence {
  kind: 'reject';
  commandId: string;
  code: HostRejectCode;
  message: string;
  reject: HostRejectPayload;
}

/**
 * Incremental authoritative patch envelope.
 * Mirrors per-step state updates driven by simulation command paths in
 * `ref/micropolis/src/sim/w_sim.c`.
 * Parity note: patch payload transport is intentionally different from C's
 * in-process memory mutation model.
 */
export interface HostPatchEnvelope extends BridgeEnvelopeIdentity, BridgeEnvelopeSequence {
  kind: 'patch';
  patch: CorePatchPayload;
}

/**
 * Full authoritative snapshot envelope.
 * Mirrors serialized state export intent from runtime command entry points in
 * `ref/micropolis/src/sim/w_sim.c`.
 * Parity note: snapshot transport is intentionally different from C, where the
 * host and simulation live in the same process.
 */
export interface HostSnapshotEnvelope extends BridgeEnvelopeIdentity, BridgeEnvelopeSequence {
  kind: 'snapshot';
  snapshot: CoreSnapshotPayload;
}

/**
 * Resync instruction envelope emitted by host.
 * Mirrors reconnect/recovery needs implied by command and NET boundaries in
 * `ref/micropolis/src/sim/w_sim.c` and `ref/micropolis/src/sim/w_net.c`.
 * Parity note: explicit `resync` messaging is intentionally new.
 */
export interface HostResyncEnvelope extends BridgeEnvelopeIdentity, BridgeEnvelopeSequence {
  kind: 'resync';
  reason: string;
}

/**
 * Presence update envelope emitted by host.
 * Mirrors multiplayer-presence intent exposed through integration hooks in
 * `ref/micropolis/src/sim/w_sim.c` (multiplayer mode toggles).
 * Parity note: this envelope is intentionally bridge-specific.
 */
export interface HostPresenceEnvelope extends BridgeEnvelopeIdentity, BridgeEnvelopeSequence {
  kind: 'presence';
  joinedClientIds: ReadonlyArray<string>;
  leftClientIds: ReadonlyArray<string>;
}

/**
 * Unexpected host/runtime fault envelope.
 * Mirrors fatal/perror error surfaces in `ref/micropolis/src/sim/w_sim.c`
 * and `ref/micropolis/src/sim/w_net.c`.
 * Parity note: this typed envelope intentionally separates unexpected `error`
 * from expected command `reject`.
 */
export interface HostErrorEnvelope extends BridgeEnvelopeIdentity, BridgeEnvelopeSequence {
  kind: 'error';
  code: string;
  message: string;
  commandId?: string;
}

/**
 * Canonical command payload shape for Stage 1 bridge contracts.
 * Mirrors the high-level command intent of `sim` handlers in
 * `ref/micropolis/src/sim/w_sim.c`.
 * Parity note: this is intentionally not a direct Tcl argv tuple.
 */
export interface CoreCommandPayload {
  type: string;
  payload?: unknown;
}

/**
 * Canonical patch payload shape for Stage 1 bridge contracts.
 * Mirrors incremental simulation update intent from `ref/micropolis/src/sim/w_sim.c`.
 * Parity note: concrete patch field unions are added in later contract tasks.
 */
export interface CorePatchPayload {
  type: string;
  payload?: unknown;
}

/**
 * Canonical snapshot payload shape for Stage 1 bridge contracts.
 * Mirrors baseline state transfer intent from `ref/micropolis/src/sim/w_sim.c`.
 * Parity note: concrete snapshot field schemas are added in later contract tasks.
 */
export interface CoreSnapshotPayload {
  type: string;
  payload?: unknown;
}

/**
 * Union of all client-to-host bridge envelopes.
 * Mirrors typed transport framing over command inputs from
 * `ref/micropolis/src/sim/w_sim.c`.
 */
export type CoreClientEnvelope =
  | ClientHelloEnvelope
  | ClientCommandEnvelope
  | ClientRequestSnapshotEnvelope
  | ClientPingEnvelope;

/**
 * Union of all host-to-client bridge envelopes.
 * Mirrors outbound integration signals derived from
 * `ref/micropolis/src/sim/w_sim.c` and `ref/micropolis/src/sim/w_net.c`.
 */
export type CoreHostEnvelope =
  | HostHelloEnvelope
  | HostAckEnvelope
  | HostRejectEnvelope
  | HostPatchEnvelope
  | HostSnapshotEnvelope
  | HostResyncEnvelope
  | HostPresenceEnvelope
  | HostErrorEnvelope;
