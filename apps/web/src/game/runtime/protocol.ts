import { LOCAL_HOST_DEFAULT_CORE_VERSION } from '../../../../../packages/core-bridge/src/local-host.ts';
import {
  type CityCommandPayloadV1,
  type CitySimSpeedV1,
  type CityToolV1,
  CORE_BRIDGE_V1_LOCAL_CLIENT_ID,
  CORE_BRIDGE_V1_LOCAL_ROOM_ID,
  CORE_BRIDGE_V1_PROTOCOL_VERSION,
  type CoreClientEnvelope as CoreBridgeClientEnvelopeContract,
  type CoreHostEnvelope as CoreBridgeHostEnvelopeContract,
} from '../../../../../packages/core-bridge/src/types.ts';

/**
 * Stage 0 canonical client-envelope contract alias for web runtime migration.
 * Maps this web-local protocol surface to `CoreClientEnvelope` in
 * `packages/core-bridge/src/types.ts`.
 * Parity note: bridge envelopes intentionally differ from Micropolis Tcl command
 * strings in `ref/micropolis/src/sim/w_sim.c`.
 */
export type CanonicalBridgeClientEnvelopeContract = CoreBridgeClientEnvelopeContract;

/**
 * Stage 0 canonical host-envelope contract alias for web runtime migration.
 * Maps this web-local protocol surface to `CoreHostEnvelope` in
 * `packages/core-bridge/src/types.ts`.
 * Parity note: bridge envelopes intentionally differ from Micropolis update
 * callbacks in `ref/micropolis/src/sim/w_update.c`.
 */
export type CanonicalBridgeHostEnvelopeContract = CoreBridgeHostEnvelopeContract;

/**
 * Stage 0 canonical bridge local-room identity constant.
 * Maps Stage 2 local defaults to `CORE_BRIDGE_V1_LOCAL_ROOM_ID` in
 * `packages/core-bridge/src/types.ts`.
 * Parity note: room ids are a TypeScript bridge concept; Micropolis C transport
 * does not expose a first-class room id field in `ref/micropolis/src/sim/w_net.c`.
 */
export const CANONICAL_BRIDGE_LOCAL_ROOM_ID = CORE_BRIDGE_V1_LOCAL_ROOM_ID;

/**
 * Stage 0 canonical bridge local-client identity constant.
 * Maps Stage 2 local defaults to `CORE_BRIDGE_V1_LOCAL_CLIENT_ID` in
 * `packages/core-bridge/src/types.ts`.
 * Parity note: client ids are a TypeScript bridge concept; Micropolis C
 * integration uses implicit process/socket identity.
 */
export const CANONICAL_BRIDGE_LOCAL_CLIENT_ID = CORE_BRIDGE_V1_LOCAL_CLIENT_ID;

/**
 * Stage 0 canonical bridge protocol token.
 * Maps web runtime protocol ownership to `CORE_BRIDGE_V1_PROTOCOL_VERSION` in
 * `packages/core-bridge/src/types.ts`.
 * Parity note: protocol tokens are a bridge abstraction rather than direct
 * `SimCmdVersion` string values in `ref/micropolis/src/sim/w_sim.c`.
 */
export const CANONICAL_BRIDGE_PROTOCOL_VERSION = CORE_BRIDGE_V1_PROTOCOL_VERSION;

/**
 * Default local room identity for the Stage 2 LocalHost path.
 * Mirrors the deterministic local-mode defaults documented in
 * `STAGE_2_SIMPLE_UI_PLAN.md` and `STAGE_1_MOCKED_BRIDGE_PLAN.md`.
 */
export const DEFAULT_LOCAL_ROOM_ID = CANONICAL_BRIDGE_LOCAL_ROOM_ID;

/**
 * Default local client identity for the Stage 2 LocalHost path.
 * Mirrors the deterministic local-mode defaults documented in
 * `STAGE_2_SIMPLE_UI_PLAN.md` and `STAGE_1_MOCKED_BRIDGE_PLAN.md`.
 */
export const DEFAULT_LOCAL_CLIENT_ID = CANONICAL_BRIDGE_LOCAL_CLIENT_ID;

/**
 * Default protocol version used by the Stage 2 web runtime handshake.
 * Maps Stage 2 runtime handshake defaults to
 * `CORE_BRIDGE_V1_PROTOCOL_VERSION` in `packages/core-bridge/src/types.ts`.
 * Parity note: protocol tokens are a bridge abstraction rather than direct
 * `SimCmdVersion` Tcl command strings in `ref/micropolis/src/sim/w_sim.c`.
 */
export const DEFAULT_PROTOCOL_VERSION = CANONICAL_BRIDGE_PROTOCOL_VERSION;

/**
 * Default core version announced by the Stage 2 web runtime handshake.
 * Maps Stage 2 runtime handshake defaults to
 * `LOCAL_HOST_DEFAULT_CORE_VERSION` in `packages/core-bridge/src/local-host.ts`.
 * Parity note: explicit version tokens are a bridge abstraction rather than
 * direct C Tcl `sim Version` return strings in `ref/micropolis/src/sim/w_sim.c`.
 */
export const DEFAULT_CORE_VERSION = LOCAL_HOST_DEFAULT_CORE_VERSION;

/**
 * Stage 0 playable command inventory locked to canonical bridge payload types.
 * Mirrors command classes routed through `SimCmd` + tool handlers in
 * `ref/micropolis/src/sim/w_sim.c`, `ref/micropolis/src/sim/w_tool.c`,
 * and `ref/micropolis/src/sim/s_fileio.c`.
 * Difference: this inventory is an explicit TypeScript subset declaration
 * instead of C command-string dispatch tables.
 */
export const STAGE0_PLAYABLE_BRIDGE_COMMAND_TYPES = [
  'tool_apply',
  'sim_pause',
  'sim_resume',
  'sim_set_speed',
  'city_new',
  'city_load',
  'city_save',
  'scenario_start',
] as const satisfies readonly CityCommandPayloadV1['type'][];

/**
 * Canonical bridge command-type subset used by Stage 2 playable flows.
 * Mirrors the Stage 0 command inventory lock derived from
 * `CityCommandPayloadV1` in `packages/core-bridge/src/types.ts`.
 */
export type Stage0PlayableBridgeCommandType = (typeof STAGE0_PLAYABLE_BRIDGE_COMMAND_TYPES)[number];

type _Stage0MissingPlayableBridgeCommandTypes = Exclude<
  CityCommandPayloadV1['type'],
  Stage0PlayableBridgeCommandType
>;

type _Stage0ExtraPlayableBridgeCommandTypes = Exclude<
  Stage0PlayableBridgeCommandType,
  CityCommandPayloadV1['type']
>;

const _STAGE0_PLAYABLE_BRIDGE_COMMAND_TYPE_EXHAUSTIVENESS_CHECK: Record<
  _Stage0MissingPlayableBridgeCommandTypes | _Stage0ExtraPlayableBridgeCommandTypes,
  never
> = {};

/**
 * Canonical bridge command payload subset for playable Stage 2 commands.
 * Mirrors the Stage 0 command inventory while keeping ownership in
 * `CityCommandPayloadV1` from `packages/core-bridge/src/types.ts`.
 */
export type Stage0PlayableBridgeCommandPayload = Extract<
  CityCommandPayloadV1,
  {
    type: Stage0PlayableBridgeCommandType;
  }
>;

const STAGE0_PLAYABLE_BRIDGE_COMMAND_TYPE_SET = new Set<Stage0PlayableBridgeCommandType>(
  STAGE0_PLAYABLE_BRIDGE_COMMAND_TYPES,
);

/**
 * Returns true when a canonical bridge command type is in the Stage 0 playable
 * single-player inventory.
 * Mirrors Stage 0 command gating intent from `SimCmd` in
 * `ref/micropolis/src/sim/w_sim.c`.
 * Difference: this checks typed bridge command discriminants instead of Tcl
 * command names.
 */
export function isStage0PlayableBridgeCommandType(
  commandType: CityCommandPayloadV1['type'],
): commandType is Stage0PlayableBridgeCommandType {
  return STAGE0_PLAYABLE_BRIDGE_COMMAND_TYPE_SET.has(
    commandType as Stage0PlayableBridgeCommandType,
  );
}

/**
 * Stage 2 canonical bridge tool identifiers used by the playable toolbar.
 * Mirrors tool routing in `ref/micropolis/src/sim/w_tool.c`.
 */
export type Stage2CanonicalToolName = Extract<
  CityToolV1,
  'road' | 'rail' | 'wire' | 'bulldoze' | 'residential' | 'commercial' | 'industrial'
>;

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
 * Stage 2 simulation speed values exposed in the simple UI controls.
 * Mirrors `setSpeed` clamping behavior in `ref/micropolis/src/sim/w_util.c`
 * and `SimCmdSpeed` input behavior in `ref/micropolis/src/sim/w_sim.c`.
 * Difference: Stage 2 UI only exposes the playable range 1..3.
 */
export type Stage2SimSpeed = Extract<CitySimSpeedV1, 1 | 2 | 3>;

const STAGE2_TO_CANONICAL_TOOL_NAME: Record<Stage2ToolName, Stage2CanonicalToolName> = {
  road: 'road',
  rail: 'rail',
  wire: 'wire',
  bulldoze: 'bulldoze',
  res: 'residential',
  com: 'commercial',
  ind: 'industrial',
};

const CANONICAL_TO_STAGE2_TOOL_NAME: Record<Stage2CanonicalToolName, Stage2ToolName> = {
  road: 'road',
  rail: 'rail',
  wire: 'wire',
  bulldoze: 'bulldoze',
  residential: 'res',
  commercial: 'com',
  industrial: 'ind',
};

/**
 * Pause simulation command routed through host authority.
 * Mirrors `Pause()` in `ref/micropolis/src/sim/w_util.c`.
 */
export interface Stage2PauseSimCommand {
  kind: 'sim-control';
  control: 'pause';
}

/**
 * Resume simulation command routed through host authority.
 * Mirrors `Resume()` in `ref/micropolis/src/sim/w_util.c`.
 */
export interface Stage2PlaySimCommand {
  kind: 'sim-control';
  control: 'play';
}

/**
 * Set simulation speed command routed through host authority.
 * Mirrors `setSpeed` + `SimCmdSpeed` in
 * `ref/micropolis/src/sim/w_util.c` and `ref/micropolis/src/sim/w_sim.c`.
 */
export interface Stage2SetSpeedSimCommand {
  kind: 'sim-control';
  control: 'set-speed';
  speed: Stage2SimSpeed;
}

/**
 * Stage 2 simulation control command union.
 * Mirrors pause/resume/speed control paths in
 * `ref/micropolis/src/sim/w_util.c` and `ref/micropolis/src/sim/w_sim.c`.
 */
export type Stage2SimControlCommand =
  | Stage2PauseSimCommand
  | Stage2PlaySimCommand
  | Stage2SetSpeedSimCommand;

/**
 * New-city lifecycle command routed through host authority.
 * Mirrors `DoNewCity` reset intent in `ref/micropolis/src/sim/s_init.c` and
 * lifecycle dispatch in `ref/micropolis/src/sim/w_sim.c`.
 */
export interface Stage2NewCityCommand {
  kind: 'city-lifecycle';
  action: 'new-city';
}

/**
 * Stage 2 city lifecycle command union.
 * Mirrors high-level city lifecycle command handling in
 * `ref/micropolis/src/sim/w_sim.c`.
 */
export type Stage2CityLifecycleCommand = Stage2NewCityCommand;

/**
 * Save/export city command routed through host authority.
 * Mirrors `SaveCityAs` flow in `ref/micropolis/src/sim/s_fileio.c`.
 * Difference: browser flow exports bytes to the user rather than writing
 * directly to a host filesystem path.
 */
export interface Stage2SaveCityCommand {
  kind: 'city-io';
  action: 'save-city';
  fileName: string;
}

/**
 * Load/import city command routed through host authority.
 * Mirrors `LoadCity` in `ref/micropolis/src/sim/s_fileio.c`.
 * Difference: browser flow passes in-memory bytes instead of host-side file IO.
 */
export interface Stage2LoadCityCommand {
  kind: 'city-io';
  action: 'load-city';
  fileName: string;
  cityBytes: Uint8Array;
}

/**
 * Stage 2 persistence command union.
 * Mirrors save/load lifecycle intent in `ref/micropolis/src/sim/s_fileio.c`.
 */
export type Stage2CityIoCommand = Stage2SaveCityCommand | Stage2LoadCityCommand;

/**
 * Scenario-start command routed through host authority.
 * Mirrors `LoadScenario(short s)` entry in `ref/micropolis/src/sim/s_fileio.c`.
 */
export interface Stage2LoadScenarioCommand {
  kind: 'scenario';
  action: 'load-scenario';
  scenarioId: number;
}

/**
 * Stage 2 scenario command union.
 * Mirrors scenario entry handling in `ref/micropolis/src/sim/s_fileio.c`.
 */
export type Stage2ScenarioCommand = Stage2LoadScenarioCommand;

/**
 * Stage 2 client command union for this UI milestone.
 * Mirrors Micropolis command dispatch in `ref/micropolis/src/sim/w_tool.c`
 * and `ref/micropolis/src/sim/w_sim.c`.
 * Difference: this keeps the Stage 2 subset only (tools, sim controls, and
 * city lifecycle/persistence/scenario commands).
 */
export type Stage2ClientCommand =
  | Stage2ToolCommand
  | Stage2SimControlCommand
  | Stage2CityLifecycleCommand
  | Stage2CityIoCommand
  | Stage2ScenarioCommand;

/**
 * Returns the canonical bridge command type that corresponds to one Stage 2
 * runtime command.
 * Mirrors command routing classes in `ref/micropolis/src/sim/w_sim.c`.
 * Difference: this mapper only emits the playable Stage 0 subset from
 * `CityCommandPayloadV1['type']`.
 */
export function getStage0PlayableBridgeCommandType(
  command: Stage2ClientCommand,
): Stage0PlayableBridgeCommandType {
  if (command.kind === 'tool') {
    return 'tool_apply';
  }

  if (command.kind === 'sim-control') {
    if (command.control === 'pause') {
      return 'sim_pause';
    }

    if (command.control === 'play') {
      return 'sim_resume';
    }

    return 'sim_set_speed';
  }

  if (command.kind === 'city-lifecycle') {
    return 'city_new';
  }

  if (command.kind === 'city-io') {
    return command.action === 'save-city' ? 'city_save' : 'city_load';
  }

  return 'scenario_start';
}

/**
 * Maps a Stage 2 toolbar tool id to the canonical bridge tool id.
 * Mirrors tool-name routing intent around `setWandState` in
 * `ref/micropolis/src/sim/w_tool.c`.
 */
export function toCanonicalBridgeToolName(tool: Stage2ToolName): Stage2CanonicalToolName {
  return STAGE2_TO_CANONICAL_TOOL_NAME[tool];
}

/**
 * Maps a canonical bridge tool id back to the Stage 2 toolbar tool id.
 * Mirrors toolbar-state projection intent around `setWandState` in
 * `ref/micropolis/src/sim/w_tool.c`.
 */
export function fromCanonicalBridgeToolName(tool: Stage2CanonicalToolName): Stage2ToolName {
  return CANONICAL_TO_STAGE2_TOOL_NAME[tool];
}

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
  /**
   * Canonical bridge hello rejection detail field from
   * `packages/core-bridge/src/types.ts` `HostHelloEnvelope.message`.
   */
  message?: string;
  /**
   * Legacy Stage 2 hello rejection detail field retained for local-host
   * compatibility while Stage 0 convergence work is still in flight.
   */
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
 * Returns true when a client payload is a Stage 2 simulation control command.
 * Mirrors command dispatch guards for speed/pause/resume in
 * `ref/micropolis/src/sim/w_sim.c` and `ref/micropolis/src/sim/w_util.c`.
 */
export function isStage2SimControlCommand(command: unknown): command is Stage2SimControlCommand {
  if (command === null || typeof command !== 'object') {
    return false;
  }

  const candidate = command as Partial<Stage2SimControlCommand>;
  if (candidate.kind !== 'sim-control' || typeof candidate.control !== 'string') {
    return false;
  }

  if (candidate.control === 'pause' || candidate.control === 'play') {
    return true;
  }

  if (candidate.control === 'set-speed') {
    return candidate.speed === 1 || candidate.speed === 2 || candidate.speed === 3;
  }

  return false;
}

/**
 * Returns true when a client payload is a Stage 2 city lifecycle command.
 * Mirrors city lifecycle command gatekeeping in `ref/micropolis/src/sim/w_sim.c`.
 */
export function isStage2CityLifecycleCommand(
  command: unknown,
): command is Stage2CityLifecycleCommand {
  if (command === null || typeof command !== 'object') {
    return false;
  }

  const candidate = command as Partial<Stage2CityLifecycleCommand>;
  return candidate.kind === 'city-lifecycle' && candidate.action === 'new-city';
}

/**
 * Returns true when a client payload is a Stage 2 city IO command.
 * Mirrors save/load command gatekeeping in `ref/micropolis/src/sim/s_fileio.c`.
 */
export function isStage2CityIoCommand(command: unknown): command is Stage2CityIoCommand {
  if (command === null || typeof command !== 'object') {
    return false;
  }

  const candidate = command as Partial<Stage2CityIoCommand>;
  if (candidate.kind !== 'city-io' || typeof candidate.action !== 'string') {
    return false;
  }

  if (candidate.action === 'save-city') {
    return typeof candidate.fileName === 'string';
  }

  if (candidate.action === 'load-city') {
    return typeof candidate.fileName === 'string' && candidate.cityBytes instanceof Uint8Array;
  }

  return false;
}

/**
 * Returns true when a client payload is a Stage 2 scenario command.
 * Mirrors `LoadScenario` command gatekeeping in `ref/micropolis/src/sim/s_fileio.c`.
 */
export function isStage2ScenarioCommand(command: unknown): command is Stage2ScenarioCommand {
  if (command === null || typeof command !== 'object') {
    return false;
  }

  const candidate = command as Partial<Stage2ScenarioCommand>;
  return (
    candidate.kind === 'scenario' &&
    candidate.action === 'load-scenario' &&
    typeof candidate.scenarioId === 'number' &&
    Number.isFinite(candidate.scenarioId)
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
