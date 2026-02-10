import { describe, expect, it } from 'vitest';

import {
  CoreBridgeV1SequenceAction,
  CoreBridgeV1SequenceReason,
  type CoreBridgeV1SequenceState,
  createCoreBridgeV1SequenceState,
  evaluateCoreBridgeV1SequenceDecision,
  getCoreBridgeV1ExpectedServerSeq,
} from './sequencing.ts';

describe('createCoreBridgeV1SequenceState', () => {
  it('creates an empty cursor by default', () => {
    expect(createCoreBridgeV1SequenceState()).toEqual({
      lastAppliedServerSeq: null,
      lastTick: null,
    });
  });

  it('accepts an explicit replay cursor seed', () => {
    expect(
      createCoreBridgeV1SequenceState({
        lastAppliedServerSeq: 24,
        lastTick: 12,
      }),
    ).toEqual({
      lastAppliedServerSeq: 24,
      lastTick: 12,
    });
  });
});

describe('evaluateCoreBridgeV1SequenceDecision', () => {
  /**
   * Tick values model monotonic CityTime progression from
   * `ref/micropolis/src/sim/s_sim.c` (`CityTime++` in `Simulate` case `mod16 == 0`).
   * Sequence values are synthetic Bridge V1 wire-order counters; small consecutive
   * integers are used here as the minimal deterministic examples.
   */
  const cases: ReadonlyArray<{
    readonly name: string;
    readonly state: CoreBridgeV1SequenceState;
    readonly incoming: { readonly serverSeq: number; readonly tick: number };
    readonly expectedAction: CoreBridgeV1SequenceAction;
    readonly expectedReason: CoreBridgeV1SequenceReason;
    readonly expectedState: CoreBridgeV1SequenceState;
    readonly expectedServerSeq: number;
  }> = [
    {
      name: 'in-order apply advances state',
      state: createCoreBridgeV1SequenceState({
        lastAppliedServerSeq: 10,
        lastTick: 100,
      }),
      incoming: { serverSeq: 11, tick: 101 },
      expectedAction: CoreBridgeV1SequenceAction.APPLY,
      expectedReason: CoreBridgeV1SequenceReason.IN_ORDER,
      expectedState: {
        lastAppliedServerSeq: 11,
        lastTick: 101,
      },
      expectedServerSeq: 11,
    },
    {
      name: 'same tick with higher sequence still applies',
      state: createCoreBridgeV1SequenceState({
        lastAppliedServerSeq: 10,
        lastTick: 100,
      }),
      incoming: { serverSeq: 11, tick: 100 },
      expectedAction: CoreBridgeV1SequenceAction.APPLY,
      expectedReason: CoreBridgeV1SequenceReason.IN_ORDER,
      expectedState: {
        lastAppliedServerSeq: 11,
        lastTick: 100,
      },
      expectedServerSeq: 11,
    },
    {
      name: 'stale sequence is dropped',
      state: createCoreBridgeV1SequenceState({
        lastAppliedServerSeq: 10,
        lastTick: 100,
      }),
      incoming: { serverSeq: 10, tick: 100 },
      expectedAction: CoreBridgeV1SequenceAction.DROP,
      expectedReason: CoreBridgeV1SequenceReason.STALE_SERVER_SEQ,
      expectedState: {
        lastAppliedServerSeq: 10,
        lastTick: 100,
      },
      expectedServerSeq: 11,
    },
    {
      name: 'server sequence gap requests resync',
      state: createCoreBridgeV1SequenceState({
        lastAppliedServerSeq: 10,
        lastTick: 100,
      }),
      incoming: { serverSeq: 13, tick: 101 },
      expectedAction: CoreBridgeV1SequenceAction.RESYNC,
      expectedReason: CoreBridgeV1SequenceReason.SERVER_SEQ_GAP,
      expectedState: {
        lastAppliedServerSeq: 10,
        lastTick: 100,
      },
      expectedServerSeq: 11,
    },
    {
      name: 'tick regression requests resync',
      state: createCoreBridgeV1SequenceState({
        lastAppliedServerSeq: 10,
        lastTick: 100,
      }),
      incoming: { serverSeq: 11, tick: 99 },
      expectedAction: CoreBridgeV1SequenceAction.RESYNC,
      expectedReason: CoreBridgeV1SequenceReason.TICK_REGRESSION,
      expectedState: {
        lastAppliedServerSeq: 10,
        lastTick: 100,
      },
      expectedServerSeq: 11,
    },
  ];

  for (const testCase of cases) {
    it(testCase.name, () => {
      const decision = evaluateCoreBridgeV1SequenceDecision(testCase.state, testCase.incoming);

      expect(decision.action).toBe(testCase.expectedAction);
      expect(decision.reason).toBe(testCase.expectedReason);
      expect(decision.nextState).toEqual(testCase.expectedState);
      expect(decision.expectedServerSeq).toBe(testCase.expectedServerSeq);
    });
  }

  it('treats the first event as the baseline apply', () => {
    const decision = evaluateCoreBridgeV1SequenceDecision(createCoreBridgeV1SequenceState(), {
      serverSeq: 42,
      tick: 200,
    });

    expect(decision.action).toBe(CoreBridgeV1SequenceAction.APPLY);
    expect(decision.reason).toBe(CoreBridgeV1SequenceReason.INITIAL_EVENT);
    expect(decision.expectedServerSeq).toBe(42);
    expect(decision.nextState).toEqual({
      lastAppliedServerSeq: 42,
      lastTick: 200,
    });
  });
});

describe('getCoreBridgeV1ExpectedServerSeq', () => {
  it('uses incoming sequence when no cursor has been applied yet', () => {
    expect(getCoreBridgeV1ExpectedServerSeq(createCoreBridgeV1SequenceState(), 7)).toBe(7);
  });

  it('increments from the last applied sequence when cursor is initialized', () => {
    expect(
      getCoreBridgeV1ExpectedServerSeq(
        createCoreBridgeV1SequenceState({
          lastAppliedServerSeq: 7,
          lastTick: 10,
        }),
        99,
      ),
    ).toBe(8);
  });
});
