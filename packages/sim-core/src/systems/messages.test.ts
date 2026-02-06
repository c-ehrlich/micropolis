import {
  runCoreOracleInitNewCity,
  runCoreOracleSendMessages,
  runCoreOracleUpdateDate,
} from '@city/micropolis-c-harness/core-parity';
import { describe, expect, it, vi } from 'vitest';

import { createSimContext } from '../core/sim-context.ts';
import { createSimState } from '../core/sim-state.ts';
import { updateDate } from './date-time.ts';
import { checkGrowth, doScenarioScore, sendMes, sendMesAt, sendMessages } from './messages.ts';

describe('SendMes', () => {
  it('gates positive messages until the port is consumed', () => {
    const hooks = { sendMes: vi.fn() };
    const context = createSimContext({ hooks });
    const state = createSimState();

    state.StartingYear = 1900;
    state.CityTime = 0;

    // s_msg.c SendMes: positive messages can only enqueue when MessagePort is empty.
    expect(sendMes(state, context, 1)).toBe(true);
    expect(sendMes(state, context, 2)).toBe(false);
    expect(state.MessagePort).toBe(1);

    // w_update.c updateDate -> s_msg.c doMessage consumes MessagePort and triggers UI delivery.
    updateDate(state, context);
    expect(hooks.sendMes).toHaveBeenCalledWith(1);
    expect(state.MessagePort).toBe(0);

    expect(sendMes(state, context, 3)).toBe(true);
    updateDate(state, context);
    expect(hooks.sendMes).toHaveBeenCalledWith(3);
  });

  it('suppresses duplicate picture messages', () => {
    const hooks = { sendMes: vi.fn() };
    const context = createSimContext({ hooks });
    const state = createSimState();

    state.StartingYear = 1900;
    state.CityTime = 0;

    // s_msg.c SendMes: picture-message de-duplication is handled by LastPicNum.
    // Note that picture messages can *overwrite* MessagePort (they do not check MessagePort==0).
    expect(sendMes(state, context, -10)).toBe(true);
    expect(sendMes(state, context, -10)).toBe(false);
    expect(sendMes(state, context, -11)).toBe(true);

    // Only the final enqueued picture message is delivered when doMessage() runs.
    updateDate(state, context);
    expect(hooks.sendMes).toHaveBeenCalledWith(-11);
    // s_msg.c doMessage: picture messages requeue the positive id to show the text next.
    expect(state.MessagePort).toBe(11);
  });

  it('sends coordinate messages through the SendMesAt path', () => {
    const hooks = {
      sendMesAt: vi.fn(),
    };
    const context = createSimContext({ hooks });
    const state = createSimState();

    state.StartingYear = 1900;
    state.CityTime = 0;
    state.autoGo = false;

    // s_msg.c SendMesAt: if SendMes succeeds, it tags the message with MesX/MesY for doMessage().
    expect(sendMesAt(state, context, 12, 10, 20)).toBe(true);
    expect(state.MesX).toBe(10);
    expect(state.MesY).toBe(20);

    updateDate(state, context);
    expect(hooks.sendMesAt).toHaveBeenCalledWith(12, 10, 20);
  });
});

describe('doMessage parity', () => {
  it('requeues picture messages as text messages on the next heads tick', () => {
    const tick = { now: 0 };
    const hooks = { tickCount: () => tick.now, sendMes: vi.fn(), sendMesAt: vi.fn() };
    const context = createSimContext({ hooks });
    const state = createSimState();

    state.StartingYear = 1900;
    state.CityTime = 0;

    // s_msg.c SendMes only enqueues MessagePort; it does not invoke UI hooks directly.
    // w_update.c updateDate calls doMessage(), which consumes MessagePort and triggers UI.
    expect(sendMes(state, context, -10)).toBe(true);
    expect(hooks.sendMes).not.toHaveBeenCalled();

    // s_msg.c doMessage: negative ids are picture messages and requeue the positive id to show the
    // *text* message on the next doMessage() run via `MessagePort = pictId`.
    updateDate(state, context);
    expect(hooks.sendMes).toHaveBeenCalledWith(-10);
    expect(state.MessagePort).toBe(10);

    tick.now += 1;
    updateDate(state, context);
    expect(hooks.sendMes).toHaveBeenCalledWith(10);
    expect(state.MessagePort).toBe(0);
  });

  it('expires active text messages after 30 seconds (60 * 30 ticks)', () => {
    const tick = { now: 0 };
    const hooks = { tickCount: () => tick.now, sendMes: vi.fn() };
    const context = createSimContext({ hooks });
    const state = createSimState();

    state.StartingYear = 1900;
    state.CityTime = 0;

    // s_msg.c doMessage: positive messages remain active until TickCount()-LastMesTime > (60 * 30).
    expect(sendMes(state, context, 12)).toBe(true);
    updateDate(state, context);
    expect(state.MesNum).toBe(12);
    expect(state.LastMesTime).toBe(0);
    expect(hooks.sendMes).toHaveBeenCalledWith(12);

    tick.now = 60 * 30 + 1;
    updateDate(state, context);
    expect(state.MesNum).toBe(0);
  });
});

describe('CheckGrowth', () => {
  it('emits milestone messages on threshold crossings', () => {
    const hooks = { sendMes: vi.fn() };
    const context = createSimContext({ hooks });
    const state = createSimState();

    state.StartingYear = 1900;
    state.CityTime = 4;
    state.ResPop = 100;
    state.ComPop = 0;
    state.IndPop = 0;
    state.LastCityPop = 1900;
    state.LastCategory = 0;

    // Threshold 2000 -> message id -35, from CheckGrowth in ref/micropolis/src/sim/s_msg.c.
    checkGrowth(state, context);

    // s_msg.c CheckGrowth enqueues via SendMes; delivery happens later via doMessage() (updateDate).
    expect(state.MessagePort).toBe(-35);
    expect(hooks.sendMes).not.toHaveBeenCalled();

    updateDate(state, context);
    expect(hooks.sendMes).toHaveBeenCalledWith(-35);
    expect(state.LastCityPop).toBe(2000);
    expect(state.LastCategory).toBe(35);
  });
});

describe('DoScenarioScore', () => {
  it('sends the success message when the scenario condition is satisfied', () => {
    const hooks = {
      sendMes: vi.fn(),
      doLoseGame: vi.fn(),
    };
    const context = createSimContext({ hooks });
    const state = createSimState();

    state.StartingYear = 1900;
    state.CityTime = 0;
    state.CityScore = 600;

    // Scenario type 5 (Tokyo) succeeds when CityScore > 500 per s_msg.c.
    doScenarioScore(state, context, 5);

    updateDate(state, context);
    expect(hooks.sendMes).toHaveBeenCalledWith(-100);
    expect(hooks.doLoseGame).not.toHaveBeenCalled();
  });

  it('triggers game loss when scenario conditions fail', () => {
    const hooks = {
      sendMes: vi.fn(),
      doLoseGame: vi.fn(),
    };
    const context = createSimContext({ hooks });
    const state = createSimState();

    state.StartingYear = 1900;
    state.CityTime = 0;
    state.CrimeAverage = 100;

    // Scenario type 6 (Detroit) succeeds when CrimeAverage < 60 per s_msg.c.
    doScenarioScore(state, context, 6);

    updateDate(state, context);
    expect(hooks.sendMes).toHaveBeenCalledWith(-200);
    expect(hooks.doLoseGame).toHaveBeenCalledOnce();
  });
});

describe('SendMessages', () => {
  it('counts down scenario scores and dispatches DoScenarioScore', () => {
    const hooks = {
      sendMes: vi.fn(),
      doLoseGame: vi.fn(),
    };
    const context = createSimContext({ hooks });
    const state = createSimState();

    state.StartingYear = 1900;
    state.CityTime = 0;
    state.ScenarioID = 1;
    state.ScoreType = 1;
    state.ScoreWait = 1;
    state.CityClass = 4;

    // Scenario countdown in SendMessages (s_msg.c) should dispatch DoScenarioScore when ScoreWait hits 0.
    sendMessages(state, context);
    updateDate(state, context);

    expect(state.ScoreWait).toBe(0);
    expect(hooks.sendMes).toHaveBeenCalledWith(-100);
    expect(hooks.doLoseGame).not.toHaveBeenCalled();
  });

  it('emits threshold messages and updates caps at the boundary', () => {
    const hooks = { sendMes: vi.fn() };
    const context = createSimContext({ hooks });
    const state = createSimState();

    state.StartingYear = 1900;
    state.CityTime = 26;
    state.ResPop = 501;
    state.StadiumPop = 0;

    // Stadium demand message 7 and ResCap logic from SendMessages in s_msg.c.
    sendMessages(state, context);
    updateDate(state, context);

    expect(hooks.sendMes).toHaveBeenCalledWith(7);
    expect(state.ResCap).toBe(1);

    state.CityTime = 1;
    state.ResZPop = 2;
    state.ComZPop = 3;
    state.IndZPop = 3;

    // TotalZPop/4 >= ResZPop triggers message 1 at equality (s_msg.c).
    sendMessages(state, context);
    updateDate(state, context);

    expect(hooks.sendMes).toHaveBeenCalledWith(1);
  });

  it('clears residential cap when stadium demand is satisfied', () => {
    const hooks = { sendMes: vi.fn() };
    const context = createSimContext({ hooks });
    const state = createSimState();

    state.StartingYear = 1900;
    state.CityTime = 26;
    state.ResPop = 600;
    state.StadiumPop = 1;
    state.ResCap = 1;

    // Stadium cap reset logic from SendMessages in s_msg.c.
    sendMessages(state, context);
    updateDate(state, context);

    expect(state.ResCap).toBe(0);
    expect(hooks.sendMes).not.toHaveBeenCalled();
  });
});

describe('Messages parity against C oracle (env-gated)', () => {
  if (process.env.CITY_TEST_PARITY !== '1') {
    it.skip('run `pnpm test-parity` to enable C parity tests', () => {});
    return;
  }

  it('matches C scenario score countdown + message port consumption', () => {
    const tickNow = 12_345;
    const oracleBefore = runCoreOracleInitNewCity({ seed: 0x01020304, cityTime: 0, cityTax: 7 });
    oracleBefore.TickNow = tickNow;
    oracleBefore.ScenarioID = 1;
    oracleBefore.ScoreType = 1;
    oracleBefore.ScoreWait = 1;
    oracleBefore.CityClass = 4;

    const oracleAfterSend = runCoreOracleSendMessages(oracleBefore);
    const oracleAfter = runCoreOracleUpdateDate(oracleAfterSend);

    const context = createSimContext({
      hooks: {
        tickCount: () => tickNow,
      },
    });
    const state = createSimState();
    state.CityTime = oracleBefore.CityTime;
    state.StartingYear = oracleBefore.StartingYear;
    state.ScenarioID = oracleBefore.ScenarioID;
    state.ScoreType = oracleBefore.ScoreType;
    state.ScoreWait = oracleBefore.ScoreWait;
    state.CityClass = oracleBefore.CityClass;
    state.MessagePort = oracleBefore.MessagePort;
    state.MesNum = oracleBefore.MesNum;
    state.MesX = oracleBefore.MesX;
    state.MesY = oracleBefore.MesY;
    state.LastMesTime = oracleBefore.LastMesTime;
    state.LastPicNum = oracleBefore.LastPicNum;

    // s_msg.c SendMessages: ScoreWait countdown triggers DoScenarioScore at 0.
    sendMessages(state, context);
    // w_update.c updateDate always calls s_msg.c doMessage for message-port consumption.
    updateDate(state, context);

    expect(state.ScoreWait).toBe(oracleAfter.ScoreWait);
    expect(state.MessagePort).toBe(oracleAfter.MessagePort);
    expect(state.MesNum).toBe(oracleAfter.MesNum);
    expect(state.LastMesTime).toBe(oracleAfter.LastMesTime);
    expect(state.LastPicNum).toBe(oracleAfter.LastPicNum);
  });

  it('matches C megalinium rollover message behavior', () => {
    const tickNow = 77;
    const oracleBefore = runCoreOracleInitNewCity({ seed: 0x00abc123, cityTax: 7 });
    // w_update.c updateDate uses `megalinium = 1000000` and computes year as `CityTime/48 + StartingYear`.
    oracleBefore.CityTime = (1_000_000 - oracleBefore.StartingYear) * 48;
    oracleBefore.TickNow = tickNow;
    oracleBefore.MessagePort = 0;
    oracleBefore.MesNum = 0;
    oracleBefore.LastMesTime = 0;

    const oracleAfter = runCoreOracleUpdateDate(oracleBefore);

    const context = createSimContext({
      hooks: {
        tickCount: () => tickNow,
      },
    });
    const state = createSimState();
    state.StartingYear = oracleBefore.StartingYear;
    state.CityTime = oracleBefore.CityTime;
    state.MessagePort = oracleBefore.MessagePort;
    state.MesNum = oracleBefore.MesNum;
    state.LastMesTime = oracleBefore.LastMesTime;

    // w_update.c rollover path queues SendMes(-40), then doMessage requeues text id 40.
    updateDate(state, context);

    expect(state.CityTime).toBe(oracleAfter.CityTime);
    expect(state.LastCityYear).toBe(oracleAfter.LastCityYear);
    expect(state.LastCityMonth).toBe(oracleAfter.LastCityMonth);
    expect(state.MessagePort).toBe(oracleAfter.MessagePort);
    expect(state.MesNum).toBe(oracleAfter.MesNum);
  });
});
