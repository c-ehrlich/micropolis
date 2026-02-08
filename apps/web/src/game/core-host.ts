import type { HelloPayload } from './handshake';

/**
 * Host mode selector for web authority transport.
 * Maps to Micropolis NET gating in `ref/micropolis/src/sim/w_sim.c`
 * (`SimCmdListenTo`/`SimCmdHearFrom`): local in-process authority vs networked authority.
 * Parity note: this is an intentional TypeScript composition switch, not a 1:1 C enum.
 */
export type HostMode = 'local' | 'do';

/**
 * Connection event emitted by `CoreHost` implementations.
 * Mirrors the authoritative runtime connect boundary implied by
 * `ref/micropolis/src/sim/w_sim.c`.
 * Parity note: typed event envelopes are a TypeScript bridge helper.
 */
export interface CoreHostConnectedEvent {
  type: 'connected';
  mode: HostMode;
}

/**
 * Disconnect event emitted by `CoreHost` implementations.
 * Mirrors the authoritative runtime disconnect boundary implied by
 * `ref/micropolis/src/sim/w_sim.c`.
 * Parity note: typed event envelopes are a TypeScript bridge helper.
 */
export interface CoreHostDisconnectedEvent {
  type: 'disconnected';
  mode: HostMode;
}

/**
 * Host handshake payload event emitted during startup.
 * Mirrors startup handoff expectations mapped from
 * `ref/micropolis/spec/integration/SPEC.md`.
 * Parity note: the bridge `hello` envelope is intentionally higher-level than C glue.
 */
export interface CoreHostHelloEvent {
  type: 'hello';
  mode: HostMode;
  payload: HelloPayload;
}

/**
 * Non-protocol host fault event emitted for unexpected failures.
 * Mirrors runtime-fault reporting intent mapped from
 * `ref/micropolis/spec/integration/SPEC.md`.
 * Parity note: explicit code/message fields are a TypeScript UX hardening seam.
 */
export interface CoreHostErrorEvent {
  type: 'error';
  mode: HostMode;
  code: string;
  message: string;
}

/**
 * Tool names accepted by the Stage 4 host command bridge.
 * Mirrors Micropolis tool entrypoints in `ref/micropolis/src/sim/w_tool.c`
 * (`road_tool`, `rail_tool`, `wire_tool`, `bulldozer_tool`, `*_tool` zoning).
 * Parity note: these string literals are a TypeScript command envelope surface,
 * not direct C enum constants.
 */
export type CoreHostTool = 'road' | 'rail' | 'wire' | 'bulldoze' | 'res' | 'com' | 'ind';

/**
 * Placement intent command sent from the web runtime to a `CoreHost`.
 * Mirrors `DoTool`/`ToolDown` intent routing in `ref/micropolis/src/sim/w_tool.c`.
 * Parity note: command envelopes are bridge-level; C receives immediate function calls.
 */
export interface CoreHostToolCommand {
  type: 'tool-command';
  commandId: string;
  tool: CoreHostTool;
  x: number;
  y: number;
}

/**
 * Command union accepted by `CoreHost`.
 * Mirrors high-level UI tool intent dispatch in `ref/micropolis/src/sim/w_tool.c`.
 */
export type CoreHostCommand = CoreHostToolCommand;

/**
 * Authoritative placement payload produced by successful command application.
 * Mirrors successful tool commit behavior in `ref/micropolis/src/sim/w_tool.c`
 * where `DidTool(...)` only fires on successful placement paths.
 * Parity note: explicit payload structs are a TypeScript event-model addition.
 */
export interface CoreHostPlacement {
  tool: CoreHostTool;
  x: number;
  y: number;
}

/**
 * Canonical rejection code for expected command denials.
 * Mirrors expected failure paths in `ref/micropolis/src/sim/w_tool.c` where
 * invalid placements return failure codes instead of mutating map state.
 */
export type CoreHostRejectCode = 'OUT_OF_BOUNDS' | 'TILE_OCCUPIED';

/**
 * Success acknowledgement emitted for accepted commands.
 * Mirrors expected acceptance signaling from Stage bridge rules anchored to
 * `ref/micropolis/src/sim/w_tool.c` successful tool application.
 */
export interface CoreHostAckEvent {
  type: 'ack';
  mode: HostMode;
  commandId: string;
  tick: number;
  serverSeq: number;
}

/**
 * Expected command denial emitted for rejected tool operations.
 * Mirrors `DoTool` failure paths in `ref/micropolis/src/sim/w_tool.c`
 * where invalid placement/funds conditions are signaled without map commit.
 * Parity note: structured reject payloads are a bridge TypeScript addition.
 */
export interface CoreHostRejectEvent {
  type: 'reject';
  mode: HostMode;
  commandId: string;
  code: CoreHostRejectCode;
  message: string;
  tick: number;
  serverSeq: number;
}

/**
 * Authoritative patch event emitted after successful command commit.
 * Mirrors the "apply result only after successful tool operation" behavior
 * from `ref/micropolis/src/sim/w_tool.c` and downstream zone updates in
 * `ref/micropolis/src/sim/s_zone.c`.
 * Parity note: explicit patch envelopes are bridge-level abstractions.
 */
export interface CoreHostPatchEvent {
  type: 'patch';
  mode: HostMode;
  commandId: string;
  placements: ReadonlyArray<CoreHostPlacement>;
  tick: number;
  serverSeq: number;
}

/**
 * Snapshot placement payload used to rebuild authoritative client projection.
 * Mirrors reconnect/recovery baseline requirements from
 * `ref/micropolis/spec/integration/SPEC.md`.
 * Parity note: command-correlated placement payloads are a TypeScript bridge
 * fixture for Stage 4 runtime recovery tests.
 */
export interface CoreHostSnapshotPlacement extends CoreHostPlacement {
  commandId: string;
}

/**
 * Snapshot event emitted during reconnect/resync recovery.
 * Mirrors snapshot-baseline recovery intent from
 * `ref/micropolis/spec/integration/SPEC.md`.
 * Parity note: explicit `baseServerSeq` is a TypeScript bridge invariant helper.
 */
export interface CoreHostSnapshotEvent {
  type: 'snapshot';
  mode: HostMode;
  tick: number;
  baseServerSeq: number;
  placements: ReadonlyArray<CoreHostSnapshotPlacement>;
}

/**
 * Resync directive event emitted when the host requires snapshot recovery.
 * Mirrors server-initiated recovery intent from
 * `ref/micropolis/spec/integration/SPEC.md`.
 * Parity note: this envelope is bridge-level and has no 1:1 C equivalent.
 */
export interface CoreHostResyncEvent {
  type: 'resync';
  mode: HostMode;
  reason: string;
}

/**
 * Event emitted by `CoreHost` implementations.
 * Mirrors transport + startup lifecycle expectations mapped from
 * `ref/micropolis/spec/integration/SPEC.md`.
 */
export type CoreHostEvent =
  | CoreHostConnectedEvent
  | CoreHostDisconnectedEvent
  | CoreHostHelloEvent
  | CoreHostAckEvent
  | CoreHostRejectEvent
  | CoreHostPatchEvent
  | CoreHostSnapshotEvent
  | CoreHostResyncEvent
  | CoreHostErrorEvent;

/**
 * Listener callback for `CoreHost` events.
 * Mirrors transport lifecycle observer needs around Micropolis runtime command routing
 * in `ref/micropolis/src/sim/w_sim.c`.
 */
export type CoreHostEventListener = (event: CoreHostEvent) => void;

/**
 * Host contract consumed by the web runtime.
 * Mirrors Micropolis' separation between simulation command routing and transport hooks
 * in `ref/micropolis/src/sim/w_sim.c`.
 * Parity note: this is intentionally adapter-based for React/web composition.
 */
export interface CoreHost {
  readonly mode: HostMode;
  connect(): void;
  disconnect(): void;
  sendCommand(command: CoreHostCommand): void;
  /**
   * Request an authoritative snapshot baseline and optional sequenced replay tail.
   * Mirrors reconnect/recovery snapshot requests mapped from
   * `ref/micropolis/spec/integration/SPEC.md`.
   * Parity note: this explicit method is a bridge-level TypeScript transport seam.
   */
  requestSnapshot(lastAppliedServerSeq?: number): void;
  subscribe(listener: CoreHostEventListener): () => void;
}
