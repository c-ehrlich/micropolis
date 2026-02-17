import { ClassicyTextArea } from '@city/classicyui';
import { type ChangeEvent, useRef, useState } from 'react';

import {
  buildScenarioEditorStrictExport,
  getScenarioEditorExportFileName,
  type ScenarioEditorStrictExportResult,
} from '../state/editor-export.ts';
import {
  parseScenarioEditorBundleImportJson,
  type ScenarioEditorBundleImportIssue,
} from '../state/editor-import.ts';
import { useScenarioEditorDispatch, useScenarioEditorState } from '../state/editor-state.tsx';
import {
  getScenarioEditorStockScenarioOptions,
  loadScenarioEditorStockScenarioBundle,
} from '../state/editor-stock-scenarios.ts';
import {
  EditorCard,
  EditorIssuesPanel,
  EditorPreviewPanel,
  EditorPrimaryButton,
  EditorSecondaryButton,
  EditorStatsGrid,
} from './-editor-ui.tsx';

type ScenarioEditorOpenResult =
  | {
      readonly sourceLabel: string;
      readonly ok: true;
    }
  | {
      readonly sourceLabel: string;
      readonly issues: readonly ScenarioEditorBundleImportIssue[];
      readonly ok: false;
    };

const STOCK_SCENARIO_OPTIONS = getScenarioEditorStockScenarioOptions();

export interface ScenarioFileMenuContentProps {
  readonly compact?: boolean;
}

/**
 * File-workflow controls for scenario open/import/export actions.
 * Reuses Stage 0 schema/map canonicalization checks derived from Micropolis map
 * persistence in `ref/micropolis/src/sim/s_fileio.c`; open/import diagnostics and
 * file-picker UX are editor-only browser workflow glue.
 */
export function ScenarioFileMenuContent({ compact = false }: ScenarioFileMenuContentProps) {
  const { bundle, isDirty, objective, script } = useScenarioEditorState();
  const dispatch = useScenarioEditorDispatch();
  const openFileInputRef = useRef<HTMLInputElement | null>(null);
  const [lastOpenResult, setLastOpenResult] = useState<ScenarioEditorOpenResult | null>(null);
  const [lastResult, setLastResult] = useState<ScenarioEditorStrictExportResult | null>(null);
  const [openStockScenarioId, setOpenStockScenarioId] = useState<number>(
    STOCK_SCENARIO_OPTIONS[0]?.id ?? 1,
  );
  const [openingStockScenario, setOpeningStockScenario] = useState(false);
  const exportFileName = getScenarioEditorExportFileName(bundle.key);

  const handleExport = () => {
    const result = buildScenarioEditorStrictExport(bundle, { objective, script });
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
        sourceLabel: selectedFile.name,
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
        sourceLabel: selectedFile.name,
        issues: importResult.issues,
      });
      return;
    }

    dispatch({ type: 'replace-bundle', bundle: importResult.bundle });
    setLastOpenResult({
      ok: true,
      sourceLabel: selectedFile.name,
    });
    setLastResult(null);
  };

  const handleOpenStockScenario = async () => {
    if (
      isDirty &&
      !window.confirm('Open a stock scenario and discard unsaved editor changes in this draft?')
    ) {
      return;
    }

    const selectedScenario =
      STOCK_SCENARIO_OPTIONS.find((option) => option.id === openStockScenarioId) ??
      STOCK_SCENARIO_OPTIONS[0];
    if (selectedScenario === undefined) {
      return;
    }

    setOpeningStockScenario(true);
    try {
      const stockBundle = await loadScenarioEditorStockScenarioBundle(selectedScenario.id);
      dispatch({ type: 'replace-bundle', bundle: stockBundle });
      setLastOpenResult({
        ok: true,
        sourceLabel: `${selectedScenario.name} (${selectedScenario.fileName})`,
      });
      setLastResult(null);
    } catch {
      setLastOpenResult({
        ok: false,
        sourceLabel: `${selectedScenario.name} (${selectedScenario.fileName})`,
        issues: [
          {
            source: 'io',
            path: '$',
            message: 'failed to load selected stock scenario resource',
          },
        ],
      });
    } finally {
      setOpeningStockScenario(false);
    }
  };

  const issues = lastResult?.ok === false ? lastResult.issues : [];
  const openIssues = lastOpenResult?.ok === false ? lastOpenResult.issues : [];

  return (
    <div className={compact ? 'grid gap-3' : ''}>
      {!compact ? (
        <p>
          Open an existing bundle JSON for iterative edits, then run strict schema/lint checks and
          export canonical `ScenarioBundleV1` JSON with map payload compiled to `city-file-bytes`
          plus authored Stage 4 objective/script payloads when enabled.
        </p>
      ) : null}

      <div
        className={
          compact ? 'grid justify-items-start gap-2' : 'mb-4 grid justify-items-start gap-2'
        }
      >
        <input
          accept="application/json,.json"
          className="hidden"
          onChange={handleOpenBundleInputChange}
          ref={openFileInputRef}
          type="file"
        />
        <label className="grid gap-[0.3rem] [&_select]:rounded [&_select]:border [&_select]:border-slate-500 [&_select]:px-[0.55rem] [&_select]:py-[0.45rem]">
          <span>Stock Scenario</span>
          <select
            onChange={(event) => {
              setOpenStockScenarioId(Number(event.currentTarget.value));
            }}
            value={openStockScenarioId}
          >
            {STOCK_SCENARIO_OPTIONS.map((scenario) => (
              <option key={scenario.id} value={scenario.id}>
                {scenario.name} ({scenario.fileName})
              </option>
            ))}
          </select>
        </label>
        <EditorSecondaryButton
          disabled={openingStockScenario}
          onClick={() => {
            void handleOpenStockScenario();
          }}
          type="button"
        >
          {openingStockScenario ? 'Opening Stock Scenario…' : 'Open Stock Scenario'}
        </EditorSecondaryButton>
        <EditorSecondaryButton onClick={handleOpenBundle} type="button">
          Open Bundle JSON
        </EditorSecondaryButton>
        <EditorPrimaryButton onClick={handleExport} type="button">
          Export Bundle JSON
        </EditorPrimaryButton>
        <small className="text-sm text-slate-600">Export file name: {exportFileName}</small>
      </div>

      <EditorStatsGrid
        className={
          compact ? 'grid-cols-[max-content_1fr] gap-x-2 text-sm [&_dt]:text-slate-500' : ''
        }
      >
        <dt>Dirty State</dt>
        <dd>{isDirty ? 'dirty' : 'clean'}</dd>
        <dt>Last Open Attempt</dt>
        <dd>
          {lastOpenResult === null
            ? 'not attempted'
            : lastOpenResult.ok
              ? `success (${lastOpenResult.sourceLabel})`
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
      </EditorStatsGrid>

      {lastResult?.ok === false ? (
        <EditorIssuesPanel aria-label="Strict export issues" className={compact ? 'mt-0' : ''}>
          <h2>Export Blocked</h2>
          <ul>
            {lastResult.issues.map((issue, index) => (
              <li key={`${issue.source}:${issue.path}:${issue.message}:${index}`}>
                <strong>{issue.source}</strong> at <code>{issue.path}</code>: {issue.message}
              </li>
            ))}
          </ul>
        </EditorIssuesPanel>
      ) : null}

      {lastOpenResult?.ok === false ? (
        <EditorIssuesPanel aria-label="Bundle open issues" className={compact ? 'mt-0' : ''}>
          <h2>Open Blocked</h2>
          <ul>
            {openIssues.map((issue, index) => (
              <li key={`${issue.source}:${issue.path}:${issue.message}:${index}`}>
                <strong>{issue.source}</strong> at <code>{issue.path}</code>: {issue.message}
              </li>
            ))}
          </ul>
        </EditorIssuesPanel>
      ) : null}

      {lastResult?.ok ? (
        <EditorPreviewPanel aria-label="Export json preview" className={compact ? 'mt-0' : ''}>
          <h2>Last Export JSON</h2>
          <ClassicyTextArea readOnly rows={compact ? 8 : 12} value={lastResult.jsonText} />
        </EditorPreviewPanel>
      ) : null}
    </div>
  );
}

/**
 * Strict JSON export + open/import card for Stage 3.4/3.5.
 * Reuses Stage 0 schema/map canonicalization checks derived from Micropolis map
 * persistence in `ref/micropolis/src/sim/s_fileio.c`; open/import diagnostics and
 * file-picker UX are editor-only browser workflow glue.
 */
export function ScenarioExportCard() {
  return (
    <EditorCard aria-label="Scenario strict export panel" className="max-w-[52rem]">
      <h1>Export Scenario Bundle</h1>
      <ScenarioFileMenuContent />
    </EditorCard>
  );
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
