import { describe, expect, it, vi } from 'vitest';

import { createSimContext } from '../core/sim-context.ts';
import { createSimState } from '../core/sim-state.ts';
import {
  _consumeMessagePort,
  checkGrowth,
  doScenarioScore,
  sendMes,
  sendMesAt,
  sendMessages,
} from './messages.ts';

describe('SendMes', () => {
  it('gates positive messages until the port is consumed', () => {
    const sent: number[] = [];
    const context = createSimContext({
      hooks: {
        sendMes: (id) => sent.push(id),
      },
    });
    const state = createSimState();

    state.CityTime = 100;

    // SendMes forwards message ids directly (ref/micropolis/src/sim/s_msg.c).
    expect(sendMes(state, context, 1)).toBe(true);
    expect(sendMes(state, context, 2)).toBe(false);
    expect(_consumeMessagePort(state)).toEqual({ id: 1, x: 0, y: 0 });
    expect(sendMes(state, context, 3)).toBe(true);
    expect(sent).toEqual([1, 3]);
  });

  it('suppresses duplicate picture messages', () => {
    const sent: number[] = [];
    const context = createSimContext({
      hooks: {
        sendMes: (id) => sent.push(id),
      },
    });
    const state = createSimState();

    state.CityTime = 4;

    // Picture-message de-duplication is handled by LastPicNum in SendMes (s_msg.c).
    expect(sendMes(state, context, -10)).toBe(true);
    expect(sendMes(state, context, -10)).toBe(false);
    expect(sendMes(state, context, -11)).toBe(true);
    expect(sent).toEqual([-10, -11]);
  });

  it('sends coordinate messages through the SendMesAt path', () => {
    const hooks = {
      sendMesAt: vi.fn(),
    };
    const context = createSimContext({ hooks });
    const state = createSimState();

    state.CityTime = 12;

    // SendMesAt forwards ids and coordinates verbatim (s_msg.c).
    expect(sendMesAt(state, context, -43, 10, 20)).toBe(true);
    expect(hooks.sendMesAt).toHaveBeenCalledWith(-43, 10, 20);
    expect(state.MesX).toBe(10);
    expect(state.MesY).toBe(20);
  });
});

describe('CheckGrowth', () => {
  it('emits milestone messages on threshold crossings', () => {
    const sent: number[] = [];
    const context = createSimContext({
      hooks: {
        sendMes: (id) => sent.push(id),
      },
    });
    const state = createSimState();

    state.CityTime = 4;
    state.ResPop = 100;
    state.ComPop = 0;
    state.IndPop = 0;
    state.LastCityPop = 1900;
    state.LastCategory = 0;

    // Threshold 2000 -> message id -35, from CheckGrowth in ref/micropolis/src/sim/s_msg.c.
    checkGrowth(state, context);

    expect(sent).toEqual([-35]);
    expect(state.LastCityPop).toBe(2000);
    expect(state.LastCategory).toBe(35);
  });
});

describe('DoScenarioScore', () => {
  it('sends the success message when the scenario condition is satisfied', () => {
    const sent: number[] = [];
    const hooks = {
      sendMes: (id: number) => sent.push(id),
      doLoseGame: vi.fn(),
    };
    const context = createSimContext({ hooks });
    const state = createSimState();

    state.CityScore = 600;

    // Scenario type 5 (Tokyo) succeeds when CityScore > 500 per s_msg.c.
    doScenarioScore(state, context, 5);

    expect(sent).toEqual([-100]);
    expect(hooks.doLoseGame).not.toHaveBeenCalled();
  });

  it('triggers game loss when scenario conditions fail', () => {
    const sent: number[] = [];
    const hooks = {
      sendMes: (id: number) => sent.push(id),
      doLoseGame: vi.fn(),
    };
    const context = createSimContext({ hooks });
    const state = createSimState();

    state.CrimeAverage = 100;

    // Scenario type 6 (Detroit) succeeds when CrimeAverage < 60 per s_msg.c.
    doScenarioScore(state, context, 6);

    expect(sent).toEqual([-200]);
    expect(hooks.doLoseGame).toHaveBeenCalledOnce();
  });
});

describe('SendMessages', () => {
  it('counts down scenario scores and dispatches DoScenarioScore', () => {
    const sent: number[] = [];
    const hooks = {
      sendMes: (id: number) => sent.push(id),
      doLoseGame: vi.fn(),
    };
    const context = createSimContext({ hooks });
    const state = createSimState();

    state.CityTime = 0;
    state.ScenarioID = 1;
    state.ScoreType = 1;
    state.ScoreWait = 1;
    state.CityClass = 4;

    // Scenario countdown in SendMessages (s_msg.c) should dispatch DoScenarioScore when ScoreWait hits 0.
    sendMessages(state, context);

    expect(state.ScoreWait).toBe(0);
    expect(sent).toEqual([-100]);
    expect(hooks.doLoseGame).not.toHaveBeenCalled();
  });

  it('emits threshold messages and updates caps at the boundary', () => {
    const sent: number[] = [];
    const context = createSimContext({
      hooks: {
        sendMes: (id) => sent.push(id),
      },
    });
    const state = createSimState();

    state.CityTime = 26;
    state.ResPop = 501;
    state.StadiumPop = 0;

    // Stadium demand message 7 and ResCap logic from SendMessages in s_msg.c.
    sendMessages(state, context);

    expect(sent).toEqual([7]);
    expect(state.ResCap).toBe(1);

    // Simulate the UI consuming the queued message like doMessage() in s_msg.c.
    _consumeMessagePort(state);

    state.CityTime = 1;
    state.ResZPop = 2;
    state.ComZPop = 3;
    state.IndZPop = 3;

    // TotalZPop/4 >= ResZPop triggers message 1 at equality (s_msg.c).
    sendMessages(state, context);

    expect(sent).toEqual([7, 1]);
  });

  it('clears residential cap when stadium demand is satisfied', () => {
    const hooks = { sendMes: vi.fn() };
    const context = createSimContext({ hooks });
    const state = createSimState();

    state.CityTime = 26;
    state.ResPop = 600;
    state.StadiumPop = 1;
    state.ResCap = 1;

    // Stadium cap reset logic from SendMessages in s_msg.c.
    sendMessages(state, context);

    expect(state.ResCap).toBe(0);
    expect(hooks.sendMes).not.toHaveBeenCalled();
  });
});
