/**
 * Default local room identity for the Stage 2 LocalHost path.
 * Mirrors the deterministic local-mode defaults documented in
 * `STAGE_2_SIMPLE_UI_PLAN.md` and `STAGE_1_MOCKED_BRIDGE_PLAN.md`.
 */
export const DEFAULT_LOCAL_ROOM_ID = 'local-room';

/**
 * Default local client identity for the Stage 2 LocalHost path.
 * Mirrors the deterministic local-mode defaults documented in
 * `STAGE_2_SIMPLE_UI_PLAN.md` and `STAGE_1_MOCKED_BRIDGE_PLAN.md`.
 */
export const DEFAULT_LOCAL_CLIENT_ID = 'local-client';

/**
 * Default protocol version used by the Stage 2 web runtime handshake.
 * Mirrors the mandatory hello/version lockstep rules from
 * `ref/micropolis/src/sim/w_sim.c` command-gate behavior, adapted to the
 * bridge envelope handshake model.
 */
export const DEFAULT_PROTOCOL_VERSION = 'v1';

/**
 * Default core version announced by the Stage 2 web runtime handshake.
 * Mirrors strict lockstep intent from `ref/micropolis/src/sim/w_sim.c` while
 * intentionally using a string token instead of the C Tcl `sim Version` path.
 */
export const DEFAULT_CORE_VERSION = 'stage-2';

/**
 * Stage 2 tool identifiers exposed in the simple playable toolbar.
 * Mirrors tool state names from `ref/micropolis/src/sim/w_tool.c` (`roadState`,
 * `rrState`, `wireState`, `dozeState`, `residentialState`,
 * `commercialState`, `industrialState`).
 */
export type Stage2ToolName = 'road' | 'rail' | 'wire' | 'bulldoze' | 'res' | 'com' | 'ind';

/**
 * High-level Stage 2 tool placement command sent through `command` envelopes.
 * Mirrors `DoTool`/`do_tool` command intent in `ref/micropolis/src/sim/w_tool.c`.
 * Difference: this is typed bridge payload data instead of Tcl command strings.
 */
export interface Stage2ToolCommand {
  kind: 'tool';
  tool: Stage2ToolName;
  x: number;
  y: number;
}

/**
 * Stage 2 client command union for this UI milestone.
 * Mirrors Micropolis tool command dispatch in `ref/micropolis/src/sim/w_tool.c`.
 * Difference: only the Stage 2 core tool subset is modeled here.
 */
export type Stage2ClientCommand = Stage2ToolCommand;

/**
 * Tool footprint metadata used for pending visuals and placement validation.
 * Mirrors `toolSize[]` and `toolOffset[]` in `ref/micropolis/src/sim/w_tool.c`.
 */
export interface Stage2ToolSpec {
  tool: Stage2ToolName;
  label: string;
  size: number;
  offset: number;
  pendingColor: string;
}

/**
 * Stage 2 tool metadata table.
 * Mirrors `toolSize[]`/`toolOffset[]` entries from `ref/micropolis/src/sim/w_tool.c`
 * for road, rail, wire, bulldoze, residential, commercial, and industrial tools.
 */
export const STAGE2_TOOL_SPECS: readonly Stage2ToolSpec[] = [
  { tool: 'road', label: 'Road', size: 1, offset: 0, pendingColor: '#f6d365' },
  { tool: 'rail', label: 'Rail', size: 1, offset: 0, pendingColor: '#c3aed6' },
  { tool: 'wire', label: 'Wire', size: 1, offset: 0, pendingColor: '#93c5fd' },
  { tool: 'bulldoze', label: 'Bulldoze', size: 1, offset: 0, pendingColor: '#fca5a5' },
  { tool: 'res', label: 'R', size: 3, offset: 1, pendingColor: '#86efac' },
  { tool: 'com', label: 'C', size: 3, offset: 1, pendingColor: '#7dd3fc' },
  { tool: 'ind', label: 'I', size: 3, offset: 1, pendingColor: '#fde047' },
] as const;

const STAGE2_TOOL_NAME_SET = new Set<Stage2ToolName>(STAGE2_TOOL_SPECS.map((spec) => spec.tool));

/**
 * Host -> client hello envelope for version/identity negotiation.
 * Mirrors command-gating intent in `ref/micropolis/src/sim/w_sim.c`; this is
 * intentionally an explicit typed handshake message rather than Tcl command IO.
 */
export interface HostHelloEnvelope {
  kind: 'hello';
  roomId: string;
  clientId: string;
  protocolVersion: string;
  coreVersion: string;
  accepted: boolean;
  reason?: string;
}

/**
 * Shared ordering envelope fields.
 * Mirrors monotonic simulation/update sequencing expectations from
 * `ref/micropolis/src/sim/w_sim.c` and heads/update cadence from
 * `ref/micropolis/src/sim/w_update.c`.
 */
export interface HostSequencingFields {
  roomId: string;
  clientId: string;
  tick: number;
  serverSeq: number;
}

/**
 * Host acknowledgement for a previously submitted command.
 * Mirrors command completion signaling around `sim` command dispatch in
 * `ref/micropolis/src/sim/w_sim.c`, adapted to bridge envelopes.
 */
export interface HostAckEnvelope extends HostSequencingFields {
  kind: 'ack';
  commandId: string;
}

/**
 * Host rejection for an expected command denial.
 * Mirrors expected-denial split from Micropolis command processing in
 * `ref/micropolis/src/sim/w_sim.c`, adapted to explicit reject envelopes.
 */
export interface HostRejectEnvelope extends HostSequencingFields {
  kind: 'reject';
  commandId: string;
  reason: string;
}

/**
 * Host incremental authoritative update envelope.
 * Mirrors post-command/update propagation intent from
 * `ref/micropolis/src/sim/w_update.c`; payload stays generic in this task.
 */
export interface HostPatchEnvelope extends HostSequencingFields {
  kind: 'patch';
  payload: unknown;
}

/**
 * Host full-state baseline envelope.
 * Mirrors full city state refresh intent in Micropolis update loops from
 * `ref/micropolis/src/sim/w_update.c`, adapted to bridge snapshots.
 */
export interface HostSnapshotEnvelope extends HostSequencingFields {
  kind: 'snapshot';
  payload: unknown;
}

/**
 * Host resync directive envelope.
 * Mirrors recover/resync intent discussed in bridge plans, aligned with
 * `ref/micropolis/src/sim/w_sim.c` deterministic command processing order.
 */
export interface HostResyncEnvelope extends HostSequencingFields {
  kind: 'resync';
  reason: string;
}

/**
 * Host unexpected-fault envelope.
 * Mirrors fatal/runtime error surfacing patterns in `ref/micropolis/src/sim/w_sim.c`.
 */
export interface HostErrorEnvelope extends HostSequencingFields {
  kind: 'error';
  message: string;
}

/**
 * Union of all Stage 2 host envelopes consumed by the web runtime.
 * Mirrors legacy event/command dispatch in `ref/micropolis/src/sim/w_sim.c`
 * while intentionally using typed envelopes in TypeScript.
 */
export type HostEnvelope =
  | HostHelloEnvelope
  | HostAckEnvelope
  | HostRejectEnvelope
  | HostPatchEnvelope
  | HostSnapshotEnvelope
  | HostResyncEnvelope
  | HostErrorEnvelope;

/**
 * Type helper for host envelopes carrying sequencing fields.
 * Mirrors ordering requirements around command/update dispatch in
 * `ref/micropolis/src/sim/w_sim.c` and `ref/micropolis/src/sim/w_update.c`.
 */
export type SequencedHostEnvelope = Exclude<HostEnvelope, HostHelloEnvelope>;

/**
 * Client -> host hello envelope.
 * Mirrors startup command negotiation intent in `ref/micropolis/src/sim/w_sim.c`.
 */
export interface ClientHelloEnvelope {
  kind: 'hello';
  roomId: string;
  clientId: string;
  protocolVersion: string;
  coreVersion: string;
}

/**
 * Client -> host high-level command envelope.
 * Mirrors `sim <command>` command submission in `ref/micropolis/src/sim/w_sim.c`,
 * intentionally represented as structured data rather than Tcl strings.
 */
export interface ClientCommandEnvelope {
  kind: 'command';
  roomId: string;
  clientId: string;
  commandId: string;
  command: Stage2ClientCommand;
}

/**
 * Client -> host snapshot request envelope.
 * Mirrors update refresh requests analogous to map/head refresh behavior in
 * `ref/micropolis/src/sim/w_update.c`, adapted for bridge resync semantics.
 */
export interface ClientRequestSnapshotEnvelope {
  kind: 'request_snapshot';
  roomId: string;
  clientId: string;
  fromServerSeq: number;
  reason: 'manual' | 'sequence-gap' | 'resync';
}

/**
 * Union of Stage 2 client envelopes emitted by the web runtime.
 * Mirrors command/update intent from `ref/micropolis/src/sim/w_sim.c` while
 * intentionally using typed bridge envelopes.
 */
export type ClientEnvelope =
  | ClientHelloEnvelope
  | ClientCommandEnvelope
  | ClientRequestSnapshotEnvelope;

/**
 * Runtime-side host contract consumed by the web client runtime.
 * Mirrors the host-facing command/update loop role of `ref/micropolis/src/sim/w_sim.c`
 * and `ref/micropolis/src/sim/w_update.c`; intentionally adapter-based in TS.
 */
export interface CoreHost {
  connect(onEnvelope: (envelope: HostEnvelope) => void): CoreHostConnection;
}

/**
 * Connected host session for sending envelopes and disconnecting.
 * Mirrors live command channel behavior in `ref/micropolis/src/sim/w_sim.c`.
 */
export interface CoreHostConnection {
  send(envelope: ClientEnvelope): void;
  disconnect(): void;
}

/**
 * Returns true when a client payload is a Stage 2 tool command.
 * Mirrors tool command dispatch guards in `ref/micropolis/src/sim/w_tool.c`.
 */
export function isStage2ToolCommand(command: unknown): command is Stage2ToolCommand {
  if (command === null || typeof command !== 'object') {
    return false;
  }

  const candidate = command as Partial<Stage2ToolCommand>;
  return (
    candidate.kind === 'tool' &&
    typeof candidate.tool === 'string' &&
    STAGE2_TOOL_NAME_SET.has(candidate.tool as Stage2ToolName) &&
    typeof candidate.x === 'number' &&
    typeof candidate.y === 'number'
  );
}

/**
 * Looks up Stage 2 tool metadata for a tool id.
 * Mirrors toolbar-to-tool-state lookup intent from `setWandState` in
 * `ref/micropolis/src/sim/w_tool.c`, adapted for typed web metadata.
 */
export function getStage2ToolSpec(tool: Stage2ToolName): Stage2ToolSpec {
  for (const spec of STAGE2_TOOL_SPECS) {
    if (spec.tool === tool) {
      return spec;
    }
  }

  throw new Error(`Unknown Stage 2 tool spec for "${tool}"`);
}

/**
 * Returns true when a host envelope carries sequencing fields.
 * Mirrors stage ordering invariants that all non-hello events are ordered by
 * `serverSeq`/`tick` (mapped to `ref/micropolis/src/sim/w_sim.c` update flow).
 */
export function isSequencedHostEnvelope(envelope: HostEnvelope): envelope is SequencedHostEnvelope {
  return envelope.kind !== 'hello';
}
