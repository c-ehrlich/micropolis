import {
  type ScenarioBundleV1,
  scenarioBundleV1Schema,
  writeScenarioBundleV1CityFileBytes,
} from '@city/scenario-core';

/**
 * One strict-export diagnostic emitted by Stage 3.4 authoring checks.
 * Reuses Stage 0 schema validation for fields that map to `LoadScenario`/`saveFile`
 * data domains in `ref/micropolis/src/sim/s_fileio.c`; lint diagnostics are
 * editor-only quality checks with no 1:1 Micropolis C equivalent.
 */
export interface ScenarioEditorExportIssue {
  readonly message: string;
  readonly path: string;
  readonly source: 'lint' | 'validation';
}

/**
 * Strict-export result contract for Stage 3.4 bundle JSON generation.
 * Mirrors Micropolis map persistence intent from `saveFile` in
 * `ref/micropolis/src/sim/s_fileio.c` by always canonicalizing map output to one
 * compiled form (`city-file-bytes`) before JSON serialization.
 */
export type ScenarioEditorStrictExportResult =
  | {
      readonly canonicalBundle: ScenarioBundleV1;
      readonly issues: readonly [];
      readonly jsonText: string;
      readonly ok: true;
    }
  | {
      readonly issues: readonly ScenarioEditorExportIssue[];
      readonly ok: false;
    };

/**
 * Build strict export JSON for one editor bundle.
 * Applies Stage 0 schema validation, authoring lints, and canonical map compilation
 * (`writeScenarioBundleV1CityFileBytes`) so export fails closed on any validation/lint
 * issue instead of producing partial output.
 */
export function buildScenarioEditorStrictExport(
  bundle: ScenarioBundleV1,
): ScenarioEditorStrictExportResult {
  const parsedBundle = scenarioBundleV1Schema.safeParse(bundle);
  if (!parsedBundle.success) {
    return {
      ok: false,
      issues: toValidationIssues(parsedBundle.error.issues),
    };
  }

  const lintIssues = lintScenarioBundleForStrictExport(parsedBundle.data);
  if (lintIssues.length > 0) {
    return {
      ok: false,
      issues: lintIssues,
    };
  }

  const canonicalBundle = writeScenarioBundleV1CityFileBytes(parsedBundle.data);
  const canonicalValidation = scenarioBundleV1Schema.safeParse(canonicalBundle);
  if (!canonicalValidation.success) {
    return {
      ok: false,
      issues: toValidationIssues(canonicalValidation.error.issues),
    };
  }

  return {
    ok: true,
    issues: [],
    canonicalBundle: canonicalValidation.data,
    jsonText: `${JSON.stringify(canonicalValidation.data, null, 2)}\n`,
  };
}

/**
 * Build a deterministic export file name from a scenario key.
 * Not from Micropolis C: classic files used fixed `snro.*` names in
 * `ref/micropolis/src/sim/s_fileio.c`; this is editor-specific JSON naming.
 */
export function getScenarioEditorExportFileName(key: string): string {
  const sanitizedKey = key
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9/_-]+/g, '-')
    .replace(/\/+/g, '__')
    .replace(/-+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '');

  return sanitizedKey.length > 0 ? `${sanitizedKey}.scenario.json` : 'scenario.scenario.json';
}

/**
 * Stage 3.4 lint checks that are stricter than base schema validation.
 * Not from Micropolis C: these checks enforce authoring hygiene before export.
 */
function lintScenarioBundleForStrictExport(
  bundle: ScenarioBundleV1,
): readonly ScenarioEditorExportIssue[] {
  const issues: ScenarioEditorExportIssue[] = [];

  const firstIndexByTag = new Map<string, number>();
  for (let index = 0; index < bundle.tags.length; index += 1) {
    const tag = bundle.tags[index];
    if (tag === undefined) {
      continue;
    }

    const firstIndex = firstIndexByTag.get(tag);
    if (firstIndex !== undefined) {
      issues.push({
        source: 'lint',
        path: `tags.${index}`,
        message: `duplicate tag "${tag}" (already used at tags.${firstIndex})`,
      });
      continue;
    }

    firstIndexByTag.set(tag, index);
  }

  return issues;
}

/**
 * Convert schema parser diagnostics into strict-export issue rows.
 * Reuses Zod issue paths/messages from `scenarioBundleV1Schema` as user-facing
 * blocking diagnostics for strict export.
 */
function toValidationIssues(
  issues: readonly { message: string; path: readonly PropertyKey[] }[],
): readonly ScenarioEditorExportIssue[] {
  return issues.map((issue) => ({
    source: 'validation',
    path: issue.path.length > 0 ? issue.path.map((segment) => String(segment)).join('.') : '$',
    message: issue.message,
  }));
}
