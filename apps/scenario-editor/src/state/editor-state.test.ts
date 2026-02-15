import { describe, expect, test } from 'vitest';

import {
  createScenarioEditorInitialBundle,
  createScenarioEditorInitialState,
  getScenarioEditorMetadataValidationIssues,
  parseScenarioEditorTagsInput,
  SCENARIO_EDITOR_MVP_VIEWS,
  scenarioEditorReducer,
} from './editor-state.tsx';

/**
 * Stage 3 state-foundation tests for initial editor draft behavior.
 * Parity anchor: `WORLD_X=120`, `WORLD_Y=100`, and `DIRT=0` come from
 * `ref/micropolis/src/sim/headers/sim.h` and map allocation in `ref/micropolis/src/sim/s_alloc.c`.
 */
describe('scenario editor state foundation', () => {
  test('creates an initial bundle with classic map dimensions and DIRT-filled words', () => {
    const bundle = createScenarioEditorInitialBundle();

    expect(bundle.map.kind).toBe('tile-words');
    if (bundle.map.kind !== 'tile-words') {
      throw new Error('Expected tile-words map payload');
    }

    expect(bundle.map.width).toBe(120);
    expect(bundle.map.height).toBe(100);
    expect(bundle.map.tileWords).toHaveLength(12000);
    expect(bundle.map.tileWords.every((word) => word === 0)).toBe(true);

    // Magic numbers source: Dullsville scenario defaults in `LoadScenario` from
    // `ref/micropolis/src/sim/s_fileio.c` set `CityTime` from year 1900 and funds 5000.
    expect(bundle.start.startYear).toBe(1900);
    expect(bundle.start.startFunds).toBe(5000);
  });

  test('transitions active view through reducer actions', () => {
    const initial = createScenarioEditorInitialState();
    const next = scenarioEditorReducer(initial, { type: 'set-active-view', view: 'map' });

    expect(next.activeView).toBe('map');
    expect(next.bundle).toBe(initial.bundle);
    expect(next.isDirty).toBe(false);
  });

  test('limits MVP workbench views to metadata/map/export and defers script authoring', () => {
    expect(SCENARIO_EDITOR_MVP_VIEWS).toEqual(['metadata', 'map', 'export']);
    expect((SCENARIO_EDITOR_MVP_VIEWS as readonly string[]).includes('scripts')).toBe(false);
    expect((SCENARIO_EDITOR_MVP_VIEWS as readonly string[]).includes('objectives')).toBe(false);
  });

  test('updates metadata fields through reducer patch actions', () => {
    const initial = createScenarioEditorInitialState();
    const next = scenarioEditorReducer(initial, {
      type: 'update-metadata',
      metadata: {
        key: 'user/custom-metadata',
        name: 'Custom Metadata',
        description: 'Editable metadata scenario',
        tags: ['editor', 'mvp'],
        start: {
          startYear: 1957,
          startFunds: 20000,
        },
      },
    });

    expect(next.isDirty).toBe(true);
    expect(next.bundle.key).toBe('user/custom-metadata');
    expect(next.bundle.name).toBe('Custom Metadata');
    expect(next.bundle.description).toBe('Editable metadata scenario');
    expect(next.bundle.tags).toEqual(['editor', 'mvp']);
    expect(next.bundle.start).toEqual({
      startYear: 1957,
      startFunds: 20000,
    });
    expect(next.bundle.map).toBe(initial.bundle.map);
  });

  test('applies map paint actions through reducer with dirty tracking', () => {
    const initial = createScenarioEditorInitialState();
    const next = scenarioEditorReducer(initial, {
      type: 'paint-map-tile',
      x: 1,
      y: 2,
      tileWord: 44,
    });

    expect(next.isDirty).toBe(true);
    expect(next.bundle.map.kind).toBe('tile-words');
    if (next.bundle.map.kind !== 'tile-words') {
      throw new Error('Expected tile-words map payload');
    }

    // Magic number source: x-major index uses `index = x * WORLD_Y + y`
    // from `Map[i] = auxPtr + i * WORLD_Y` in `ref/micropolis/src/sim/s_alloc.c`.
    expect(next.bundle.map.tileWords[102]).toBe(44);
  });

  test('ignores out-of-bounds map paint actions', () => {
    const initial = createScenarioEditorInitialState();
    const next = scenarioEditorReducer(initial, {
      type: 'paint-map-tile',
      x: 120,
      y: 99,
      tileWord: 11,
    });

    expect(next).toBe(initial);
  });

  test('reports validation issues for invalid metadata fields', () => {
    const bundle = createScenarioEditorInitialBundle();
    const invalidBundle = {
      ...bundle,
      key: 'custom-without-namespace',
      name: '',
      start: {
        ...bundle.start,
        startFunds: -1,
      },
    };

    const issues = getScenarioEditorMetadataValidationIssues(invalidBundle);

    expect(issues.key).toContain('builtin/* or user/* namespace');
    expect(issues.name).toBeDefined();
    expect(issues.startFunds).toBeDefined();
  });

  test('parses comma or newline tag input into canonical tag arrays', () => {
    const tags = parseScenarioEditorTagsInput('classic, tutorial\nharbor redevelopment');

    expect(tags).toEqual(['classic', 'tutorial', 'harbor redevelopment']);
  });
});
