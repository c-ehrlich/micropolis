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

  test('exposes Stage 4 objective/script/behavior views while still deferring ai authoring', () => {
    expect(SCENARIO_EDITOR_MVP_VIEWS).toEqual([
      'metadata',
      'map',
      'objective',
      'script',
      'behavior',
      'export',
    ]);
    expect((SCENARIO_EDITOR_MVP_VIEWS as readonly string[]).includes('script')).toBe(true);
    expect((SCENARIO_EDITOR_MVP_VIEWS as readonly string[]).includes('scripts')).toBe(false);
    expect((SCENARIO_EDITOR_MVP_VIEWS as readonly string[]).includes('objective')).toBe(true);
    expect((SCENARIO_EDITOR_MVP_VIEWS as readonly string[]).includes('behavior')).toBe(true);
    expect((SCENARIO_EDITOR_MVP_VIEWS as readonly string[]).includes('ai')).toBe(false);
    expect((SCENARIO_EDITOR_MVP_VIEWS as readonly string[]).includes('ai-import')).toBe(false);
    expect((SCENARIO_EDITOR_MVP_VIEWS as readonly string[]).includes('image-import')).toBe(false);
  });

  test('updates objective draft state through reducer actions', () => {
    const initial = createScenarioEditorInitialState();
    const enabled = scenarioEditorReducer(initial, {
      type: 'set-objective-enabled',
      enabled: true,
    });

    expect(enabled.objective.enabled).toBe(true);
    expect(enabled.isDirty).toBe(true);

    const replaced = scenarioEditorReducer(enabled, {
      type: 'replace-objective-predicate',
      predicate: {
        kind: 'metric',
        metric: 'traffic-average',
        op: 'lt',
        // Magic number source: Bern uses `TrafficAverage < 80` in
        // `DoScenarioScore` from `ref/micropolis/src/sim/s_msg.c`.
        value: 80,
      },
    });

    expect(replaced.objective.predicate).toEqual({
      kind: 'metric',
      metric: 'traffic-average',
      op: 'lt',
      value: 80,
    });
  });

  test('updates script draft state through reducer actions', () => {
    const initial = createScenarioEditorInitialState();
    const enabled = scenarioEditorReducer(initial, {
      type: 'set-script-enabled',
      enabled: true,
    });

    expect(enabled.script.enabled).toBe(true);
    expect(enabled.isDirty).toBe(true);

    const replaced = scenarioEditorReducer(enabled, {
      type: 'replace-script-events',
      events: [
        {
          // Magic number source: Rio scenario disaster cadence evaluates
          // `wait % 24 == 0` in `ScenarioDisaster` (`ref/micropolis/src/sim/s_disast.c`).
          trigger: { everyTicks: 24 },
          actions: [{ kind: 'make-flood' }],
        },
      ],
    });

    expect(replaced.script.events).toEqual([
      {
        trigger: { everyTicks: 24 },
        actions: [{ kind: 'make-flood' }],
      },
    ]);
  });

  test('updates behavior profile draft state through reducer actions', () => {
    const initial = createScenarioEditorInitialState();
    const enabled = scenarioEditorReducer(initial, {
      type: 'set-behavior-enabled',
      enabled: true,
    });

    expect(enabled.behavior.enabled).toBe(true);
    expect(enabled.isDirty).toBe(true);

    const assigned = scenarioEditorReducer(enabled, {
      type: 'set-behavior-profile-key',
      profileKey: 'classic/sf-ship-honk',
    });
    expect(assigned.behavior.profileKey).toBe('classic/sf-ship-honk');
    expect(assigned.isDirty).toBe(true);

    const trimmed = scenarioEditorReducer(assigned, {
      type: 'set-behavior-profile-key',
      profileKey: '  classic/default  ',
    });
    expect(trimmed.behavior.profileKey).toBe('classic/default');
    expect(trimmed.isDirty).toBe(true);
  });

  test('hydrates objective/script drafts from imported bundle payloads on replace-bundle', () => {
    const initial = createScenarioEditorInitialState();
    const replaced = scenarioEditorReducer(initial, {
      type: 'replace-bundle',
      bundle: {
        ...createScenarioEditorInitialBundle(),
        objective: {
          kind: 'metric',
          metric: 'traffic-average',
          op: 'lt',
          // Magic number source: Bern objective threshold `TrafficAverage < 80`
          // from `DoScenarioScore` in `ref/micropolis/src/sim/s_msg.c`.
          value: 80,
        },
        script: [
          {
            // Magic number source: Rio flood cadence checks `wait % 24 == 0`
            // in `ScenarioDisaster` (`ref/micropolis/src/sim/s_disast.c`).
            trigger: { everyTicks: 24 },
            actions: [{ kind: 'make-flood' }],
          },
        ],
      },
    });

    expect(replaced.isDirty).toBe(false);
    expect(replaced.objective.enabled).toBe(true);
    expect(replaced.objective.predicate).toEqual({
      kind: 'metric',
      metric: 'traffic-average',
      op: 'lt',
      value: 80,
    });
    expect(replaced.script.enabled).toBe(true);
    expect(replaced.script.events).toEqual([
      {
        trigger: { everyTicks: 24 },
        actions: [{ kind: 'make-flood' }],
      },
    ]);
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
