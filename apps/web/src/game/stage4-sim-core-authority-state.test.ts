import { describe, expect, test } from 'vitest';

import { Stage4SimCoreAuthorityState } from './stage4-sim-core-authority-state';

describe('Stage4SimCoreAuthorityState', () => {
  test('creates one authority-owned bundle for map store, sim state/context, and tool context', () => {
    const authorityState = new Stage4SimCoreAuthorityState({ seed: 1234 });

    expect(authorityState.simContext.store).toBe(authorityState.store);
    expect(authorityState.toolContext.store).toBe(authorityState.store);
    expect(authorityState.toolContext.rng).toBe(authorityState.simContext.rng);
    expect(authorityState.toolContext.funds).toBe(authorityState.simState.TotalFunds);
    expect(authorityState.simState.SimMetaSpeed).toBe(authorityState.simState.SimSpeed);
  });

  test('applies explicit starting funds to authoritative state and tool context seed data', () => {
    const startingFunds = 12_345;
    const authorityState = new Stage4SimCoreAuthorityState({ startingFunds });

    expect(authorityState.simState.TotalFunds).toBe(startingFunds);
    expect(authorityState.toolContext.funds).toBe(startingFunds);
  });
});
