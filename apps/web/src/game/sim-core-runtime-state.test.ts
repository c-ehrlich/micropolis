import { describe, expect, test } from 'vitest';

import { MAP_FLAGS } from '../../../../packages/sim-core/src/core/map-flags.ts';
import { SimCoreRuntimeState } from './sim-core-runtime-state';

describe('SimCoreRuntimeState', () => {
  test('creates one authority-owned bundle for map store, sim state/context, and tool context', () => {
    const authorityState = new SimCoreRuntimeState({ seed: 1234 });

    expect(authorityState.simContext.store).toBe(authorityState.store);
    expect(authorityState.toolContext.store).toBe(authorityState.store);
    expect(authorityState.toolContext.rng).toBe(authorityState.simContext.rng);
    expect(authorityState.toolContext.funds).toBe(authorityState.simState.TotalFunds);
    expect(authorityState.simState.SimMetaSpeed).toBe(authorityState.simState.SimSpeed);
  });

  test('applies explicit starting funds to authoritative state and tool context seed data', () => {
    const startingFunds = 12_345;
    const authorityState = new SimCoreRuntimeState({ startingFunds });

    expect(authorityState.simState.TotalFunds).toBe(startingFunds);
    expect(authorityState.toolContext.funds).toBe(startingFunds);
  });

  test('initialization marks s_scan.c NewMapFlags producers dirty', () => {
    const authorityState = new SimCoreRuntimeState({ seed: 7 });
    const flags = authorityState.simState.NewMapFlags;

    // `PTLScan`/`CrimeScan`/`PopDenScan`/`FireAnalysis` in `ref/micropolis/src/sim/s_scan.c`
    // set the listed NewMapFlags slots to 1 during DoSimInit bootstrap.
    expect(flags[MAP_FLAGS.DYMAP]).toBe(1);
    expect(flags[MAP_FLAGS.PLMAP]).toBe(1);
    expect(flags[MAP_FLAGS.LVMAP]).toBe(1);
    expect(flags[MAP_FLAGS.CRMAP]).toBe(1);
    expect(flags[MAP_FLAGS.POMAP]).toBe(1);
    expect(flags[MAP_FLAGS.PDMAP]).toBe(1);
    expect(flags[MAP_FLAGS.RGMAP]).toBe(1);
    expect(flags[MAP_FLAGS.FIMAP]).toBe(1);
  });
});
