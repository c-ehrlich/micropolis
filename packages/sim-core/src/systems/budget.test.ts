import {
  runCoreOracleCollectTax,
  runCoreOracleDoBudgetNow,
  runCoreOracleInitNewCity,
} from '@city/micropolis-c-harness/core-parity';
import { describe, expect, it } from 'vitest';

import { createSimContext } from '../core/sim-context.ts';
import { createSimState } from '../core/sim-state.ts';
import { collectTax, doBudgetNow, updateFundEffects } from './budget.ts';

describe('Budget system', () => {
  it('skips taxation when TaxFlag is set', () => {
    const state = createSimState();
    const context = createSimContext();
    state.TaxFlag = 1;
    state.CashFlow = 123;
    state.AvCityTax = 96;
    state.PoliceFund = 456;

    collectTax(state, context);

    expect(state.CashFlow).toBe(0);
    expect(state.AvCityTax).toBe(96);
    expect(state.PoliceFund).toBe(456);
  });

  it('collects taxes and applies autobudget with sufficient funds', () => {
    const calls: string[] = [];
    const hooks = {
      doUpdateHeads: () => calls.push('doUpdateHeads'),
      drawBudgetWindow: () => calls.push('drawBudgetWindow'),
      drawCurrPercents: () => calls.push('drawCurrPercents'),
      showBudgetWindowAndStartWaiting: () => calls.push('showBudgetWindowAndStartWaiting'),
      sendMes: () => calls.push('sendMes'),
    };
    const context = createSimContext({ hooks });
    const state = createSimState();

    state.TotalFunds = 1000;
    state.TotalPop = 100;
    state.LVAverage = 10;
    state.CityTax = 7;
    state.GameLevel = 1;
    state.PolicePop = 5;
    state.FireStPop = 2;
    state.RoadTotal = 10;
    state.RailTotal = 3;
    state.AvCityTax = 96;

    // Spec/C: RoadFund=(RoadTotal + RailTotal*2)*RLevels[GameLevel]
    // RLevels[1]=0.9 -> (10 + 3*2) * 0.9 = 14.4 => 14 (trunc).
    // Spec/C: TaxFund=((TotalPop*LVAverage)/120) * CityTax * FLevels[GameLevel]
    // ((100*10)/120)=8.33.. => 8, *7=56, *1.2=67.2 => 67 (trunc).
    collectTax(state, context);

    expect(state.PoliceFund).toBe(500);
    expect(state.FireFund).toBe(200);
    expect(state.RoadFund).toBe(14);
    expect(state.TaxFund).toBe(67);
    expect(state.CashFlow).toBe(-647);
    expect(state.TotalFunds).toBe(353);
    expect(state.FireSpend).toBe(200);
    expect(state.PoliceSpend).toBe(500);
    expect(state.RoadSpend).toBe(14);
    expect(state.AvCityTax).toBe(0);
    expect(calls).toContain('doUpdateHeads');
    expect(calls).not.toContain('showBudgetWindowAndStartWaiting');
  });

  it('reduces funding percentages in order when funds are insufficient', () => {
    const calls: string[] = [];
    const context = createSimContext({
      hooks: {
        showBudgetWindowAndStartWaiting: () => calls.push('showBudgetWindowAndStartWaiting'),
      },
    });
    const state = createSimState();

    state.autoBudget = false;
    state.TotalFunds = 150;
    state.TaxFund = 0;
    state.RoadFund = 100;
    state.FireFund = 100;
    state.PoliceFund = 100;
    state.roadPercent = 1;
    state.firePercent = 1;
    state.policePercent = 1;

    doBudgetNow(state, context, false);

    // Spec/C: allocate in order road -> fire -> police with remaining funds.
    // 150 total => road=100 (100%), fire=50 (50%), police=0 (0%).
    expect(state.roadPercent).toBe(1);
    expect(state.firePercent).toBeCloseTo(0.5);
    expect(state.policePercent).toBe(0);
    expect(state.RoadSpend).toBe(100);
    expect(state.FireSpend).toBe(50);
    expect(state.PoliceSpend).toBe(0);
    expect(state.TotalFunds).toBe(0);
    expect(calls).toEqual(['showBudgetWindowAndStartWaiting']);
  });

  it('turns off autobudget and sends a message when funds are insufficient', () => {
    const calls: string[] = [];
    const state = createSimState();
    state.StartingYear = 1900;
    state.CityTime = 0;
    const context = createSimContext({
      hooks: {
        sendMes: (id) => {
          calls.push(`sendMes:${id}`);
        },
        showBudgetWindowAndStartWaiting: () => calls.push('showBudgetWindowAndStartWaiting'),
      },
    });

    state.autoBudget = true;
    state.MessagePort = 7;
    state.LastPicNum = 12;
    state.TotalFunds = 150;
    state.TaxFund = 0;
    state.RoadFund = 100;
    state.FireFund = 100;
    state.PoliceFund = 100;
    state.roadPercent = 1;
    state.firePercent = 1;
    state.policePercent = 1;

    doBudgetNow(state, context, false);

    expect(state.autoBudget).toBe(false);
    // w_budget.c: DoUpdateHeads runs updateOptions and clears MustUpdateOptions.
    expect(state.MustUpdateOptions).toBe(0);
    expect(calls).toContain('sendMes:29');
    expect(calls).toContain('showBudgetWindowAndStartWaiting');
    // w_budget.c: ClearMes before SendMes(29) when autobudget runs out of funds.
    expect(state.LastPicNum).toBe(0);
    // w_update.c updateDate -> doMessage consumes MessagePort during the runUiUpdate/doUpdateHeads call.
    expect(state.MessagePort).toBe(0);
    expect(state.MesNum).toBe(29);
    expect(state.RoadSpend).toBe(100);
    expect(state.FireSpend).toBe(50);
    expect(state.PoliceSpend).toBe(0);
  });

  it('updates fund effects based on spend ratios', () => {
    const calls: string[] = [];
    const context = createSimContext({
      hooks: {
        drawCurrPercents: () => calls.push('drawCurrPercents'),
      },
    });
    const state = createSimState();

    state.RoadFund = 100;
    state.RoadSpend = 25;
    state.PoliceFund = 200;
    state.PoliceSpend = 50;
    state.FireFund = 0;
    state.FireSpend = 0;

    updateFundEffects(state, context);

    expect(state.RoadEffect).toBe(8);
    expect(state.PoliceEffect).toBe(250);
    expect(state.FireEffect).toBe(1000);
    expect(calls).toEqual(['drawCurrPercents']);
  });
});

describe('Budget parity against C oracle (env-gated)', () => {
  if (process.env.CITY_TEST_PARITY !== '1') {
    it.skip('run `pnpm test-parity` to enable C parity tests', () => {});
    return;
  }

  it('matches C CollectTax + autobudget spend path', () => {
    const oracleBefore = runCoreOracleInitNewCity({ seed: 0x0badc0de });
    oracleBefore.TotalFunds = 1000;
    oracleBefore.TotalPop = 100;
    oracleBefore.LVAverage = 10;
    oracleBefore.CityTax = 7;
    oracleBefore.GameLevel = 1;
    oracleBefore.PolicePop = 5;
    oracleBefore.FireStPop = 2;
    oracleBefore.RoadTotal = 10;
    oracleBefore.RailTotal = 3;
    oracleBefore.AvCityTax = 96;
    oracleBefore.autoBudget = 1;
    oracleBefore.roadPercent = 1;
    oracleBefore.firePercent = 1;
    oracleBefore.policePercent = 1;

    const oracleAfter = runCoreOracleCollectTax(oracleBefore);

    const context = createSimContext();
    const state = createSimState();
    state.TotalFunds = oracleBefore.TotalFunds;
    state.TotalPop = oracleBefore.TotalPop;
    state.LVAverage = oracleBefore.LVAverage;
    state.CityTax = oracleBefore.CityTax;
    state.GameLevel = oracleBefore.GameLevel;
    state.PolicePop = oracleBefore.PolicePop;
    state.FireStPop = oracleBefore.FireStPop;
    state.RoadTotal = oracleBefore.RoadTotal;
    state.RailTotal = oracleBefore.RailTotal;
    state.AvCityTax = oracleBefore.AvCityTax;
    state.autoBudget = oracleBefore.autoBudget !== 0;
    state.roadPercent = oracleBefore.roadPercent;
    state.firePercent = oracleBefore.firePercent;
    state.policePercent = oracleBefore.policePercent;

    // s_sim.c CollectTax constants: RLevels/FLevels with truncation on integer storage.
    collectTax(state, context);

    expect(state.TaxFund).toBe(oracleAfter.TaxFund);
    expect(state.RoadFund).toBe(oracleAfter.RoadFund);
    expect(state.FireFund).toBe(oracleAfter.FireFund);
    expect(state.PoliceFund).toBe(oracleAfter.PoliceFund);
    expect(state.CashFlow).toBe(oracleAfter.CashFlow);
    expect(state.TotalFunds).toBe(oracleAfter.TotalFunds);
    expect(state.RoadSpend).toBe(oracleAfter.RoadSpend);
    expect(state.FireSpend).toBe(oracleAfter.FireSpend);
    expect(state.PoliceSpend).toBe(oracleAfter.PoliceSpend);
    expect(state.AvCityTax).toBe(oracleAfter.AvCityTax);
  });

  it('matches C DoBudgetNow insufficient-funds warning flow', () => {
    const tickNow = 500;
    const oracleBefore = runCoreOracleInitNewCity({ seed: 0x00dd00dd, cityTime: 0 });
    oracleBefore.TickNow = tickNow;
    oracleBefore.autoBudget = 1;
    oracleBefore.MessagePort = 7;
    oracleBefore.LastPicNum = 12;
    oracleBefore.TotalFunds = 150;
    oracleBefore.TaxFund = 0;
    oracleBefore.RoadFund = 100;
    oracleBefore.FireFund = 100;
    oracleBefore.PoliceFund = 100;
    oracleBefore.roadPercent = 1;
    oracleBefore.firePercent = 1;
    oracleBefore.policePercent = 1;

    const oracleAfter = runCoreOracleDoBudgetNow({
      state: oracleBefore,
      fromMenu: false,
    });

    const context = createSimContext({
      hooks: {
        tickCount: () => tickNow,
      },
    });
    const state = createSimState();
    state.CityTime = oracleBefore.CityTime;
    state.StartingYear = oracleBefore.StartingYear;
    state.autoBudget = true;
    state.MessagePort = 7;
    state.LastPicNum = 12;
    state.TotalFunds = 150;
    state.TaxFund = 0;
    state.RoadFund = 100;
    state.FireFund = 100;
    state.PoliceFund = 100;
    state.roadPercent = 1;
    state.firePercent = 1;
    state.policePercent = 1;

    // w_budget.c `DoBudgetNow` no-money path clears messages then queues message 29.
    doBudgetNow(state, context, false);

    expect(state.autoBudget ? 1 : 0).toBe(oracleAfter.autoBudget);
    expect(state.MustUpdateOptions).toBe(oracleAfter.MustUpdateOptions);
    expect(state.LastPicNum).toBe(oracleAfter.LastPicNum);
    expect(state.MessagePort).toBe(oracleAfter.MessagePort);
    expect(state.MesNum).toBe(oracleAfter.MesNum);
    expect(state.LastMesTime).toBe(oracleAfter.LastMesTime);
    expect(state.RoadSpend).toBe(oracleAfter.RoadSpend);
    expect(state.FireSpend).toBe(oracleAfter.FireSpend);
    expect(state.PoliceSpend).toBe(oracleAfter.PoliceSpend);
    expect(state.TotalFunds).toBe(oracleAfter.TotalFunds);
  });
});
