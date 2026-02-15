import { describe, expect, test } from 'vitest';

import {
  buildScenarioEditorStrictExport,
  getScenarioEditorExportFileName,
} from './editor-export.ts';
import { createScenarioEditorInitialBundle } from './editor-state.tsx';

/**
 * Stage 3.4 strict-export tests for canonical JSON bundle output.
 * Parity anchor: map canonicalization reuses `saveFile` map-word persistence shape in
 * `ref/micropolis/src/sim/s_fileio.c` through `writeScenarioBundleV1CityFileBytes`.
 */
describe('scenario editor strict export', () => {
  test('exports canonical bundle JSON when validation and lint pass', () => {
    const bundle = createScenarioEditorInitialBundle();
    const result = buildScenarioEditorStrictExport(bundle);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('Expected strict export to succeed');
    }

    expect(result.issues).toHaveLength(0);
    expect(result.canonicalBundle.map.kind).toBe('city-file-bytes');
    expect(result.jsonText.endsWith('\n')).toBe(true);

    const json = JSON.parse(result.jsonText) as { map?: { kind?: string; tileWords?: unknown } };
    expect(json.map?.kind).toBe('city-file-bytes');
    expect(json.map?.tileWords).toBeUndefined();
  });

  test('fails export on schema validation errors', () => {
    const bundle = {
      ...createScenarioEditorInitialBundle(),
      key: 'missing-namespace',
    };
    const result = buildScenarioEditorStrictExport(bundle);

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('Expected strict export to fail');
    }

    expect(
      result.issues.some(
        (issue) =>
          issue.source === 'validation' &&
          issue.path === 'key' &&
          issue.message.includes('namespace'),
      ),
    ).toBe(true);
  });

  test('fails export on lint errors', () => {
    const bundle = {
      ...createScenarioEditorInitialBundle(),
      tags: ['harbor', 'harbor'],
    };
    const result = buildScenarioEditorStrictExport(bundle);

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('Expected strict export to fail');
    }

    expect(result.issues).toContainEqual({
      source: 'lint',
      path: 'tags.1',
      message: 'duplicate tag "harbor" (already used at tags.0)',
    });
  });
});

describe('scenario editor export file naming', () => {
  test('sanitizes key text into a deterministic file name', () => {
    const fileName = getScenarioEditorExportFileName('user/Harbor Redevelopment 2026!');

    expect(fileName).toBe('user__harbor-redevelopment-2026.scenario.json');
  });
});
