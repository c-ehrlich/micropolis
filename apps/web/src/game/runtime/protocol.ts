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
  TOOL_COST,
  TOOL_OFFSET,
  TOOL_SIZE,
  TOOL_STATE,
} from '../../../../../packages/sim-core/src/actions/tool-actions.ts';

/**
 * Bridge V1 canonical client-envelope contract alias for web runtime migration.
 * Maps this web-local protocol surface to `CoreClientEnvelope` in
 * `packages/core-bridge/src/types.ts`.
 * Parity note: bridge envelopes intentionally differ from Micropolis Tcl command
 * strings in `ref/micropolis/src/sim/w_sim.c`.
 */
export type CanonicalBridgeClientEnvelopeContract = CoreBridgeClientEnvelopeContract;

/**
 * Bridge V1 canonical host-envelope contract alias for web runtime migration.
 * Maps this web-local protocol surface to `CoreHostEnvelope` in
 * `packages/core-bridge/src/types.ts`.
 * Parity note: bridge envelopes intentionally differ from Micropolis update
 * callbacks in `ref/micropolis/src/sim/w_update.c`.
 */
export type CanonicalBridgeHostEnvelopeContract = CoreBridgeHostEnvelopeContract;

/**
 * Bridge V1 canonical bridge local-room identity constant.
 * Maps Playable Runtime local defaults to `CORE_BRIDGE_V1_LOCAL_ROOM_ID` in
 * `packages/core-bridge/src/types.ts`.
 * Parity note: room ids are a TypeScript bridge concept; Micropolis C transport
 * does not expose a first-class room id field in `ref/micropolis/src/sim/w_net.c`.
 */
export const CANONICAL_BRIDGE_LOCAL_ROOM_ID = CORE_BRIDGE_V1_LOCAL_ROOM_ID;

/**
 * Bridge V1 canonical bridge local-client identity constant.
 * Maps Playable Runtime local defaults to `CORE_BRIDGE_V1_LOCAL_CLIENT_ID` in
 * `packages/core-bridge/src/types.ts`.
 * Parity note: client ids are a TypeScript bridge concept; Micropolis C
 * integration uses implicit process/socket identity.
 */
export const CANONICAL_BRIDGE_LOCAL_CLIENT_ID = CORE_BRIDGE_V1_LOCAL_CLIENT_ID;

/**
 * Bridge V1 canonical bridge protocol token.
 * Maps web runtime protocol ownership to `CORE_BRIDGE_V1_PROTOCOL_VERSION` in
 * `packages/core-bridge/src/types.ts`.
 * Parity note: protocol tokens are a bridge abstraction rather than direct
 * `SimCmdVersion` string values in `ref/micropolis/src/sim/w_sim.c`.
 */
export const CANONICAL_BRIDGE_PROTOCOL_VERSION = CORE_BRIDGE_V1_PROTOCOL_VERSION;

/**
 * Default local room identity for the Playable Runtime LocalHost path.
 * Mirrors the deterministic local-mode defaults documented in
 * `MASTER_GAME_ALIGNMENT_PLAN.md`.
 */
export const DEFAULT_LOCAL_ROOM_ID = CANONICAL_BRIDGE_LOCAL_ROOM_ID;

/**
 * Default local client identity for the Playable Runtime LocalHost path.
 * Mirrors the deterministic local-mode defaults documented in
 * `MASTER_GAME_ALIGNMENT_PLAN.md`.
 */
export const DEFAULT_LOCAL_CLIENT_ID = CANONICAL_BRIDGE_LOCAL_CLIENT_ID;

/**
 * Default protocol version used by the Playable Runtime web runtime handshake.
 * Maps Playable Runtime runtime handshake defaults to
 * `CORE_BRIDGE_V1_PROTOCOL_VERSION` in `packages/core-bridge/src/types.ts`.
 * Parity note: protocol tokens are a bridge abstraction rather than direct
 * `SimCmdVersion` Tcl command strings in `ref/micropolis/src/sim/w_sim.c`.
 */
export const DEFAULT_PROTOCOL_VERSION = CANONICAL_BRIDGE_PROTOCOL_VERSION;

/**
 * Default core version announced by the Playable Runtime web runtime handshake.
 * Maps Playable Runtime runtime handshake defaults to
 * `LOCAL_HOST_DEFAULT_CORE_VERSION` in `packages/core-bridge/src/local-host.ts`.
 * Parity note: explicit version tokens are a bridge abstraction rather than
 * direct C Tcl `sim Version` return strings in `ref/micropolis/src/sim/w_sim.c`.
 */
export const DEFAULT_CORE_VERSION = LOCAL_HOST_DEFAULT_CORE_VERSION;

/**
 * Bridge V1 playable command inventory locked to canonical bridge payload types.
 * Mirrors command classes routed through `SimCmd` + tool handlers in
 * `ref/micropolis/src/sim/w_sim.c`, `ref/micropolis/src/sim/w_tool.c`,
 * and `ref/micropolis/src/sim/s_fileio.c`.
 * Difference: this inventory is an explicit TypeScript subset declaration
 * instead of C command-string dispatch tables.
 */
export const PLAYABLE_BRIDGE_COMMAND_TYPES = [
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
 * Canonical bridge command-type subset used by Playable Runtime playable flows.
 * Mirrors the Bridge V1 command inventory lock derived from
 * `CityCommandPayloadV1` in `packages/core-bridge/src/types.ts`.
 */
export type PlayableBridgeCommandType = (typeof PLAYABLE_BRIDGE_COMMAND_TYPES)[number];

type _MissingPlayableBridgeCommandTypes = Exclude<
  CityCommandPayloadV1['type'],
  PlayableBridgeCommandType
>;

type _ExtraPlayableBridgeCommandTypes = Exclude<
  PlayableBridgeCommandType,
  CityCommandPayloadV1['type']
>;

const _PLAYABLE_BRIDGE_COMMAND_TYPE_EXHAUSTIVENESS_CHECK: Record<
  _MissingPlayableBridgeCommandTypes | _ExtraPlayableBridgeCommandTypes,
  never
> = {};

/**
 * Canonical bridge command payload subset for playable Playable Runtime commands.
 * Mirrors the Bridge V1 command inventory while keeping ownership in
 * `CityCommandPayloadV1` from `packages/core-bridge/src/types.ts`.
 */
export type PlayableBridgeCommandPayload = Extract<
  CityCommandPayloadV1,
  {
    type: PlayableBridgeCommandType;
  }
>;

const PLAYABLE_BRIDGE_COMMAND_TYPE_SET = new Set<PlayableBridgeCommandType>(
  PLAYABLE_BRIDGE_COMMAND_TYPES,
);

/**
 * Returns true when a canonical bridge command type is in the Bridge V1 playable
 * single-player inventory.
 * Mirrors Bridge V1 command gating intent from `SimCmd` in
 * `ref/micropolis/src/sim/w_sim.c`.
 * Difference: this checks typed bridge command discriminants instead of Tcl
 * command names.
 */
export function isPlayableBridgeCommandType(
  commandType: CityCommandPayloadV1['type'],
): commandType is PlayableBridgeCommandType {
  return PLAYABLE_BRIDGE_COMMAND_TYPE_SET.has(commandType as PlayableBridgeCommandType);
}

/**
 * Playable Runtime canonical bridge tool identifiers used by the playable toolbar.
 * Mirrors tool routing in `ref/micropolis/src/sim/w_tool.c`.
 */
export type PlayableCanonicalToolName = Extract<
  CityToolV1,
  | 'road'
  | 'rail'
  | 'wire'
  | 'bulldoze'
  | 'residential'
  | 'commercial'
  | 'industrial'
  | 'query'
  | 'police_dept'
  | 'fire_dept'
  | 'stadium'
  | 'park'
  | 'seaport'
  | 'coal_power'
  | 'nuclear_power'
  | 'airport'
>;

/**
 * Playable Runtime tool identifiers exposed in the simple playable toolbar.
 * Mirrors tool state names from `ref/micropolis/src/sim/w_tool.c` (`residentialState`,
 * `commercialState`, `industrialState`, `fireState`, `queryState`, `policeState`,
 * `wireState`, `dozeState`, `rrState`, `roadState`, `stadiumState`, `parkState`,
 * `seaportState`, `powerState`, `nuclearState`, `airportState`).
 */
export type PlayableToolName =
  | 'res'
  | 'com'
  | 'ind'
  | 'fire'
  | 'query'
  | 'police'
  | 'wire'
  | 'bulldoze'
  | 'rail'
  | 'road'
  | 'stadium'
  | 'park'
  | 'seaport'
  | 'coal'
  | 'nuclear'
  | 'airport';

/**
 * High-level Playable Runtime tool placement command sent through `command` envelopes.
 * Mirrors `DoTool`/`do_tool` command intent in `ref/micropolis/src/sim/w_tool.c`.
 * Difference: this is typed bridge payload data instead of Tcl command strings.
 */
export interface PlayableToolCommand {
  kind: 'tool';
  tool: PlayableToolName;
  x: number;
  y: number;
}

/**
 * Playable Runtime simulation speed values exposed in the simple UI controls.
 * Mirrors `setSpeed` clamping behavior in `ref/micropolis/src/sim/w_util.c`
 * and `SimCmdSpeed` input behavior in `ref/micropolis/src/sim/w_sim.c`.
 * Difference: Playable Runtime UI only exposes the playable range 1..3.
 */
export type PlayableSimSpeed = Extract<CitySimSpeedV1, 1 | 2 | 3>;

/**
 * Playable Runtime game difficulty level id.
 * Mirrors `GameLevel` and `SetGameLevelFunds(short)` level domain in
 * `ref/micropolis/src/sim/w_util.c` and `ref/micropolis/src/sim/w_sim.c`.
 */
export type PlayableGameLevel = 0 | 1 | 2;

const PLAYABLE_TO_CANONICAL_TOOL_NAME: Record<PlayableToolName, PlayableCanonicalToolName> = {
  res: 'residential',
  com: 'commercial',
  ind: 'industrial',
  fire: 'fire_dept',
  query: 'query',
  police: 'police_dept',
  wire: 'wire',
  bulldoze: 'bulldoze',
  rail: 'rail',
  road: 'road',
  stadium: 'stadium',
  park: 'park',
  seaport: 'seaport',
  coal: 'coal_power',
  nuclear: 'nuclear_power',
  airport: 'airport',
};

const CANONICAL_TO_PLAYABLE_TOOL_NAME: Record<PlayableCanonicalToolName, PlayableToolName> = {
  residential: 'res',
  commercial: 'com',
  industrial: 'ind',
  fire_dept: 'fire',
  query: 'query',
  police_dept: 'police',
  wire: 'wire',
  bulldoze: 'bulldoze',
  rail: 'rail',
  road: 'road',
  stadium: 'stadium',
  park: 'park',
  seaport: 'seaport',
  coal_power: 'coal',
  nuclear_power: 'nuclear',
  airport: 'airport',
};

/**
 * Pause simulation command routed through host authority.
 * Mirrors `Pause()` in `ref/micropolis/src/sim/w_util.c`.
 */
export interface PlayablePauseSimCommand {
  kind: 'sim-control';
  control: 'pause';
}

/**
 * Resume simulation command routed through host authority.
 * Mirrors `Resume()` in `ref/micropolis/src/sim/w_util.c`.
 */
export interface PlayableResumeSimCommand {
  kind: 'sim-control';
  control: 'play';
}

/**
 * Set simulation speed command routed through host authority.
 * Mirrors `setSpeed` + `SimCmdSpeed` in
 * `ref/micropolis/src/sim/w_util.c` and `ref/micropolis/src/sim/w_sim.c`.
 */
export interface PlayableSetSpeedSimCommand {
  kind: 'sim-control';
  control: 'set-speed';
  speed: PlayableSimSpeed;
}

/**
 * Set-city-tax command routed through host authority.
 * Mirrors `SimCmdTaxRate` (`sim TaxRate`) in `ref/micropolis/src/sim/w_sim.c`.
 */
export interface PlayableSetTaxRateSimCommand {
  kind: 'sim-control';
  control: 'set-tax-rate';
  taxRate: number;
}

/**
 * Set-road-funding-percent command routed through host authority.
 * Mirrors `SimCmdRoadFund` (`sim RoadFund`) in `ref/micropolis/src/sim/w_sim.c`.
 */
export interface PlayableSetRoadPercentSimCommand {
  kind: 'sim-control';
  control: 'set-road-percent';
  percent: number;
}

/**
 * Set-fire-funding-percent command routed through host authority.
 * Mirrors `SimCmdFireFund` (`sim FireFund`) in `ref/micropolis/src/sim/w_sim.c`.
 */
export interface PlayableSetFirePercentSimCommand {
  kind: 'sim-control';
  control: 'set-fire-percent';
  percent: number;
}

/**
 * Set-police-funding-percent command routed through host authority.
 * Mirrors `SimCmdPoliceFund` (`sim PoliceFund`) in `ref/micropolis/src/sim/w_sim.c`.
 */
export interface PlayableSetPolicePercentSimCommand {
  kind: 'sim-control';
  control: 'set-police-percent';
  percent: number;
}

/**
 * Set-auto-budget toggle command routed through host authority.
 * Mirrors `SimCmdAutoBudget` (`sim AutoBudget`) in `ref/micropolis/src/sim/w_sim.c`.
 */
export interface PlayableSetAutoBudgetSimCommand {
  kind: 'sim-control';
  control: 'set-auto-budget';
  enabled: boolean;
}

/**
 * Budget-window menu-open command routed through host authority.
 * Mirrors `DoBudgetFromMenu` via the Windows->Budget path in
 * `ref/micropolis/src/sim/w_budget.c` and `ref/micropolis/res/whead.tcl`.
 */
export interface PlayableOpenBudgetFromMenuSimCommand {
  kind: 'sim-control';
  control: 'open-budget-from-menu';
}

/**
 * Playable Runtime simulation control command union.
 * Mirrors pause/resume/speed control paths in
 * `ref/micropolis/src/sim/w_util.c` and `ref/micropolis/src/sim/w_sim.c`.
 */
export type PlayableSimControlCommand =
  | PlayablePauseSimCommand
  | PlayableResumeSimCommand
  | PlayableSetSpeedSimCommand
  | PlayableSetTaxRateSimCommand
  | PlayableSetRoadPercentSimCommand
  | PlayableSetFirePercentSimCommand
  | PlayableSetPolicePercentSimCommand
  | PlayableSetAutoBudgetSimCommand
  | PlayableOpenBudgetFromMenuSimCommand;

/**
 * New-city lifecycle command routed through host authority.
 * Mirrors `DoNewCity` reset intent in `ref/micropolis/src/sim/s_init.c` and
 * lifecycle dispatch in `ref/micropolis/src/sim/w_sim.c`.
 */
export interface PlayableNewCityCommand {
  kind: 'city-lifecycle';
  action: 'new-city';
  gameLevel?: PlayableGameLevel;
  /**
   * Optional explicit terrain seed for deterministic new-city terrain selection.
   * Mirrors `GenerateSomeCity(int r)` seed input in `ref/micropolis/src/sim/s_gen.c`.
   */
  terrainSeed?: number;
}

/**
 * Playable Runtime city lifecycle command union.
 * Mirrors high-level city lifecycle command handling in
 * `ref/micropolis/src/sim/w_sim.c`.
 */
export type PlayableCityLifecycleCommand = PlayableNewCityCommand;

/**
 * Save/export city command routed through host authority.
 * Mirrors `SaveCityAs` flow in `ref/micropolis/src/sim/s_fileio.c`.
 * Difference: browser flow exports bytes to the user rather than writing
 * directly to a host filesystem path.
 */
export interface PlayableSaveCityCommand {
  kind: 'city-io';
  action: 'save-city';
  fileName: string;
}

/**
 * Load/import city command routed through host authority.
 * Mirrors `LoadCity` in `ref/micropolis/src/sim/s_fileio.c`.
 * Difference: browser flow passes in-memory bytes instead of host-side file IO.
 */
export interface PlayableLoadCityCommand {
  kind: 'city-io';
  action: 'load-city';
  fileName: string;
  cityBytes: Uint8Array;
}

/**
 * Playable Runtime persistence command union.
 * Mirrors save/load lifecycle intent in `ref/micropolis/src/sim/s_fileio.c`.
 */
export type PlayableCityIoCommand = PlayableSaveCityCommand | PlayableLoadCityCommand;

/**
 * Scenario-start command routed through host authority.
 * Mirrors `LoadScenario(short s)` entry in `ref/micropolis/src/sim/s_fileio.c`.
 */
export interface PlayableLoadScenarioCommand {
  kind: 'scenario';
  action: 'load-scenario';
  scenarioKey: string;
  gameLevel?: PlayableGameLevel;
}

/**
 * Playable Runtime scenario command union.
 * Mirrors scenario entry handling in `ref/micropolis/src/sim/s_fileio.c`.
 */
export type PlayableScenarioCommand = PlayableLoadScenarioCommand;

/**
 * Playable Runtime client command union for this UI milestone.
 * Mirrors Micropolis command dispatch in `ref/micropolis/src/sim/w_tool.c`
 * and `ref/micropolis/src/sim/w_sim.c`.
 * Difference: this keeps the Playable Runtime subset only (tools, sim controls, and
 * city lifecycle/persistence/scenario commands).
 */
export type PlayableClientCommand =
  | PlayableToolCommand
  | PlayableSimControlCommand
  | PlayableCityLifecycleCommand
  | PlayableCityIoCommand
  | PlayableScenarioCommand;

/**
 * Returns the canonical bridge command type that corresponds to one Playable Runtime
 * runtime command.
 * Mirrors command routing classes in `ref/micropolis/src/sim/w_sim.c`.
 * Difference: this mapper only emits the playable Bridge V1 subset from
 * `CityCommandPayloadV1['type']`.
 */
export function getPlayableBridgeCommandType(
  command: PlayableClientCommand,
): PlayableBridgeCommandType {
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
 * Maps a Playable Runtime toolbar tool id to the canonical bridge tool id.
 * Mirrors tool-name routing intent around `setWandState` in
 * `ref/micropolis/src/sim/w_tool.c`.
 */
export function toCanonicalBridgeToolName(tool: PlayableToolName): PlayableCanonicalToolName {
  return PLAYABLE_TO_CANONICAL_TOOL_NAME[tool];
}

/**
 * Maps a canonical bridge tool id back to the Playable Runtime toolbar tool id.
 * Mirrors toolbar-state projection intent around `setWandState` in
 * `ref/micropolis/src/sim/w_tool.c`.
 */
export function fromCanonicalBridgeToolName(tool: PlayableCanonicalToolName): PlayableToolName {
  return CANONICAL_TO_PLAYABLE_TOOL_NAME[tool];
}

/**
 * Tool footprint metadata used for pending visuals and placement validation.
 * Mirrors `toolSize[]` and `toolOffset[]` in `ref/micropolis/src/sim/w_tool.c`.
 */
export interface PlayableToolSpec {
  tool: PlayableToolName;
  label: string;
  toolState: number;
  size: number;
  offset: number;
  baseCost: number;
  pendingColor: string;
}

const PLAYABLE_TOOL_STATE_ID: Record<PlayableToolName, number> = {
  res: TOOL_STATE.res,
  com: TOOL_STATE.com,
  ind: TOOL_STATE.ind,
  fire: TOOL_STATE.fire,
  query: TOOL_STATE.query,
  police: TOOL_STATE.police,
  wire: TOOL_STATE.wire,
  bulldoze: TOOL_STATE.bulldoze,
  rail: TOOL_STATE.rail,
  road: TOOL_STATE.road,
  stadium: TOOL_STATE.stadium,
  park: TOOL_STATE.park,
  seaport: TOOL_STATE.seaport,
  coal: TOOL_STATE.coal,
  nuclear: TOOL_STATE.nuclear,
  airport: TOOL_STATE.airport,
};

interface PlayableToolVisualSpec {
  tool: PlayableToolName;
  label: string;
  pendingColor: string;
}

const PLAYABLE_TOOL_VISUAL_SPECS: readonly PlayableToolVisualSpec[] = [
  { tool: 'res', label: 'Residential', pendingColor: '#86efac' },
  { tool: 'com', label: 'Commercial', pendingColor: '#7dd3fc' },
  { tool: 'ind', label: 'Industrial', pendingColor: '#fde047' },
  { tool: 'fire', label: 'Fire Dept', pendingColor: '#fca5a5' },
  { tool: 'query', label: 'Query', pendingColor: '#fdba74' },
  { tool: 'police', label: 'Police Dept', pendingColor: '#bfdbfe' },
  { tool: 'wire', label: 'Wire', pendingColor: '#93c5fd' },
  { tool: 'bulldoze', label: 'Bulldoze', pendingColor: '#fca5a5' },
  { tool: 'rail', label: 'Rail', pendingColor: '#c3aed6' },
  { tool: 'road', label: 'Road', pendingColor: '#f6d365' },
  { tool: 'stadium', label: 'Stadium', pendingColor: '#d9f99d' },
  { tool: 'park', label: 'Park', pendingColor: '#bbf7d0' },
  { tool: 'seaport', label: 'Seaport', pendingColor: '#99f6e4' },
  { tool: 'coal', label: 'Coal Plant', pendingColor: '#cbd5e1' },
  { tool: 'nuclear', label: 'Nuclear Plant', pendingColor: '#fecaca' },
  { tool: 'airport', label: 'Airport', pendingColor: '#e2e8f0' },
] as const;

/**
 * Looks up playable tool metadata from C-parity tool-state tables.
 * Mirrors `toolSize[]`, `toolOffset[]`, and `CostOf[]` indexing in
 * `ref/micropolis/src/sim/w_tool.c` (1:1 state-id lookup).
 */
function playableFootprintFromToolTables(
  tool: PlayableToolName,
): Pick<PlayableToolSpec, 'toolState' | 'size' | 'offset' | 'baseCost'> {
  const stateId = PLAYABLE_TOOL_STATE_ID[tool];
  const size = TOOL_SIZE[stateId];
  const offset = TOOL_OFFSET[stateId];
  const baseCost = TOOL_COST[stateId];
  if (size === undefined || offset === undefined || baseCost === undefined) {
    throw new Error(`Missing tool footprint table entry for playable tool "${tool}"`);
  }
  return {
    toolState: stateId,
    size,
    offset,
    baseCost,
  };
}

/**
 * Playable tool metadata table.
 * Mirrors `toolSize[]`/`toolOffset[]` entries from `ref/micropolis/src/sim/w_tool.c`
 * for the full editor-palette build/query tool set.
 * Parity note: `size`/`offset` values are derived from sim-core C-parity tool tables
 * (`TOOL_SIZE`, `TOOL_OFFSET`) to keep 1x1 vs 3x3 behavior locked to Micropolis.
 */
export const PLAYABLE_TOOL_SPECS: readonly PlayableToolSpec[] = PLAYABLE_TOOL_VISUAL_SPECS.map(
  (spec) => ({
    ...spec,
    ...playableFootprintFromToolTables(spec.tool),
  }),
);

const PLAYABLE_TOOL_NAME_SET = new Set<PlayableToolName>(
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
   * Legacy Playable Runtime hello rejection detail field retained for local-host
   * compatibility while Bridge V1 convergence work is still in flight.
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
 * Shared authoritative sound-delta section for sequenced host envelopes.
 * Mirrors unified sound-intent dispatch through `MakeSound` / `MakeSoundOn` in
 * `ref/micropolis/src/sim/w_sound.c`.
 * Parity note: this schema is transport-level metadata so any sequenced
 * envelope kind can carry sound deltas without coupling sounds to patch-only
 * payloads.
 */
export interface HostSequencedSoundDeltaSchema {
  soundDeltas?: readonly HostSoundDeltaPayload[];
}

/**
 * Host acknowledgement for a previously submitted command.
 * Mirrors command completion signaling around `sim` command dispatch in
 * `ref/micropolis/src/sim/w_sim.c`, adapted to bridge envelopes.
 */
export interface HostAckEnvelope extends HostSequencingFields, HostSequencedSoundDeltaSchema {
  kind: 'ack';
  commandId: string;
}

/**
 * Host rejection for an expected command denial.
 * Mirrors expected-denial split from Micropolis command processing in
 * `ref/micropolis/src/sim/w_sim.c`, adapted to explicit reject envelopes.
 */
export interface HostRejectEnvelope extends HostSequencingFields, HostSequencedSoundDeltaSchema {
  kind: 'reject';
  commandId: string;
  reason: string;
}

/**
 * Authoritative snapshot map payload carried by Playable Runtime host envelopes.
 * Mirrors contiguous `Map[WORLD_X][WORLD_Y]` storage and serialization order in
 * `ref/micropolis/src/sim/s_alloc.c` and `ref/micropolis/src/sim/s_fileio.c`.
 * Parity note: `tileWords` follows classic Micropolis x-major order
 * (`index = x * WORLD_Y + y`).
 */
export interface HostMapSnapshotPayload {
  width: number;
  height: number;
  tileWords: readonly number[] | Uint16Array;
  /**
   * Unpowered-zone blink phase sampled by the authoritative sim timer.
   * Mirrors `flagBlink` assignment in `ref/micropolis/src/sim/sim.c` and
   * lightning substitution gating (`flagBlink <= 0`) in
   * `ref/micropolis/src/sim/g_bigmap.c`.
   * Parity note: this carries the already-resolved boolean phase used by
   * renderer tile selection (`LIGHTNINGBOLT` vs base zone tile).
   */
  blinkUnpoweredZoneCenter?: boolean;
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
 * Authoritative incremental map payload carried by Playable Runtime patch envelopes.
 * Mirrors map mutation deltas consumed by `DoUpdateMap` in
 * `ref/micropolis/src/sim/w_map.c`.
 */
export interface HostMapPatchPayload {
  tileWordDeltas: readonly HostMapPatchTileWordDelta[];
  /**
   * Unpowered-zone blink phase sampled by the authoritative sim timer.
   * Mirrors `flagBlink` assignment in `ref/micropolis/src/sim/sim.c` and
   * lightning substitution gating (`flagBlink <= 0`) in
   * `ref/micropolis/src/sim/g_bigmap.c`.
   */
  blinkUnpoweredZoneCenter?: boolean;
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
 * One graph-series byte payload for one range (`10` or `120` years).
 * Mirrors one `History10[i]` / `History120[i]` channel buffer populated by
 * `doAllGraphs` in `ref/micropolis/src/sim/w_graph.c`.
 * Parity note: transport accepts both `Uint8Array` and JSON-friendly number lists.
 */
export interface HostHudGraphSeriesPayload {
  res: Uint8Array | readonly number[];
  com: Uint8Array | readonly number[];
  ind: Uint8Array | readonly number[];
  money: Uint8Array | readonly number[];
  crime: Uint8Array | readonly number[];
  pollution: Uint8Array | readonly number[];
}

/**
 * Full graph history payload for both Micropolis graph ranges.
 * Mirrors `History10[]` and `History120[]` output from
 * `ref/micropolis/src/sim/w_graph.c` (`drawMonth` / `doAllGraphs`).
 */
export interface HostHudGraphPayload {
  history10: HostHudGraphSeriesPayload;
  history120: HostHudGraphSeriesPayload;
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
 * One ranked evaluation problem row from the Micropolis evaluation scorecard.
 * Mirrors per-row name/percent text in `UISetEvaluation` from
 * `ref/micropolis/res/micropolis.tcl`.
 */
export interface HostHudEvaluationProblemSlotPayload {
  name: string;
  percent: string;
}

/**
 * Authoritative evaluation scorecard payload emitted by host snapshot/patch envelopes.
 * Mirrors `SetEvaluation` arguments in `ref/micropolis/src/sim/w_eval.c` and
 * `UISetEvaluation` projection in `ref/micropolis/res/micropolis.tcl`.
 */
export interface HostHudEvaluationPayload {
  title: string;
  score: string;
  scoreDelta: string;
  population: string;
  populationDelta: string;
  assessedValue: string;
  cityClass: string;
  cityLevel: string;
  yesPercent: string;
  noPercent: string;
  problems: readonly [
    HostHudEvaluationProblemSlotPayload,
    HostHudEvaluationProblemSlotPayload,
    HostHudEvaluationProblemSlotPayload,
    HostHudEvaluationProblemSlotPayload,
  ];
}

/**
 * Authoritative budget heads payload emitted by host snapshot/patch envelopes.
 * Mirrors budget-window source values from `ReallyDrawBudgetWindow` and
 * `ReallyDrawCurrPercents` in `ref/micropolis/src/sim/w_budget.c`.
 */
export interface HostHudBudgetPayload {
  taxRate: number;
  autoBudget: boolean;
  taxFund: number;
  totalFunds: number;
  cashFlow: number;
  roadPercent: number;
  firePercent: number;
  policePercent: number;
  roadWant: number;
  fireWant: number;
  policeWant: number;
  roadGot: number;
  fireGot: number;
  policeGot: number;
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
 * One authoritative notice payload emitted by host snapshot/patch envelopes.
 * Mirrors `UIShowPicture` notice display state in `ref/micropolis/res/micropolis.tcl`.
 * Parity note: this carries fully resolved title/body/color content so web clients
 * do not need to execute Tcl `Messages($id)` lookups.
 */
export interface HostHudNoticePayload {
  id: number;
  title: string;
  body: string;
  color: string;
  /**
   * Optional original authority tick for replay-stable notice baselines.
   * Mirrors ordered notice progression from `UIShowPicture` call ordering in
   * `ref/micropolis/src/sim/s_msg.c` and `ref/micropolis/res/micropolis.tcl`.
   */
  tick?: number;
  /**
   * Optional original authority sequence for replay-stable notice baselines.
   * Mirrors ordered bridge delivery intent in `ref/micropolis/spec/integration/SPEC.md`.
   */
  serverSeq?: number;
}

/**
 * One incremental HUD message delta in Playable Runtime patch payloads.
 * Mirrors incremental message dispatch in `ref/micropolis/src/sim/s_msg.c`.
 * Parity note: this is append-only for Playable Runtime feed projection.
 */
export type HostMessageDeltaPayload = HostHudMessagePayload;

/**
 * `MakeSoundOn` scope metadata projected onto bridge transport payloads.
 * Mirrors local-vs-global sound dispatch intent in
 * `ref/micropolis/src/sim/w_sound.c` (`MakeSound` and `MakeSoundOn`).
 * Parity note: this preserves host routing context; browser runtime playback
 * may ignore `target` while still retaining deterministic transport data.
 */
export interface HostSoundScopePayload {
  kind: 'view' | 'global';
  target?: string;
}

/**
 * One authoritative gameplay sound delta carried by host envelopes.
 * Mirrors sound-intent emission through `MakeSound` / `MakeSoundOn` in
 * `ref/micropolis/src/sim/w_sound.c`, with Tcl/activity token forwarding in
 * `ref/micropolis/res/micropolis.tcl` (`EchoPlaySound`) and
 * `ref/micropolis/micropolisactivity.py` (`PlaySound` handling).
 * Parity note: `soundSpec` is intentionally the full Micropolis sound spec
 * string; normalization to wav token is a runtime playback concern.
 */
export interface HostSoundDeltaPayload {
  channel: string;
  soundSpec: string;
  scope?: HostSoundScopePayload;
}

const HOST_SOUND_SCOPE_ALLOWED_KEYS = new Set(['kind', 'target']);
const HOST_SOUND_DELTA_ALLOWED_KEYS = new Set(['channel', 'soundSpec', 'scope']);

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyAllowedKeys(
  record: Record<string, unknown>,
  allowedKeys: ReadonlySet<string>,
): boolean {
  return Object.keys(record).every((key) => allowedKeys.has(key));
}

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
 * One incremental realtime object delta entry for Realtime Overlay payloads.
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
 * Realtime payload section carried by Playable Runtime snapshot/patch envelopes.
 * Mirrors realtime object stream intent from `ref/micropolis/src/sim/w_sprite.c`.
 * Parity note: `objects` remains a compatibility full-object stream while
 * Realtime Overlay adds explicit `snapshot` and `deltas` fields for deterministic
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
 * as a temporary compatibility field during Playable Runtime protocol migration.
 */
export interface HostHudPayload {
  funds?: number;
  fundsLabel?: string;
  date?: HostHudDatePayload;
  demand?: HostHudDemandPayload;
  graph?: HostHudGraphPayload;
  /**
   * Authoritative city population scalar (`CityPop`) from sim-core evaluation.
   * Mirrors `CityPop` derivation in `ref/micropolis/src/sim/s_eval.c`.
   * Parity note: this is emitted as a numeric head value; C displays formatted text.
   */
  cityPopulation?: number;
  /**
   * Authoritative city class ordinal (`0..5`) from sim-core evaluation.
   * Mirrors `CityClass` thresholds in `ref/micropolis/src/sim/s_eval.c`
   * and class labels in `ref/micropolis/src/sim/w_eval.c`.
   */
  cityClass?: number;
  speed?: number;
  options?: Partial<HostHudOptionsPayload>;
  evaluation?: HostHudEvaluationPayload;
  budget?: HostHudBudgetPayload;
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
 * Playable Runtime snapshot payload surface consumed by runtime projection reducers.
 * Mirrors map snapshot ownership in `ref/micropolis/src/sim/w_update.c`.
 * Parity note: legacy `map.tiles` support is retained temporarily while Playable Runtime
 * protocol migration is in flight.
 */
export interface HostSnapshotPayload extends Record<string, unknown> {
  map?: HostMapSnapshotPayload | LegacyHostMapSnapshotPayload;
  hud?: HostHudPayload;
  /**
   * Snapshot notice baseline (single active notice state).
   * Mirrors current notice ownership via `ShowingPicture` in
   * `ref/micropolis/res/micropolis.tcl`.
   */
  notice?: HostHudNoticePayload | null;
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
   * while Playable Runtime payload producers are upgraded.
   */
  messageDeltas?: readonly HostMessageDeltaPayload[];
}

/**
 * Playable Runtime patch payload surface consumed by runtime projection reducers.
 * Mirrors map patch ownership in `ref/micropolis/src/sim/w_update.c`.
 * Parity note: legacy `map.tiles` support is retained temporarily while Playable Runtime
 * protocol migration is in flight.
 */
export interface HostPatchPayload extends Record<string, unknown> {
  map?: HostMapPatchPayload | LegacyHostMapPatchPayload;
  hud?: HostHudPayload;
  /**
   * Incremental active-notice replacement for patch projection.
   * Mirrors `UIShowPicture` replacement behavior in
   * `ref/micropolis/res/micropolis.tcl`.
   */
  notice?: HostHudNoticePayload | null;
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
   * Legacy message delta field retained during Playable Runtime migration.
   * Runtime consumes this as append-only deltas.
   */
  messages?: readonly HostHudMessagePayload[];
}

/**
 * Host incremental authoritative update envelope.
 * Mirrors post-command/update propagation intent from
 * `ref/micropolis/src/sim/w_update.c`, including Playable Runtime map tile-word deltas.
 */
export interface HostPatchEnvelope extends HostSequencingFields, HostSequencedSoundDeltaSchema {
  kind: 'patch';
  payload: HostPatchPayload;
}

/**
 * Host full-state baseline envelope.
 * Mirrors full city state refresh intent in Micropolis update loops from
 * `ref/micropolis/src/sim/w_update.c`, adapted to bridge snapshots.
 */
export interface HostSnapshotEnvelope extends HostSequencingFields, HostSequencedSoundDeltaSchema {
  kind: 'snapshot';
  payload: HostSnapshotPayload;
}

/**
 * Host resync directive envelope.
 * Mirrors recover/resync intent discussed in bridge plans, aligned with
 * `ref/micropolis/src/sim/w_sim.c` deterministic command processing order.
 */
export interface HostResyncEnvelope extends HostSequencingFields, HostSequencedSoundDeltaSchema {
  kind: 'resync';
  reason: string;
}

/**
 * Host unexpected-fault envelope.
 * Mirrors fatal/runtime error surfacing patterns in `ref/micropolis/src/sim/w_sim.c`.
 */
export interface HostErrorEnvelope extends HostSequencingFields, HostSequencedSoundDeltaSchema {
  kind: 'error';
  message: string;
}

/**
 * Union of all Playable Runtime host envelopes consumed by the web runtime.
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
  command: PlayableClientCommand;
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
 * Union of Playable Runtime client envelopes emitted by the web runtime.
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
 * Returns true when a client payload is a Playable Runtime tool command.
 * Mirrors tool command dispatch guards in `ref/micropolis/src/sim/w_tool.c`.
 */
export function isPlayableToolCommand(command: unknown): command is PlayableToolCommand {
  if (command === null || typeof command !== 'object') {
    return false;
  }

  const candidate = command as Partial<PlayableToolCommand>;
  return (
    candidate.kind === 'tool' &&
    typeof candidate.tool === 'string' &&
    PLAYABLE_TOOL_NAME_SET.has(candidate.tool as PlayableToolName) &&
    typeof candidate.x === 'number' &&
    typeof candidate.y === 'number'
  );
}

/**
 * Returns true when a client payload is a Playable Runtime simulation control command.
 * Mirrors command dispatch guards for speed/pause/resume in
 * `ref/micropolis/src/sim/w_sim.c` and `ref/micropolis/src/sim/w_util.c`.
 */
export function isPlayableSimControlCommand(
  command: unknown,
): command is PlayableSimControlCommand {
  if (command === null || typeof command !== 'object') {
    return false;
  }

  const candidate = command as Partial<PlayableSimControlCommand>;
  if (candidate.kind !== 'sim-control' || typeof candidate.control !== 'string') {
    return false;
  }

  if (candidate.control === 'pause' || candidate.control === 'play') {
    return true;
  }

  if (candidate.control === 'set-speed') {
    return candidate.speed === 1 || candidate.speed === 2 || candidate.speed === 3;
  }

  if (candidate.control === 'set-tax-rate') {
    return (
      typeof candidate.taxRate === 'number' &&
      Number.isFinite(candidate.taxRate) &&
      Math.trunc(candidate.taxRate) >= 0 &&
      Math.trunc(candidate.taxRate) <= 20
    );
  }

  if (
    candidate.control === 'set-road-percent' ||
    candidate.control === 'set-fire-percent' ||
    candidate.control === 'set-police-percent'
  ) {
    return (
      typeof candidate.percent === 'number' &&
      Number.isFinite(candidate.percent) &&
      Math.trunc(candidate.percent) >= 0 &&
      Math.trunc(candidate.percent) <= 100
    );
  }

  if (candidate.control === 'set-auto-budget') {
    return typeof candidate.enabled === 'boolean';
  }

  if (candidate.control === 'open-budget-from-menu') {
    return true;
  }

  return false;
}

/**
 * Returns true when one candidate matches C game-level domain `0..2`.
 * Mirrors `SimCmdGameLevel` range checks and `SetGameLevelFunds(short)` level
 * switching in `ref/micropolis/src/sim/w_sim.c` and `ref/micropolis/src/sim/w_util.c`.
 */
function isPlayableGameLevel(value: unknown): value is PlayableGameLevel {
  return value === 0 || value === 1 || value === 2;
}

/**
 * Returns true when a new-city terrain seed matches the classic 16-bit range.
 * Mirrors `Rand16`-sourced seed usage for `GenerateSomeCity(int r)` in
 * `ref/micropolis/src/sim/s_gen.c`.
 */
function isPlayableTerrainSeed(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 0xffff
  );
}

/**
 * Returns true when one value is a namespaced scenario key (`builtin/*` or `user/*`).
 * Mirrors Stage 0 scenario key namespace contracts that wrap classic
 * `LoadScenario(short s)` identity from `ref/micropolis/src/sim/s_fileio.c`.
 */
function isPlayableScenarioKey(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false;
  }

  const BUILTIN_SCENARIO_KEY_PREFIX = 'builtin/';
  const USER_SCENARIO_KEY_PREFIX = 'user/';
  return (
    (value.startsWith(BUILTIN_SCENARIO_KEY_PREFIX) &&
      value.length > BUILTIN_SCENARIO_KEY_PREFIX.length) ||
    (value.startsWith(USER_SCENARIO_KEY_PREFIX) && value.length > USER_SCENARIO_KEY_PREFIX.length)
  );
}

/**
 * Returns true when a client payload is a Playable Runtime city lifecycle command.
 * Mirrors city lifecycle command gatekeeping in `ref/micropolis/src/sim/w_sim.c`.
 */
export function isPlayableCityLifecycleCommand(
  command: unknown,
): command is PlayableCityLifecycleCommand {
  if (command === null || typeof command !== 'object') {
    return false;
  }

  const candidate = command as Partial<PlayableCityLifecycleCommand>;
  return (
    candidate.kind === 'city-lifecycle' &&
    candidate.action === 'new-city' &&
    (candidate.gameLevel === undefined || isPlayableGameLevel(candidate.gameLevel)) &&
    (candidate.terrainSeed === undefined || isPlayableTerrainSeed(candidate.terrainSeed))
  );
}

/**
 * Returns true when a client payload is a Playable Runtime city IO command.
 * Mirrors save/load command gatekeeping in `ref/micropolis/src/sim/s_fileio.c`.
 */
export function isPlayableCityIoCommand(command: unknown): command is PlayableCityIoCommand {
  if (command === null || typeof command !== 'object') {
    return false;
  }

  const candidate = command as Partial<PlayableCityIoCommand>;
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
 * Returns true when a client payload is a Playable Runtime scenario command.
 * Mirrors `LoadScenario` command gatekeeping in `ref/micropolis/src/sim/s_fileio.c`.
 * Parity note: this accepts namespaced `scenarioKey` values (`builtin/*`, `user/*`);
 * host routing resolves keys into C `LoadScenario(short s)` metadata as needed.
 */
export function isPlayableScenarioCommand(command: unknown): command is PlayableScenarioCommand {
  if (command === null || typeof command !== 'object') {
    return false;
  }

  const candidate = command as Partial<PlayableScenarioCommand>;
  return (
    candidate.kind === 'scenario' &&
    candidate.action === 'load-scenario' &&
    isPlayableScenarioKey(candidate.scenarioKey) &&
    (candidate.gameLevel === undefined || isPlayableGameLevel(candidate.gameLevel))
  );
}

/**
 * Returns true when payload matches the locked host sound scope metadata shape.
 * Mirrors `MakeSoundOn` scope intent in `ref/micropolis/src/sim/w_sound.c`.
 * Parity note: only `kind` plus optional `target` are accepted so transport
 * metadata stays constrained to the agreed bridge payload contract.
 */
export function isHostSoundScopePayload(payload: unknown): payload is HostSoundScopePayload {
  if (!isObjectRecord(payload) || !hasOnlyAllowedKeys(payload, HOST_SOUND_SCOPE_ALLOWED_KEYS)) {
    return false;
  }

  if (payload.kind !== 'view' && payload.kind !== 'global') {
    return false;
  }

  return payload.target === undefined || typeof payload.target === 'string';
}

/**
 * Returns true when payload matches the locked host sound-delta shape.
 * Mirrors unified `MakeSound` / `MakeSoundOn` dispatch ownership in
 * `ref/micropolis/src/sim/w_sound.c`.
 * Parity note: `soundSpec` remains the full Micropolis sound spec string,
 * and this gate rejects out-of-contract fields to keep runtime transport stable.
 */
export function isHostSoundDeltaPayload(payload: unknown): payload is HostSoundDeltaPayload {
  if (!isObjectRecord(payload) || !hasOnlyAllowedKeys(payload, HOST_SOUND_DELTA_ALLOWED_KEYS)) {
    return false;
  }

  if (typeof payload.channel !== 'string' || typeof payload.soundSpec !== 'string') {
    return false;
  }

  return payload.scope === undefined || isHostSoundScopePayload(payload.scope);
}

/**
 * Looks up playable tool metadata for a tool id.
 * Mirrors toolbar-to-tool-state lookup intent from `setWandState` in
 * `ref/micropolis/src/sim/w_tool.c`, adapted for typed web metadata.
 */
export function getPlayableToolSpec(tool: PlayableToolName): PlayableToolSpec {
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
