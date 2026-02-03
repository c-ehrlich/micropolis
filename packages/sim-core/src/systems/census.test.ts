import { describe, expect, it, vi } from 'vitest';

import { createClassicMapStore } from '../core/map-store.ts';
import { createSimContext } from '../core/sim-context.ts';
import { createSimState } from '../core/sim-state.ts';
import { clearCensus, take2Census, takeCensus } from './census.ts';

describe('Census system', () => {
  it('clears per-tick counters and resets fire/police maps', () => {
    const store = createClassicMapStore();
    const state = createSimState();
    const context = createSimContext({ store });

    state.PwrdZCnt = 4;
    state.unPwrdZCnt = 3;
    state.FirePop = 7;
    state.RoadTotal = 11;
    state.RailTotal = 12;
    state.ResPop = 13;
    state.ComPop = 14;
    state.IndPop = 15;
    state.ResZPop = 16;
    state.ComZPop = 17;
    state.IndZPop = 18;
    state.HospPop = 19;
    state.ChurchPop = 20;
    state.PolicePop = 21;
    state.FireStPop = 22;
    state.StadiumPop = 23;
    state.CoalPop = 24;
    state.NuclearPop = 25;
    state.PortPop = 26;
    state.APortPop = 27;
    state.PowerStackNum = 6;

    store.beginTick();
    store.write('fireStMap', 0, 5);
    store.write('policeMap', 0, 9);

    clearCensus(state, context);

    expect(state.PwrdZCnt).toBe(0);
    expect(state.unPwrdZCnt).toBe(0);
    expect(state.FirePop).toBe(0);
    expect(state.RoadTotal).toBe(0);
    expect(state.RailTotal).toBe(0);
    expect(state.ResPop).toBe(0);
    expect(state.ComPop).toBe(0);
    expect(state.IndPop).toBe(0);
    expect(state.ResZPop).toBe(0);
    expect(state.ComZPop).toBe(0);
    expect(state.IndZPop).toBe(0);
    expect(state.HospPop).toBe(0);
    expect(state.ChurchPop).toBe(0);
    expect(state.PolicePop).toBe(0);
    expect(state.FireStPop).toBe(0);
    expect(state.StadiumPop).toBe(0);
    expect(state.CoalPop).toBe(0);
    expect(state.NuclearPop).toBe(0);
    expect(state.PortPop).toBe(0);
    expect(state.APortPop).toBe(0);
    expect(state.PowerStackNum).toBe(0);

    const fireStMap = store.getLayer('fireStMap') as Int16Array;
    const policeMap = store.getLayer('policeMap') as Int16Array;
    expect(fireStMap[0]).toBe(0);
    expect(policeMap[0]).toBe(0);
    store.commitTick();
  });

  it('shifts 10-year histories, updates ramps, graphs, and needs', () => {
    const store = createClassicMapStore();
    const changeCensus = vi.fn();
    const context = createSimContext({ store, hooks: { changeCensus } });
    const state = createSimState();

    state.ResHis[0] = 10;
    state.ResHis[118] = 70;
    state.ResHis[119] = 200;
    state.ComHis[0] = 20;
    state.ComHis[118] = 90;
    state.ComHis[119] = 150;
    state.IndHis[0] = 30;
    state.IndHis[118] = 80;
    state.IndHis[119] = 160;
    state.CrimeHis[0] = 33;
    state.PollutionHis[0] = 44;
    state.MoneyHis[0] = 77;

    state.ResPop = 1024;
    state.ComPop = 12;
    state.IndPop = 7;
    state.CrimeRamp = 300;
    state.CrimeAverage = 300;
    state.PolluteRamp = 10;
    state.PolluteAverage = 18;
    state.CashFlow = 5000;
    state.HospPop = 3;
    state.ChurchPop = 5;

    takeCensus(state, context);

    expect(state.ResHis[1]).toBe(10);
    expect(state.ResHis[119]).toBe(70);
    expect(state.ComHis[1]).toBe(20);
    expect(state.ComHis[119]).toBe(90);
    expect(state.IndHis[1]).toBe(30);
    expect(state.IndHis[119]).toBe(80);
    expect(state.CrimeHis[1]).toBe(33);
    expect(state.PollutionHis[1]).toBe(44);
    expect(state.MoneyHis[1]).toBe(77);

    expect(state.ResHisMax).toBe(70);
    expect(state.ComHisMax).toBe(90);
    expect(state.IndHisMax).toBe(80);
    expect(state.Graph10Max).toBe(90);

    expect(state.ResHis[0]).toBe(128);
    expect(state.ComHis[0]).toBe(12);
    expect(state.IndHis[0]).toBe(7);
    expect(state.CrimeRamp).toBe(300);
    expect(state.CrimeHis[0]).toBe(255);
    expect(state.PolluteRamp).toBe(12);
    expect(state.PollutionHis[0]).toBe(12);
    expect(state.MoneyHis[0]).toBe(255);

    expect(state.NeedHosp).toBe(1);
    expect(state.NeedChurch).toBe(-1);
    expect(changeCensus).toHaveBeenCalledTimes(1);
  });

  it('shifts 120-year histories and copies current census values', () => {
    const store = createClassicMapStore();
    const changeCensus = vi.fn();
    const context = createSimContext({ store, hooks: { changeCensus } });
    const state = createSimState();

    state.ResHis[120] = 5;
    state.ResHis[238] = 70;
    state.ResHis[239] = 200;
    state.ComHis[120] = 6;
    state.ComHis[238] = 90;
    state.ComHis[239] = 150;
    state.IndHis[120] = 7;
    state.IndHis[238] = 80;
    state.IndHis[239] = 160;
    state.CrimeHis[0] = 11;
    state.PollutionHis[0] = 22;
    state.MoneyHis[0] = 33;

    state.ResPop = 80;
    state.ComPop = 12;
    state.IndPop = 7;

    take2Census(state, context);

    expect(state.ResHis[121]).toBe(5);
    expect(state.ResHis[239]).toBe(70);
    expect(state.ComHis[121]).toBe(6);
    expect(state.ComHis[239]).toBe(90);
    expect(state.IndHis[121]).toBe(7);
    expect(state.IndHis[239]).toBe(80);

    expect(state.Res2HisMax).toBe(70);
    expect(state.Com2HisMax).toBe(90);
    expect(state.Ind2HisMax).toBe(80);
    expect(state.Graph120Max).toBe(90);

    expect(state.ResHis[120]).toBe(10);
    expect(state.ComHis[120]).toBe(12);
    expect(state.IndHis[120]).toBe(7);
    expect(state.CrimeHis[120]).toBe(11);
    expect(state.PollutionHis[120]).toBe(22);
    expect(state.MoneyHis[120]).toBe(33);

    expect(changeCensus).toHaveBeenCalledTimes(1);
  });

  it('clamps money at zero and clears need flags when counts match', () => {
    const store = createClassicMapStore();
    const changeCensus = vi.fn();
    const context = createSimContext({ store, hooks: { changeCensus } });
    const state = createSimState();

    state.ResPop = 256;
    state.HospPop = 1;
    state.ChurchPop = 1;
    state.CashFlow = -10000;

    takeCensus(state, context);

    expect(state.MoneyHis[0]).toBe(0);
    expect(state.NeedHosp).toBe(0);
    expect(state.NeedChurch).toBe(0);
    expect(changeCensus).toHaveBeenCalledTimes(1);
  });
});
