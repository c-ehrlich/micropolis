import { describe, expect, it } from 'vitest';

import { createSimContext } from '../core/sim-context.ts';
import { createSimState } from '../core/sim-state.ts';
import { setValves } from './valves.ts';

describe('Demand valves', () => {
  it('computes projected populations, valves, and misc history snapshots', () => {
    const state = createSimState();
    const context = createSimContext();

    state.EMarket = 9;
    state.ResPop = 800;
    state.ComPop = 50;
    state.IndPop = 25;
    state.ResHis[1] = 120;
    state.ComHis[1] = 40;
    state.IndHis[1] = 20;
    state.CityTax = 7;
    state.GameLevel = 1;
    state.RValve = 100;
    state.CValve = 200;
    state.IValve = -100;
    state.CrimeRamp = 12;
    state.PolluteRamp = 34;
    state.LVAverage = 56;
    state.CrimeAverage = 78;
    state.PolluteAverage = 90;
    state.CityClass = 2;
    state.CityScore = 345;
    state.ValveFlag = 0;

    // C ref: SetValves in ref/micropolis/src/sim/s_sim.c.
    // NormResPop=ResPop/8=800/8=100 (integer division).
    // Employment=(40+20)/100=0.6, Migration=100*(0.6-1)=-40, Births=2, PjResPop=62.
    // LaborBase=ResHis[1]/(ComHis[1]+IndHis[1])=120/60=2 -> clamp 1.3.
    // IntMarket=(100+50+25)/3.7=47.297..., PjComPop=61.486...
    // GameLevel=1 => extMarket=1.1; PjIndPop=25*1.3*1.1=35.75.
    // Ratios: R=0.62, C=1.2297..., I=1.43. Tax index=8 => TaxTable[8]=-10.
    // Valve deltas: R=-238, C=127.832..., I=247.999... (float truncation).
    // RValve=100-238=-138, CValve=200+127.832...=327.832... -> 327 (trunc),
    // IValve=-100+247.999...=147 (trunc).
    setValves(state, context);

    expect(state.LastTotalPop).toBe(0);
    expect(state.TotalPop).toBe(175);
    expect(state.RValve).toBe(-138);
    expect(state.CValve).toBe(327);
    expect(state.IValve).toBe(147);
    expect(state.ValveFlag).toBe(1);

    expect(state.MiscHis[1]).toBe(9);
    expect(state.MiscHis[2]).toBe(800);
    expect(state.MiscHis[3]).toBe(50);
    expect(state.MiscHis[4]).toBe(25);
    expect(state.MiscHis[5]).toBe(100);
    expect(state.MiscHis[6]).toBe(200);
    expect(state.MiscHis[7]).toBe(-100);
    expect(state.MiscHis[10]).toBe(12);
    expect(state.MiscHis[11]).toBe(34);
    expect(state.MiscHis[12]).toBe(56);
    expect(state.MiscHis[13]).toBe(78);
    expect(state.MiscHis[14]).toBe(90);
    expect(state.MiscHis[15]).toBe(1);
    expect(state.MiscHis[16]).toBe(2);
    expect(state.MiscHis[17]).toBe(345);
  });

  it('clamps ratios and valves to configured caps', () => {
    const state = createSimState();
    const context = createSimContext();

    state.ResPop = 80;
    state.ComPop = 1;
    state.IndPop = 1;
    state.ResHis[1] = 30;
    state.ComHis[1] = 20;
    state.IndHis[1] = 20;
    state.CityTax = 0;
    state.GameLevel = 0;
    state.RValve = 1990;
    state.CValve = 1490;
    state.IValve = 1490;

    // C ref: SetValves in ref/micropolis/src/sim/s_sim.c.
    // NormResPop=10. Employment=(20+20)/10=4, PjResPop=40.2 => Rratio>2 (clamp).
    // PjComPop=IntMarket*LaborBase=3.243...*0.75=2.432... => Cratio>2 (clamp).
    // PjIndPop=min 5 => Iratio>2 (clamp). Tax index=0 => +200.
    // (2-1)*600+200=800, so valves exceed caps and clamp to R=2000, C=1500, I=1500.
    setValves(state, context);

    expect(state.RValve).toBe(2000);
    expect(state.CValve).toBe(1500);
    expect(state.IValve).toBe(1500);
  });

  it('zeroes positive valves when caps are set', () => {
    const state = createSimState();
    const context = createSimContext();

    state.ResPop = 80;
    state.ComPop = 0;
    state.IndPop = 0;
    state.ResHis[1] = 10;
    state.ComHis[1] = 5;
    state.IndHis[1] = 5;
    state.CityTax = 0;
    state.GameLevel = 0;
    state.RValve = 10;
    state.CValve = 10;
    state.IValve = 10;
    state.ResCap = 1;
    state.ComCap = 1;
    state.IndCap = 1;

    // C ref: SetValves in ref/micropolis/src/sim/s_sim.c.
    // Ratios are positive under these inputs, so valves rise above zero before cap checks.
    // Cap flags force R/C/I valves to 0 when positive.
    setValves(state, context);

    expect(state.RValve).toBe(0);
    expect(state.CValve).toBe(0);
    expect(state.IValve).toBe(0);
  });
});
