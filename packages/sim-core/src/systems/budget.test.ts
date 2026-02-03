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
    const context = createSimContext({
      hooks: {
        sendMes: (id) => calls.push(`sendMes:${id}`),
        showBudgetWindowAndStartWaiting: () => calls.push('showBudgetWindowAndStartWaiting'),
      },
    });
    const state = createSimState();

    state.autoBudget = true;
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
    expect(state.MustUpdateOptions).toBe(1);
    expect(calls).toContain('sendMes:29');
    expect(calls).toContain('showBudgetWindowAndStartWaiting');
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
