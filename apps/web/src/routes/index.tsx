import { createFileRoute } from '@tanstack/react-router';
import { type MouseEvent, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import type { CoreHostTool } from '../game/core-host';
import { MapCanvas } from '../game/map/map-canvas.tsx';
import {
  type CommittedPlacement,
  describeRuntimeStatus,
  type PendingVisualPlacement,
} from '../game/runtime';
import {
  DemoMapHost,
  readDemoCityExportPayload,
  STAGE2_SCENARIO_CHOICES,
} from '../game/runtime/demo-map-host.ts';
import {
  createWebHostRuntime,
  type RuntimeHudMessageEvent,
  STAGE2_TOOL_SPECS,
  type Stage2SimSpeed,
  type Stage2ToolName,
  type WebRuntimeState,
} from '../game/runtime/index.ts';
import { gameRuntime } from '../game/runtime-instance';

export const Route = createFileRoute('/')({
  component: HomePage,
});

type RuntimeViewMode = 'stage4' | 'stage2';
const STAGE4_MAP_WIDTH = 120;
const STAGE4_MAP_HEIGHT = 100;
const STAGE4_MAP_TILE_SIZE = 6;
const SURVIVING_GAMEPLAY_ROUTE_PATH = '/';
const DUPLICATE_PROTOCOL_SURFACE_DELETE_PLAN = [
  'apps/web/src/game/core-host.ts',
  'apps/web/src/game/runtime/protocol.ts',
] as const;

/**
 * Route-level host/runtime switcher for Stage 4 and Stage 2 browser views.
 * Mirrors Micropolis transport-path switching intent in `ref/micropolis/src/sim/w_sim.c`:
 * one UI surface can target local in-process flows and network-ready host flows.
 * Difference: Stage 2 remains a temporary migration scaffold while `/` is the
 * locked surviving gameplay surface during bridge convergence.
 */
function HomePage() {
  const [viewMode, setViewMode] = useState<RuntimeViewMode>('stage4');

  return (
    <main
      style={{
        display: 'grid',
        gap: 12,
        padding: 16,
      }}
    >
      <h1 style={{ fontSize: 20, margin: 0 }}>City Runtime</h1>
      <div style={{ color: '#334155', fontFamily: 'monospace', fontSize: 11 }}>
        Stage 0 contract lock: surviving gameplay route is `{SURVIVING_GAMEPLAY_ROUTE_PATH}`. Delete
        duplicate protocol surfaces after bridge-contract port:{' '}
        {DUPLICATE_PROTOCOL_SURFACE_DELETE_PLAN.join(', ')}.
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <button
          onClick={() => {
            setViewMode('stage4');
          }}
          style={{
            background: viewMode === 'stage4' ? '#dbeafe' : '#f8fafc',
            border: '1px solid #334155',
            borderRadius: 4,
            fontFamily: 'monospace',
            fontSize: 12,
            padding: '6px 10px',
          }}
          type="button"
        >
          Stage 4 Runtime (Default)
        </button>
        <button
          onClick={() => {
            setViewMode('stage2');
          }}
          style={{
            background: viewMode === 'stage2' ? '#dbeafe' : '#f8fafc',
            border: '1px solid #334155',
            borderRadius: 4,
            fontFamily: 'monospace',
            fontSize: 12,
            padding: '6px 10px',
          }}
          type="button"
        >
          Stage 2 Demo Map
        </button>
      </div>
      {viewMode === 'stage4' ? <Stage4RuntimePanel /> : <Stage2DemoPanel />}
    </main>
  );
}

/**
 * Stage 4 host-agnostic runtime panel backed by `gameRuntime` and `CoreHost`.
 * Mirrors startup handshake + command lifecycle expectations in
 * `ref/micropolis/spec/integration/SPEC.md`, `ref/micropolis/src/sim/w_sim.c`, and
 * tool commit/reject behavior in `ref/micropolis/src/sim/w_tool.c`.
 */
function Stage4RuntimePanel() {
  const state = useSyncExternalStore(
    (onStoreChange) => gameRuntime.subscribeState(() => onStoreChange()),
    () => gameRuntime.getState(),
    () => gameRuntime.getState(),
  );
  const status = describeRuntimeStatus(state);
  const [activeTool, setActiveTool] = useState<CoreHostTool>('road');
  const [toolX, setToolX] = useState(60);
  const [toolY, setToolY] = useState(50);
  const commandCounter = useRef(1);

  const controlsDisabled = state.status !== 'ready';
  const recentCommitted = state.committedPlacements.slice(-16).reverse();
  const recentLogs = state.commandLifecycleLog.slice(-20).reverse();
  /**
   * Sends one Stage 4 placement command and keeps coordinate inputs aligned to the click target.
   * Mirrors `DoTool` targeting + command correlation intent in `ref/micropolis/src/sim/w_tool.c`.
   */
  const sendStage4Placement = (x: number, y: number): void => {
    if (controlsDisabled) {
      return;
    }

    setToolX(x);
    setToolY(y);
    gameRuntime.sendCommand({
      type: 'tool-command',
      commandId: nextCommandId(commandCounter, 'stage4-tool'),
      tool: activeTool,
      x,
      y,
    });
  };

  return (
    <section
      style={{
        display: 'grid',
        gap: 12,
      }}
    >
      <h2 style={{ fontFamily: 'monospace', fontSize: 16, margin: 0 }}>Stage 4 Runtime</h2>
      <div style={{ fontFamily: 'monospace', fontSize: 12 }}>
        mode={state.mode} status={state.status} seq={state.lastAppliedServerSeq} tick=
        {state.lastAppliedTick} pending={state.pendingPlacements.length} committed=
        {state.committedPlacements.length} resyncing={String(state.isResyncing)}
      </div>
      <div
        style={{
          color: status.isError ? '#b91c1c' : '#0f766e',
          fontFamily: 'monospace',
          fontSize: 12,
        }}
      >
        {status.headline}: {status.detail}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <button
          onClick={() => {
            gameRuntime.stop();
            gameRuntime.start();
          }}
          type="button"
        >
          Restart Runtime
        </button>
        <button
          onClick={() => {
            gameRuntime.host.requestSnapshot(state.lastAppliedServerSeq);
          }}
          type="button"
        >
          Request Snapshot
        </button>
      </div>

      <section
        style={{
          border: '1px solid #334155',
          borderRadius: 6,
          display: 'grid',
          gap: 8,
          padding: 10,
        }}
      >
        <strong style={{ fontFamily: 'monospace', fontSize: 13 }}>
          Authoritative Placement Map
        </strong>
        <Stage4PlacementCanvas
          committedPlacements={state.committedPlacements}
          height={STAGE4_MAP_HEIGHT}
          onTileClick={(x, y) => {
            sendStage4Placement(x, y);
          }}
          pendingPlacements={state.pendingPlacements}
          tileSize={STAGE4_MAP_TILE_SIZE}
          width={STAGE4_MAP_WIDTH}
        />
        <div style={{ fontFamily: 'monospace', fontSize: 12 }}>
          Click any tile to send a `{activeTool}` placement command.
        </div>
      </section>

      <section
        style={{
          border: '1px solid #334155',
          borderRadius: 6,
          display: 'grid',
          gap: 10,
          padding: 10,
        }}
      >
        <strong style={{ fontFamily: 'monospace', fontSize: 13 }}>Tool Command</strong>
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
                type="button"
              >
                {spec.label}
              </button>
            );
          })}
        </div>
        <div style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <label style={{ display: 'flex', gap: 4, fontFamily: 'monospace', fontSize: 12 }}>
            X
            <input
              disabled={controlsDisabled}
              min={0}
              onChange={(event) => {
                setToolX(parseTileCoordinate(event.target.value, toolX));
              }}
              step={1}
              style={{ width: 70 }}
              type="number"
              value={toolX}
            />
          </label>
          <label style={{ display: 'flex', gap: 4, fontFamily: 'monospace', fontSize: 12 }}>
            Y
            <input
              disabled={controlsDisabled}
              min={0}
              onChange={(event) => {
                setToolY(parseTileCoordinate(event.target.value, toolY));
              }}
              step={1}
              style={{ width: 70 }}
              type="number"
              value={toolY}
            />
          </label>
          <button
            disabled={controlsDisabled}
            onClick={() => {
              sendStage4Placement(toolX, toolY);
            }}
            type="button"
          >
            Send Placement
          </button>
        </div>
      </section>

      <section
        style={{
          border: '1px solid #334155',
          borderRadius: 6,
          display: 'grid',
          gap: 8,
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          padding: 10,
        }}
      >
        <div style={{ display: 'grid', gap: 6 }}>
          <strong style={{ fontFamily: 'monospace', fontSize: 13 }}>Pending Placements</strong>
          <RuntimePlacementList
            emptyText="No pending placements."
            placements={state.pendingPlacements.map((placement) => ({
              commandId: placement.commandId,
              tool: placement.tool,
              x: placement.x,
              y: placement.y,
            }))}
          />
        </div>
        <div style={{ display: 'grid', gap: 6 }}>
          <strong style={{ fontFamily: 'monospace', fontSize: 13 }}>
            Recent Committed Placements
          </strong>
          <RuntimePlacementList
            emptyText="No committed placements yet."
            placements={recentCommitted}
          />
        </div>
      </section>

      <section style={{ display: 'grid', gap: 6 }}>
        <strong style={{ fontFamily: 'monospace', fontSize: 13 }}>Command Lifecycle Log</strong>
        <RuntimeLogList entries={recentLogs} />
      </section>
    </section>
  );
}

/**
 * Stage 4 map canvas that visualizes authoritative placement events.
 * Mirrors map-tile redraw ownership from `ref/micropolis/src/sim/w_map.c` and
 * successful tool commit visibility from `ref/micropolis/src/sim/w_tool.c`.
 * Difference: Stage 4 currently renders placement overlays only (no full tile art map yet).
 */
function Stage4PlacementCanvas({
  committedPlacements,
  height,
  onTileClick,
  pendingPlacements,
  tileSize,
  width,
}: {
  committedPlacements: ReadonlyArray<CommittedPlacement>;
  height: number;
  onTileClick: (x: number, y: number) => void;
  pendingPlacements: ReadonlyArray<PendingVisualPlacement>;
  tileSize: number;
  width: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) {
      return;
    }

    const context = canvas.getContext('2d');
    if (context === null) {
      return;
    }

    const widthPx = width * tileSize;
    const heightPx = height * tileSize;
    if (canvas.width !== widthPx) {
      canvas.width = widthPx;
    }
    if (canvas.height !== heightPx) {
      canvas.height = heightPx;
    }

    context.fillStyle = '#e2e8f0';
    context.fillRect(0, 0, widthPx, heightPx);

    for (const placement of committedPlacements) {
      if (!isTileInBoundsForCanvas(placement.x, placement.y, width, height)) {
        continue;
      }

      context.fillStyle = resolveToolColor(placement.tool);
      context.fillRect(placement.x * tileSize, placement.y * tileSize, tileSize, tileSize);
    }

    for (const placement of pendingPlacements) {
      if (!isTileInBoundsForCanvas(placement.x, placement.y, width, height)) {
        continue;
      }

      context.strokeStyle = resolveToolColor(placement.tool);
      context.lineWidth = 1;
      context.strokeRect(placement.x * tileSize, placement.y * tileSize, tileSize, tileSize);
    }
  }, [committedPlacements, height, pendingPlacements, tileSize, width]);

  const widthPx = width * tileSize;
  const heightPx = height * tileSize;

  return (
    <div
      style={{
        border: '1px solid #334155',
        height: heightPx,
        overflow: 'hidden',
        width: widthPx,
      }}
    >
      <canvas
        ref={canvasRef}
        onClick={(event) => {
          const canvas = canvasRef.current;
          if (canvas === null) {
            return;
          }

          const tile = getCanvasTilePosition(event, canvas, tileSize);
          if (tile === null || !isTileInBoundsForCanvas(tile.x, tile.y, width, height)) {
            return;
          }

          onTileClick(tile.x, tile.y);
        }}
        style={{
          cursor: 'crosshair',
          display: 'block',
          imageRendering: 'pixelated',
        }}
      />
    </div>
  );
}

/**
 * Resolve one runtime tool name into deterministic UI marker color.
 * Mirrors tool-specific visual differentiation intent from `ref/micropolis/src/sim/w_tool.c`.
 * Difference: this uses Stage 2 debug palette tokens instead of Micropolis art sprites.
 */
function resolveToolColor(tool: CoreHostTool): string {
  const spec = STAGE2_TOOL_SPECS.find((candidate) => candidate.tool === tool);
  return spec?.pendingColor ?? '#334155';
}

/**
 * Converts a canvas click position into placement tile coordinates.
 * Mirrors tile-address targeting flow from `do_tool` in `ref/micropolis/src/sim/w_tool.c`,
 * adapted to HTML canvas screen-space coordinates.
 */
function getCanvasTilePosition(
  event: MouseEvent<HTMLCanvasElement>,
  canvas: HTMLCanvasElement,
  tileSize: number,
): { x: number; y: number } | null {
  const bounds = canvas.getBoundingClientRect();
  if (bounds.width === 0 || bounds.height === 0) {
    return null;
  }

  const canvasX = ((event.clientX - bounds.left) * canvas.width) / bounds.width;
  const canvasY = ((event.clientY - bounds.top) * canvas.height) / bounds.height;

  return {
    x: Math.floor(canvasX / tileSize),
    y: Math.floor(canvasY / tileSize),
  };
}

/**
 * Stage 4 map bounds-check helper for placement rendering and click validation.
 * Mirrors map bound checks used by Micropolis tool entry points in
 * `ref/micropolis/src/sim/w_tool.c`.
 */
function isTileInBoundsForCanvas(x: number, y: number, width: number, height: number): boolean {
  return x >= 0 && y >= 0 && x < width && y < height;
}

/**
 * Stage 2 route panel that renders map, HUD, controls, and message feed from host envelopes.
 * Mirrors map/tool/heads flows in `ref/micropolis/src/sim/w_map.c`,
 * `ref/micropolis/src/sim/w_tool.c`, `ref/micropolis/src/sim/w_update.c`, and
 * `ref/micropolis/src/sim/s_msg.c`, adapted to React + typed bridge state.
 */
function Stage2DemoPanel() {
  const runtime = useMemo(() => createWebHostRuntime({ host: new DemoMapHost() }), []);
  const [state, setState] = useState<WebRuntimeState>(() => runtime.getState());
  const [activeTool, setActiveTool] = useState<Stage2ToolName>('road');
  const [selectedScenarioId, setSelectedScenarioId] = useState<number>(
    STAGE2_SCENARIO_CHOICES[0]?.id ?? 1,
  );
  const [saveFileName, setSaveFileName] = useState('newcity.cty');
  const [lastSaveStatus, setLastSaveStatus] = useState<string>('');
  const [cityIoError, setCityIoError] = useState<string>('');
  const loadInputRef = useRef<HTMLInputElement | null>(null);
  const commandCounter = useRef(1);

  useEffect(() => {
    const unsubscribe = runtime.subscribe((event) => {
      setState(event.state);

      if (event.envelope?.kind !== 'patch') {
        return;
      }

      const savePayload = readDemoCityExportPayload(event.envelope.payload);
      if (savePayload === null) {
        return;
      }

      downloadCityBytes(savePayload.fileName, savePayload.cityBytes);
      setSaveFileName(savePayload.fileName);
      setLastSaveStatus(`Saved ${savePayload.cityName} -> ${savePayload.fileName}`);
      setCityIoError('');
    });

    runtime.connect();
    return () => {
      unsubscribe();
      runtime.disconnect();
    };
  }, [runtime]);

  const controlsDisabled = state.phase !== 'ready';
  const reconnectDisabled =
    state.phase === 'connecting' || state.phase === 'negotiating' || state.phase === 'reconnecting';
  const resyncDisabled =
    state.phase === 'disconnected' ||
    state.phase === 'connecting' ||
    state.phase === 'negotiating' ||
    state.phase === 'reconnecting' ||
    state.phase === 'failed';

  return (
    <section
      style={{
        display: 'grid',
        gap: 12,
      }}
    >
      <h2 style={{ fontFamily: 'monospace', fontSize: 16, margin: 0 }}>Stage 2 Demo Map Runtime</h2>
      <div style={{ fontFamily: 'monospace', fontSize: 13 }}>
        phase={state.phase} seq={state.lastAppliedServerSeq} tick={state.lastAppliedTick} pending=
        {state.pendingTools.length}
      </div>
      <div style={{ color: '#b91c1c', fontFamily: 'monospace', fontSize: 12, minHeight: 16 }}>
        {state.lastRejectReason === null ? '' : `last reject: ${state.lastRejectReason}`}
      </div>
      <div style={{ color: '#b91c1c', fontFamily: 'monospace', fontSize: 12, minHeight: 16 }}>
        {cityIoError}
      </div>
      <div style={{ color: '#0f766e', fontFamily: 'monospace', fontSize: 12, minHeight: 16 }}>
        {lastSaveStatus}
      </div>
      <div style={{ fontFamily: 'monospace', fontSize: 12, minHeight: 16 }}>
        {formatRuntimePhaseStatus(state.phase)}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <button
          disabled={reconnectDisabled}
          onClick={() => {
            runtime.reconnect();
            setCityIoError('');
            setLastSaveStatus('');
          }}
          type="button"
        >
          Reconnect
        </button>
        <button
          disabled={resyncDisabled}
          onClick={() => {
            runtime.requestSnapshot('resync');
          }}
          type="button"
        >
          Resync Snapshot
        </button>
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
            <strong style={{ fontFamily: 'monospace', fontSize: 13 }}>City</strong>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <button
                disabled={controlsDisabled}
                onClick={() => {
                  setSaveFileName('newcity.cty');
                  runtime.sendCommand(nextCommandId(commandCounter, 'city'), {
                    kind: 'city-lifecycle',
                    action: 'new-city',
                  });
                }}
                type="button"
              >
                New City
              </button>
              <button
                disabled={controlsDisabled}
                onClick={() => {
                  runtime.sendCommand(nextCommandId(commandCounter, 'city'), {
                    kind: 'city-io',
                    action: 'save-city',
                    fileName: saveFileName,
                  });
                }}
                type="button"
              >
                Save .cty
              </button>
              <button
                disabled={controlsDisabled}
                onClick={() => {
                  loadInputRef.current?.click();
                }}
                type="button"
              >
                Load .cty
              </button>
            </div>
            <label style={{ display: 'grid', gap: 4, fontFamily: 'monospace', fontSize: 12 }}>
              Save file name
              <input
                disabled={controlsDisabled}
                onChange={(event) => {
                  setSaveFileName(event.target.value);
                }}
                type="text"
                value={saveFileName}
              />
            </label>
            <input
              accept=".cty,application/octet-stream"
              onChange={async (event) => {
                const input = event.currentTarget;
                const file = input.files?.[0];
                input.value = '';

                if (file === undefined || controlsDisabled) {
                  return;
                }

                try {
                  const cityBytes = new Uint8Array(await file.arrayBuffer());
                  setSaveFileName(file.name);
                  runtime.sendCommand(nextCommandId(commandCounter, 'city'), {
                    kind: 'city-io',
                    action: 'load-city',
                    fileName: file.name,
                    cityBytes,
                  });
                  setCityIoError('');
                } catch {
                  setCityIoError('Failed to read selected city file.');
                }
              }}
              ref={loadInputRef}
              style={{ display: 'none' }}
              type="file"
            />
          </section>

          <section style={{ display: 'grid', gap: 6 }}>
            <strong style={{ fontFamily: 'monospace', fontSize: 13 }}>Scenario</strong>
            <div style={{ display: 'flex', gap: 8 }}>
              <select
                disabled={controlsDisabled}
                onChange={(event) => {
                  setSelectedScenarioId(Number.parseInt(event.target.value, 10));
                }}
                value={selectedScenarioId}
              >
                {STAGE2_SCENARIO_CHOICES.map((scenario) => (
                  <option key={scenario.id} value={scenario.id}>
                    {scenario.id}. {scenario.name} ({scenario.startYear})
                  </option>
                ))}
              </select>
              <button
                disabled={controlsDisabled}
                onClick={() => {
                  const scenario = STAGE2_SCENARIO_CHOICES.find(
                    (entry) => entry.id === selectedScenarioId,
                  );
                  if (scenario !== undefined) {
                    setSaveFileName(`${scenario.fileName}.cty`);
                  }

                  runtime.sendCommand(nextCommandId(commandCounter, 'scenario'), {
                    kind: 'scenario',
                    action: 'load-scenario',
                    scenarioId: selectedScenarioId,
                  });
                }}
                type="button"
              >
                Start Scenario
              </button>
            </div>
          </section>

          <section style={{ display: 'grid', gap: 6 }}>
            <strong style={{ fontFamily: 'monospace', fontSize: 13 }}>Message Feed</strong>
            <MessageFeed messages={state.hudState.messages} />
          </section>
        </aside>
      </section>
    </section>
  );
}

/**
 * Renders a compact placement list for Stage 4 runtime diagnostics.
 * Mirrors placement visibility intent from `DidTool(...)` usage in
 * `ref/micropolis/src/sim/w_tool.c`, adapted to simple text rows.
 */
function RuntimePlacementList({
  emptyText,
  placements,
}: {
  emptyText: string;
  placements: ReadonlyArray<{ commandId: string; tool: string; x: number; y: number }>;
}) {
  if (placements.length === 0) {
    return <div style={{ fontFamily: 'monospace', fontSize: 12 }}>{emptyText}</div>;
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
      {placements.map((placement) => (
        <div key={`${placement.commandId}:${placement.tool}:${placement.x}:${placement.y}`}>
          {placement.commandId} {placement.tool}@{placement.x},{placement.y}
        </div>
      ))}
    </div>
  );
}

/**
 * Renders a compact reverse-chronological lifecycle log list.
 * Mirrors deterministic command/update ordering audit intent from
 * `ref/micropolis/spec/integration/SPEC.md`.
 */
function RuntimeLogList({ entries }: { entries: readonly string[] }) {
  if (entries.length === 0) {
    return <div style={{ fontFamily: 'monospace', fontSize: 12 }}>No lifecycle entries yet.</div>;
  }

  return (
    <div
      style={{
        background: '#f8fafc',
        border: '1px solid #cbd5e1',
        borderRadius: 4,
        fontFamily: 'monospace',
        fontSize: 12,
        maxHeight: 220,
        overflowY: 'auto',
        padding: 8,
      }}
    >
      {entries.map((entry, index) => (
        <div key={`${index}-${entry}`}>{entry}</div>
      ))}
    </div>
  );
}

/**
 * Parses one tile coordinate input while preserving previous valid value.
 * Mirrors integer command-coordinate validation intent in
 * `ref/micropolis/src/sim/w_tool.c`.
 */
function parseTileCoordinate(raw: string, fallback: number): number {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return parsed;
}

/**
 * Triggers a browser download for exported `.cty` payload bytes.
 * Mirrors `SaveCityAs` user-selected output intent in `ref/micropolis/src/sim/s_fileio.c`.
 */
function downloadCityBytes(fileName: string, cityBytes: Uint8Array): void {
  const blobBytes = new Uint8Array(cityBytes.byteLength);
  blobBytes.set(cityBytes);
  const blob = new Blob([blobBytes.buffer], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);

  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.style.display = 'none';

  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/**
 * Deterministically builds command ids for runtime command sends.
 * Mirrors `commandId`-based host correlation requirements from Stage plans.
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
 * Runtime phase status text shown above Stage 2 reconnect/resync controls.
 * Mirrors reconnect/resync lifecycle intent from
 * `ref/micropolis/spec/integration/SPEC.md`.
 */
function formatRuntimePhaseStatus(phase: WebRuntimeState['phase']): string {
  if (phase === 'reconnecting') {
    return 'Reconnecting to host...';
  }
  if (phase === 'resyncing') {
    return 'Resyncing authoritative snapshot...';
  }
  if (phase === 'negotiating') {
    return 'Negotiating hello handshake...';
  }
  if (phase === 'connecting') {
    return 'Connecting to host...';
  }
  if (phase === 'failed') {
    return 'Connection failed. Reconnect to retry.';
  }
  if (phase === 'disconnected') {
    return 'Disconnected.';
  }
  return 'Connected.';
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
