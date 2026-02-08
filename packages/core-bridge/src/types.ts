/**
 * Frozen bridge protocol identifier for Stage 0 v1 contracts.
 * Mirrors the strict lockstep handshake intent documented in
 * `ref/micropolis/spec/integration/SPEC.md` and the command gateway mindset in
 * `ref/micropolis/src/sim/w_sim.c`.
 * Parity note: intentionally different from Micropolis Tcl command strings by
 * using a typed transport-agnostic version token.
 */
export const CORE_BRIDGE_V1_PROTOCOL_VERSION = 'core-bridge/v1' as const;

/**
 * Frozen city payload namespace for v1 gameplay contracts.
 * Mirrors the integration boundary described in
 * `ref/micropolis/spec/integration/SPEC.md`.
 * Parity note: intentionally different from C globals by introducing an explicit
 * payload namespace for TypeScript contracts.
 */
export const CORE_BRIDGE_V1_CITY_PAYLOAD_VERSION = 'city/v1' as const;

/**
 * Default authoritative snapshot cadence in ticks.
 * Mirrors the Stage 0 lock in `/Users/cje/dev/city/MASTER_GAME_ALIGNMENT_PLAN.md`.
 * Parity note: intentionally different from legacy ad-hoc update cadence by
 * making the default interval explicit in the wire contract.
 */
export const CORE_BRIDGE_V1_DEFAULT_SNAPSHOT_CADENCE_TICKS = 64 as const;

/**
 * Deterministic local-mode room identifier.
 * Mirrors local host defaults in `/Users/cje/dev/city/MASTER_GAME_ALIGNMENT_PLAN.md`.
 * Parity note: intentionally different from Micropolis C, which does not expose
 * a room identity concept in `w_sim.c` networking hooks.
 */
export const CORE_BRIDGE_V1_LOCAL_ROOM_ID = 'local-room' as const;

/**
 * Deterministic local-mode client identifier.
 * Mirrors local host defaults in `/Users/cje/dev/city/MASTER_GAME_ALIGNMENT_PLAN.md`.
 * Parity note: intentionally different from Micropolis C, which does not expose
 * a typed client identity in `w_net.c`.
 */
export const CORE_BRIDGE_V1_LOCAL_CLIENT_ID = 'local-client' as const;

/**
 * Canonical v1 client-to-host envelope discriminants.
 * Mirrors inbound command categories in `ref/micropolis/src/sim/w_sim.c`.
 * Parity note: intentionally different from Tcl command-line parsing by using a
 * finite discriminated union for transport messages.
 */
export const CORE_BRIDGE_V1_CLIENT_ENVELOPE_KINDS = [
  'hello',
  'command',
  'request_snapshot',
  'ping',
] as const;

/**
 * Canonical v1 host-to-client envelope discriminants.
 * Mirrors outbound integration semantics from
 * `ref/micropolis/spec/integration/SPEC.md`.
 * Parity note: intentionally different from Micropolis stdout/UDP text payloads
 * by freezing explicit typed envelope kinds.
 */
export const CORE_BRIDGE_V1_SERVER_ENVELOPE_KINDS = [
  'hello',
  'ack',
  'reject',
  'patch',
  'snapshot',
  'resync',
  'presence',
  'error',
] as const;

/**
 * Room identity in v1 bridge envelopes.
 * Mirrors channel scoping intent from `ref/micropolis/src/sim/w_net.c`.
 * Parity note: intentionally different from C socket-level addressing by using a
 * stable string room identifier in every envelope.
 */
export type CoreBridgeRoomIdV1 = string;

/**
 * Client identity in v1 bridge envelopes.
 * Mirrors peer identity needs implied by Sugar/NET integration layers in
 * `ref/micropolis/spec/integration/SPEC.md`.
 * Parity note: intentionally different from C integration, where identity is not
 * consistently represented as a required typed field.
 */
export type CoreBridgeClientIdV1 = string;

/**
 * Command idempotency key in v1 command lifecycle envelopes.
 * Mirrors deterministic command handling expectations from
 * `ref/micropolis/src/sim/w_sim.c`.
 * Parity note: intentionally different from C command execution, which does not
 * require an explicit idempotency token.
 */
export type CoreBridgeCommandIdV1 = string;

/**
 * Authoritative simulation tick index.
 * Mirrors simulation progression concepts in `ref/micropolis/src/sim/s_sim.c`.
 * Parity note: 1:1 with the concept of advancing simulation ticks, but exposed
 * as a required transport field.
 */
export type CoreBridgeTickV1 = number;

/**
 * Strictly monotonic server sequence number.
 * Mirrors ordered integration message expectations from
 * `ref/micropolis/spec/integration/SPEC.md`.
 * Parity note: intentionally different from legacy Micropolis NET hooks, which
 * do not provide a first-class monotonic sequence field.
 */
export type CoreBridgeServerSeqV1 = number;

/**
 * Client-to-host envelope kind discriminant union.
 * Mirrors command ingress categories in `ref/micropolis/src/sim/w_sim.c`.
 * Parity note: intentionally different from free-form Tcl commands by freezing
 * closed string literal kinds.
 */
export type CoreBridgeV1ClientEnvelopeKind = (typeof CORE_BRIDGE_V1_CLIENT_ENVELOPE_KINDS)[number];

/**
 * Host-to-client envelope kind discriminant union.
 * Mirrors update/feedback categories in `ref/micropolis/spec/integration/SPEC.md`.
 * Parity note: intentionally different from line-oriented legacy outputs by
 * freezing a closed discriminated union.
 */
export type CoreBridgeV1ServerEnvelopeKind = (typeof CORE_BRIDGE_V1_SERVER_ENVELOPE_KINDS)[number];

/**
 * Union of all v1 envelope kind discriminants.
 * Mirrors the full protocol inventory locked in Stage 0 plans.
 * Parity note: intentionally different from the C integration path by centralizing
 * all envelope names under one typed union.
 */
export type CoreBridgeV1EnvelopeKind =
  | CoreBridgeV1ClientEnvelopeKind
  | CoreBridgeV1ServerEnvelopeKind;

type CoreBridgeV1Extensions = Readonly<Record<string, unknown>>;

interface CoreBridgeV1EnvelopeBase<TKind extends CoreBridgeV1EnvelopeKind> {
  readonly kind: TKind;
  readonly roomId: CoreBridgeRoomIdV1;
  readonly clientId: CoreBridgeClientIdV1;
}

interface CoreBridgeV1SequencedEnvelopeBase<
  TKind extends CoreBridgeV1ServerEnvelopeKind,
> extends CoreBridgeV1EnvelopeBase<TKind> {
  readonly tick: CoreBridgeTickV1;
  readonly serverSeq: CoreBridgeServerSeqV1;
}

/**
 * City build tool identifiers for v1 command payloads.
 * Mirrors major tool paths in `ref/micropolis/src/sim/w_tool.c` (`do_tool` dispatch).
 * Parity note: intentionally different from numeric `tool_state` enums by using
 * named string literals in the wire contract.
 */
export type CityToolV1 =
  | 'road'
  | 'rail'
  | 'wire'
  | 'bulldoze'
  | 'residential'
  | 'commercial'
  | 'industrial'
  | 'police_dept'
  | 'fire_dept'
  | 'stadium'
  | 'park'
  | 'seaport'
  | 'airport'
  | 'coal_power'
  | 'nuclear_power'
  | 'query';

/**
 * Simulation speed domain accepted by v1 commands and snapshots.
 * Mirrors `SimCmdSpeed` range checks in `ref/micropolis/src/sim/w_sim.c` (`0..7`).
 * Parity note: 1:1 numeric range parity with C speed constraints.
 */
export type CitySimSpeedV1 = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

/**
 * Demand projection scalars included in snapshot and patch contracts.
 * Mirrors demand/valve reporting concepts in `ref/micropolis/src/sim/w_update.c`.
 * Parity note: intentionally different from scattered C globals by publishing one
 * stable grouped object in the bridge payload.
 */
export interface CityDemandV1 {
  readonly residential: number;
  readonly commercial: number;
  readonly industrial: number;
}

/**
 * Message feed entry carried by snapshot/patch payloads.
 * Mirrors `sendMes` / `sendMesAt` message stream behavior in
 * `ref/micropolis/src/sim/s_msg.c`.
 * Parity note: intentionally different from legacy numeric-only message channels
 * by exposing richer typed fields for UI clients.
 */
export interface CityMessageV1 {
  readonly messageId: number;
  readonly text: string;
  readonly tick: CoreBridgeTickV1;
}

/**
 * Full concrete v1 command payload union for city gameplay.
 * Mirrors tool and runtime command classes from
 * `ref/micropolis/src/sim/w_tool.c` and `ref/micropolis/src/sim/w_sim.c`.
 * Parity note: intentionally different from Tcl command strings by freezing one
 * typed discriminated union for tools, sim controls, lifecycle, persistence, and scenarios.
 */
export type CityCommandPayloadV1 =
  | {
      readonly type: 'tool_apply';
      readonly tool: CityToolV1;
      readonly x: number;
      readonly y: number;
      readonly dragTo?: Readonly<{
        readonly x: number;
        readonly y: number;
      }>;
      readonly extensions?: CoreBridgeV1Extensions;
    }
  | {
      readonly type: 'sim_pause';
      readonly extensions?: CoreBridgeV1Extensions;
    }
  | {
      readonly type: 'sim_resume';
      readonly extensions?: CoreBridgeV1Extensions;
    }
  | {
      readonly type: 'sim_set_speed';
      readonly speed: CitySimSpeedV1;
      readonly extensions?: CoreBridgeV1Extensions;
    }
  | {
      readonly type: 'city_new';
      readonly cityName: string;
      readonly difficulty: 'easy' | 'medium' | 'hard';
      readonly terrainSeed: number;
      readonly createIsland: boolean;
      readonly extensions?: CoreBridgeV1Extensions;
    }
  | {
      readonly type: 'city_load';
      readonly format: 'cty';
      readonly encoding: 'base64';
      readonly encodedCityData: string;
      readonly extensions?: CoreBridgeV1Extensions;
    }
  | {
      readonly type: 'city_save';
      readonly format: 'cty';
      readonly target: 'download' | 'autosave' | 'slot';
      readonly slotId?: string;
      readonly extensions?: CoreBridgeV1Extensions;
    }
  | {
      readonly type: 'scenario_start';
      readonly scenarioId: number;
      readonly extensions?: CoreBridgeV1Extensions;
    };

/**
 * Concrete v1 patch payload for ordered authoritative deltas.
 * Mirrors incremental world/head updates from `ref/micropolis/src/sim/w_update.c`.
 * Parity note: intentionally different from C callback fan-out by batching all
 * map/hud/message/lifecycle deltas in one typed payload envelope.
 */
export interface CityPatchPayloadV1 {
  readonly mapDeltas: readonly Readonly<{
    readonly x: number;
    readonly y: number;
    readonly tile: number;
  }>[];
  readonly hud: Readonly<{
    readonly funds?: number;
    readonly date?: Readonly<{
      readonly year: number;
      readonly month: number;
    }>;
    readonly demand?: CityDemandV1;
    readonly simSpeed?: CitySimSpeedV1;
  }>;
  readonly messageFeed: readonly CityMessageV1[];
  readonly lifecycle: readonly (
    | Readonly<{
        readonly kind: 'sim_paused';
      }>
    | Readonly<{
        readonly kind: 'sim_resumed';
      }>
    | Readonly<{
        readonly kind: 'city_reset';
        readonly cityName: string;
      }>
    | Readonly<{
        readonly kind: 'city_loaded';
        readonly cityName: string;
        readonly source: 'save' | 'scenario';
      }>
    | Readonly<{
        readonly kind: 'scenario_started';
        readonly scenarioId: number;
      }>
    | Readonly<{
        readonly kind: 'city_saved';
        readonly target: 'download' | 'autosave' | 'slot';
        readonly slotId?: string;
      }>
  )[];
  readonly extensions?: CoreBridgeV1Extensions;
}

/**
 * Concrete v1 snapshot payload for reconnect/bootstrap baselines.
 * Mirrors full-state bootstrap intent from `ref/micropolis/spec/integration/SPEC.md`.
 * Parity note: intentionally different from C in-memory globals by providing one
 * serializable authoritative projection with replay metadata.
 */
export interface CitySnapshotPayloadV1 {
  readonly map: Readonly<{
    readonly width: number;
    readonly height: number;
    readonly tiles: readonly number[];
  }>;
  readonly hud: Readonly<{
    readonly funds: number;
    readonly date: Readonly<{
      readonly year: number;
      readonly month: number;
    }>;
    readonly demand: CityDemandV1;
    readonly simSpeed: CitySimSpeedV1;
    readonly messageFeed: readonly CityMessageV1[];
  }>;
  readonly lifecycle: Readonly<{
    readonly mode: 'running' | 'paused';
    readonly cityName: string;
    readonly scenarioId: number | null;
  }>;
  readonly replay: Readonly<{
    readonly snapshotTick: CoreBridgeTickV1;
    readonly appliedServerSeq: CoreBridgeServerSeqV1;
    readonly patchTailStartServerSeq: CoreBridgeServerSeqV1;
  }>;
  readonly extensions?: CoreBridgeV1Extensions;
}

/**
 * Frozen v1 handshake payload shared by client and host `hello` envelopes.
 * Mirrors startup compatibility checks in `ref/micropolis/spec/integration/SPEC.md`.
 * Parity note: intentionally different from Micropolis process startup flags by
 * carrying explicit protocol/core versions in-band.
 */
export interface CoreBridgeV1HelloPayload {
  readonly protocolVersion: typeof CORE_BRIDGE_V1_PROTOCOL_VERSION;
  readonly cityPayloadVersion: typeof CORE_BRIDGE_V1_CITY_PAYLOAD_VERSION;
  readonly coreVersion: string;
  readonly snapshotCadenceTicks: number;
  readonly extensions?: CoreBridgeV1Extensions;
}

/**
 * `hello` envelope used during v1 lockstep negotiation.
 * Mirrors pre-command setup/identity intents from
 * `ref/micropolis/spec/integration/SPEC.md`.
 * Parity note: intentionally different from C startup glue by requiring explicit
 * room/client identity and version payload fields.
 */
export interface CoreBridgeV1HelloEnvelope extends CoreBridgeV1EnvelopeBase<'hello'> {
  readonly payload: CoreBridgeV1HelloPayload;
}

/**
 * `command` envelope carrying typed gameplay intent from client to host.
 * Mirrors command entry points in `ref/micropolis/src/sim/w_sim.c` and tools in
 * `ref/micropolis/src/sim/w_tool.c`.
 * Parity note: intentionally different from command-string evaluation because this
 * envelope freezes typed payload variants and idempotency key requirements.
 */
export interface CoreBridgeV1CommandEnvelope extends CoreBridgeV1EnvelopeBase<'command'> {
  readonly commandId: CoreBridgeCommandIdV1;
  readonly payload: CityCommandPayloadV1;
}

/**
 * `request_snapshot` envelope used for reconnect/resync snapshot pulls.
 * Mirrors reconnect baseline intent in `ref/micropolis/spec/integration/SPEC.md`.
 * Parity note: intentionally different from legacy Micropolis by making snapshot
 * replay requests explicit in the protocol.
 */
export interface CoreBridgeV1RequestSnapshotEnvelope extends CoreBridgeV1EnvelopeBase<'request_snapshot'> {
  readonly payload: Readonly<{
    readonly reason: 'reconnect' | 'sequence_gap' | 'manual';
    readonly afterServerSeq?: CoreBridgeServerSeqV1;
    readonly sentAtMs: number;
  }>;
}

/**
 * `ping` envelope for client->host liveness and latency checks.
 * Mirrors optional network liveness behavior implied by `w_net.c`.
 * Parity note: intentionally different from raw UDP packet polling by using an
 * explicit typed ping payload.
 */
export interface CoreBridgeV1PingEnvelope extends CoreBridgeV1EnvelopeBase<'ping'> {
  readonly payload: Readonly<{
    readonly pingId: string;
    readonly sentAtMs: number;
  }>;
}

/**
 * `ack` envelope for successful or idempotent command acceptance.
 * Mirrors command-result feedback expectations from
 * `ref/micropolis/src/sim/w_sim.c`.
 * Parity note: intentionally different from direct in-process command execution
 * by explicitly reporting dedupe state and command type.
 */
export interface CoreBridgeV1AckEnvelope extends CoreBridgeV1SequencedEnvelopeBase<'ack'> {
  readonly commandId: CoreBridgeCommandIdV1;
  readonly payload: Readonly<{
    readonly deduplicated: boolean;
    readonly commandType: CityCommandPayloadV1['type'];
    readonly extensions?: CoreBridgeV1Extensions;
  }>;
}

/**
 * Canonical reject reason codes for expected command denial paths.
 * Mirrors denial semantics around placement/funds/arguments in
 * `ref/micropolis/src/sim/w_tool.c` and `ref/micropolis/src/sim/w_sim.c`.
 * Parity note: intentionally different from C integer return conventions by
 * exposing explicit symbolic reason identifiers.
 */
export type CoreBridgeV1RejectCode =
  | 'invalid_command'
  | 'invalid_placement'
  | 'insufficient_funds'
  | 'out_of_bounds'
  | 'version_mismatch';

/**
 * `reject` envelope for expected command denial outcomes.
 * Mirrors predictable validation/rule rejection pathways in
 * `ref/micropolis/src/sim/w_sim.c`.
 * Parity note: intentionally different from C error strings by freezing typed
 * reject code/message/retryability fields.
 */
export interface CoreBridgeV1RejectEnvelope extends CoreBridgeV1SequencedEnvelopeBase<'reject'> {
  readonly commandId: CoreBridgeCommandIdV1;
  readonly payload: Readonly<{
    readonly code: CoreBridgeV1RejectCode;
    readonly message: string;
    readonly retryable: boolean;
    readonly extensions?: CoreBridgeV1Extensions;
  }>;
}

/**
 * `patch` envelope for ordered incremental authoritative updates.
 * Mirrors incremental update flows in `ref/micropolis/src/sim/w_update.c`.
 * Parity note: intentionally different from C UI callback fan-out by bundling
 * deterministic deltas into one transport payload.
 */
export interface CoreBridgeV1PatchEnvelope extends CoreBridgeV1SequencedEnvelopeBase<'patch'> {
  readonly payload: CityPatchPayloadV1;
}

/**
 * `snapshot` envelope carrying full authoritative baseline state.
 * Mirrors reconnect/load baseline expectations in
 * `ref/micropolis/spec/integration/SPEC.md`.
 * Parity note: intentionally different from C global state pointers by using a
 * fully serializable snapshot projection.
 */
export interface CoreBridgeV1SnapshotEnvelope extends CoreBridgeV1SequencedEnvelopeBase<'snapshot'> {
  readonly payload: CitySnapshotPayloadV1;
}

/**
 * `resync` envelope directing client recovery when stream continuity is lost.
 * Mirrors gap-recovery intent in `ref/micropolis/spec/integration/SPEC.md`.
 * Parity note: intentionally different from Micropolis C, which has no explicit
 * typed resync control envelope.
 */
export interface CoreBridgeV1ResyncEnvelope extends CoreBridgeV1SequencedEnvelopeBase<'resync'> {
  readonly payload: Readonly<{
    readonly reason: 'sequence_gap' | 'manual' | 'server_restart';
    readonly expectedNextServerSeq: CoreBridgeServerSeqV1;
    readonly snapshotRequired: true;
    readonly extensions?: CoreBridgeV1Extensions;
  }>;
}

/**
 * `presence` envelope for room membership change broadcasts.
 * Mirrors Sugar buddy/presence integration intent in
 * `ref/micropolis/spec/integration/SPEC.md`.
 * Parity note: intentionally different from Micropolis Sugar bridge Tcl commands
 * by publishing normalized typed client membership fields.
 */
export interface CoreBridgeV1PresenceEnvelope extends CoreBridgeV1SequencedEnvelopeBase<'presence'> {
  readonly payload: Readonly<{
    readonly connectedClientIds: readonly CoreBridgeClientIdV1[];
    readonly joinedClientId?: CoreBridgeClientIdV1;
    readonly leftClientId?: CoreBridgeClientIdV1;
    readonly extensions?: CoreBridgeV1Extensions;
  }>;
}

/**
 * Canonical unexpected fault codes for `error` envelopes.
 * Mirrors transport/runtime failure surfaces in `ref/micropolis/src/sim/w_net.c`.
 * Parity note: intentionally different from raw errno/perror strings by freezing
 * symbolic error categories.
 */
export type CoreBridgeV1ErrorCode = 'internal' | 'transport' | 'timeout' | 'protocol_violation';

/**
 * `error` envelope for unexpected transport/runtime/internal failures.
 * Mirrors unexpected failure paths surfaced by legacy integration layers in
 * `ref/micropolis/spec/integration/SPEC.md`.
 * Parity note: intentionally different from C side-effect printing by requiring
 * typed code/message/retryability fields.
 */
export interface CoreBridgeV1ErrorEnvelope extends CoreBridgeV1SequencedEnvelopeBase<'error'> {
  readonly payload: Readonly<{
    readonly code: CoreBridgeV1ErrorCode;
    readonly message: string;
    readonly retryable: boolean;
    readonly extensions?: CoreBridgeV1Extensions;
  }>;
}

/**
 * Union of all canonical client->host v1 envelopes.
 * Mirrors command/control ingress paths in `ref/micropolis/src/sim/w_sim.c`.
 * Parity note: intentionally different from free-form command channels by freezing
 * a typed discriminated union.
 */
export type CoreBridgeV1ClientEnvelope =
  | CoreBridgeV1HelloEnvelope
  | CoreBridgeV1CommandEnvelope
  | CoreBridgeV1RequestSnapshotEnvelope
  | CoreBridgeV1PingEnvelope;

/**
 * Union of all canonical host->client v1 envelopes.
 * Mirrors host event categories from `ref/micropolis/spec/integration/SPEC.md`.
 * Parity note: intentionally different from heterogeneous C callbacks by freezing
 * one typed union for all authoritative outbound events.
 */
export type CoreBridgeV1ServerEnvelope =
  | CoreBridgeV1HelloEnvelope
  | CoreBridgeV1AckEnvelope
  | CoreBridgeV1RejectEnvelope
  | CoreBridgeV1PatchEnvelope
  | CoreBridgeV1SnapshotEnvelope
  | CoreBridgeV1ResyncEnvelope
  | CoreBridgeV1PresenceEnvelope
  | CoreBridgeV1ErrorEnvelope;

/**
 * Union of every canonical v1 bridge envelope.
 * Mirrors Stage 0 protocol freeze scope in
 * `/Users/cje/dev/city/STAGE_0_CONTRACT_FREEZE_PLAN.md`.
 * Parity note: intentionally different from Micropolis C integration by exposing a
 * single strongly-typed envelope root for all transports.
 */
export type CoreBridgeV1Envelope = CoreBridgeV1ClientEnvelope | CoreBridgeV1ServerEnvelope;
