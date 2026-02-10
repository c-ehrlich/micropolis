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
import {
  TOOL_OFFSET,
  TOOL_SIZE,
  TOOL_STATE,
} from '../../../../../packages/sim-core/src/actions/tool-actions.ts';

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
export interface PlayableToolSpec {
  tool: Stage2ToolName;
  label: string;
  size: number;
  offset: number;
  pendingColor: string;
}

const PLAYABLE_TOOL_STATE_ID: Record<Stage2ToolName, number> = {
  road: TOOL_STATE.road,
  rail: TOOL_STATE.rail,
  wire: TOOL_STATE.wire,
  bulldoze: TOOL_STATE.bulldoze,
  res: TOOL_STATE.res,
  com: TOOL_STATE.com,
  ind: TOOL_STATE.ind,
};

interface PlayableToolVisualSpec {
  tool: Stage2ToolName;
  label: string;
  pendingColor: string;
}

const PLAYABLE_TOOL_VISUAL_SPECS: readonly PlayableToolVisualSpec[] = [
  { tool: 'road', label: 'Road', pendingColor: '#f6d365' },
  { tool: 'rail', label: 'Rail', pendingColor: '#c3aed6' },
  { tool: 'wire', label: 'Wire', pendingColor: '#93c5fd' },
  { tool: 'bulldoze', label: 'Bulldoze', pendingColor: '#fca5a5' },
  { tool: 'res', label: 'R', pendingColor: '#86efac' },
  { tool: 'com', label: 'C', pendingColor: '#7dd3fc' },
  { tool: 'ind', label: 'I', pendingColor: '#fde047' },
] as const;

/**
 * Looks up playable tool footprint dimensions from C-parity tool-state tables.
 * Mirrors `toolSize[]` and `toolOffset[]` indexing in
 * `ref/micropolis/src/sim/w_tool.c` (1:1 state-id lookup).
 */
function playableFootprintFromToolTables(
  tool: Stage2ToolName,
): Pick<PlayableToolSpec, 'size' | 'offset'> {
  const stateId = PLAYABLE_TOOL_STATE_ID[tool];
  const size = TOOL_SIZE[stateId];
  const offset = TOOL_OFFSET[stateId];
  if (size === undefined || offset === undefined) {
    throw new Error(`Missing tool footprint table entry for playable tool "${tool}"`);
  }
  return { size, offset };
}

/**
 * Playable tool metadata table.
 * Mirrors `toolSize[]`/`toolOffset[]` entries from `ref/micropolis/src/sim/w_tool.c`
 * for road, rail, wire, bulldoze, residential, commercial, and industrial tools.
 * Parity note: `size`/`offset` values are derived from sim-core C-parity tool tables
 * (`TOOL_SIZE`, `TOOL_OFFSET`) to keep 1x1 vs 3x3 behavior locked to Micropolis.
 */
export const PLAYABLE_TOOL_SPECS: readonly PlayableToolSpec[] = PLAYABLE_TOOL_VISUAL_SPECS.map(
  (spec) => ({
    ...spec,
    ...playableFootprintFromToolTables(spec.tool),
  }),
);

const PLAYABLE_TOOL_NAME_SET = new Set<Stage2ToolName>(
  PLAYABLE_TOOL_SPECS.map((spec) => spec.tool),
);

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
 * Authoritative snapshot map payload carried by Stage 2 host envelopes.
 * Mirrors contiguous `Map[WORLD_X][WORLD_Y]` storage and serialization order in
 * `ref/micropolis/src/sim/s_alloc.c` and `ref/micropolis/src/sim/s_fileio.c`.
 * Parity note: `tileWords` follows classic Micropolis x-major order
 * (`index = x * WORLD_Y + y`).
 */
export interface HostMapSnapshotPayload {
  width: number;
  height: number;
  tileWords: readonly number[] | Uint16Array;
  redrawPlan?: HostMapRedrawPlanPayload;
}

/**
 * One authoritative map patch delta addressed by tile coordinates.
 * Mirrors coordinate-addressed writes to `Map[x][y]` in
 * `ref/micropolis/src/sim/w_tool.c` and `ref/micropolis/src/sim/w_con.c`.
 * Parity note: this intentionally avoids ambiguous linear index deltas.
 */
export interface HostMapPatchTileWordDelta {
  x: number;
  y: number;
  tileWord: number;
}

/**
 * One tile-space dirty rect carried by authoritative redraw-plan payloads.
 * Mirrors dirty-region ownership consumed by `DoUpdateMap` in
 * `ref/micropolis/src/sim/w_map.c`.
 * Parity note: this reuses tile-space `x/y/width/height` rect semantics from
 * `planMapRedraw` in `packages/sim-core/src/core/map-invalidation.ts`.
 */
export interface HostMapRedrawDirtyRectPayload {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Deterministic redraw-plan metadata emitted by authority map payloads.
 * Mirrors `NewMap`/`NewMapFlags` invalidation gating in
 * `ref/micropolis/src/sim/w_map.c` and cycle clear behavior from
 * `ref/micropolis/src/sim/sim.c`.
 * Parity note: this is the transport projection of `MapRedrawPlan` from
 * `packages/sim-core/src/core/map-invalidation.ts`.
 */
export interface HostMapRedrawPlanPayload {
  reason:
    | 'none'
    | 'new-map'
    | 'map-flag'
    | 'shake'
    | 'patch-tile-threshold'
    | 'patch-rect-threshold'
    | 'patch-rects';
  fullRedraw: boolean;
  dirtyRects: readonly HostMapRedrawDirtyRectPayload[];
}

/**
 * Authoritative incremental map payload carried by Stage 2 patch envelopes.
 * Mirrors map mutation deltas consumed by `DoUpdateMap` in
 * `ref/micropolis/src/sim/w_map.c`.
 */
export interface HostMapPatchPayload {
  tileWordDeltas: readonly HostMapPatchTileWordDelta[];
  redrawPlan?: HostMapRedrawPlanPayload;
}

/**
 * Authoritative date head payload emitted by host snapshot/patch envelopes.
 * Mirrors `updateDate` output fields in `ref/micropolis/src/sim/w_update.c`.
 * Parity note: month uses the same zero-based `0..11` indexing as C.
 */
export interface HostHudDatePayload {
  label?: string;
  month: number;
  year: number;
}

/**
 * Authoritative demand heads payload emitted by host snapshot/patch envelopes.
 * Mirrors `SetDemand` output domain in `ref/micropolis/src/sim/w_update.c`.
 * Parity note: values are already projected to the visible valve range (`-15..15`).
 */
export interface HostHudDemandPayload {
  r: number;
  c: number;
  i: number;
}

/**
 * Authoritative options heads payload emitted by host snapshot/patch envelopes.
 * Mirrors `updateOptions` / `UISetOptions` in `ref/micropolis/src/sim/w_update.c`.
 * Parity note: C packs these into one bitfield; bridge payloads expose booleans directly.
 */
export interface HostHudOptionsPayload {
  autoBudget: boolean;
  autoGo: boolean;
  autoBulldoze: boolean;
  disasters: boolean;
  userSoundOn: boolean;
  doAnimation: boolean;
  doMessages: boolean;
  doNotices: boolean;
}

/**
 * One authoritative HUD message payload emitted by host snapshot/patch envelopes.
 * Mirrors `SendMes` / `SendMesAt` payload data in `ref/micropolis/src/sim/s_msg.c`.
 * Parity note: `(x, y) = (0, 0)` is intentionally preserved so runtime can keep
 * C dispatch parity (`MesX || MesY` decides SendMesAt).
 */
export interface HostHudMessagePayload {
  id: number;
  text: string;
  x?: number;
  y?: number;
  /**
   * Optional original authority tick for replay-stable snapshot baselines.
   * Mirrors ordered message progression intent from `ref/micropolis/src/sim/s_msg.c`.
   * Parity note: this field is bridge metadata (not present in C payloads) used
   * so snapshot replay can preserve prior message ordering context.
   */
  tick?: number;
  /**
   * Optional original authority sequence for replay-stable snapshot baselines.
   * Mirrors ordered update delivery intent from `ref/micropolis/spec/integration/SPEC.md`.
   * Parity note: this field is bridge metadata (not present in C payloads) used
   * so snapshot replay can preserve prior message ordering context.
   */
  serverSeq?: number;
}

/**
 * One incremental HUD message delta in Stage 2 patch payloads.
 * Mirrors incremental message dispatch in `ref/micropolis/src/sim/s_msg.c`.
 * Parity note: this is append-only for Stage 2 feed projection.
 */
export type HostMessageDeltaPayload = HostHudMessagePayload;

/**
 * One authoritative realtime object entry carried by snapshot/patch envelopes.
 * Mirrors sprite field ownership in `ref/micropolis/src/sim/w_sprite.c`, as
 * represented by `SimSprite` in `packages/sim-core/src/sim/realtime.ts`.
 * Parity note: this adds a bridge-level `id` key for deterministic per-tick
 * delta application; C sprite structs are pointer-addressed in-process.
 */
export interface HostRealtimeObjectPayload {
  id?: string;
  name: string;
  type: number;
  x: number;
  y: number;
  frame?: number;
}

/**
 * One incremental realtime object delta entry for Stage 7 payloads.
 * Mirrors ordered sprite lifecycle/mutation progression in
 * `ref/micropolis/src/sim/w_sprite.c` (`InitSprite`/move/destroy paths).
 * Parity note: explicit `upsert`/`remove` transport records are additive vs C,
 * which mutates in-memory sprite structs directly.
 */
export type HostRealtimeObjectDeltaPayload =
  | Readonly<{
      kind: 'upsert';
      object: HostRealtimeObjectPayload;
    }>
  | Readonly<{
      kind: 'remove';
      id: string;
    }>;

/**
 * Realtime payload section carried by Stage 2 snapshot/patch envelopes.
 * Mirrors realtime object stream intent from `ref/micropolis/src/sim/w_sprite.c`.
 * Parity note: `objects` remains a compatibility full-object stream while
 * Stage 7 adds explicit `snapshot` and `deltas` fields for deterministic
 * realtime baseline + per-tick projection.
 */
export interface HostRealtimePayload {
  snapshot?: readonly HostRealtimeObjectPayload[];
  deltas?: readonly HostRealtimeObjectDeltaPayload[];
  objects?: readonly HostRealtimeObjectPayload[];
}

/**
 * Authoritative HUD heads payload carried by snapshot/patch envelopes.
 * Mirrors `DoUpdateHeads` scalar UI updates in `ref/micropolis/src/sim/w_update.c`.
 * Parity note: `funds` carries the canonical scalar while `fundsLabel` is retained
 * as a temporary compatibility field during Stage 2 protocol migration.
 */
export interface HostHudPayload {
  funds?: number;
  fundsLabel?: string;
  date?: HostHudDatePayload;
  demand?: HostHudDemandPayload;
  speed?: number;
  options?: Partial<HostHudOptionsPayload>;
  /**
   * Legacy single-message compatibility payload retained while migration from
   * ad-hoc message fields to explicit `messageDeltas` is in flight.
   */
  message?: HostHudMessagePayload;
}

interface LegacyHostMapSnapshotPayload {
  width: number;
  height: number;
  tiles: readonly number[] | Uint16Array;
}

interface LegacyHostMapPatchPayload {
  tiles: ReadonlyArray<{
    index: number;
    tile: number;
  }>;
}

/**
 * Stage 2 snapshot payload surface consumed by runtime projection reducers.
 * Mirrors map snapshot ownership in `ref/micropolis/src/sim/w_update.c`.
 * Parity note: legacy `map.tiles` support is retained temporarily while Stage 2
 * protocol migration is in flight.
 */
export interface HostSnapshotPayload extends Record<string, unknown> {
  map?: HostMapSnapshotPayload | LegacyHostMapSnapshotPayload;
  hud?: HostHudPayload;
  /**
   * Optional realtime object baseline for overlay projection.
   * Mirrors sprite snapshot ownership in `ref/micropolis/src/sim/w_sprite.c`.
   */
  realtime?: HostRealtimePayload;
  /**
   * Snapshot baseline message feed (full replacement semantics).
   * Mirrors `SetMessageField` visible-message ownership in
   * `ref/micropolis/src/sim/s_msg.c`.
   */
  messages?: readonly HostHudMessagePayload[];
  /**
   * Compatibility field: tolerated on snapshots so replay streams remain stable
   * while Stage 2 payload producers are upgraded.
   */
  messageDeltas?: readonly HostMessageDeltaPayload[];
}

/**
 * Stage 2 patch payload surface consumed by runtime projection reducers.
 * Mirrors map patch ownership in `ref/micropolis/src/sim/w_update.c`.
 * Parity note: legacy `map.tiles` support is retained temporarily while Stage 2
 * protocol migration is in flight.
 */
export interface HostPatchPayload extends Record<string, unknown> {
  map?: HostMapPatchPayload | LegacyHostMapPatchPayload;
  hud?: HostHudPayload;
  /**
   * Optional realtime object delta/snapshot payload for staged overlay support.
   * Mirrors per-frame sprite update intent from `ref/micropolis/src/sim/w_sprite.c`.
   */
  realtime?: HostRealtimePayload;
  /**
   * Incremental message additions for patch projection.
   * Mirrors one-heads-cycle message dispatch deltas in `ref/micropolis/src/sim/s_msg.c`.
   */
  messageDeltas?: readonly HostMessageDeltaPayload[];
  /**
   * Legacy message delta field retained during Stage 2 migration.
   * Runtime consumes this as append-only deltas.
   */
  messages?: readonly HostHudMessagePayload[];
}

/**
 * Host incremental authoritative update envelope.
 * Mirrors post-command/update propagation intent from
 * `ref/micropolis/src/sim/w_update.c`, including Stage 2 map tile-word deltas.
 */
export interface HostPatchEnvelope extends HostSequencingFields {
  kind: 'patch';
  payload: HostPatchPayload;
}

/**
 * Host full-state baseline envelope.
 * Mirrors full city state refresh intent in Micropolis update loops from
 * `ref/micropolis/src/sim/w_update.c`, adapted to bridge snapshots.
 */
export interface HostSnapshotEnvelope extends HostSequencingFields {
  kind: 'snapshot';
  payload: HostSnapshotPayload;
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
    PLAYABLE_TOOL_NAME_SET.has(candidate.tool as Stage2ToolName) &&
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
 * Parity note: this requires an integral id because `LoadScenario(short s)` consumes
 * integer scenario ids in C; fractional values are rejected before host routing.
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
    Number.isFinite(candidate.scenarioId) &&
    Number.isInteger(candidate.scenarioId)
  );
}

/**
 * Looks up playable tool metadata for a tool id.
 * Mirrors toolbar-to-tool-state lookup intent from `setWandState` in
 * `ref/micropolis/src/sim/w_tool.c`, adapted for typed web metadata.
 */
export function getPlayableToolSpec(tool: Stage2ToolName): PlayableToolSpec {
  for (const spec of PLAYABLE_TOOL_SPECS) {
    if (spec.tool === tool) {
      return spec;
    }
  }

  throw new Error(`Unknown playable tool spec for "${tool}"`);
}

/**
 * Returns true when a host envelope carries sequencing fields.
 * Mirrors stage ordering invariants that all non-hello events are ordered by
 * `serverSeq`/`tick` (mapped to `ref/micropolis/src/sim/w_sim.c` update flow).
 */
export function isSequencedHostEnvelope(envelope: HostEnvelope): envelope is SequencedHostEnvelope {
  return envelope.kind !== 'hello';
}
