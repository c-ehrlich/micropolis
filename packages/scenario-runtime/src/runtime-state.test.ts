import { describe, expect, it } from 'vitest';

import {
  advanceScenarioRuntimeState,
  createScenarioEventRuntimeState,
  createScenarioObjectiveRuntimeState,
  createScenarioRuntimeState,
  resolveScenarioObjective,
  type ScenarioRuntimeDefinition,
  tickScenarioEventRuntimeState,
  tickScenarioObjectiveRuntimeState,
} from './runtime-state.ts';

describe('scenario-runtime event countdown state', () => {
  it('matches ScenarioDisaster countdown/deactivate order', () => {
    let eventState = createScenarioEventRuntimeState({
      key: 'builtin/sf-earthquake',
      initialCountdown: 2,
      rules: [
        {
          when: { kind: 'countdown-equals', value: 1 },
          action: { kind: 'make-earthquake' },
        },
      ],
    });

    const firstTick = tickScenarioEventRuntimeState(eventState);
    eventState = firstTick.state;
    expect(firstTick.actions).toEqual([]);
    expect(eventState.countdown).toBe(1);
    expect(eventState.active).toBe(true);

    const secondTick = tickScenarioEventRuntimeState(eventState);
    eventState = secondTick.state;
    expect(secondTick.actions).toEqual([{ kind: 'make-earthquake' }]);
    expect(eventState.countdown).toBe(0);
    expect(eventState.active).toBe(true);

    const thirdTick = tickScenarioEventRuntimeState(eventState);
    eventState = thirdTick.state;
    expect(thirdTick.actions).toEqual([]);
    expect(eventState.countdown).toBe(0);
    expect(eventState.active).toBe(false);
  });

  it('supports countdown modulo triggers including the zero-countdown tick', () => {
    const eventState = createScenarioEventRuntimeState({
      key: 'builtin/rio-flood',
      /**
       * Magic numbers from C parity:
       * - `2 * 48`: scenario 8 `DisasterWait` table value from
       *   `ref/micropolis/src/sim/s_sim.c`.
       * - `24`: flood cadence check `DisasterWait % 24 == 0` in
       *   `ref/micropolis/src/sim/s_disast.c`.
       */
      initialCountdown: 2 * 48,
      rules: [
        {
          when: { kind: 'countdown-every', interval: 24 },
          action: { kind: 'make-flood' },
        },
      ],
    });

    let current = eventState;
    let floodEvents = 0;
    for (let i = 0; i < 97; i += 1) {
      const tick = tickScenarioEventRuntimeState(current);
      current = tick.state;
      floodEvents += tick.actions.length;
    }

    expect(current.active).toBe(false);
    expect(current.countdown).toBe(0);
    // Expected flood ticks: 96, 72, 48, 24, 0.
    expect(floodEvents).toBe(5);
  });
});

describe('scenario-runtime objective countdown state', () => {
  it('evaluates exactly once when countdown decrements to zero', () => {
    const objective = createScenarioObjectiveRuntimeState({
      key: 'builtin/sf-objective',
      /**
       * Magic number from `SCORE_WAIT_TABLE[2] = 5 * 48` in
       * `ref/micropolis/src/sim/s_sim.c`.
       */
      initialCountdown: 5 * 48,
      predicate: {
        kind: 'metric',
        metric: 'city-class',
        op: 'gte',
        value: 4,
      },
      successMessageId: -100,
      failureMessageId: -200,
      loseGameOnFailure: true,
    });

    let state = objective;
    for (let i = 0; i < 5 * 48 - 1; i += 1) {
      const tick = tickScenarioObjectiveRuntimeState(state);
      state = tick.state;
      expect(tick.shouldEvaluate).toBe(false);
    }

    const dueTick = tickScenarioObjectiveRuntimeState(state);
    state = dueTick.state;
    expect(dueTick.shouldEvaluate).toBe(true);
    expect(state.active).toBe(false);
    expect(state.countdown).toBe(0);

    const postDueTick = tickScenarioObjectiveRuntimeState(state);
    expect(postDueTick.shouldEvaluate).toBe(false);
  });
});

describe('scenario-runtime objective resolution', () => {
  it('matches classic DoScenarioScore success/failure message outcomes', () => {
    const objectiveDef = {
      key: 'builtin/dullsville-goal',
      initialCountdown: 1,
      /**
       * Magic numbers from `DoScenarioScore` in `ref/micropolis/src/sim/s_msg.c`:
       * - Success message id `-100`.
       * - Failure message id `-200`.
       */
      predicate: {
        kind: 'metric',
        metric: 'city-class',
        op: 'gte',
        value: 4,
      },
      successMessageId: -100,
      failureMessageId: -200,
      loseGameOnFailure: true,
    } as const;

    const success = resolveScenarioObjective(objectiveDef, {
      'city-class': 4,
      'traffic-average': 0,
      'city-score': 0,
      'crime-average': 0,
    });
    expect(success).toEqual({
      success: true,
      messageId: -100,
      shouldLoseGame: false,
    });

    const failure = resolveScenarioObjective(objectiveDef, {
      'city-class': 3,
      'traffic-average': 0,
      'city-score': 0,
      'crime-average': 0,
    });
    expect(failure).toEqual({
      success: false,
      messageId: -200,
      shouldLoseGame: true,
    });
  });
});

describe('scenario-runtime aggregate state', () => {
  it('advances event/objective state in one runtime tick', () => {
    const definition: ScenarioRuntimeDefinition = {
      key: 'builtin/demo',
      events: [
        {
          key: 'demo-event',
          initialCountdown: 1,
          rules: [
            {
              when: { kind: 'countdown-equals', value: 1 },
              action: { kind: 'drop-fire-bombs' },
            },
          ],
        },
      ],
      objective: {
        key: 'demo-objective',
        initialCountdown: 1,
        predicate: {
          kind: 'metric',
          metric: 'city-score',
          op: 'gt',
          value: 500,
        },
        successMessageId: -100,
        failureMessageId: -200,
        loseGameOnFailure: true,
      },
    };

    const runtimeState = createScenarioRuntimeState(definition);
    const firstTick = advanceScenarioRuntimeState(runtimeState);
    expect(firstTick.eventActions).toEqual([{ kind: 'drop-fire-bombs' }]);
    expect(firstTick.objectiveShouldEvaluate).toBe(true);
  });
});
