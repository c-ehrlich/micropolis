import { getCoreBridgeV1SnapshotTileIndex } from '@city/core-bridge';
import {
  SCENARIO_BUNDLE_V1_MAP_HEIGHT,
  SCENARIO_BUNDLE_V1_MAP_WIDTH,
  type ScenarioBundleV1,
} from '@city/scenario-core';

import type { RuntimeMapState } from '../../../web/src/game/runtime/map-state.ts';
import { getScenarioEditorMapTileWords } from './editor-map.ts';

const EMPTY_DIRTY_TILE_INDEXES = new Uint32Array(0);
const EMPTY_DIRTY_RECTS = Object.freeze([] as const);

/**
 * Runtime-map projection options for scenario editor rendering.
 * Not from Micropolis C: editor-only draw-state toggles layered on top of
 * canonical map tiles for `MapCanvas` behavior parity.
 */
export interface ScenarioEditorRuntimeMapStateOptions {
  readonly blinkUnpoweredZoneCenter?: boolean;
}

/**
 * Builds one runtime-map projection from scenario bundle map words.
 * Mirrors Micropolis x-major map storage (`Map[x][y]`) from
 * `ref/micropolis/src/sim/s_alloc.c`; parity difference: output tiles are row-major
 * for `MapCanvas` rendering, matching runtime conversion in `apps/web`.
 */
export function createScenarioEditorRuntimeMapState(bundle: ScenarioBundleV1): RuntimeMapState {
  return createScenarioEditorRuntimeMapStateWithOptions(bundle);
}

/**
 * Builds one runtime-map projection from scenario bundle map words.
 * Mirrors Micropolis x-major map storage (`Map[x][y]`) from
 * `ref/micropolis/src/sim/s_alloc.c`; parity difference: output tiles are row-major
 * for `MapCanvas` rendering, matching runtime conversion in `apps/web`.
 */
export function createScenarioEditorRuntimeMapStateWithOptions(
  bundle: ScenarioBundleV1,
  options: ScenarioEditorRuntimeMapStateOptions = {},
): RuntimeMapState {
  const tileWords = getScenarioEditorMapTileWords(bundle);
  return {
    hasSnapshot: true,
    width: SCENARIO_BUNDLE_V1_MAP_WIDTH,
    height: SCENARIO_BUNDLE_V1_MAP_HEIGHT,
    tiles: toScenarioEditorRuntimeRowMajorTiles(tileWords),
    blinkUnpoweredZoneCenter: options.blinkUnpoweredZoneCenter ?? false,
    dirtyTileIndexes: EMPTY_DIRTY_TILE_INDEXES,
    dirtyRects: EMPTY_DIRTY_RECTS,
    drawMode: 'snapshot',
    // Snapshot-only projection for editor view; epoch is stable and redraw is driven
    // by React state object identity changes.
    renderEpoch: 1,
  };
}

/**
 * Convert classic x-major map words to row-major runtime tile buffer.
 * Mirrors bridge/runtime conversion semantics from
 * `apps/web/src/game/runtime/map-state.ts` (`convertSnapshotTileWordsToRuntimeTiles`).
 */
export function toScenarioEditorRuntimeRowMajorTiles(tileWords: readonly number[]): Uint16Array {
  const runtimeTiles = new Uint16Array(
    SCENARIO_BUNDLE_V1_MAP_WIDTH * SCENARIO_BUNDLE_V1_MAP_HEIGHT,
  );
  for (let x = 0; x < SCENARIO_BUNDLE_V1_MAP_WIDTH; x += 1) {
    for (let y = 0; y < SCENARIO_BUNDLE_V1_MAP_HEIGHT; y += 1) {
      const sourceIndex = getCoreBridgeV1SnapshotTileIndex(x, y, SCENARIO_BUNDLE_V1_MAP_HEIGHT);
      const runtimeIndex = toScenarioEditorRuntimeTileIndex(x, y, SCENARIO_BUNDLE_V1_MAP_WIDTH);
      runtimeTiles[runtimeIndex] = tileWords[sourceIndex] ?? 0;
    }
  }

  return runtimeTiles;
}

/**
 * Compute row-major runtime tile index (`y * width + x`).
 * Mirrors renderer indexing in `apps/web/src/presentation/map/map-canvas.tsx`.
 */
function toScenarioEditorRuntimeTileIndex(x: number, y: number, width: number): number {
  return y * width + x;
}
