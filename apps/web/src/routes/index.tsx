import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState } from 'react';

import { MapCanvas } from '../game/map/map-canvas.tsx';
import {
  type ClientEnvelope,
  type CoreHost,
  type CoreHostConnection,
  createWebHostRuntime,
  getStage2ToolSpec,
  type HostEnvelope,
  isStage2SimControlCommand,
  isStage2ToolCommand,
  type RuntimeHudMessageEvent,
  STAGE2_TOOL_SPECS,
  type Stage2SimControlCommand,
  type Stage2SimSpeed,
  type Stage2ToolCommand,
  type Stage2ToolName,
  type WebRuntimeState,
} from '../game/runtime/index.ts';

const DEMO_WORLD_WIDTH = 120;
const DEMO_WORLD_HEIGHT = 100;
const DEMO_PATCH_INTERVAL_MS = 180;
const DEMO_PATCH_TILE_COUNT = 28;
const DEMO_STARTING_YEAR = 1900;
const DEMO_INITIAL_FUNDS = 20_000;
const DEMO_MESSAGE_LOG_LIMIT = 24;

const TOOL_TILE_VALUES: Record<Stage2ToolName, number> = {
  road: 66,
  rail: 226,
  wire: 210,
  bulldoze: 0,
  res: 240,
  com: 423,
  ind: 612,
};

const TOOL_COSTS: Record<Stage2ToolName, number> = {
  // Mirrors `CostOf[]` values for road/rail/wire/bulldoze/R/C/I in
  // `ref/micropolis/src/sim/w_tool.c`.
  road: 10,
  rail: 20,
  wire: 5,
  bulldoze: 1,
  res: 100,
  com: 100,
  ind: 100,
};

const ZONE_TOOLS = new Set<Stage2ToolName>(['res', 'com', 'ind']);

const DATE_STRINGS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

const STAGE2_MESSAGE_TEXT: Record<number, string> = {
  1: 'Need more residential zones.',
  2: 'Need more commercial zones.',
  3: 'Need more industrial zones.',
  4: 'Build more roads.',
  5: 'Build more rail.',
  6: 'Need power plants.',
  13: 'Residents demand fire stations.',
  14: 'Residents demand police stations.',
  16: 'City taxes are too high.',
  17: 'Road maintenance is low.',
  18: 'Fire coverage is low.',
  19: 'Police coverage is low.',
  [-10]: 'Pollution has reached dangerous levels.',
  [-11]: 'Crime is out of control.',
  [-12]: 'Traffic is congested.',
};

interface DemoHudMessagePayload {
  id: number;
  text: string;
  x?: number;
  y?: number;
}

interface DemoHudPayload {
  fundsLabel?: string;
  date?: {
    label: string;
    month: number;
    year: number;
  };
  demand?: {
    r: number;
    c: number;
    i: number;
  };
  speed?: number;
}

interface DemoPatchPayload {
  map?: {
    tiles: Array<{ index: number; tile: number }>;
  };
  hud?: DemoHudPayload;
  messages?: DemoHudMessagePayload[];
}

export const Route = createFileRoute('/')({
  component: HomePage,
});

/**
 * Deterministic local map host used for Stage 2 HUD/control/tool bring-up.
 * Mirrors authoritative command + UI update intent from
 * `ref/micropolis/src/sim/w_tool.c`, `ref/micropolis/src/sim/w_update.c`,
 * `ref/micropolis/src/sim/w_util.c`, and `ref/micropolis/src/sim/s_msg.c`.
 * Difference: this is a scripted bridge-host stand-in and not full sim-core.
 */
class DemoMapHost implements CoreHost {
  private onEnvelope: ((envelope: HostEnvelope) => void) | undefined;
  private intervalHandle: ReturnType<typeof setInterval> | undefined;
  private serverSeq = 0;
  private tick = 0;
  private cityTime = 0;
  private rngState = 0x12345678;
  private totalFunds = DEMO_INITIAL_FUNDS;
  private simMetaSpeed: Stage2SimSpeed = 3;
  private paused = false;
  private speedCycle = 0;
  private readonly mapTiles = buildInitialDemoMapTiles(DEMO_WORLD_WIDTH, DEMO_WORLD_HEIGHT);
  private readonly messageLog: DemoHudMessagePayload[] = [
    {
      id: 0,
      text: 'City initialized.',
    },
  ];
  private readonly commandOutcomes = new Map<
    string,
    { kind: 'ack' } | { kind: 'reject'; reason: string }
  >();

  connect(onEnvelope: (envelope: HostEnvelope) => void): CoreHostConnection {
    this.onEnvelope = onEnvelope;

    return {
      send: (envelope) => {
        this.handleClientEnvelope(envelope);
      },
      disconnect: () => {
        this.stopInterval();
        this.onEnvelope = undefined;
      },
    };
  }

  /**
   * Routes client envelopes into deterministic host-side command handlers.
   * Mirrors command routing and request-snapshot flow in
   * `ref/micropolis/src/sim/w_sim.c`, adapted to typed bridge envelopes.
   */
  private handleClientEnvelope(envelope: ClientEnvelope): void {
    if (this.onEnvelope === undefined) {
      return;
    }

    if (envelope.kind === 'hello') {
      this.onEnvelope({
        kind: 'hello',
        roomId: envelope.roomId,
        clientId: envelope.clientId,
        protocolVersion: envelope.protocolVersion,
        coreVersion: envelope.coreVersion,
        accepted: true,
      });

      this.emitSnapshot(envelope.roomId, envelope.clientId);
      this.startInterval(envelope.roomId, envelope.clientId);
      return;
    }

    if (envelope.kind === 'request_snapshot') {
      this.emitSnapshot(envelope.roomId, envelope.clientId);
      return;
    }

    if (envelope.kind === 'command') {
      this.handleCommandEnvelope(envelope);
    }
  }

  /**
   * Applies one command envelope and emits `ack`/`reject` plus resulting patch.
   * Mirrors command lifecycle handling in `ref/micropolis/src/sim/w_sim.c` and
   * tool/speed side effects in `ref/micropolis/src/sim/w_tool.c` and
   * `ref/micropolis/src/sim/w_util.c`.
   */
  private handleCommandEnvelope(envelope: Extract<ClientEnvelope, { kind: 'command' }>): void {
    this.tick += 1;

    const settled = this.commandOutcomes.get(envelope.commandId);
    if (settled !== undefined) {
      if (settled.kind === 'ack') {
        this.emitAck(envelope.roomId, envelope.clientId, envelope.commandId);
      } else {
        this.emitReject(envelope.roomId, envelope.clientId, envelope.commandId, settled.reason);
      }
      return;
    }

    if (isStage2ToolCommand(envelope.command)) {
      this.handleToolCommand(envelope, envelope.command);
      return;
    }

    if (isStage2SimControlCommand(envelope.command)) {
      this.handleSimControlCommand(envelope, envelope.command);
      return;
    }

    const reason = 'invalid-command';
    this.commandOutcomes.set(envelope.commandId, { kind: 'reject', reason });
    this.emitReject(envelope.roomId, envelope.clientId, envelope.commandId, reason);
  }

  /**
   * Applies a Stage 2 tool command and emits map/HUD patch deltas.
   * Mirrors tool placement + spending intent from `do_tool`/`Spend` in
   * `ref/micropolis/src/sim/w_tool.c`.
   * Difference: tile values are synthetic debug IDs in this local host.
   */
  private handleToolCommand(
    envelope: Extract<ClientEnvelope, { kind: 'command' }>,
    command: Stage2ToolCommand,
  ): void {
    const placement = applyDemoToolCommand(
      this.mapTiles,
      DEMO_WORLD_WIDTH,
      DEMO_WORLD_HEIGHT,
      command,
    );

    if (!placement.accepted) {
      const reason = placement.reason;
      this.commandOutcomes.set(envelope.commandId, { kind: 'reject', reason });
      this.emitReject(envelope.roomId, envelope.clientId, envelope.commandId, reason);
      return;
    }

    const toolCost = TOOL_COSTS[command.tool];
    if (this.totalFunds - toolCost < 0) {
      const reason = 'insufficient-funds';
      this.commandOutcomes.set(envelope.commandId, { kind: 'reject', reason });
      this.emitReject(envelope.roomId, envelope.clientId, envelope.commandId, reason);
      return;
    }

    this.totalFunds -= toolCost;
    this.commandOutcomes.set(envelope.commandId, { kind: 'ack' });
    this.emitAck(envelope.roomId, envelope.clientId, envelope.commandId);

    const payload: DemoPatchPayload = {
      hud: {
        fundsLabel: formatFundsLabel(this.totalFunds),
      },
    };

    if (placement.deltas.length > 0) {
      payload.map = {
        tiles: placement.deltas,
      };
    }

    this.emitPatch(envelope.roomId, envelope.clientId, payload);
  }

  /**
   * Applies pause/play/set-speed commands through host authority.
   * Mirrors `Pause`, `Resume`, and `setSpeed` in `ref/micropolis/src/sim/w_util.c`
   * and `SimCmdSpeed` command entry in `ref/micropolis/src/sim/w_sim.c`.
   */
  private handleSimControlCommand(
    envelope: Extract<ClientEnvelope, { kind: 'command' }>,
    command: Stage2SimControlCommand,
  ): void {
    applyDemoSimControl(this, command);

    this.commandOutcomes.set(envelope.commandId, { kind: 'ack' });
    this.emitAck(envelope.roomId, envelope.clientId, envelope.commandId);
    this.emitPatch(envelope.roomId, envelope.clientId, {
      hud: {
        speed: this.getVisibleSpeed(),
      },
    });
  }

  /**
   * Emits an authoritative snapshot baseline with map + HUD + message feed.
   * Mirrors full refresh intent in `ref/micropolis/src/sim/w_update.c`.
   */
  private emitSnapshot(roomId: string, clientId: string): void {
    if (this.onEnvelope === undefined) {
      return;
    }

    this.serverSeq += 1;
    this.onEnvelope({
      kind: 'snapshot',
      roomId,
      clientId,
      tick: this.tick,
      serverSeq: this.serverSeq,
      payload: {
        map: {
          width: DEMO_WORLD_WIDTH,
          height: DEMO_WORLD_HEIGHT,
          tiles: this.mapTiles.slice(),
        },
        hud: {
          fundsLabel: formatFundsLabel(this.totalFunds),
          date: computeDemoDateHeads(this.cityTime),
          demand: computeDemoDemandHeads(this.tick),
          speed: this.getVisibleSpeed(),
        },
        messages: this.messageLog,
      },
    });
  }

  /**
   * Emits a command `ack` envelope.
   * Mirrors successful command completion signaling in
   * `ref/micropolis/src/sim/w_sim.c`.
   */
  private emitAck(roomId: string, clientId: string, commandId: string): void {
    if (this.onEnvelope === undefined) {
      return;
    }

    this.serverSeq += 1;
    this.onEnvelope({
      kind: 'ack',
      roomId,
      clientId,
      tick: this.tick,
      serverSeq: this.serverSeq,
      commandId,
    });
  }

  /**
   * Emits a command `reject` envelope.
   * Mirrors expected-denial command results in `ref/micropolis/src/sim/w_sim.c`.
   */
  private emitReject(roomId: string, clientId: string, commandId: string, reason: string): void {
    if (this.onEnvelope === undefined) {
      return;
    }

    this.serverSeq += 1;
    this.onEnvelope({
      kind: 'reject',
      roomId,
      clientId,
      tick: this.tick,
      serverSeq: this.serverSeq,
      commandId,
      reason,
    });
  }

  /**
   * Emits one authoritative patch envelope for map/HUD/message deltas.
   * Mirrors incremental `UISet*` and map update propagation intent from
   * `ref/micropolis/src/sim/w_update.c` and `ref/micropolis/src/sim/s_msg.c`.
   */
  private emitPatch(roomId: string, clientId: string, payload: DemoPatchPayload): void {
    if (this.onEnvelope === undefined) {
      return;
    }

    this.serverSeq += 1;
    this.onEnvelope({
      kind: 'patch',
      roomId,
      clientId,
      tick: this.tick,
      serverSeq: this.serverSeq,
      payload,
    });
  }

  /**
   * Runs one ambient simulation slice and emits map/HUD/message deltas.
   * Mirrors speed-gated frame stepping in `ref/micropolis/src/sim/s_sim.c`
   * plus head updates in `ref/micropolis/src/sim/w_update.c`.
   */
  private emitAmbientPatch(roomId: string, clientId: string): void {
    if (!this.shouldAdvanceSimulation()) {
      return;
    }

    const deltas: Array<{ index: number; tile: number }> = [];
    for (let i = 0; i < DEMO_PATCH_TILE_COUNT; i += 1) {
      const index = this.nextRandom() % this.mapTiles.length;
      const currentTile = this.mapTiles[index];
      if (currentTile === undefined) {
        continue;
      }

      const nextTile = (currentTile + 1 + (this.tick & 31) + i) & 0xffff;
      this.mapTiles[index] = nextTile;
      deltas.push({ index, tile: nextTile });
    }

    this.tick += 1;
    this.cityTime += 1;

    let fundsChanged = false;
    if ((this.cityTime & 15) === 0) {
      this.totalFunds += this.simMetaSpeed;
      fundsChanged = true;
    }

    const payload: DemoPatchPayload = {
      hud: {
        date: computeDemoDateHeads(this.cityTime),
        demand: computeDemoDemandHeads(this.tick),
      },
    };

    if (fundsChanged) {
      if (payload.hud === undefined) {
        payload.hud = {};
      }
      payload.hud.fundsLabel = formatFundsLabel(this.totalFunds);
    }

    if (deltas.length > 0) {
      payload.map = {
        tiles: deltas,
      };
    }

    const ambientMessage = this.createAmbientMessage();
    if (ambientMessage !== null) {
      payload.messages = [ambientMessage];
      this.recordMessages(payload.messages);
    }

    this.emitPatch(roomId, clientId, payload);
  }

  /**
   * Starts the deterministic local tick interval.
   * Mirrors timer-based step scheduling intent in `ref/micropolis/src/sim/w_util.c`.
   */
  private startInterval(roomId: string, clientId: string): void {
    this.stopInterval();
    this.intervalHandle = setInterval(() => {
      this.emitAmbientPatch(roomId, clientId);
    }, DEMO_PATCH_INTERVAL_MS);
  }

  /**
   * Stops the local tick interval.
   * Mirrors timer stop behavior from `StopMicropolisTimer` usage in
   * `ref/micropolis/src/sim/w_util.c`.
   */
  private stopInterval(): void {
    if (this.intervalHandle !== undefined) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = undefined;
    }
  }

  /**
   * Returns whether the next interval should advance simulation work.
   * Mirrors `SimFrame` speed gating in `ref/micropolis/src/sim/s_sim.c`:
   * speed 0 pauses, speed 1 runs every 5th cycle, speed 2 every 3rd cycle,
   * speed 3 runs each cycle.
   */
  private shouldAdvanceSimulation(): boolean {
    if (this.paused) {
      return false;
    }

    this.speedCycle = (this.speedCycle + 1) & 0xffff;
    if (this.simMetaSpeed === 1 && this.speedCycle % 5 !== 0) {
      return false;
    }

    if (this.simMetaSpeed === 2 && this.speedCycle % 3 !== 0) {
      return false;
    }

    return true;
  }

  /**
   * Creates an occasional deterministic message event for the Stage 2 feed/log.
   * Mirrors threshold-driven message feed behavior in
   * `ref/micropolis/src/sim/s_msg.c`.
   * Difference: this emits from a scripted cadence rather than full sim thresholds.
   */
  private createAmbientMessage(): DemoHudMessagePayload | null {
    if ((this.cityTime & 31) !== 0) {
      return null;
    }

    const candidates = [1, 2, 3, 4, 5, 6, 13, 14, 16, 17, 18, 19, -10, -11, -12];
    const index = this.nextRandom() % candidates.length;
    const id = candidates[index];
    if (id === undefined) {
      return null;
    }

    return {
      id,
      text: messageTextForId(id),
    };
  }

  /**
   * Appends host-generated messages to the local snapshot baseline feed.
   * Mirrors one-slot message replacement in `SetMessageField` from
   * `ref/micropolis/src/sim/s_msg.c`, but intentionally keeps a bounded log.
   */
  private recordMessages(messages: readonly DemoHudMessagePayload[]): void {
    this.messageLog.push(...messages);
    if (this.messageLog.length > DEMO_MESSAGE_LOG_LIMIT) {
      this.messageLog.splice(0, this.messageLog.length - DEMO_MESSAGE_LOG_LIMIT);
    }
  }

  /**
   * Reads visible UI speed value.
   * Mirrors `UISetSpeed` behavior in `ref/micropolis/src/sim/w_util.c`, where
   * paused mode reports speed 0 while preserving remembered meta speed.
   */
  private getVisibleSpeed(): number {
    return this.paused ? 0 : this.simMetaSpeed;
  }

  /**
   * Sets paused state and remembered speed metadata.
   * Mirrors `Pause`/`Resume`/`setSpeed` interactions from
   * `ref/micropolis/src/sim/w_util.c`.
   */
  public applySimControl(command: Stage2SimControlCommand): void {
    if (command.control === 'pause') {
      this.paused = true;
      return;
    }

    if (command.control === 'play') {
      this.paused = false;
      return;
    }

    this.simMetaSpeed = command.speed;
  }

  /**
   * Deterministic pseudo-random generator for host-side scripted updates.
   * Mirrors the fixed-seed deterministic run style used throughout Micropolis.
   */
  private nextRandom(): number {
    this.rngState = (Math.imul(this.rngState, 1103515245) + 12345) >>> 0;
    return this.rngState;
  }
}

/**
 * Applies one simulation control command to the local scripted host state.
 * Mirrors pause/resume/speed intent from `ref/micropolis/src/sim/w_util.c`.
 */
function applyDemoSimControl(host: DemoMapHost, command: Stage2SimControlCommand): void {
  host.applySimControl(command);
}

/**
 * Computes deterministic demand head values in the visible -15..15 range.
 * Mirrors `SetDemand` output range from `ref/micropolis/src/sim/w_update.c`
 * where demand is emitted as integer valve/100 values.
 */
function computeDemoDemandHeads(tick: number): { r: number; c: number; i: number } {
  return {
    r: ((tick * 5) % 31) - 15,
    c: ((tick * 3 + 7) % 31) - 15,
    i: ((tick * 2 + 11) % 31) - 15,
  };
}

/**
 * Computes date label/month/year from CityTime.
 * Mirrors `updateDate` calculations in `ref/micropolis/src/sim/w_update.c`:
 * `y = (CityTime / 48) + StartingYear` and `m = (CityTime % 48) >> 2`.
 */
function computeDemoDateHeads(cityTime: number): { label: string; month: number; year: number } {
  const year = Math.trunc(cityTime / 48) + DEMO_STARTING_YEAR;
  const month = Math.trunc((cityTime % 48) / 4);
  const monthName = DATE_STRINGS[month] ?? 'Jan';
  return {
    label: `${monthName} ${year}`,
    month,
    year,
  };
}

/**
 * Resolves message text for one message id.
 * Mirrors `GetIndString` message lookup intent in `ref/micropolis/src/sim/s_msg.c`.
 * Difference: Stage 2 uses a compact local subset instead of full resource tables.
 */
function messageTextForId(id: number): string {
  const text = STAGE2_MESSAGE_TEXT[id];
  if (text !== undefined) {
    return text;
  }

  return `Message ${id}`;
}

/**
 * Formats funds label using Micropolis dollar-grouping style.
 * Mirrors `ReallyUpdateFunds` + `makeDollarDecimalStr` behavior in
 * `ref/micropolis/src/sim/w_update.c` and `ref/micropolis/src/sim/w_util.c`.
 */
function formatFundsLabel(value: number): string {
  return `Funds: ${formatDollarDecimal(value)}`;
}

/**
 * Formats one number into Micropolis-style dollar text.
 * Mirrors `makeDollarDecimalStr` in `ref/micropolis/src/sim/w_util.c`.
 */
function formatDollarDecimal(value: number): string {
  const raw = Math.max(0, Math.trunc(value)).toString();
  if (raw.length <= 3) {
    return `$${raw}`;
  }

  let left = raw.length % 3;
  if (left === 0) {
    left = 3;
  }

  let output = `$${raw.slice(0, left)}`;
  for (let index = left; index < raw.length; index += 3) {
    output += `,${raw.slice(index, index + 3)}`;
  }
  return output;
}

/**
 * Applies one Stage 2 tool command to the local demo map and returns changed
 * tiles for a host `patch` envelope.
 * Mirrors placement footprint rules from `ref/micropolis/src/sim/w_tool.c`
 * (`toolSize[]`, `toolOffset[]`, 3x3 zone stamp shape).
 * Difference: this uses synthetic debug tile ids and does not run simulation.
 */
function applyDemoToolCommand(
  tiles: Uint16Array,
  width: number,
  height: number,
  command: Stage2ToolCommand,
):
  | { accepted: true; deltas: Array<{ index: number; tile: number }> }
  | { accepted: false; reason: string } {
  if (!Number.isInteger(command.x) || !Number.isInteger(command.y)) {
    return { accepted: false, reason: 'out-of-bounds' };
  }

  const spec = getStage2ToolSpec(command.tool);
  const startX = command.x - spec.offset;
  const startY = command.y - spec.offset;
  const endX = startX + spec.size;
  const endY = startY + spec.size;

  if (startX < 0 || startY < 0 || endX > width || endY > height) {
    return { accepted: false, reason: 'out-of-bounds' };
  }

  const deltas: Array<{ index: number; tile: number }> = [];

  if (ZONE_TOOLS.has(command.tool)) {
    const base = TOOL_TILE_VALUES[command.tool];
    let offset = 0;
    for (let yy = startY; yy < endY; yy += 1) {
      for (let xx = startX; xx < endX; xx += 1) {
        writeDemoTile(tiles, width, xx, yy, (base + offset) & 0xffff, deltas);
        offset += 1;
      }
    }
    return { accepted: true, deltas };
  }

  writeDemoTile(tiles, width, command.x, command.y, TOOL_TILE_VALUES[command.tool], deltas);
  return { accepted: true, deltas };
}

/**
 * Updates one tile and records a patch delta only when the value changes.
 * Mirrors tile-write + dirty update intent in `ref/micropolis/src/sim/w_map.c`.
 */
function writeDemoTile(
  tiles: Uint16Array,
  width: number,
  x: number,
  y: number,
  tile: number,
  deltas: Array<{ index: number; tile: number }>,
): void {
  const index = y * width + x;
  if (tiles[index] === tile) {
    return;
  }

  tiles[index] = tile;
  deltas.push({ index, tile });
}

/**
 * Builds an initial deterministic tile baseline for the Stage 2 debug map view.
 * Mirrors map-buffer baseline setup intent from `ref/micropolis/src/sim/g_map.c`.
 * Difference: values are synthetic so UI work can proceed before full art parity.
 */
function buildInitialDemoMapTiles(width: number, height: number): Uint16Array {
  const tiles = new Uint16Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const band = (x >> 3) & 31;
      const stripe = (y >> 2) & 31;
      tiles[index] = ((band << 8) | stripe) & 0xffff;
    }
  }
  return tiles;
}

/**
 * Stage 2 route that renders map, HUD, controls, and message feed from host envelopes.
 * Mirrors map/tool/heads flows in `ref/micropolis/src/sim/w_map.c`,
 * `ref/micropolis/src/sim/w_tool.c`, `ref/micropolis/src/sim/w_update.c`, and
 * `ref/micropolis/src/sim/s_msg.c`, adapted to React + typed bridge state.
 */
function HomePage() {
  const runtime = useMemo(() => createWebHostRuntime({ host: new DemoMapHost() }), []);
  const [state, setState] = useState<WebRuntimeState>(() => runtime.getState());
  const [activeTool, setActiveTool] = useState<Stage2ToolName>('road');
  const commandCounter = useRef(1);

  useEffect(() => {
    const unsubscribe = runtime.subscribe((event) => {
      setState(event.state);
    });

    runtime.connect();
    return () => {
      unsubscribe();
      runtime.disconnect();
    };
  }, [runtime]);

  const controlsDisabled = state.phase !== 'ready';

  return (
    <main
      style={{
        display: 'grid',
        gap: 12,
        padding: 16,
      }}
    >
      <h1 style={{ fontSize: 20, margin: 0 }}>Stage 2 Simple UI: HUD + Simulation Controls</h1>
      <div style={{ fontFamily: 'monospace', fontSize: 13 }}>
        phase={state.phase} seq={state.lastAppliedServerSeq} tick={state.lastAppliedTick} pending=
        {state.pendingTools.length}
      </div>
      <div style={{ color: '#b91c1c', fontFamily: 'monospace', fontSize: 12, minHeight: 16 }}>
        {state.lastRejectReason === null ? '' : `last reject: ${state.lastRejectReason}`}
      </div>

      <section
        style={{
          display: 'grid',
          gap: 12,
          gridTemplateColumns: 'auto minmax(280px, 320px)',
        }}
      >
        <div style={{ display: 'grid', gap: 10, alignContent: 'start' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {STAGE2_TOOL_SPECS.map((spec) => {
              const active = activeTool === spec.tool;
              return (
                <button
                  key={spec.tool}
                  disabled={controlsDisabled}
                  onClick={() => {
                    setActiveTool(spec.tool);
                  }}
                  type="button"
                  style={{
                    background: active ? spec.pendingColor : '#f3f4f6',
                    border: '1px solid #334155',
                    borderRadius: 4,
                    cursor: controlsDisabled ? 'not-allowed' : 'pointer',
                    fontFamily: 'monospace',
                    fontSize: 12,
                    opacity: controlsDisabled ? 0.6 : 1,
                    padding: '6px 8px',
                  }}
                >
                  {spec.label}
                </button>
              );
            })}
          </div>

          <MapCanvas
            mapState={state.mapState}
            onTileClick={(x, y) => {
              if (controlsDisabled) {
                return;
              }

              runtime.sendCommand(nextCommandId(commandCounter, 'tool'), {
                kind: 'tool',
                tool: activeTool,
                x,
                y,
              });
            }}
            pendingTools={state.pendingTools}
            tileSize={5}
          />
        </div>

        <aside
          style={{
            border: '1px solid #334155',
            borderRadius: 6,
            display: 'grid',
            gap: 12,
            padding: 10,
          }}
        >
          <section style={{ display: 'grid', gap: 6 }}>
            <strong style={{ fontFamily: 'monospace', fontSize: 13 }}>HUD</strong>
            <div style={{ fontFamily: 'monospace', fontSize: 12 }}>
              <div>{state.hudState.fundsLabel}</div>
              <div>Date: {state.hudState.dateLabel}</div>
              <div>
                Demand R/C/I: {state.hudState.demandR}/{state.hudState.demandC}/
                {state.hudState.demandI}
              </div>
              <div>Speed: {formatSpeedLabel(state.hudState.speed)}</div>
            </div>
          </section>

          <section style={{ display: 'grid', gap: 6 }}>
            <strong style={{ fontFamily: 'monospace', fontSize: 13 }}>Simulation</strong>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <button
                disabled={controlsDisabled}
                onClick={() => {
                  runtime.sendCommand(nextCommandId(commandCounter, 'sim'), {
                    kind: 'sim-control',
                    control: 'pause',
                  });
                }}
                type="button"
              >
                Pause
              </button>
              <button
                disabled={controlsDisabled}
                onClick={() => {
                  runtime.sendCommand(nextCommandId(commandCounter, 'sim'), {
                    kind: 'sim-control',
                    control: 'play',
                  });
                }}
                type="button"
              >
                Play
              </button>
              {[1, 2, 3].map((speed) => (
                <button
                  key={speed}
                  disabled={controlsDisabled}
                  onClick={() => {
                    runtime.sendCommand(nextCommandId(commandCounter, 'sim'), {
                      kind: 'sim-control',
                      control: 'set-speed',
                      speed: speed as Stage2SimSpeed,
                    });
                  }}
                  style={{
                    fontWeight: state.hudState.speed === speed ? 700 : 400,
                  }}
                  type="button"
                >
                  x{speed}
                </button>
              ))}
            </div>
          </section>

          <section style={{ display: 'grid', gap: 6 }}>
            <strong style={{ fontFamily: 'monospace', fontSize: 13 }}>Message Feed</strong>
            <MessageFeed messages={state.hudState.messages} />
          </section>
        </aside>
      </section>
    </main>
  );
}

/**
 * Deterministically builds command ids for tool/sim-control sends.
 * Mirrors `commandId`-based host correlation requirements from Stage 2 rules.
 */
function nextCommandId(counter: { current: number }, prefix: string): string {
  const nextValue = counter.current;
  counter.current = nextValue + 1;
  return `${prefix}-${nextValue}`;
}

/**
 * Human-readable speed text formatter for the HUD panel.
 * Mirrors `UISetSpeed` paused-display behavior from `ref/micropolis/src/sim/w_util.c`.
 */
function formatSpeedLabel(speed: number): string {
  if (speed <= 0) {
    return 'Paused';
  }

  return `x${speed}`;
}

/**
 * Stage 2 message feed view.
 * Mirrors user-visible message surface from `UISetMessage` in
 * `ref/micropolis/src/sim/s_msg.c`, with a bounded reverse-chronological list.
 */
function MessageFeed({ messages }: { messages: readonly RuntimeHudMessageEvent[] }) {
  if (messages.length === 0) {
    return <div style={{ fontFamily: 'monospace', fontSize: 12 }}>No messages yet.</div>;
  }

  return (
    <div
      style={{
        background: '#f8fafc',
        border: '1px solid #cbd5e1',
        borderRadius: 4,
        fontFamily: 'monospace',
        fontSize: 12,
        maxHeight: 180,
        overflowY: 'auto',
        padding: 8,
      }}
    >
      {[...messages].reverse().map((message) => (
        <div key={`${message.serverSeq}:${message.id}:${message.tick}`} style={{ marginBottom: 4 }}>
          <span style={{ color: '#334155' }}>[{message.serverSeq}]</span> {message.text}
        </div>
      ))}
    </div>
  );
}
