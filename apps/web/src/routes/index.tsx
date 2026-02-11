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
type TopMenubarSection = 'game' | 'disasters' | 'runtime';
type GameDialogKind = 'save' | 'load' | 'scenario';

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
  const [_disasterStatus, setDisasterStatus] = useState<string>('');
  const [openMenubarSection, setOpenMenubarSection] = useState<TopMenubarSection | null>(null);
  const [gameDialog, setGameDialog] = useState<GameDialogKind | null>(null);
  const [saveFileNameDraft, setSaveFileNameDraft] = useState('newcity.cty');
  const [pendingLoadFile, setPendingLoadFile] = useState<File | null>(null);
  const [isLoadingCityFile, setIsLoadingCityFile] = useState(false);
  const [mapCameraControlsContainer, setMapCameraControlsContainer] =
    useState<HTMLDivElement | null>(null);
  const menubarRef = useRef<HTMLElement | null>(null);
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

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (openMenubarSection === null) {
        return;
      }
      const menuRoot = menubarRef.current;
      if (menuRoot === null) {
        return;
      }
      if (event.target instanceof Node && menuRoot.contains(event.target)) {
        return;
      }
      setOpenMenubarSection(null);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return;
      }
      setOpenMenubarSection(null);
      setGameDialog(null);
    };

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [openMenubarSection]);

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
  const isSimulationRunning = state.hudState.speed > 0;
  const runtimePhaseStatus = formatRuntimePhaseStatus(state.phase);
  const topStatusLine = `${runtimePhaseStatus} phase=${state.phase} seq=${state.lastAppliedServerSeq} tick=${state.lastAppliedTick}`;

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
          cameraControlsContainer={mapCameraControlsContainer}
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

      <header
        ref={menubarRef}
        style={{
          alignItems: 'center',
          background: 'rgba(226, 232, 240, 0.96)',
          borderBottom: '1px solid rgba(15, 23, 42, 0.55)',
          display: 'flex',
          flexWrap: 'wrap',
          gap: 8,
          left: 0,
          minHeight: 34,
          padding: '4px 8px',
          pointerEvents: 'auto',
          position: 'absolute',
          right: 0,
          top: 0,
          zIndex: 10,
        }}
      >
        <div
          style={{
            alignItems: 'center',
            color: '#0f172a',
            display: 'flex',
            fontFamily: 'monospace',
            fontSize: 12,
            fontWeight: 700,
            gap: 6,
            minWidth: 86,
          }}
        >
          <span>Micropolis</span>
        </div>
        <div style={{ alignItems: 'center', display: 'flex', gap: 2 }}>
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => {
                setOpenMenubarSection((current) => (current === 'game' ? null : 'game'));
              }}
              style={{
                background: openMenubarSection === 'game' ? '#bfdbfe' : 'transparent',
                border: '1px solid rgba(15, 23, 42, 0.35)',
                borderRadius: 3,
                color: '#0f172a',
                fontFamily: 'monospace',
                fontSize: 12,
                minWidth: 72,
                padding: '4px 8px',
                textAlign: 'left',
              }}
              type="button"
            >
              Game
            </button>
            {openMenubarSection !== 'game' ? null : (
              <section
                style={{
                  background: '#f8fafc',
                  border: '1px solid rgba(15, 23, 42, 0.55)',
                  borderRadius: 4,
                  boxShadow: '0 8px 20px rgba(15, 23, 42, 0.25)',
                  color: '#0f172a',
                  display: 'grid',
                  gap: 2,
                  left: 0,
                  minWidth: 204,
                  padding: 6,
                  position: 'absolute',
                  top: 'calc(100% + 3px)',
                  zIndex: 12,
                }}
              >
                <button
                  disabled={controlsDisabled}
                  onClick={() => {
                    setHasStartedPlayableSession(true);
                    setSaveFileName('newcity.cty');
                    runtime.sendCommand(nextCommandId(commandCounter, 'city'), {
                      kind: 'city-lifecycle',
                      action: 'new-city',
                    });
                    setOpenMenubarSection(null);
                  }}
                  style={{ textAlign: 'left' }}
                  type="button"
                >
                  New
                </button>
                <button
                  disabled={sessionControlsDisabled}
                  onClick={() => {
                    setSaveFileNameDraft(saveFileName);
                    setGameDialog('save');
                    setOpenMenubarSection(null);
                  }}
                  style={{ textAlign: 'left' }}
                  type="button"
                >
                  Save...
                </button>
                <button
                  disabled={controlsDisabled}
                  onClick={() => {
                    setPendingLoadFile(null);
                    setGameDialog('load');
                    setOpenMenubarSection(null);
                  }}
                  style={{ textAlign: 'left' }}
                  type="button"
                >
                  Load...
                </button>
                <button
                  disabled={controlsDisabled}
                  onClick={() => {
                    setGameDialog('scenario');
                    setOpenMenubarSection(null);
                  }}
                  style={{ textAlign: 'left' }}
                  type="button"
                >
                  Scenario...
                </button>
              </section>
            )}
          </div>
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => {
                setOpenMenubarSection((current) => (current === 'disasters' ? null : 'disasters'));
              }}
              style={{
                background: openMenubarSection === 'disasters' ? '#bfdbfe' : 'transparent',
                border: '1px solid rgba(15, 23, 42, 0.35)',
                borderRadius: 3,
                color: '#0f172a',
                fontFamily: 'monospace',
                fontSize: 12,
                minWidth: 84,
                padding: '4px 8px',
                textAlign: 'left',
              }}
              type="button"
            >
              Disasters
            </button>
            {openMenubarSection !== 'disasters' ? null : (
              <section
                style={{
                  background: '#f8fafc',
                  border: '1px solid rgba(15, 23, 42, 0.55)',
                  borderRadius: 4,
                  boxShadow: '0 8px 20px rgba(15, 23, 42, 0.25)',
                  color: '#0f172a',
                  display: 'grid',
                  gap: 4,
                  left: 0,
                  minWidth: 204,
                  padding: 6,
                  position: 'absolute',
                  top: 'calc(100% + 3px)',
                  zIndex: 12,
                }}
              >
                {PLAYABLE_DISASTER_CHOICES.map((choice) => (
                  <button
                    key={choice.id}
                    disabled={sessionControlsDisabled}
                    onClick={() => {
                      setDisasterStatus(triggerRouteDisasterControl(host, choice.id, choice.label));
                      setOpenMenubarSection(null);
                    }}
                    style={{ textAlign: 'left' }}
                    type="button"
                  >
                    {choice.label.replace('Trigger ', '')}
                  </button>
                ))}
              </section>
            )}
          </div>
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => {
                setOpenMenubarSection((current) => (current === 'runtime' ? null : 'runtime'));
              }}
              style={{
                background: openMenubarSection === 'runtime' ? '#bfdbfe' : 'transparent',
                border: '1px solid rgba(15, 23, 42, 0.35)',
                borderRadius: 3,
                color: '#0f172a',
                fontFamily: 'monospace',
                fontSize: 12,
                minWidth: 80,
                padding: '4px 8px',
                textAlign: 'left',
              }}
              type="button"
            >
              Runtime
            </button>
            {openMenubarSection !== 'runtime' ? null : (
              <section
                style={{
                  background: '#f8fafc',
                  border: '1px solid rgba(15, 23, 42, 0.55)',
                  borderRadius: 4,
                  boxShadow: '0 8px 20px rgba(15, 23, 42, 0.25)',
                  color: '#0f172a',
                  display: 'grid',
                  gap: 6,
                  left: 0,
                  minWidth: 290,
                  padding: 8,
                  position: 'absolute',
                  top: 'calc(100% + 3px)',
                  zIndex: 12,
                }}
              >
                <div style={{ fontFamily: 'monospace', fontSize: 12 }}>
                  phase={state.phase} seq={state.lastAppliedServerSeq} tick={state.lastAppliedTick}
                </div>
                <div style={{ fontFamily: 'monospace', fontSize: 12 }}>{runtimePhaseStatus}</div>
                {state.lastRejectReason === null ? null : (
                  <div style={{ color: '#b91c1c', fontFamily: 'monospace', fontSize: 12 }}>
                    {`last reject: ${state.lastRejectReason}`}
                  </div>
                )}
                {cityIoError === '' ? null : (
                  <div style={{ color: '#b91c1c', fontFamily: 'monospace', fontSize: 12 }}>
                    {cityIoError}
                  </div>
                )}
                {lastSaveStatus === '' ? null : (
                  <div style={{ color: '#166534', fontFamily: 'monospace', fontSize: 12 }}>
                    {lastSaveStatus}
                  </div>
                )}
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
            )}
          </div>
        </div>
        <div
          style={{
            alignItems: 'center',
            color: '#334155',
            display: 'flex',
            fontFamily: 'monospace',
            fontSize: 11,
            marginLeft: 'auto',
            minHeight: 24,
          }}
        >
          <span>{topStatusLine}</span>
        </div>
      </header>

      <section
        style={{
          backdropFilter: 'blur(3px)',
          background: 'rgba(107, 114, 128, 0.9)',
          border: '2px solid rgba(15, 23, 42, 0.75)',
          borderRadius: 6,
          display: 'grid',
          gap: 6,
          left: 12,
          maxHeight: 'calc(100vh - 240px)',
          overflowY: 'auto',
          padding: 8,
          pointerEvents: 'auto',
          position: 'absolute',
          top: '50%',
          transform: 'translateY(-50%)',
          width: 170,
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
        <MicropolisStatusSprite isRunning={isSimulationRunning} />
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
                  <span
                    style={{
                      alignItems: 'center',
                      display: 'flex',
                      height: 30,
                      justifyContent: 'center',
                      width: 30,
                    }}
                  >
                    <img
                      alt={`${spec.label} tool`}
                      draggable={false}
                      src={iconUrl}
                      style={{
                        display: 'block',
                        height: '100%',
                        imageRendering: 'pixelated',
                        objectFit: 'contain',
                        width: '100%',
                      }}
                    />
                  </span>
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
        <div
          style={{
            color: '#f8fafc',
            display: 'grid',
            fontFamily: 'monospace',
            fontSize: 11,
            gap: 2,
            textAlign: 'center',
          }}
        >
          <div>{state.hudState.fundsLabel}</div>
          <div>{state.hudState.dateDisplayLabel}</div>
        </div>
        <section style={{ display: 'grid', gap: 4 }}>
          <button
            disabled={sessionControlsDisabled}
            onClick={() => {
              runtime.sendCommand(nextCommandId(commandCounter, 'sim'), {
                kind: 'sim-control',
                control: isSimulationRunning ? 'pause' : 'play',
              });
            }}
            style={{ justifySelf: 'center', width: '68%' }}
            type="button"
          >
            {isSimulationRunning ? 'Pause' : 'Play'}
          </button>
          <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
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
                  padding: '2px 0',
                  width: 26,
                }}
                type="button"
              >
                x{speed}
              </button>
            ))}
          </div>
        </section>
        <section style={{ display: 'grid', gap: 4 }}>
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
            Zoom
          </strong>
          <div ref={setMapCameraControlsContainer} />
        </section>
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

      <section
        style={{
          backdropFilter: 'blur(3px)',
          background: 'rgba(107, 114, 128, 0.9)',
          border: '2px solid rgba(15, 23, 42, 0.75)',
          borderRadius: 6,
          bottom: 12,
          display: 'grid',
          gap: 4,
          left: '50%',
          padding: 8,
          pointerEvents: 'auto',
          position: 'absolute',
          transform: 'translateX(-50%)',
          width: 'min(420px, calc(100vw - 24px))',
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
          Message Feed
        </strong>
        <MessageFeed messages={state.hudState.messages} />
      </section>
      <input
        accept=".cty,application/octet-stream"
        onChange={(event) => {
          const input = event.currentTarget;
          const file = input.files?.[0] ?? null;
          input.value = '';
          setPendingLoadFile(file);
          if (file !== null) {
            setCityIoError('');
          }
        }}
        ref={loadInputRef}
        style={{ display: 'none' }}
        type="file"
      />

      {gameDialog === null ? null : (
        <div
          onClick={() => {
            if (!isLoadingCityFile) {
              setGameDialog(null);
            }
          }}
          style={{
            alignItems: 'center',
            background: 'rgba(15, 23, 42, 0.62)',
            display: 'flex',
            inset: 0,
            justifyContent: 'center',
            pointerEvents: 'auto',
            position: 'absolute',
            zIndex: 15,
          }}
        >
          <section
            onClick={(event) => {
              event.stopPropagation();
            }}
            style={{
              background: '#f8fafc',
              border: '1px solid rgba(15, 23, 42, 0.45)',
              borderRadius: 6,
              color: '#0f172a',
              display: 'grid',
              gap: 10,
              minWidth: 320,
              padding: 12,
              width: 'min(420px, calc(100vw - 24px))',
            }}
          >
            {gameDialog !== 'save' ? null : (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  if (sessionControlsDisabled) {
                    return;
                  }
                  const fileName = normalizeCitySaveFileName(saveFileNameDraft);
                  setSaveFileName(fileName);
                  runtime.sendCommand(nextCommandId(commandCounter, 'city'), {
                    kind: 'city-io',
                    action: 'save-city',
                    fileName,
                  });
                  setGameDialog(null);
                }}
                style={{ display: 'grid', gap: 10 }}
              >
                <strong style={{ fontFamily: 'monospace', fontSize: 14 }}>Save City</strong>
                <label style={{ display: 'grid', gap: 4, fontFamily: 'monospace', fontSize: 12 }}>
                  File name
                  <input
                    autoFocus
                    disabled={sessionControlsDisabled}
                    onChange={(event) => {
                      setSaveFileNameDraft(event.target.value);
                    }}
                    type="text"
                    value={saveFileNameDraft}
                  />
                </label>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button
                    onClick={() => {
                      setGameDialog(null);
                    }}
                    type="button"
                  >
                    Cancel
                  </button>
                  <button disabled={sessionControlsDisabled} type="submit">
                    Save
                  </button>
                </div>
              </form>
            )}

            {gameDialog !== 'load' ? null : (
              <section style={{ display: 'grid', gap: 10 }}>
                <strong style={{ fontFamily: 'monospace', fontSize: 14 }}>Load City</strong>
                <div style={{ color: '#334155', fontFamily: 'monospace', fontSize: 12 }}>
                  {pendingLoadFile === null
                    ? 'No file selected.'
                    : `Selected: ${pendingLoadFile.name}`}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  <button
                    disabled={controlsDisabled || isLoadingCityFile}
                    onClick={() => {
                      loadInputRef.current?.click();
                    }}
                    type="button"
                  >
                    Choose .cty File...
                  </button>
                  <button
                    disabled={controlsDisabled || pendingLoadFile === null || isLoadingCityFile}
                    onClick={async () => {
                      if (pendingLoadFile === null || controlsDisabled) {
                        return;
                      }

                      setIsLoadingCityFile(true);
                      try {
                        const cityBytes = new Uint8Array(await pendingLoadFile.arrayBuffer());
                        setHasStartedPlayableSession(true);
                        setSaveFileName(pendingLoadFile.name);
                        runtime.sendCommand(nextCommandId(commandCounter, 'city'), {
                          kind: 'city-io',
                          action: 'load-city',
                          fileName: pendingLoadFile.name,
                          cityBytes,
                        });
                        setCityIoError('');
                        setPendingLoadFile(null);
                        setGameDialog(null);
                      } catch {
                        setCityIoError('Failed to read selected city file.');
                      } finally {
                        setIsLoadingCityFile(false);
                      }
                    }}
                    type="button"
                  >
                    {isLoadingCityFile ? 'Loading...' : 'Load'}
                  </button>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button
                    disabled={isLoadingCityFile}
                    onClick={() => {
                      setGameDialog(null);
                    }}
                    type="button"
                  >
                    Close
                  </button>
                </div>
              </section>
            )}

            {gameDialog !== 'scenario' ? null : (
              <section style={{ display: 'grid', gap: 10 }}>
                <strong style={{ fontFamily: 'monospace', fontSize: 14 }}>Scenario</strong>
                <select
                  autoFocus
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
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button
                    onClick={() => {
                      setGameDialog(null);
                    }}
                    type="button"
                  >
                    Cancel
                  </button>
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
                      setGameDialog(null);
                    }}
                    type="button"
                  >
                    Start Scenario
                  </button>
                </div>
              </section>
            )}
          </section>
        </div>
      )}
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
 * Normalizes Save dialog file-name input to one classic `.cty` target.
 * Mirrors `SaveCityAs` naming flow in `ref/micropolis/src/sim/s_fileio.c`.
 * Parity note: browser UI keeps user-entered names but appends `.cty`
 * when no extension is provided.
 */
function normalizeCitySaveFileName(fileNameInput: string): string {
  const trimmedName = fileNameInput.trim();
  if (trimmedName === '') {
    return 'newcity.cty';
  }
  if (trimmedName.toLowerCase().endsWith('.cty')) {
    return trimmedName;
  }
  return `${trimmedName}.cty`;
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
  return (
    <div
      style={{
        background: 'rgba(15, 23, 42, 0.32)',
        border: '1px solid rgba(15, 23, 42, 0.58)',
        borderRadius: 4,
        color: '#e2e8f0',
        fontFamily: 'monospace',
        fontSize: 12,
        height: 58,
        overflowY: 'auto',
        padding: '4px 6px',
      }}
    >
      {messages.length === 0 ? (
        <div style={{ color: '#cbd5e1', lineHeight: '16px' }}>No messages yet.</div>
      ) : (
        [...messages].reverse().map((message) => {
          const coordinateSuffix =
            message.dispatch === 'sendMesAt' && message.x !== null && message.y !== null
              ? ` @ (${message.x}, ${message.y})`
              : '';
          return (
            <div
              key={`${message.serverSeq}:${message.id}:${message.tick}:${message.x ?? 'na'}:${message.y ?? 'na'}`}
              style={{
                lineHeight: '16px',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              <span style={{ color: '#bfdbfe' }}>[{message.serverSeq}]</span> {message.text}
              {coordinateSuffix}
            </div>
          );
        })
      )}
    </div>
  );
}
