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
  isStage2ToolCommand,
  STAGE2_TOOL_SPECS,
  type Stage2ToolCommand,
  type Stage2ToolName,
  type WebRuntimeState,
} from '../game/runtime/index.ts';

const DEMO_WORLD_WIDTH = 120;
const DEMO_WORLD_HEIGHT = 100;
const DEMO_PATCH_INTERVAL_MS = 180;
const DEMO_PATCH_TILE_COUNT = 28;

const TOOL_TILE_VALUES: Record<Stage2ToolName, number> = {
  road: 66,
  rail: 226,
  wire: 210,
  bulldoze: 0,
  res: 240,
  com: 423,
  ind: 612,
};

const ZONE_TOOLS = new Set<Stage2ToolName>(['res', 'com', 'ind']);

export const Route = createFileRoute('/')({
  component: HomePage,
});

/**
 * Deterministic local map host used for Stage 2 map/tool bring-up.
 * Mirrors authoritative tool command lifecycle intent from
 * `ref/micropolis/src/sim/w_tool.c` (`DoTool`, `DoPendTool`) and zone baseline
 * intent from `ref/micropolis/src/sim/s_zone.c`.
 * Difference: this is a scripted bridge-host stand-in and not full sim-core.
 */
class DemoMapHost implements CoreHost {
  private onEnvelope: ((envelope: HostEnvelope) => void) | undefined;
  private intervalHandle: ReturnType<typeof setInterval> | undefined;
  private serverSeq = 0;
  private tick = 0;
  private rngState = 0x12345678;
  private readonly mapTiles = buildInitialDemoMapTiles(DEMO_WORLD_WIDTH, DEMO_WORLD_HEIGHT);
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

    if (!isStage2ToolCommand(envelope.command)) {
      const reason = 'invalid-tool-command';
      this.commandOutcomes.set(envelope.commandId, { kind: 'reject', reason });
      this.emitReject(envelope.roomId, envelope.clientId, envelope.commandId, reason);
      return;
    }

    const placement = applyDemoToolCommand(
      this.mapTiles,
      DEMO_WORLD_WIDTH,
      DEMO_WORLD_HEIGHT,
      envelope.command,
    );

    if (!placement.accepted) {
      const reason = placement.reason;
      this.commandOutcomes.set(envelope.commandId, { kind: 'reject', reason });
      this.emitReject(envelope.roomId, envelope.clientId, envelope.commandId, reason);
      return;
    }

    this.commandOutcomes.set(envelope.commandId, { kind: 'ack' });
    this.emitAck(envelope.roomId, envelope.clientId, envelope.commandId);

    if (placement.deltas.length > 0) {
      this.emitPatch(envelope.roomId, envelope.clientId, placement.deltas);
    }
  }

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
      },
    });
  }

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

  private emitPatch(
    roomId: string,
    clientId: string,
    deltas: Array<{ index: number; tile: number }>,
  ): void {
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
      payload: {
        map: {
          tiles: deltas,
        },
      },
    });
  }

  private emitAmbientPatch(roomId: string, clientId: string): void {
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

    if (deltas.length === 0) {
      return;
    }

    this.tick += 1;
    this.emitPatch(roomId, clientId, deltas);
  }

  private startInterval(roomId: string, clientId: string): void {
    this.stopInterval();
    this.intervalHandle = setInterval(() => {
      this.emitAmbientPatch(roomId, clientId);
    }, DEMO_PATCH_INTERVAL_MS);
  }

  private stopInterval(): void {
    if (this.intervalHandle !== undefined) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = undefined;
    }
  }

  private nextRandom(): number {
    // Keeps deterministic host updates across runs, similar in spirit to C RNG.
    this.rngState = (Math.imul(this.rngState, 1103515245) + 12345) >>> 0;
    return this.rngState;
  }
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
 * Stage 2 route that renders a map projection and tool command toolbar sourced
 * from host envelopes.
 * Mirrors map-view + tool interaction flow in `ref/micropolis/src/sim/w_map.c`
 * and `ref/micropolis/src/sim/w_tool.c`, adapted to React + typed bridge state.
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

  return (
    <main
      style={{
        display: 'grid',
        gap: 12,
        padding: 16,
      }}
    >
      <h1 style={{ fontSize: 20, margin: 0 }}>Stage 2 Simple UI: Tools + Pending Lifecycle</h1>
      <div style={{ fontFamily: 'monospace', fontSize: 13 }}>
        phase={state.phase} seq={state.lastAppliedServerSeq} tick={state.lastAppliedTick} pending=
        {state.pendingTools.length}
      </div>
      <div style={{ color: '#b91c1c', fontFamily: 'monospace', fontSize: 12, minHeight: 16 }}>
        {state.lastRejectReason === null ? '' : `last reject: ${state.lastRejectReason}`}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {STAGE2_TOOL_SPECS.map((spec) => {
          const active = activeTool === spec.tool;
          return (
            <button
              key={spec.tool}
              onClick={() => {
                setActiveTool(spec.tool);
              }}
              type="button"
              style={{
                background: active ? spec.pendingColor : '#f3f4f6',
                border: '1px solid #334155',
                borderRadius: 4,
                cursor: 'pointer',
                fontFamily: 'monospace',
                fontSize: 12,
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
          if (state.phase !== 'ready') {
            return;
          }

          const commandId = `tool-${commandCounter.current}`;
          commandCounter.current += 1;
          runtime.sendCommand(commandId, {
            kind: 'tool',
            tool: activeTool,
            x,
            y,
          });
        }}
        pendingTools={state.pendingTools}
        tileSize={5}
      />
    </main>
  );
}
