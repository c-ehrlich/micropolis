import { describe, expect, it } from 'vitest';

import { applyPatch, createClassicMapStore, type LayerArray, type LayerId } from './map-store.ts';

/**
 * Deterministic LCG for repeatable soak-write selection.
 * Parity note: deterministic seeds are test harness behavior, not a Micropolis RNG port.
 */
function createRng(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value;
  };
}

/**
 * Clone a layer snapshot for local replay verification.
 * Mirrors snapshot/replay-style consistency checks used across integration tests.
 */
function cloneLayer(layer: LayerArray): LayerArray {
  if (layer instanceof Uint16Array) {
    return layer.slice();
  }
  if (layer instanceof Uint8Array) {
    return layer.slice();
  }
  return layer.slice();
}

describe('DoubleBufferMapStore soak stability', () => {
  it('remains deterministic over multiple full cycle wraps of sustained writes', () => {
    const store = createClassicMapStore();
    const rand = createRng(0x5a17_2026);

    const trackedLayers: LayerId[] = ['map', 'popDensity', 'trfDensity'];
    const mirrors = new Map<LayerId, LayerArray>(
      trackedLayers.map((layer) => [layer, cloneLayer(store.snapshot(layer))]),
    );

    // Micropolis simulation cycles are 10-bit wrapped (`& 1023` in `sim.c`/`s_sim.c`).
    // Run 4 wraps to guard long-session stability with deterministic replay checks.
    const soakTicks = 4 * 1024;
    for (let tick = 0; tick < soakTicks; tick += 1) {
      store.beginTick();

      const mapLength = store.layerInfo('map').length;
      const popLength = store.layerInfo('popDensity').length;
      const trafficLength = store.layerInfo('trfDensity').length;

      for (let i = 0; i < 96; i += 1) {
        store.write('map', rand() % mapLength, rand() & 0xffff);
      }

      for (let i = 0; i < 64; i += 1) {
        store.write('popDensity', rand() % popLength, rand() & 0xff);
        store.write('trfDensity', rand() % trafficLength, rand() & 0xff);
      }

      const result = store.commitTick();
      for (const patch of result.patches) {
        const mirror = mirrors.get(patch.layer);
        if (!mirror) {
          continue;
        }
        applyPatch(mirror as never, patch);
      }

      if (tick % 256 === 0 || tick === soakTicks - 1) {
        for (const layer of trackedLayers) {
          const mirror = mirrors.get(layer);
          if (!mirror) {
            continue;
          }
          expect(Array.from(mirror)).toEqual(Array.from(store.snapshot(layer)));
        }
      }
    }
  });

  it('rejects out-of-bounds writes with stable errors', () => {
    const store = createClassicMapStore();

    store.beginTick();
    expect(() => store.write('map', -1, 1)).toThrow('out of bounds');
    expect(() => store.write('map', store.layerInfo('map').length, 1)).toThrow('out of bounds');
    expect(() => store.write('map', 2.5, 1)).toThrow('must be an integer');
  });
});
