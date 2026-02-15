import { Tile } from '@city/sim-core';
import { describe, expect, test } from 'vitest';

import {
  createScenarioEditorRuntimeMapState,
  toScenarioEditorRuntimeRowMajorTiles,
} from './editor-map-runtime.ts';
import { createScenarioEditorInitialBundle } from './editor-state.tsx';

/**
 * Runtime map projection tests for the scenario editor.
 * Parity anchors:
 * - Source map words follow Micropolis x-major storage (`Map[x][y]`) from `s_alloc.c`.
 * - Runtime renderer buffer uses row-major indexing used by web map canvas.
 */
describe('scenario editor runtime map projection', () => {
  test('converts x-major words to row-major runtime tiles', () => {
    const tileWords = new Array<number>(120 * 100).fill(0);
    // Magic number source: x-major map index is `x * WORLD_Y + y` in
    // `ref/micropolis/src/sim/s_alloc.c` with `WORLD_Y=100`.
    tileWords[1 * 100 + 2] = Tile.ROADS;
    tileWords[5 * 100 + 9] = Tile.RIVER;

    const runtimeTiles = toScenarioEditorRuntimeRowMajorTiles(tileWords);

    // Runtime row-major index: `y * WORLD_X + x` for renderer buffers.
    expect(runtimeTiles[2 * 120 + 1]).toBe(Tile.ROADS);
    expect(runtimeTiles[9 * 120 + 5]).toBe(Tile.RIVER);
  });

  test('builds a snapshot-ready map state for MapCanvas', () => {
    const bundle = createScenarioEditorInitialBundle();
    const mapState = createScenarioEditorRuntimeMapState(bundle);

    expect(mapState.hasSnapshot).toBe(true);
    expect(mapState.width).toBe(120);
    expect(mapState.height).toBe(100);
    expect(mapState.tiles).toHaveLength(12000);
    expect(mapState.drawMode).toBe('snapshot');
    expect(mapState.blinkUnpoweredZoneCenter).toBe(false);
  });
});
