import {
  type ScenarioBundleV1,
  scenarioBundleV1Schema,
  transcodeScenarioMapTileWordsV1,
} from '@city/scenario-core';

/**
 * One issue reported while opening a bundle JSON document in the editor.
 * Mirrors Micropolis file-ingest domains from `loadFile`/`LoadScenario` in
 * `ref/micropolis/src/sim/s_fileio.c` by separating read/parse/validation failures.
 * Parity difference: Stage 3 editor returns structured diagnostics instead of Tcl errors.
 */
export interface ScenarioEditorBundleImportIssue {
  readonly message: string;
  readonly path: string;
  readonly source: 'io' | 'json' | 'validation';
}

/**
 * Result contract for opening one external scenario bundle JSON file in the editor.
 * Mirrors classic scenario file-open intent from `LoadScenario` in
 * `ref/micropolis/src/sim/s_fileio.c`; parity difference: successful opens normalize
 * to editable Stage 3 `tile-words` map form for deterministic browser editing.
 */
export type ScenarioEditorBundleImportResult =
  | {
      readonly bundle: ScenarioBundleV1;
      readonly issues: readonly [];
      readonly ok: true;
    }
  | {
      readonly issues: readonly ScenarioEditorBundleImportIssue[];
      readonly ok: false;
    };

/**
 * Parse and validate one scenario bundle JSON text for editor open/import flow.
 * Mirrors classic file-open flow intent from `LoadScenario` in
 * `ref/micropolis/src/sim/s_fileio.c`; parity difference: this validates Stage 0 JSON
 * schema first and then normalizes to `tile-words` for iterative Stage 3 map edits.
 */
export function parseScenarioEditorBundleImportJson(
  jsonText: string,
): ScenarioEditorBundleImportResult {
  let parsedValue: unknown;
  try {
    parsedValue = JSON.parse(jsonText);
  } catch {
    return {
      ok: false,
      issues: [
        {
          source: 'json',
          path: '$',
          message: 'scenario bundle file must contain valid JSON text',
        },
      ],
    };
  }

  const parsedBundle = scenarioBundleV1Schema.safeParse(parsedValue);
  if (!parsedBundle.success) {
    return {
      ok: false,
      issues: toValidationIssues(parsedBundle.error.issues),
    };
  }

  return {
    ok: true,
    issues: [],
    bundle: normalizeScenarioEditorImportedBundle(parsedBundle.data),
  };
}

/**
 * Normalize opened bundles into the map form expected for iterative editor writes.
 * Reuses Stage 0 map decode semantics from `_load_short((&Map[0][0]), WORLD_X * WORLD_Y, ...)`
 * in `ref/micropolis/src/sim/s_fileio.c`; parity difference: this stores decoded words in
 * JSON `tile-words` arrays so map paint/fill in Stage 3 can mutate immutably.
 */
export function normalizeScenarioEditorImportedBundle(bundle: ScenarioBundleV1): ScenarioBundleV1 {
  if (bundle.map.kind === 'tile-words') {
    return bundle;
  }

  return {
    ...bundle,
    map: transcodeScenarioMapTileWordsV1(bundle.map),
  };
}

/**
 * Convert schema diagnostics to import-flow issue rows with stable `path` strings.
 * Reuses Zod issue message/path output from `scenarioBundleV1Schema`.
 */
function toValidationIssues(
  issues: readonly { message: string; path: readonly PropertyKey[] }[],
): readonly ScenarioEditorBundleImportIssue[] {
  return issues.map((issue) => ({
    source: 'validation',
    path: issue.path.length > 0 ? issue.path.map((segment) => String(segment)).join('.') : '$',
    message: issue.message,
  }));
}
