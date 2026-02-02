import { describe, expect, it } from 'vitest';

import { applyPatch, createClassicMapStore } from './map-store.ts';

describe('MapStore patches', () => {
  const getMapPatch = (store: ReturnType<typeof createClassicMapStore>) =>
    store.commitTick().patches.find((entry) => entry.layer === 'map');

  const normalizePatch = (patch: NonNullable<ReturnType<typeof getMapPatch>>) => {
    const rows = Array.from(patch.index, (index, idx) => ({
      index,
      prev: patch.prev[idx],
      next: patch.next[idx],
    }));
    rows.sort((a, b) => a.index - b.index);
    return rows;
  };

  it('applies patches to reproduce mutations', () => {
    const store = createClassicMapStore();
    const before = store.snapshot('map').slice();

    store.beginTick();
    store.write('map', 5, 1000);
    store.write('map', 42, 9000);
    const patch = getMapPatch(store);
    expect(patch).toBeDefined();

    const applied = applyPatch(before.slice(), patch!);
    const after = store.snapshot('map');

    expect(Array.from(applied)).toEqual(Array.from(after));
  });

  it('applies patches idempotently', () => {
    const store = createClassicMapStore();
    const before = store.snapshot('map').slice();

    store.beginTick();
    store.write('map', 10, 1234);
    store.write('map', 11, 4321);
    const patch = getMapPatch(store);
    expect(patch).toBeDefined();

    const appliedOnce = applyPatch(before.slice(), patch!);
    const appliedTwice = applyPatch(appliedOnce.slice(), patch!);

    expect(Array.from(appliedTwice)).toEqual(Array.from(appliedOnce));
  });

  it('swaps snapshots on commit', () => {
    const store = createClassicMapStore();
    const initial = store.snapshot('map')[0];

    store.beginTick();
    store.write('map', 0, 777);

    expect(store.snapshot('map')[0]).toBe(initial);

    store.commitTick();

    expect(store.snapshot('map')[0]).toBe(777);
  });

  it('skips no-op writes', () => {
    const store = createClassicMapStore();

    store.beginTick();
    store.write('map', 0, 0);
    const result = store.commitTick();

    expect(result.patches).toHaveLength(0);
  });

  it('records only the initial previous value when rewriting the same index', () => {
    const store = createClassicMapStore();

    store.beginTick();
    store.write('map', 5, 10);
    store.write('map', 5, 20);
    const patch = getMapPatch(store);

    expect(patch).toBeDefined();
    expect(Array.from(patch!.index)).toEqual([5]);
    expect(Array.from(patch!.prev)).toEqual([0]);
    expect(Array.from(patch!.next)).toEqual([20]);
  });

  it('produces deterministic patches regardless of write ordering', () => {
    const makePatch = (order: number[]) => {
      const store = createClassicMapStore();
      store.beginTick();
      for (const index of order) {
        store.write('map', index, index + 100);
      }
      return getMapPatch(store);
    };

    const patchA = makePatch([2, 5, 9]);
    const patchB = makePatch([9, 2, 5]);

    expect(patchA).toBeDefined();
    expect(patchB).toBeDefined();
    expect(normalizePatch(patchA!)).toEqual(normalizePatch(patchB!));
  });

  it('throws when used outside a tick', () => {
    const store = createClassicMapStore();

    expect(() => store.getLayer('map')).toThrow('outside of a tick');
    expect(() => store.write('map', 0, 1)).toThrow('outside of a tick');
    expect(() => store.commitTick()).toThrow('outside of a tick');
  });

  it('throws when beginning a tick twice', () => {
    const store = createClassicMapStore();

    store.beginTick();
    expect(() => store.beginTick()).toThrow('already in a tick');
  });
});

describe('applyPatch type coverage', () => {
  it('applies Uint8Array patches', () => {
    const target = new Uint8Array(4);
    const patch = {
      layer: 'popDensity' as const,
      index: Uint32Array.from([1, 3]),
      prev: Uint8Array.from([0, 0]),
      next: Uint8Array.from([7, 255]),
    };

    applyPatch(target, patch);

    expect(Array.from(target)).toEqual([0, 7, 0, 255]);
  });

  it('applies Int16Array patches with negative values', () => {
    const target = new Int16Array(4);
    const patch = {
      layer: 'rateOGMem' as const,
      index: Uint32Array.from([0, 2]),
      prev: Int16Array.from([0, 0]),
      next: Int16Array.from([-2, 32000]),
    };

    applyPatch(target, patch);

    expect(Array.from(target)).toEqual([-2, 0, 32000, 0]);
  });
});
