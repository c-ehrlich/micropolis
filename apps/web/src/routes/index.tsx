import { createFileRoute } from '@tanstack/react-router';
import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react';

import demandGaugeBackgroundUrl from '../../../../packages/sim-assets/generated-images/images/demandg.png';
import micropolisRunningIndicatorUrl from '../../../../packages/sim-assets/generated-images/images/micropolisg.png';
import micropolisPausedIndicatorUrl from '../../../../packages/sim-assets/generated-images/images/micropoliss.png';
import { resolveSimUiToolIconAssetLookup } from '../../../../packages/sim-assets/src/sim-ui.ts';
import { createMicropolisGameplayAudioConsumer } from '../game/audio/micropolis-gameplay-audio-consumer.ts';
import { createMicropolisGameplaySoundPlaybackPolicy } from '../game/audio/micropolis-gameplay-sound-playback-policy.ts';
import { routeMicropolisGameplaySoundDeltas } from '../game/audio/micropolis-runtime-envelope-sound-routing.ts';
import { MapCanvas } from '../game/map/map-canvas.tsx';
import { createCoalescedStateDispatcher } from '../game/runtime/frame-coalescer.ts';
import {
  coalesceQueuedRuntimeMapState,
  createWebHostRuntime,
  getPlayableToolSpec,
  PLAYABLE_TOOL_SPECS,
  type PlayableSimSpeed,
  type PlayableToolName,
  type RuntimeHudMessageEvent,
  type WebRuntimeState,
} from '../game/runtime/index.ts';
import {
  createPlayableRuntimeHost,
  PLAYABLE_DISASTER_CHOICES,
  PLAYABLE_SCENARIO_CHOICES,
  type PlayableDisasterChoiceId,
  readCityExportPayload,
  triggerPlayableRuntimeDisaster,
} from '../game/runtime/playable-runtime-host.ts';
import { type CoreHost } from '../game/runtime/protocol.ts';

export const Route = createFileRoute('/')({
  component: HomePage,
});

const MAP_TILE_SIZE = 16;
const PLAYABLE_TOOL_ICON_MODULES = import.meta.glob(
  '../../../../packages/sim-assets/generated-images/images/ic*.png',
  {
    eager: true,
    import: 'default',
  },
) as Record<string, string>;
const PLAYABLE_TOOL_ICON_URL_BY_BASENAME = new Map<string, string>(
  Object.entries(PLAYABLE_TOOL_ICON_MODULES).map(([modulePath, moduleUrl]) => {
    const basenameMatch = /\/(ic[^/]+\.png)$/.exec(modulePath);
    return [basenameMatch?.[1] ?? modulePath, moduleUrl];
  }),
);

/**
 * Triggers one playable-route manual disaster control click and returns status text.
 * Mirrors Disasters menu entrypoint ownership in `ref/micropolis/res/whead.tcl`,
 * with runtime disaster handling in `ref/micropolis/src/sim/s_disast.c` and
 * `ref/micropolis/src/sim/w_sprite.c`.
 * Parity note: this keeps route `/` disaster controls host-agnostic by delegating
 * to the structural host capability adapter instead of concrete host classes.
 */
export function triggerRouteDisasterControl(
  host: CoreHost,
  disasterId: PlayableDisasterChoiceId,
  disasterLabel: string,
): string {
  if (triggerPlayableRuntimeDisaster(host, disasterId)) {
    return `${disasterLabel}.`;
  }

  return 'Disaster trigger is unavailable on this host.';
}

/**
 * Primary Authoritative Runtime gameplay route rendered at `/`.
 * Mirrors the single command-surface gameplay intent from `w_sim.c` in
 * `ref/micropolis/src/sim/w_sim.c`.
 * Parity note: route wiring imports a Authoritative Runtime primary-host surface so users do
 * not depend on demo-only host controls in the default gameplay path.
 */
function HomePage() {
  return (
    <main
      style={{
        inset: 0,
        overflow: 'hidden',
        position: 'fixed',
      }}
    >
      <RuntimePanel />
    </main>
  );
}

/**
 * Authoritative Runtime route panel that renders map, HUD, controls, and message feed from host envelopes.
 * Mirrors map/tool/heads flows in `ref/micropolis/src/sim/w_map.c`,
 * `ref/micropolis/src/sim/w_tool.c`, `ref/micropolis/src/sim/w_update.c`, and
 * `ref/micropolis/src/sim/s_msg.c`, adapted to React + typed bridge state.
 * Parity note: this replaces the earlier Authoritative Runtime placement-only primary panel
 * with the full authoritative map/HUD/control projection path.
 */
function RuntimePanel() {
  const host = useMemo(() => createPlayableRuntimeHost(), []);
  const runtime = useMemo(() => createWebHostRuntime({ host }), [host]);
  const gameplayAudioConsumer = useMemo(() => createMicropolisGameplayAudioConsumer(), []);
  const gameplaySoundPlaybackPolicy = useMemo(
    () => createMicropolisGameplaySoundPlaybackPolicy({ mode: 'applied-only' }),
    [],
  );
  const [state, setState] = useState<WebRuntimeState>(() => runtime.getState());
  /**
   * Coalesces host-driven runtime projections to one browser paint commit.
   * Mirrors Micropolis cadence where map/head updates are consumed on UI update
   * boundaries (`sim_update_maps` / `DoUpdateHeads`) rather than every internal
   * simulation mutation (`ref/micropolis/src/sim/sim.c`, `w_update.c`).
   */
  const stateCommitDispatcher = useMemo(
    () =>
      createCoalescedStateDispatcher<WebRuntimeState>({
        scheduleFrame: (flush) => requestAnimationFrame(flush),
        cancelFrame: (frameHandle) => cancelAnimationFrame(frameHandle),
        commitState: (nextState) => {
          setState(nextState);
        },
        coalesceQueuedState: (queuedState, nextState) => {
          return {
            ...nextState,
            mapState: coalesceQueuedRuntimeMapState(queuedState.mapState, nextState.mapState),
          };
        },
      }),
    [],
  );
  const [activeTool, setActiveTool] = useState<PlayableToolName>('road');
  const [selectedScenarioId, setSelectedScenarioId] = useState<number>(
    PLAYABLE_SCENARIO_CHOICES[0]?.id ?? 1,
  );
  const [hasStartedPlayableSession, setHasStartedPlayableSession] = useState(false);
  const [saveFileName, setSaveFileName] = useState('newcity.cty');
  const [lastSaveStatus, setLastSaveStatus] = useState<string>('');
  const [cityIoError, setCityIoError] = useState<string>('');
  const [disasterStatus, setDisasterStatus] = useState<string>('');
  const loadInputRef = useRef<HTMLInputElement | null>(null);
  const commandCounter = useRef(1);

  useEffect(() => {
    const unsubscribe = runtime.subscribe((event) => {
      stateCommitDispatcher.queue(event.state);

      const runtimeEnvelope = event.envelope;
      if (runtimeEnvelope === undefined) {
        return;
      }

      routeMicropolisGameplaySoundDeltas({
        envelope: runtimeEnvelope,
        reducerOutcome: event.outcome,
        userSoundOn: event.state.hudState.options.userSoundOn,
        gameplayAudioConsumer,
        gameplaySoundPlaybackPolicy,
      });

      if (runtimeEnvelope.kind !== 'patch') {
        return;
      }

      const savePayload = readCityExportPayload(runtimeEnvelope.payload);
      if (savePayload !== null) {
        downloadCityBytes(savePayload.fileName, savePayload.cityBytes);
        setSaveFileName(savePayload.fileName);
        setLastSaveStatus(`Saved ${savePayload.cityName} -> ${savePayload.fileName}`);
        setCityIoError('');
      }
    });

    runtime.connect();
    return () => {
      unsubscribe();
      stateCommitDispatcher.dispose();
      runtime.disconnect();
      gameplayAudioConsumer.dispose();
    };
  }, [runtime, stateCommitDispatcher, gameplayAudioConsumer, gameplaySoundPlaybackPolicy]);

  const controlsDisabled = state.phase !== 'ready';
  const sessionControlsDisabled = controlsDisabled || !hasStartedPlayableSession;
  const reconnectDisabled =
    state.phase === 'connecting' || state.phase === 'negotiating' || state.phase === 'reconnecting';
  const resyncDisabled =
    state.phase === 'disconnected' ||
    state.phase === 'connecting' ||
    state.phase === 'negotiating' ||
    state.phase === 'reconnecting' ||
    state.phase === 'failed';
  const activeToolSpec = getPlayableToolSpec(activeTool);

  return (
    <section
      style={{
        background: '#0b1020',
        color: '#e2e8f0',
        height: '100%',
        overflow: 'hidden',
        position: 'relative',
        width: '100%',
      }}
    >
      <div
        style={{
          inset: 0,
          position: 'absolute',
        }}
      >
        <MapCanvas
          mapState={state.mapState}
          onTileClick={(x, y) => {
            if (sessionControlsDisabled) {
              return;
            }

            const commandId = nextCommandId(commandCounter, 'tool');
            runtime.sendCommand(commandId, {
              kind: 'tool',
              tool: activeTool,
              x,
              y,
            });
          }}
          pendingTools={state.pendingTools}
          realtimeObjects={state.realtimeState.objects}
          tileSize={MAP_TILE_SIZE}
        />
      </div>

      <section
        style={{
          backdropFilter: 'blur(3px)',
          background: 'rgba(107, 114, 128, 0.9)',
          border: '2px solid rgba(15, 23, 42, 0.75)',
          borderRadius: 6,
          display: 'grid',
          gap: 6,
          left: 12,
          maxHeight: 'calc(100vh - 220px)',
          overflowY: 'auto',
          padding: 8,
          pointerEvents: 'auto',
          position: 'absolute',
          top: '50%',
          transform: 'translateY(-50%)',
          width: 104,
          zIndex: 6,
        }}
      >
        <strong
          style={{
            color: '#f8fafc',
            fontFamily: 'monospace',
            fontSize: 11,
            letterSpacing: 0.4,
            textAlign: 'center',
            textTransform: 'uppercase',
          }}
        >
          Build
        </strong>
        <MicropolisStatusSprite isRunning={state.hudState.speed > 0} />
        <div
          style={{
            display: 'grid',
            gap: 6,
            gridTemplateColumns: 'repeat(2, 40px)',
            justifyContent: 'center',
            margin: '0 auto',
          }}
        >
          {PLAYABLE_TOOL_SPECS.map((spec) => {
            const active = activeTool === spec.tool;
            const iconLookup = resolveSimUiToolIconAssetLookup(spec.toolState, {
              highlighted: active,
            });
            const iconBasename = iconLookup?.derivedPngPath?.split('/').pop();
            const iconUrl =
              iconBasename === undefined
                ? undefined
                : PLAYABLE_TOOL_ICON_URL_BY_BASENAME.get(iconBasename);

            return (
              <button
                key={spec.tool}
                disabled={sessionControlsDisabled}
                onClick={() => {
                  setActiveTool(spec.tool);
                }}
                title={`${spec.label} ($${spec.baseCost})`}
                type="button"
                style={{
                  alignItems: 'center',
                  background: active ? '#fef08a' : '#e2e8f0',
                  border: active ? '2px solid #b45309' : '2px solid #334155',
                  borderRadius: 2,
                  cursor: sessionControlsDisabled ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  height: 40,
                  justifyContent: 'center',
                  opacity: sessionControlsDisabled ? 0.6 : 1,
                  padding: 0,
                  width: 40,
                }}
              >
                {iconUrl === undefined ? (
                  <span
                    style={{
                      color: '#0f172a',
                      fontFamily: 'monospace',
                      fontSize: 10,
                      fontWeight: 700,
                    }}
                  >
                    {spec.label.slice(0, 2).toUpperCase()}
                  </span>
                ) : (
                  <img
                    alt={`${spec.label} tool`}
                    draggable={false}
                    src={iconUrl}
                    style={{
                      display: 'block',
                      height: 28,
                      imageRendering: 'pixelated',
                      width: 28,
                    }}
                  />
                )}
              </button>
            );
          })}
        </div>
        <DemandHeadsWidget
          demandC={state.hudState.demandC}
          demandI={state.hudState.demandI}
          demandR={state.hudState.demandR}
        />
      </section>

      <section
        style={{
          background: 'rgba(248, 250, 252, 0.94)',
          border: '2px solid rgba(15, 23, 42, 0.72)',
          borderRadius: 3,
          bottom: 12,
          color: '#0f172a',
          left: 12,
          padding: '6px 8px',
          pointerEvents: 'none',
          position: 'absolute',
          width: 'min(260px, calc(100vw - 24px))',
          zIndex: 6,
        }}
      >
        <div style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 700 }}>
          {activeToolSpec.label}: ${activeToolSpec.baseCost}
        </div>
        <div style={{ color: '#475569', fontFamily: 'monospace', fontSize: 11 }}>
          {sessionControlsDisabled
            ? 'Connect and start a city to build.'
            : 'Click map tiles to place tool.'}
        </div>
      </section>

      <aside
        style={{
          backdropFilter: 'blur(6px)',
          background: 'rgba(15, 23, 42, 0.82)',
          border: '1px solid rgba(148, 163, 184, 0.65)',
          borderRadius: 8,
          display: 'grid',
          gap: 12,
          maxHeight: 'calc(100vh - 24px)',
          overflowY: 'auto',
          padding: 10,
          pointerEvents: 'auto',
          position: 'absolute',
          right: 12,
          top: 12,
          width: 'min(360px, calc(100vw - 24px))',
          zIndex: 5,
        }}
      >
        <strong style={{ fontFamily: 'monospace', fontSize: 14 }}>Micropolis</strong>

        <section style={{ display: 'grid', gap: 6 }}>
          <strong style={{ fontFamily: 'monospace', fontSize: 13 }}>HUD</strong>
          <div style={{ fontFamily: 'monospace', fontSize: 12 }}>
            <div>{state.hudState.fundsLabel}</div>
            <div>{state.hudState.dateDisplayLabel}</div>
            <div>{state.hudState.speedLabel}</div>
          </div>
          <strong style={{ fontFamily: 'monospace', fontSize: 12 }}>Message Feed</strong>
          <MessageFeed messages={state.hudState.messages} />
        </section>

        <section style={{ display: 'grid', gap: 6 }}>
          <strong style={{ fontFamily: 'monospace', fontSize: 13 }}>Simulation</strong>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <button
              disabled={sessionControlsDisabled}
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
              disabled={sessionControlsDisabled}
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
                disabled={sessionControlsDisabled}
                onClick={() => {
                  runtime.sendCommand(nextCommandId(commandCounter, 'sim'), {
                    kind: 'sim-control',
                    control: 'set-speed',
                    speed: speed as PlayableSimSpeed,
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
                setHasStartedPlayableSession(true);
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
              disabled={sessionControlsDisabled}
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
                setHasStartedPlayableSession(true);
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
              {PLAYABLE_SCENARIO_CHOICES.map((scenario) => (
                <option key={scenario.id} value={scenario.id}>
                  {scenario.id}. {scenario.name} ({scenario.startYear})
                </option>
              ))}
            </select>
            <button
              disabled={controlsDisabled}
              onClick={() => {
                setHasStartedPlayableSession(true);
                const scenario = PLAYABLE_SCENARIO_CHOICES.find(
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
          <strong style={{ fontFamily: 'monospace', fontSize: 13 }}>Disasters</strong>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {PLAYABLE_DISASTER_CHOICES.map((choice) => (
              <button
                key={choice.id}
                disabled={sessionControlsDisabled}
                onClick={() => {
                  setDisasterStatus(triggerRouteDisasterControl(host, choice.id, choice.label));
                }}
                type="button"
              >
                {choice.label.replace('Trigger ', '')}
              </button>
            ))}
          </div>
          <div style={{ color: '#5eead4', fontFamily: 'monospace', fontSize: 12, minHeight: 16 }}>
            {disasterStatus}
          </div>
        </section>

        <section style={{ display: 'grid', gap: 6 }}>
          <strong style={{ fontFamily: 'monospace', fontSize: 13 }}>Runtime</strong>
          <div style={{ fontFamily: 'monospace', fontSize: 12 }}>
            phase={state.phase} seq={state.lastAppliedServerSeq} tick={state.lastAppliedTick}
          </div>
          {state.lastRejectReason === null ? null : (
            <div style={{ color: '#fca5a5', fontFamily: 'monospace', fontSize: 12 }}>
              {`last reject: ${state.lastRejectReason}`}
            </div>
          )}
          {cityIoError === '' ? null : (
            <div style={{ color: '#fca5a5', fontFamily: 'monospace', fontSize: 12 }}>
              {cityIoError}
            </div>
          )}
          {lastSaveStatus === '' ? null : (
            <div style={{ color: '#5eead4', fontFamily: 'monospace', fontSize: 12 }}>
              {lastSaveStatus}
            </div>
          )}
          <div style={{ fontFamily: 'monospace', fontSize: 12 }}>
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
        </section>
      </aside>
    </section>
  );
}

/**
 * Demand heads widget shown in the Build tool rail.
 * Mirrors demand canvas composition in `ref/micropolis/res/whead.tcl` and
 * bar updates from `UISetDemand` in `ref/micropolis/res/micropolis.tcl`.
 * Parity note: this uses PNG conversions of the original XPM art and CSS
 * absolutely positioned bars instead of Tk canvas primitives.
 */
function DemandHeadsWidget({
  demandR,
  demandC,
  demandI,
}: {
  demandR: number;
  demandC: number;
  demandI: number;
}) {
  const scaledWidth = 39 * 2;
  const scaledHeight = 55 * 2;
  const demandBars = [
    { channel: 'r', demand: demandR, left: 8, fillColor: '#1b8f3a' },
    { channel: 'c', demand: demandC, left: 17, fillColor: '#1b2fe0' },
    { channel: 'i', demand: demandI, left: 26, fillColor: '#ff7a1a' },
  ] as const;

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        width: '100%',
      }}
      title={`Demand R/C/I: ${demandR}/${demandC}/${demandI}`}
    >
      <div
        aria-label={`Demand heads R ${demandR}, C ${demandC}, I ${demandI}`}
        role="img"
        style={{
          height: scaledHeight,
          position: 'relative',
          width: scaledWidth,
        }}
      >
        <div
          style={{
            height: 55,
            left: 0,
            position: 'absolute',
            top: 0,
            transform: 'scale(2)',
            transformOrigin: 'top left',
            width: 39,
          }}
        >
          <img
            alt=""
            aria-hidden
            draggable={false}
            src={demandGaugeBackgroundUrl}
            style={{
              display: 'block',
              height: 47,
              imageRendering: 'pixelated',
              left: 0,
              pointerEvents: 'none',
              position: 'absolute',
              top: 4,
              width: 39,
            }}
          />
          {demandBars.map((bar) => (
            <div
              key={bar.channel}
              style={resolveDemandBarStyle({
                demand: bar.demand,
                fillColor: bar.fillColor,
                left: bar.left,
              })}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Micropolis paused/running indicator shown above the Build tool palette.
 * Mirrors `UIUpdateRunning` bitmap switching in `ref/micropolis/res/micropolis.tcl`.
 * Parity note: this uses exported PNG assets instead of Tk bitmap paths.
 */
function MicropolisStatusSprite({ isRunning }: { isRunning: boolean }) {
  const spriteUrl = isRunning ? micropolisRunningIndicatorUrl : micropolisPausedIndicatorUrl;
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        width: '100%',
      }}
      title={isRunning ? 'Simulation running' : 'Simulation paused'}
    >
      <img
        alt=""
        aria-hidden
        draggable={false}
        src={spriteUrl}
        style={{
          display: 'block',
          height: 47 * 2,
          imageRendering: 'pixelated',
          width: 37 * 2,
        }}
      />
    </div>
  );
}

/**
 * Computes one vertical demand-bar segment style.
 * Mirrors the Tcl `UISetDemand` branch and coordinate math in
 * `ref/micropolis/res/micropolis.tcl` (1:1 baseline and endpoint behavior).
 */
function resolveDemandBarStyle({
  demand,
  left,
  fillColor,
}: {
  demand: number;
  left: number;
  fillColor: string;
}): CSSProperties {
  const clampedDemand = Math.max(-15, Math.min(15, Math.trunc(demand)));
  const baseline = clampedDemand <= 0 ? 32 : 24;
  const endpoint = baseline - clampedDemand;
  const top = Math.min(baseline, endpoint);
  const bottom = Math.max(baseline, endpoint);
  return {
    background: fillColor,
    height: Math.max(1, bottom - top),
    left,
    pointerEvents: 'none',
    position: 'absolute',
    top,
    width: 7,
  };
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
 * Runtime phase status text shown above Authoritative Runtime reconnect/resync controls.
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
 * Authoritative Runtime message feed view.
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
        background: 'rgba(15, 23, 42, 0.78)',
        border: '1px solid rgba(148, 163, 184, 0.55)',
        borderRadius: 4,
        color: '#e2e8f0',
        fontFamily: 'monospace',
        fontSize: 12,
        maxHeight: 180,
        overflowY: 'auto',
        padding: 8,
      }}
    >
      {[...messages].reverse().map((message) => {
        const coordinateSuffix =
          message.dispatch === 'sendMesAt' && message.x !== null && message.y !== null
            ? ` @ (${message.x}, ${message.y})`
            : '';
        return (
          <div
            key={`${message.serverSeq}:${message.id}:${message.tick}:${message.x ?? 'na'}:${message.y ?? 'na'}`}
            style={{ marginBottom: 4 }}
          >
            <span style={{ color: '#93c5fd' }}>[{message.serverSeq}]</span> {message.text}
            {coordinateSuffix}
          </div>
        );
      })}
    </div>
  );
}
