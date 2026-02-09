import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState } from 'react';

import { MapCanvas } from '../game/map/map-canvas.tsx';
import {
  DemoMapHost,
  readDemoCityExportPayload,
  STAGE2_SCENARIO_CHOICES,
} from '../game/runtime/demo-map-host.ts';
import {
  createWebHostRuntime,
  PLAYABLE_TOOL_SPECS,
  type RuntimeHudMessageEvent,
  type Stage2SimSpeed,
  type Stage2ToolName,
  type WebRuntimeState,
} from '../game/runtime/index.ts';

export const Route = createFileRoute('/')({
  component: HomePage,
});

type RuntimeViewMode = 'stage4' | 'stage2';
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
 * Stage 4 panel projected from authoritative snapshot/patch game state.
 * Mirrors Stage 2 data-plane intent for map/HUD/message projection from
 * `ref/micropolis/src/sim/w_update.c`, `ref/micropolis/src/sim/sim.c`, and
 * `ref/micropolis/src/sim/s_msg.c`.
 * Difference: this still uses the deterministic `DemoMapHost` adapter instead
 * of a full sim-core authority payload source.
 */
function Stage4RuntimePanel() {
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
      <h2 style={{ fontFamily: 'monospace', fontSize: 16, margin: 0 }}>Stage 4 Runtime</h2>
      <div style={{ fontFamily: 'monospace', fontSize: 12 }}>
        phase={state.phase} seq={state.lastAppliedServerSeq} tick={state.lastAppliedTick} pending=
        {state.pendingTools.length} draw={state.mapState.drawMode}
      </div>
      <div style={{ color: '#b91c1c', fontFamily: 'monospace', fontSize: 12, minHeight: 16 }}>
        {state.lastRejectReason === null ? '' : `last reject: ${state.lastRejectReason}`}
      </div>
      <div style={{ fontFamily: 'monospace', fontSize: 12, minHeight: 16 }}>
        {formatRuntimePhaseStatus(state.phase)}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <button
          disabled={reconnectDisabled}
          onClick={() => {
            runtime.reconnect();
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
          border: '1px solid #334155',
          borderRadius: 6,
          display: 'grid',
          gap: 8,
          padding: 10,
        }}
      >
        <strong style={{ fontFamily: 'monospace', fontSize: 13 }}>
          Authoritative Snapshot/Patch Map
        </strong>
        <MapCanvas
          mapState={state.mapState}
          onTileClick={(x, y) => {
            if (controlsDisabled) {
              return;
            }

            runtime.sendCommand(nextCommandId(commandCounter, 'stage4-tool'), {
              kind: 'tool',
              tool: activeTool,
              x,
              y,
            });
          }}
          pendingTools={state.pendingTools}
          tileSize={STAGE4_MAP_TILE_SIZE}
        />
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
          {PLAYABLE_TOOL_SPECS.map((spec) => {
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
        <div style={{ fontFamily: 'monospace', fontSize: 12 }}>
          Click map tiles to submit `{activeTool}` tool commands.
        </div>
      </section>

      <section
        style={{
          border: '1px solid #334155',
          borderRadius: 6,
          display: 'grid',
          gap: 8,
          padding: 10,
        }}
      >
        <strong style={{ fontFamily: 'monospace', fontSize: 13 }}>HUD + Messages</strong>
        <div style={{ fontFamily: 'monospace', fontSize: 12 }}>
          <div>{state.hudState.fundsLabel}</div>
          <div>Date: {state.hudState.dateLabel}</div>
          <div>
            Demand R/C/I: {state.hudState.demandR}/{state.hudState.demandC}/{state.hudState.demandI}
          </div>
          <div>Speed: {formatSpeedLabel(state.hudState.speed)}</div>
        </div>
        <MessageFeed messages={state.hudState.messages} />
      </section>
    </section>
  );
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
            {PLAYABLE_TOOL_SPECS.map((spec) => {
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
