import { SCENARIO_BUNDLE_V1_MAP_HEIGHT, SCENARIO_BUNDLE_V1_MAP_WIDTH } from '@city/scenario-core';
import { createFileRoute } from '@tanstack/react-router';
import {
  type ChangeEvent,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  getScenarioEditorBehaviorValidationIssue,
  isScenarioEditorBehaviorProfileKey,
  SCENARIO_EDITOR_BEHAVIOR_PROFILE_KEYS,
} from '../state/editor-behavior.ts';
import {
  buildScenarioEditorStrictExport,
  getScenarioEditorExportFileName,
  type ScenarioEditorStrictExportResult,
} from '../state/editor-export.ts';
import {
  parseScenarioEditorBundleImportJson,
  type ScenarioEditorBundleImportIssue,
} from '../state/editor-import.ts';
import {
  getScenarioEditorMapIndex,
  getScenarioEditorMapTileWords,
  normalizeScenarioEditorTileWord,
  readScenarioEditorMapTileWord,
  type ScenarioEditorMapPoint,
} from '../state/editor-map.ts';
import {
  appendScenarioObjectiveChildPredicate,
  coerceScenarioObjectivePredicateKind,
  getScenarioEditorObjectiveValidationIssues,
  removeScenarioObjectiveChildPredicate,
  replaceScenarioObjectiveChildPredicate,
  replaceScenarioObjectiveNotChildPredicate,
  SCENARIO_EDITOR_OBJECTIVE_COMPARISONS,
  SCENARIO_EDITOR_OBJECTIVE_METRIC_KEYS,
  SCENARIO_EDITOR_OBJECTIVE_PREDICATE_KINDS,
  type ScenarioEditorObjectivePredicate,
} from '../state/editor-objective.ts';
import {
  appendScenarioEditorScriptAction,
  appendScenarioEditorScriptEvent,
  coerceScenarioEditorScriptActionKind,
  coerceScenarioEditorScriptTriggerKind,
  getScenarioEditorScriptTriggerKind,
  getScenarioEditorScriptValidationIssues,
  removeScenarioEditorScriptAction,
  removeScenarioEditorScriptEvent,
  replaceScenarioEditorAtTickTrigger,
  replaceScenarioEditorEveryTicksTrigger,
  replaceScenarioEditorScriptAction,
  replaceScenarioEditorScriptEvent,
  replaceScenarioEditorSendMessageId,
  SCENARIO_EDITOR_SCRIPT_ACTION_KINDS,
  SCENARIO_EDITOR_SCRIPT_TRIGGER_KINDS,
  type ScenarioEditorScriptAction,
  type ScenarioEditorScriptEvent,
} from '../state/editor-script.ts';
import {
  getScenarioEditorMetadataValidationIssues,
  parseScenarioEditorTagsInput,
  useScenarioEditorDispatch,
  useScenarioEditorState,
} from '../state/editor-state.tsx';

const TILE_BASE_MASK = 1023;

const EDITOR_TILE_PRESETS = [
  { label: 'DIRT', source: 'DIRT=0', tileWord: 0 },
  { label: 'RIVER', source: 'RIVER=2', tileWord: 2 },
  { label: 'REDGE', source: 'REDGE=3', tileWord: 3 },
] as const;

type ScenarioEditorOpenResult =
  | {
      readonly fileName: string;
      readonly ok: true;
    }
  | {
      readonly fileName: string;
      readonly issues: readonly ScenarioEditorBundleImportIssue[];
      readonly ok: false;
    };

export const Route = createFileRoute('/')({
  component: ScenarioEditorHomeRoute,
});

/**
 * Stage 4 workbench route with metadata/map editing plus objective and script authoring.
 * Parity note: objective metric leaves map to `DoScenarioScore` checks in
 * `ref/micropolis/src/sim/s_msg.c`, while logical composition forms are declarative
 * runtime extensions from `packages/scenario-runtime`; script events map to
 * `ScenarioDisaster` trigger/action domains in `ref/micropolis/src/sim/s_disast.c`; behavior
 * profile assignment maps closed `DoShipSprite` variants from `ref/micropolis/src/sim/w_sprite.c`.
 */
function ScenarioEditorHomeRoute() {
  const { activeView } = useScenarioEditorState();

  if (activeView === 'metadata') {
    return <ScenarioMetadataEditorCard />;
  }
  if (activeView === 'map') {
    return <ScenarioMapEditorCard />;
  }
  if (activeView === 'objective') {
    return <ScenarioObjectiveEditorCard />;
  }
  if (activeView === 'script') {
    return <ScenarioScriptEditorCard />;
  }
  if (activeView === 'behavior') {
    return <ScenarioBehaviorProfileEditorCard />;
  }

  return <ScenarioExportCard />;
}

/**
 * Metadata editing card for scenario bundle fields required by Stage 3.2.
 * Reuses `scenario-core` schema constraints; this has no direct 1:1 C editor equivalent.
 */
function ScenarioMetadataEditorCard() {
  const { bundle, isDirty } = useScenarioEditorState();
  const dispatch = useScenarioEditorDispatch();
  const issues = getScenarioEditorMetadataValidationIssues(bundle);
  const hasIssues =
    issues.key !== undefined ||
    issues.name !== undefined ||
    issues.description !== undefined ||
    issues.tags !== undefined ||
    issues.startYear !== undefined ||
    issues.startFunds !== undefined;

  return (
    <section className="editor-card" aria-label="Scenario metadata editor">
      <h1>Scenario Metadata</h1>
      <p>
        Edit canonical bundle metadata fields for key identity, player-facing labels, and scenario
        start parameters.
      </p>
      <form className="editor-form" onSubmit={preventFormSubmit}>
        <label className="editor-field">
          <span>Scenario Key</span>
          <input
            aria-invalid={issues.key !== undefined}
            onChange={(event) => {
              dispatch({ type: 'update-metadata', metadata: { key: event.currentTarget.value } });
            }}
            type="text"
            value={bundle.key}
          />
          <small className="editor-help">Must use `builtin/*` or `user/*` namespace.</small>
          {issues.key !== undefined ? <small className="editor-error">{issues.key}</small> : null}
        </label>

        <label className="editor-field">
          <span>Name</span>
          <input
            aria-invalid={issues.name !== undefined}
            onChange={(event) => {
              dispatch({ type: 'update-metadata', metadata: { name: event.currentTarget.value } });
            }}
            type="text"
            value={bundle.name}
          />
          {issues.name !== undefined ? <small className="editor-error">{issues.name}</small> : null}
        </label>

        <label className="editor-field">
          <span>Description</span>
          <textarea
            aria-invalid={issues.description !== undefined}
            onChange={(event) => {
              dispatch({
                type: 'update-metadata',
                metadata: { description: event.currentTarget.value },
              });
            }}
            rows={4}
            value={bundle.description}
          />
          {issues.description !== undefined ? (
            <small className="editor-error">{issues.description}</small>
          ) : null}
        </label>

        <label className="editor-field">
          <span>Tags</span>
          <textarea
            aria-invalid={issues.tags !== undefined}
            onChange={(event) => {
              dispatch({
                type: 'update-metadata',
                metadata: { tags: parseScenarioEditorTagsInput(event.currentTarget.value) },
              });
            }}
            placeholder="classic, tutorial"
            rows={3}
            value={bundle.tags.join(', ')}
          />
          <small className="editor-help">Comma or newline separated.</small>
          {issues.tags !== undefined ? <small className="editor-error">{issues.tags}</small> : null}
        </label>

        <div className="editor-field editor-field-inline">
          <label>
            <span>Start Year</span>
            <input
              aria-invalid={issues.startYear !== undefined}
              onChange={(event) => {
                dispatch({
                  type: 'update-metadata',
                  metadata: {
                    start: {
                      startYear: parseIntegerInput(
                        event.currentTarget.value,
                        bundle.start.startYear,
                      ),
                    },
                  },
                });
              }}
              type="number"
              value={bundle.start.startYear}
            />
            {issues.startYear !== undefined ? (
              <small className="editor-error">{issues.startYear}</small>
            ) : null}
          </label>

          <label>
            <span>Start Funds</span>
            <input
              aria-invalid={issues.startFunds !== undefined}
              min={0}
              onChange={(event) => {
                dispatch({
                  type: 'update-metadata',
                  metadata: {
                    start: {
                      startFunds: parseIntegerInput(
                        event.currentTarget.value,
                        bundle.start.startFunds,
                      ),
                    },
                  },
                });
              }}
              type="number"
              value={bundle.start.startFunds}
            />
            {issues.startFunds !== undefined ? (
              <small className="editor-error">{issues.startFunds}</small>
            ) : null}
          </label>
        </div>
      </form>

      <dl className="editor-grid">
        <dt>Dirty State</dt>
        <dd>{isDirty ? 'dirty' : 'clean'}</dd>
        <dt>Validation</dt>
        <dd>{hasIssues ? 'invalid metadata' : 'metadata valid'}</dd>
      </dl>
    </section>
  );
}

/**
 * Manual map-editing card for Stage 3.3 with fixed `120x100` preview and paint controls.
 * Mirrors direct tile assignment/fill behavior from `SimCmdTile`/`SimCmdFill` in
 * `ref/micropolis/src/sim/w_sim.c`; preview colors are editor-only visualization.
 */
function ScenarioMapEditorCard() {
  const { bundle, isDirty } = useScenarioEditorState();
  const dispatch = useScenarioEditorDispatch();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isPaintingRef = useRef(false);
  const lastPaintedIndexRef = useRef<number | null>(null);
  const [activeTileWord, setActiveTileWord] = useState<number>(0);
  const [hoveredPoint, setHoveredPoint] = useState<ScenarioEditorMapPoint | null>(null);
  const tileWords = useMemo(() => getScenarioEditorMapTileWords(bundle), [bundle]);
  const hoveredTileWord =
    hoveredPoint === null ? null : readScenarioEditorMapTileWord(bundle, hoveredPoint);

  useEffect(() => {
    drawScenarioEditorPreview(canvasRef.current, tileWords);
  }, [tileWords]);

  const handlePointerPaint = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const point = getScenarioEditorPointerTile(event.currentTarget, event.clientX, event.clientY);
    setHoveredPoint(point);
    if (point === null) {
      return;
    }

    const index = getScenarioEditorMapIndex(point);
    if (index === null || lastPaintedIndexRef.current === index) {
      return;
    }

    dispatch({
      type: 'paint-map-tile',
      x: point.x,
      y: point.y,
      tileWord: activeTileWord,
    });
    lastPaintedIndexRef.current = index;
  };

  return (
    <section className="editor-card editor-map-card" aria-label="Scenario map editor">
      <h1>Scenario Map</h1>
      <p>
        Paint map words directly on the fixed `120x100` world (`WORLD_X=120`, `WORLD_Y=100`) used by
        classic Micropolis scenario/city files.
      </p>

      <div className="editor-map-controls">
        <label className="editor-field">
          <span>Active Tile Word</span>
          <input
            max={65535}
            min={0}
            onChange={(event) => {
              setActiveTileWord(normalizeScenarioEditorTileWord(Number(event.currentTarget.value)));
            }}
            type="number"
            value={activeTileWord}
          />
          <small className="editor-help">Stored as unsigned 16-bit map words.</small>
        </label>

        <div className="editor-map-preset-row">
          {EDITOR_TILE_PRESETS.map((preset) => (
            <button
              key={preset.label}
              onClick={() => {
                setActiveTileWord(preset.tileWord);
              }}
              type="button"
            >
              {preset.label} ({preset.source})
            </button>
          ))}
        </div>

        <button
          className="editor-map-fill-button"
          onClick={() => {
            dispatch({ type: 'fill-map', tileWord: activeTileWord });
          }}
          type="button"
        >
          Fill Entire Map
        </button>
      </div>

      <div className="editor-map-preview-shell">
        <canvas
          aria-label="Scenario map preview canvas"
          className="editor-map-preview"
          height={SCENARIO_BUNDLE_V1_MAP_HEIGHT}
          onPointerCancel={(event) => {
            isPaintingRef.current = false;
            lastPaintedIndexRef.current = null;
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId);
            }
          }}
          onPointerDown={(event) => {
            event.preventDefault();
            isPaintingRef.current = true;
            lastPaintedIndexRef.current = null;
            event.currentTarget.setPointerCapture(event.pointerId);
            handlePointerPaint(event);
          }}
          onPointerLeave={() => {
            setHoveredPoint(null);
            if (!isPaintingRef.current) {
              lastPaintedIndexRef.current = null;
            }
          }}
          onPointerMove={(event) => {
            if (!isPaintingRef.current) {
              setHoveredPoint(
                getScenarioEditorPointerTile(event.currentTarget, event.clientX, event.clientY),
              );
              return;
            }
            handlePointerPaint(event);
          }}
          onPointerUp={(event) => {
            isPaintingRef.current = false;
            lastPaintedIndexRef.current = null;
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId);
            }
          }}
          ref={canvasRef}
          width={SCENARIO_BUNDLE_V1_MAP_WIDTH}
        />
      </div>

      <dl className="editor-grid">
        <dt>Map Size</dt>
        <dd>
          {SCENARIO_BUNDLE_V1_MAP_WIDTH} x {SCENARIO_BUNDLE_V1_MAP_HEIGHT}
        </dd>
        <dt>Tile Count</dt>
        <dd>{tileWords.length}</dd>
        <dt>Hover</dt>
        <dd>
          {hoveredPoint === null || hoveredTileWord === null
            ? 'outside map'
            : `x=${hoveredPoint.x}, y=${hoveredPoint.y}, tileWord=${hoveredTileWord}`}
        </dd>
        <dt>Dirty State</dt>
        <dd>{isDirty ? 'dirty' : 'clean'}</dd>
      </dl>
    </section>
  );
}

/**
 * Objective authoring card for Stage 4.1 predicate DSL editing.
 * Parity note: metric leaves mirror `DoScenarioScore` checks in
 * `ref/micropolis/src/sim/s_msg.c`; logical nodes (`all`/`any`/`not`) are
 * declarative extensions supported by `packages/scenario-runtime`.
 */
function ScenarioObjectiveEditorCard() {
  const { objective, isDirty } = useScenarioEditorState();
  const dispatch = useScenarioEditorDispatch();
  const validationIssues = useMemo(
    () => getScenarioEditorObjectiveValidationIssues(objective),
    [objective],
  );
  const objectiveJson = useMemo(
    () => JSON.stringify(objective.enabled ? objective.predicate : null, null, 2),
    [objective.enabled, objective.predicate],
  );

  return (
    <section className="editor-card editor-objective-card" aria-label="Scenario objective editor">
      <h1>Scenario Objective</h1>
      <p>
        Author objective predicates using the Stage 4 DSL. Metric comparisons track classic
        `DoScenarioScore` fields, while `all`/`any`/`not` allow composed checks.
      </p>

      <label className="editor-field editor-objective-toggle">
        <span>Objective Enabled</span>
        <input
          checked={objective.enabled}
          onChange={(event) => {
            dispatch({ type: 'set-objective-enabled', enabled: event.currentTarget.checked });
          }}
          type="checkbox"
        />
        <small className="editor-help">
          This Stage 4.1 draft editor captures predicate authoring only; export integration lands in
          Stage 4.5.
        </small>
      </label>

      {objective.enabled ? (
        <ScenarioObjectivePredicateEditor
          depth={0}
          onChange={(predicate) => {
            dispatch({ type: 'replace-objective-predicate', predicate });
          }}
          predicate={objective.predicate}
        />
      ) : (
        <p className="editor-help">Objective checks are disabled for this draft.</p>
      )}

      <dl className="editor-grid">
        <dt>Dirty State</dt>
        <dd>{isDirty ? 'dirty' : 'clean'}</dd>
        <dt>Objective Enabled</dt>
        <dd>{objective.enabled ? 'yes' : 'no'}</dd>
        <dt>Root Predicate</dt>
        <dd>{objective.enabled ? objective.predicate.kind : 'none'}</dd>
        <dt>Validation</dt>
        <dd>
          {!objective.enabled
            ? 'disabled'
            : validationIssues.length === 0
              ? 'valid'
              : `invalid (${validationIssues.length} issue${
                  validationIssues.length === 1 ? '' : 's'
                })`}
        </dd>
      </dl>

      {objective.enabled && validationIssues.length > 0 ? (
        <section aria-label="Objective semantic issues" className="editor-export-issues">
          <h2>Objective Semantic Issues</h2>
          <ul>
            {validationIssues.map((issue, index) => (
              <li key={`${issue.path}:${issue.message}:${index}`}>
                <code>{issue.path}</code>: {issue.message}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="editor-export-preview" aria-label="Objective predicate preview">
        <h2>Objective Predicate JSON</h2>
        <textarea readOnly rows={10} value={objectiveJson} />
      </section>
    </section>
  );
}

/**
 * Recursive node editor for one objective predicate subtree.
 * Not from Micropolis C: this is React authoring UI over runtime predicate data.
 */
function ScenarioObjectivePredicateEditor(options: {
  depth: number;
  onChange: (predicate: ScenarioEditorObjectivePredicate) => void;
  predicate: ScenarioEditorObjectivePredicate;
}) {
  const { depth, onChange, predicate } = options;
  const nodeLabel = `Predicate depth ${depth}`;

  return (
    <fieldset className="editor-objective-node">
      <legend>{nodeLabel}</legend>
      <label className="editor-field">
        <span>Kind</span>
        <select
          onChange={(event) => {
            onChange(
              coerceScenarioObjectivePredicateKind(
                predicate,
                event.currentTarget.value as ScenarioEditorObjectivePredicate['kind'],
              ),
            );
          }}
          value={predicate.kind}
        >
          {SCENARIO_EDITOR_OBJECTIVE_PREDICATE_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {getScenarioObjectivePredicateKindLabel(kind)}
            </option>
          ))}
        </select>
      </label>

      {predicate.kind === 'metric' ? (
        <div className="editor-objective-metric-grid">
          <label className="editor-field">
            <span>Metric</span>
            <select
              onChange={(event) => {
                onChange({
                  ...predicate,
                  metric: event.currentTarget
                    .value as (typeof SCENARIO_EDITOR_OBJECTIVE_METRIC_KEYS)[number],
                });
              }}
              value={predicate.metric}
            >
              {SCENARIO_EDITOR_OBJECTIVE_METRIC_KEYS.map((metric) => (
                <option key={metric} value={metric}>
                  {getScenarioObjectiveMetricLabel(metric)}
                </option>
              ))}
            </select>
          </label>

          <label className="editor-field">
            <span>Operator</span>
            <select
              onChange={(event) => {
                onChange({
                  ...predicate,
                  op: event.currentTarget
                    .value as (typeof SCENARIO_EDITOR_OBJECTIVE_COMPARISONS)[number],
                });
              }}
              value={predicate.op}
            >
              {SCENARIO_EDITOR_OBJECTIVE_COMPARISONS.map((comparison) => (
                <option key={comparison} value={comparison}>
                  {getScenarioObjectiveComparisonLabel(comparison)}
                </option>
              ))}
            </select>
          </label>

          <label className="editor-field">
            <span>Value</span>
            <input
              onChange={(event) => {
                onChange({
                  ...predicate,
                  value: parseIntegerInput(event.currentTarget.value, predicate.value),
                });
              }}
              type="number"
              value={predicate.value}
            />
          </label>
        </div>
      ) : null}

      {predicate.kind === 'all' || predicate.kind === 'any' ? (
        <div className="editor-objective-children">
          {predicate.predicates.map((childPredicate, index) => (
            <div className="editor-objective-child-row" key={index}>
              <ScenarioObjectivePredicateEditor
                depth={depth + 1}
                onChange={(child) => {
                  onChange(replaceScenarioObjectiveChildPredicate(predicate, index, child));
                }}
                predicate={childPredicate}
              />
              <button
                className="editor-objective-remove"
                onClick={() => {
                  onChange(removeScenarioObjectiveChildPredicate(predicate, index));
                }}
                type="button"
              >
                Remove Child
              </button>
            </div>
          ))}
          <button
            className="editor-objective-add"
            onClick={() => {
              onChange(appendScenarioObjectiveChildPredicate(predicate));
            }}
            type="button"
          >
            Add Child Predicate
          </button>
        </div>
      ) : null}

      {predicate.kind === 'not' ? (
        <div className="editor-objective-children">
          <ScenarioObjectivePredicateEditor
            depth={depth + 1}
            onChange={(child) => {
              onChange(replaceScenarioObjectiveNotChildPredicate(predicate, child));
            }}
            predicate={predicate.predicate}
          />
        </div>
      ) : null}
    </fieldset>
  );
}

/**
 * Event/action authoring card for Stage 4.2 declarative script editing.
 * Parity note: trigger patterns (`atTick`, `everyTicks`) mirror `ScenarioDisaster`
 * timing checks in `ref/micropolis/src/sim/s_disast.c`, while this React form is
 * editor-only UI over `scenario-runtime` action unions.
 */
function ScenarioScriptEditorCard() {
  const { script, isDirty } = useScenarioEditorState();
  const dispatch = useScenarioEditorDispatch();
  const validationIssues = useMemo(() => getScenarioEditorScriptValidationIssues(script), [script]);
  const scriptJson = useMemo(
    () => JSON.stringify(script.enabled ? script.events : [], null, 2),
    [script.enabled, script.events],
  );

  const replaceEvents = (events: readonly ScenarioEditorScriptEvent[]) => {
    dispatch({ type: 'replace-script-events', events });
  };

  return (
    <section className="editor-card editor-script-card" aria-label="Scenario script editor">
      <h1>Scenario Scripts</h1>
      <p>
        Author declarative event scripts with one-shot (`atTick`) and interval (`everyTicks`)
        triggers plus runtime action unions for disasters/messages.
      </p>

      <label className="editor-field editor-script-toggle">
        <span>Scripts Enabled</span>
        <input
          checked={script.enabled}
          onChange={(event) => {
            dispatch({ type: 'set-script-enabled', enabled: event.currentTarget.checked });
          }}
          type="checkbox"
        />
        <small className="editor-help">
          This Stage 4.2 draft editor captures event/action authoring only; export integration lands
          in Stage 4.5.
        </small>
      </label>

      {script.enabled ? (
        <div className="editor-script-events">
          {script.events.map((event, eventIndex) => (
            <ScenarioScriptEventEditor
              event={event}
              index={eventIndex}
              key={eventIndex}
              onChange={(nextEvent) => {
                replaceEvents(
                  replaceScenarioEditorScriptEvent(script.events, eventIndex, nextEvent),
                );
              }}
              onRemove={() => {
                replaceEvents(removeScenarioEditorScriptEvent(script.events, eventIndex));
              }}
            />
          ))}
          <button
            className="editor-script-add"
            onClick={() => {
              replaceEvents(appendScenarioEditorScriptEvent(script.events));
            }}
            type="button"
          >
            Add Script Event
          </button>
        </div>
      ) : (
        <p className="editor-help">Scripted event actions are disabled for this draft.</p>
      )}

      <dl className="editor-grid">
        <dt>Dirty State</dt>
        <dd>{isDirty ? 'dirty' : 'clean'}</dd>
        <dt>Scripts Enabled</dt>
        <dd>{script.enabled ? 'yes' : 'no'}</dd>
        <dt>Event Rows</dt>
        <dd>{script.events.length}</dd>
        <dt>Validation</dt>
        <dd>
          {!script.enabled
            ? 'disabled'
            : validationIssues.length === 0
              ? 'valid'
              : `invalid (${validationIssues.length} issue${
                  validationIssues.length === 1 ? '' : 's'
                })`}
        </dd>
      </dl>

      {script.enabled && validationIssues.length > 0 ? (
        <section aria-label="Script semantic issues" className="editor-export-issues">
          <h2>Script Semantic Issues</h2>
          <ul>
            {validationIssues.map((issue, index) => (
              <li key={`${issue.path}:${issue.message}:${index}`}>
                <code>{issue.path}</code>: {issue.message}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="editor-export-preview" aria-label="Script event preview">
        <h2>Script Event JSON</h2>
        <textarea readOnly rows={12} value={scriptJson} />
      </section>
    </section>
  );
}

/**
 * One event row editor for Stage 4.2 script authoring.
 * Not from Micropolis C: this is React form wiring around declarative runtime event drafts.
 */
function ScenarioScriptEventEditor(options: {
  event: ScenarioEditorScriptEvent;
  index: number;
  onChange: (event: ScenarioEditorScriptEvent) => void;
  onRemove: () => void;
}) {
  const { event, index, onChange, onRemove } = options;
  const triggerKind = getScenarioEditorScriptTriggerKind(event.trigger);

  return (
    <fieldset className="editor-script-event">
      <legend>{`Event ${index + 1}`}</legend>
      <div className="editor-script-event-grid">
        <label className="editor-field">
          <span>Trigger</span>
          <select
            onChange={(changeEvent) => {
              onChange(
                coerceScenarioEditorScriptTriggerKind(
                  event,
                  changeEvent.currentTarget
                    .value as (typeof SCENARIO_EDITOR_SCRIPT_TRIGGER_KINDS)[number],
                ),
              );
            }}
            value={triggerKind}
          >
            {SCENARIO_EDITOR_SCRIPT_TRIGGER_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {getScenarioScriptTriggerKindLabel(kind)}
              </option>
            ))}
          </select>
        </label>

        {triggerKind === 'atTick' ? (
          <label className="editor-field">
            <span>atTick</span>
            <input
              min={0}
              onChange={(changeEvent) => {
                onChange(
                  replaceScenarioEditorAtTickTrigger(
                    event,
                    parseIntegerInput(
                      changeEvent.currentTarget.value,
                      'atTick' in event.trigger ? event.trigger.atTick : 0,
                    ),
                  ),
                );
              }}
              type="number"
              value={'atTick' in event.trigger ? event.trigger.atTick : 0}
            />
          </label>
        ) : (
          <label className="editor-field">
            <span>everyTicks</span>
            <input
              min={1}
              onChange={(changeEvent) => {
                onChange(
                  replaceScenarioEditorEveryTicksTrigger(
                    event,
                    parseIntegerInput(
                      changeEvent.currentTarget.value,
                      'everyTicks' in event.trigger ? event.trigger.everyTicks : 1,
                    ),
                  ),
                );
              }}
              type="number"
              value={'everyTicks' in event.trigger ? event.trigger.everyTicks : 1}
            />
          </label>
        )}
      </div>

      <div className="editor-script-actions">
        <h3>Actions</h3>
        {event.actions.map((action, actionIndex) => (
          <div className="editor-script-action-row" key={`${index}:${actionIndex}`}>
            <label className="editor-field">
              <span>Action</span>
              <select
                onChange={(changeEvent) => {
                  onChange(
                    replaceScenarioEditorScriptAction(
                      event,
                      actionIndex,
                      coerceScenarioEditorScriptActionKind(
                        action,
                        changeEvent.currentTarget.value as ScenarioEditorScriptAction['kind'],
                      ),
                    ),
                  );
                }}
                value={action.kind}
              >
                {SCENARIO_EDITOR_SCRIPT_ACTION_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {getScenarioScriptActionKindLabel(kind)}
                  </option>
                ))}
              </select>
            </label>

            {action.kind === 'send-message' ? (
              <label className="editor-field">
                <span>messageId</span>
                <input
                  onChange={(changeEvent) => {
                    onChange(
                      replaceScenarioEditorScriptAction(
                        event,
                        actionIndex,
                        replaceScenarioEditorSendMessageId(
                          action,
                          parseIntegerInput(changeEvent.currentTarget.value, action.messageId),
                        ),
                      ),
                    );
                  }}
                  type="number"
                  value={action.messageId}
                />
              </label>
            ) : null}

            <button
              className="editor-script-remove"
              onClick={() => {
                onChange(removeScenarioEditorScriptAction(event, actionIndex));
              }}
              type="button"
            >
              Remove Action
            </button>
          </div>
        ))}
        <button
          className="editor-script-add"
          onClick={() => {
            onChange(appendScenarioEditorScriptAction(event));
          }}
          type="button"
        >
          Add Action
        </button>
      </div>

      <button className="editor-script-remove" onClick={onRemove} type="button">
        Remove Event
      </button>
    </fieldset>
  );
}

/**
 * Behavior-profile assignment card for Stage 4.3 closed-profile authoring.
 * Parity note: profile keys map to closed `ScenarioID` behavior variants in `DoShipSprite`
 * (`ref/micropolis/src/sim/w_sprite.c`), with declarative selection via
 * `packages/scenario-runtime/src/behavior-profiles.ts`.
 */
function ScenarioBehaviorProfileEditorCard() {
  const { behavior, isDirty } = useScenarioEditorState();
  const dispatch = useScenarioEditorDispatch();
  const validationIssue = getScenarioEditorBehaviorValidationIssue(behavior);
  const normalizedProfileKey = behavior.profileKey.trim();
  const hasClosedProfileKey = isScenarioEditorBehaviorProfileKey(normalizedProfileKey);
  const selectedProfileKey = hasClosedProfileKey ? normalizedProfileKey : behavior.profileKey;
  const behaviorJson = useMemo(
    () =>
      JSON.stringify(
        behavior.enabled ? { behaviorProfileKey: behavior.profileKey } : null,
        null,
        2,
      ),
    [behavior.enabled, behavior.profileKey],
  );

  return (
    <section
      className="editor-card editor-behavior-card"
      aria-label="Scenario behavior profile editor"
    >
      <h1>Scenario Behavior Profile</h1>
      <p>
        Assign one closed runtime behavior profile key. This preserves deterministic parity by
        allowing only registered profile variants.
      </p>

      <label className="editor-field editor-behavior-toggle">
        <span>Behavior Profile Assignment Enabled</span>
        <input
          checked={behavior.enabled}
          onChange={(event) => {
            dispatch({ type: 'set-behavior-enabled', enabled: event.currentTarget.checked });
          }}
          type="checkbox"
        />
        <small className="editor-help">
          This Stage 4.3 draft editor captures profile assignment only; export integration lands in
          Stage 4.5.
        </small>
      </label>

      {behavior.enabled ? (
        <label className="editor-field">
          <span>Behavior Profile Key</span>
          <select
            aria-invalid={validationIssue !== undefined}
            onChange={(event) => {
              dispatch({
                type: 'set-behavior-profile-key',
                profileKey: event.currentTarget.value,
              });
            }}
            value={selectedProfileKey}
          >
            {hasClosedProfileKey ? null : (
              <option value={selectedProfileKey}>
                {`Unrecognized key: ${behavior.profileKey || '(empty)'}`}
              </option>
            )}
            {SCENARIO_EDITOR_BEHAVIOR_PROFILE_KEYS.map((profileKey) => (
              <option key={profileKey} value={profileKey}>
                {getScenarioBehaviorProfileLabel(profileKey)}
              </option>
            ))}
          </select>
          <small className="editor-help">
            Closed profile keys only: {SCENARIO_EDITOR_BEHAVIOR_PROFILE_KEYS.join(', ')}.
          </small>
          {validationIssue !== undefined ? (
            <small className="editor-error">{validationIssue}</small>
          ) : null}
        </label>
      ) : (
        <p className="editor-help">Behavior profile override is disabled for this draft.</p>
      )}

      <dl className="editor-grid">
        <dt>Dirty State</dt>
        <dd>{isDirty ? 'dirty' : 'clean'}</dd>
        <dt>Assignment Enabled</dt>
        <dd>{behavior.enabled ? 'yes' : 'no'}</dd>
        <dt>Profile Key</dt>
        <dd>{behavior.enabled ? behavior.profileKey : 'none'}</dd>
        <dt>Validation</dt>
        <dd>{validationIssue === undefined ? 'valid' : 'invalid'}</dd>
      </dl>

      <section className="editor-export-preview" aria-label="Behavior profile preview">
        <h2>Behavior Assignment JSON</h2>
        <textarea readOnly rows={6} value={behaviorJson} />
      </section>
    </section>
  );
}

/**
 * Strict JSON export + open/import card for Stage 3.4/3.5.
 * Reuses Stage 0 schema/map canonicalization checks derived from Micropolis map
 * persistence in `ref/micropolis/src/sim/s_fileio.c`; open/import diagnostics and
 * file-picker UX are editor-only browser workflow glue.
 */
function ScenarioExportCard() {
  const { bundle, isDirty } = useScenarioEditorState();
  const dispatch = useScenarioEditorDispatch();
  const openFileInputRef = useRef<HTMLInputElement | null>(null);
  const [lastOpenResult, setLastOpenResult] = useState<ScenarioEditorOpenResult | null>(null);
  const [lastResult, setLastResult] = useState<ScenarioEditorStrictExportResult | null>(null);
  const exportFileName = getScenarioEditorExportFileName(bundle.key);

  const handleExport = () => {
    const result = buildScenarioEditorStrictExport(bundle);
    setLastResult(result);

    if (!result.ok) {
      return;
    }

    triggerScenarioBundleJsonDownload(exportFileName, result.jsonText);
    dispatch({ type: 'mark-clean' });
  };

  const handleOpenBundle = () => {
    if (
      isDirty &&
      !window.confirm('Open a bundle and discard unsaved editor changes in this draft?')
    ) {
      return;
    }

    openFileInputRef.current?.click();
  };

  const handleOpenBundleInputChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const selectedFile = input.files?.[0];
    input.value = '';
    if (selectedFile === undefined) {
      return;
    }

    let fileText: string;
    try {
      fileText = await selectedFile.text();
    } catch {
      setLastOpenResult({
        ok: false,
        fileName: selectedFile.name,
        issues: [
          {
            source: 'io',
            path: '$',
            message: 'failed to read the selected bundle file',
          },
        ],
      });
      return;
    }

    const importResult = parseScenarioEditorBundleImportJson(fileText);
    if (!importResult.ok) {
      setLastOpenResult({
        ok: false,
        fileName: selectedFile.name,
        issues: importResult.issues,
      });
      return;
    }

    dispatch({ type: 'replace-bundle', bundle: importResult.bundle });
    dispatch({ type: 'set-active-view', view: 'metadata' });
    setLastOpenResult({
      ok: true,
      fileName: selectedFile.name,
    });
    setLastResult(null);
  };

  const issues = lastResult?.ok === false ? lastResult.issues : [];
  const openIssues = lastOpenResult?.ok === false ? lastOpenResult.issues : [];

  return (
    <section className="editor-card" aria-label="Scenario strict export panel">
      <h1>Export Scenario Bundle</h1>
      <p>
        Open an existing bundle JSON for iterative edits, then run strict schema/lint checks and
        export canonical `ScenarioBundleV1` JSON with map payload compiled to `city-file-bytes`.
      </p>

      <div className="editor-export-actions">
        <input
          accept="application/json,.json"
          className="editor-open-input"
          onChange={handleOpenBundleInputChange}
          ref={openFileInputRef}
          type="file"
        />
        <button className="editor-open-button" onClick={handleOpenBundle} type="button">
          Open Bundle JSON
        </button>
        <button className="editor-export-button" onClick={handleExport} type="button">
          Export Bundle JSON
        </button>
        <small className="editor-help">Export file name: {exportFileName}</small>
      </div>

      <dl className="editor-grid">
        <dt>Dirty State</dt>
        <dd>{isDirty ? 'dirty' : 'clean'}</dd>
        <dt>Last Open Attempt</dt>
        <dd>
          {lastOpenResult === null
            ? 'not attempted'
            : lastOpenResult.ok
              ? `success (${lastOpenResult.fileName})`
              : `blocked (${openIssues.length} issue${openIssues.length === 1 ? '' : 's'})`}
        </dd>
        <dt>Last Export Attempt</dt>
        <dd>
          {lastResult === null
            ? 'not attempted'
            : lastResult.ok
              ? 'success'
              : `blocked (${issues.length} issue${issues.length === 1 ? '' : 's'})`}
        </dd>
      </dl>

      {lastResult?.ok === false ? (
        <section aria-label="Strict export issues" className="editor-export-issues">
          <h2>Export Blocked</h2>
          <ul>
            {lastResult.issues.map((issue, index) => (
              <li key={`${issue.source}:${issue.path}:${issue.message}:${index}`}>
                <strong>{issue.source}</strong> at <code>{issue.path}</code>: {issue.message}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {lastOpenResult?.ok === false ? (
        <section aria-label="Bundle open issues" className="editor-open-issues">
          <h2>Open Blocked</h2>
          <ul>
            {openIssues.map((issue, index) => (
              <li key={`${issue.source}:${issue.path}:${issue.message}:${index}`}>
                <strong>{issue.source}</strong> at <code>{issue.path}</code>: {issue.message}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {lastResult?.ok ? (
        <section aria-label="Export json preview" className="editor-export-preview">
          <h2>Last Export JSON</h2>
          <textarea readOnly rows={12} value={lastResult.jsonText} />
        </section>
      ) : null}
    </section>
  );
}

/**
 * Prevent accidental form submission reload while editing metadata.
 * Not from Micropolis C: browser form behavior guard for SPA workflow.
 */
function preventFormSubmit(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();
}

/**
 * Trigger one browser download for a strict-export scenario bundle JSON file.
 * Not from Micropolis C: classic scenario/city files were written by `saveFile` in
 * `ref/micropolis/src/sim/s_fileio.c`; this is browser download plumbing.
 */
function triggerScenarioBundleJsonDownload(fileName: string, jsonText: string) {
  const blob = new Blob([jsonText], { type: 'application/json' });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  anchor.click();
  window.setTimeout(() => {
    URL.revokeObjectURL(objectUrl);
  }, 0);
}

/**
 * Parse integer form input with deterministic fallback.
 * Parity note: integers mirror C-style whole-number scenario/objective fields, while fallback
 * behavior is editor-specific UI handling.
 */
function parseIntegerInput(rawValue: string, fallback: number): number {
  if (rawValue.trim().length === 0) {
    return fallback;
  }
  const parsed = Number.parseInt(rawValue, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

/**
 * Render label text for one objective predicate kind.
 * Not from Micropolis C: UI-only display names for runtime predicate kinds.
 */
function getScenarioObjectivePredicateKindLabel(
  kind: ScenarioEditorObjectivePredicate['kind'],
): string {
  if (kind === 'metric') {
    return 'Metric';
  }
  if (kind === 'all') {
    return 'All';
  }
  if (kind === 'any') {
    return 'Any';
  }
  return 'Not';
}

/**
 * Render label text for one objective metric key.
 * Mirrors metric domains from `DoScenarioScore` in `ref/micropolis/src/sim/s_msg.c`.
 */
function getScenarioObjectiveMetricLabel(
  metric: (typeof SCENARIO_EDITOR_OBJECTIVE_METRIC_KEYS)[number],
): string {
  if (metric === 'city-class') {
    return 'City Class';
  }
  if (metric === 'traffic-average') {
    return 'Traffic Average';
  }
  if (metric === 'city-score') {
    return 'City Score';
  }
  return 'Crime Average';
}

/**
 * Render label text for one objective comparison operator.
 * Mirrors relational operator semantics used by `DoScenarioScore` in
 * `ref/micropolis/src/sim/s_msg.c`.
 */
function getScenarioObjectiveComparisonLabel(
  comparison: (typeof SCENARIO_EDITOR_OBJECTIVE_COMPARISONS)[number],
): string {
  if (comparison === 'gt') {
    return '>';
  }
  if (comparison === 'gte') {
    return '>=';
  }
  if (comparison === 'lt') {
    return '<';
  }
  if (comparison === 'lte') {
    return '<=';
  }
  if (comparison === 'eq') {
    return '=';
  }
  return '!=';
}

/**
 * Render label text for one script trigger selector value.
 * Mirrors `ScenarioDisaster` trigger styles in `ref/micropolis/src/sim/s_disast.c`.
 */
function getScenarioScriptTriggerKindLabel(
  kind: (typeof SCENARIO_EDITOR_SCRIPT_TRIGGER_KINDS)[number],
): string {
  if (kind === 'atTick') {
    return 'At Tick';
  }
  return 'Every Ticks';
}

/**
 * Render label text for one script action kind.
 * Mirrors action side-effect categories represented by `ScenarioRuntimeAction`.
 */
function getScenarioScriptActionKindLabel(
  kind: (typeof SCENARIO_EDITOR_SCRIPT_ACTION_KINDS)[number],
): string {
  if (kind === 'make-earthquake') {
    return 'Make Earthquake';
  }
  if (kind === 'drop-fire-bombs') {
    return 'Drop Fire Bombs';
  }
  if (kind === 'make-monster') {
    return 'Make Monster';
  }
  if (kind === 'make-meltdown') {
    return 'Make Meltdown';
  }
  if (kind === 'make-flood') {
    return 'Make Flood';
  }
  if (kind === 'send-message') {
    return 'Send Message';
  }
  return 'Lose Game';
}

/**
 * Render label text for one closed behavior-profile key.
 * Mirrors runtime profile keyspace from `packages/scenario-runtime` registry.
 */
function getScenarioBehaviorProfileLabel(
  profileKey: (typeof SCENARIO_EDITOR_BEHAVIOR_PROFILE_KEYS)[number],
): string {
  if (profileKey === 'classic/default') {
    return 'Classic Default';
  }
  if (profileKey === 'classic/sf-ship-honk') {
    return 'Classic SF Ship Honk';
  }
  return profileKey;
}

/**
 * Convert canvas pointer coordinates to fixed map tile coordinates.
 * Mirrors Micropolis bounds guards (`0 <= x < WORLD_X`, `0 <= y < WORLD_Y`) from
 * `SimCmdTile` in `ref/micropolis/src/sim/w_sim.c`; parity difference: input space is
 * browser canvas pixels rather than Tcl command arguments.
 */
function getScenarioEditorPointerTile(
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
): ScenarioEditorMapPoint | null {
  const rect = canvas.getBoundingClientRect();
  if (
    clientX < rect.left ||
    clientX >= rect.right ||
    clientY < rect.top ||
    clientY >= rect.bottom ||
    rect.width <= 0 ||
    rect.height <= 0
  ) {
    return null;
  }

  const x = Math.floor(((clientX - rect.left) / rect.width) * SCENARIO_BUNDLE_V1_MAP_WIDTH);
  const y = Math.floor(((clientY - rect.top) / rect.height) * SCENARIO_BUNDLE_V1_MAP_HEIGHT);
  const point = { x, y };

  return getScenarioEditorMapIndex(point) === null ? null : point;
}

/**
 * Render the current map words to the `120x100` preview canvas.
 * Mirrors classic map cardinality (`WORLD_X=120`, `WORLD_Y=100`) from
 * `ref/micropolis/src/sim/headers/sim.h`; parity difference: this is a simplified
 * editor visualization, not the original sprite/tile renderer from Micropolis UI code.
 */
function drawScenarioEditorPreview(canvas: HTMLCanvasElement | null, tileWords: readonly number[]) {
  if (canvas === null) {
    return;
  }

  const context = canvas.getContext('2d');
  if (context === null) {
    return;
  }

  const imageData = context.createImageData(
    SCENARIO_BUNDLE_V1_MAP_WIDTH,
    SCENARIO_BUNDLE_V1_MAP_HEIGHT,
  );
  for (let x = 0; x < SCENARIO_BUNDLE_V1_MAP_WIDTH; x += 1) {
    for (let y = 0; y < SCENARIO_BUNDLE_V1_MAP_HEIGHT; y += 1) {
      const mapIndex = x * SCENARIO_BUNDLE_V1_MAP_HEIGHT + y;
      const pixelIndex = (y * SCENARIO_BUNDLE_V1_MAP_WIDTH + x) * 4;
      const tileWord = tileWords[mapIndex] ?? 0;
      const [red, green, blue] = getScenarioEditorPreviewColor(tileWord);

      imageData.data[pixelIndex] = red;
      imageData.data[pixelIndex + 1] = green;
      imageData.data[pixelIndex + 2] = blue;
      imageData.data[pixelIndex + 3] = 255;
    }
  }

  context.putImageData(imageData, 0, 0);
}

/**
 * Map one tile word to a preview RGB color.
 * Uses Micropolis low-10-bit tile base semantics (`LOMASK=1023`) from
 * `ref/micropolis/src/sim/headers/sim.h`; parity difference: color selection is
 * editor-specific and not a 1:1 port of classic tile art.
 */
function getScenarioEditorPreviewColor(tileWord: number): readonly [number, number, number] {
  const tileBase = tileWord & TILE_BASE_MASK;

  if (tileBase === 0) {
    return [187, 167, 132];
  }
  if (tileBase === 2) {
    return [71, 132, 201];
  }
  if (tileBase === 3) {
    return [103, 171, 227];
  }

  const red = (tileBase * 67 + 29) & 255;
  const green = (tileBase * 37 + 97) & 255;
  const blue = (tileBase * 19 + 173) & 255;
  return [red, green, blue];
}
