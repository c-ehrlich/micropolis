import { describe, expect, test } from 'vitest';

import { buildScenarioEditorStrictExport } from './editor-export.ts';
import {
  normalizeScenarioEditorImportedBundle,
  parseScenarioEditorBundleImportJson,
} from './editor-import.ts';
import { createScenarioEditorInitialBundle } from './editor-state.tsx';

/**
 * Stage 3.5 bundle-open tests for iterative editor edits.
 * Parity anchors:
 * - File-open intent follows `LoadScenario` in `ref/micropolis/src/sim/s_fileio.c`.
 * - Map decode to tile words follows `_load_short` map-word order from the same source.
 */
describe('scenario editor bundle import', () => {
  test('opens strict-export JSON and normalizes map payload for editing', () => {
    const strictExport = buildScenarioEditorStrictExport(createScenarioEditorInitialBundle());
    expect(strictExport.ok).toBe(true);
    if (!strictExport.ok) {
      throw new Error('Expected strict export fixture to be valid');
    }

    const openResult = parseScenarioEditorBundleImportJson(strictExport.jsonText);
    expect(openResult.ok).toBe(true);
    if (!openResult.ok) {
      throw new Error('Expected bundle-open parse to succeed');
    }

    expect(openResult.bundle.map.kind).toBe('tile-words');
    if (openResult.bundle.map.kind !== 'tile-words') {
      throw new Error('Expected tile-words map payload');
    }

    // Magic number sources: `WORLD_X=120` and `WORLD_Y=100` in
    // `ref/micropolis/src/sim/headers/sim.h`, producing `120 * 100 = 12000` map words.
    expect(openResult.bundle.map.width).toBe(120);
    expect(openResult.bundle.map.height).toBe(100);
    expect(openResult.bundle.map.tileWords).toHaveLength(12000);
  });

  test('reports a JSON issue for malformed document text', () => {
    const openResult = parseScenarioEditorBundleImportJson('{');

    expect(openResult.ok).toBe(false);
    if (openResult.ok) {
      throw new Error('Expected malformed JSON to fail');
    }

    expect(openResult.issues).toContainEqual({
      source: 'json',
      path: '$',
      message: 'scenario bundle file must contain valid JSON text',
    });
  });

  test('reports validation issues for schema-invalid bundles', () => {
    const invalidJsonText = JSON.stringify({
      ...createScenarioEditorInitialBundle(),
      key: 'missing-namespace',
    });
    const openResult = parseScenarioEditorBundleImportJson(invalidJsonText);

    expect(openResult.ok).toBe(false);
    if (openResult.ok) {
      throw new Error('Expected schema-invalid bundle to fail');
    }

    expect(
      openResult.issues.some(
        (issue) =>
          issue.source === 'validation' &&
          issue.path === 'key' &&
          issue.message.includes('namespace'),
      ),
    ).toBe(true);
  });
});

describe('scenario editor imported bundle normalization', () => {
  test('keeps tile-word map bundles unchanged', () => {
    const bundle = createScenarioEditorInitialBundle();

    expect(normalizeScenarioEditorImportedBundle(bundle)).toBe(bundle);
  });
});
