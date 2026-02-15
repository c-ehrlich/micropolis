import { describe, expect, test } from 'vitest';

import {
  createScenarioEditorInitialBundle,
  createScenarioEditorInitialState,
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
  });

  test('transitions active view through reducer actions', () => {
    const initial = createScenarioEditorInitialState();
    const next = scenarioEditorReducer(initial, { type: 'set-active-view', view: 'map' });

    expect(next.activeView).toBe('map');
    expect(next.bundle).toBe(initial.bundle);
    expect(next.isDirty).toBe(false);
  });
});
