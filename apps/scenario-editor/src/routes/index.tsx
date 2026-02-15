import { SCENARIO_BUNDLE_V1_MAP_HEIGHT, SCENARIO_BUNDLE_V1_MAP_WIDTH } from '@city/scenario-core';
import { createFileRoute } from '@tanstack/react-router';
import {
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  buildScenarioEditorStrictExport,
  getScenarioEditorExportFileName,
  type ScenarioEditorStrictExportResult,
} from '../state/editor-export.ts';
import {
  getScenarioEditorMapIndex,
  getScenarioEditorMapTileWords,
  normalizeScenarioEditorTileWord,
  readScenarioEditorMapTileWord,
  type ScenarioEditorMapPoint,
} from '../state/editor-map.ts';
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

export const Route = createFileRoute('/')({
  component: ScenarioEditorHomeRoute,
});

/**
 * Stage 3 workbench route with metadata editing and manual map editing MVP sections.
 * Parity note: metadata `startYear`/`startFunds` map to `LoadScenario` fields in
 * `ref/micropolis/src/sim/s_fileio.c`; map edits mirror `Map[x][y]` writes from
 * `SimCmdTile`/`SimCmdFill` in `ref/micropolis/src/sim/w_sim.c`.
 */
function ScenarioEditorHomeRoute() {
  const { activeView } = useScenarioEditorState();

  if (activeView === 'metadata') {
    return <ScenarioMetadataEditorCard />;
  }
  if (activeView === 'map') {
    return <ScenarioMapEditorCard />;
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
 * Strict JSON export card for Stage 3.4.
 * Reuses Stage 0 schema/map canonicalization checks derived from Micropolis map
 * persistence in `ref/micropolis/src/sim/s_fileio.c`; lint UX/status is editor-only.
 */
function ScenarioExportCard() {
  const { bundle, isDirty } = useScenarioEditorState();
  const dispatch = useScenarioEditorDispatch();
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

  const issues = lastResult?.ok === false ? lastResult.issues : [];

  return (
    <section className="editor-card" aria-label="Scenario strict export panel">
      <h1>Export Scenario Bundle</h1>
      <p>
        Run strict schema/lint checks and export a canonical `ScenarioBundleV1` JSON file with map
        payload compiled to `city-file-bytes`.
      </p>

      <div className="editor-export-actions">
        <button className="editor-export-button" onClick={handleExport} type="button">
          Export Bundle JSON
        </button>
        <small className="editor-help">File name: {exportFileName}</small>
      </div>

      <dl className="editor-grid">
        <dt>Dirty State</dt>
        <dd>{isDirty ? 'dirty' : 'clean'}</dd>
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
 * Parity note: integers mirror C-style whole-number scenario fields, while fallback behavior
 * is editor-specific UI handling.
 */
function parseIntegerInput(rawValue: string, fallback: number): number {
  if (rawValue.trim().length === 0) {
    return fallback;
  }
  const parsed = Number.parseInt(rawValue, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
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
