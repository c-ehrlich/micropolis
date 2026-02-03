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

    // 10-year history range is 0..119 in Micropolis `TakeCensus`.
    const SHORT_HISTORY_MAX = 119;
    const SHORT_HISTORY_SHIFT_START = 118;

    state.ResHis[0] = 10;
    state.ResHis[SHORT_HISTORY_SHIFT_START] = 70;
    state.ResHis[SHORT_HISTORY_MAX] = 200;
    state.ComHis[0] = 20;
    state.ComHis[SHORT_HISTORY_SHIFT_START] = 90;
    state.ComHis[SHORT_HISTORY_MAX] = 150;
    state.IndHis[0] = 30;
    state.IndHis[SHORT_HISTORY_SHIFT_START] = 80;
    state.IndHis[SHORT_HISTORY_MAX] = 160;
    // Non-zero sentinels to verify history shifts copy prior values.
    state.CrimeHis[0] = 33;
    state.PollutionHis[0] = 44;
    state.MoneyHis[0] = 77;

    // ResPop/8 becomes 128 for history graph (1024 / 8).
    state.ResPop = 1024;
    state.ComPop = 12;
    state.IndPop = 7;
    // Crime ramp uses (CrimeAverage - CrimeRamp) / 4; equal values keep 300.
    state.CrimeRamp = 300;
    state.CrimeAverage = 300;
    // Pollute ramp uses (PolluteAverage - PolluteRamp) / 4: (18-10)/4 = 2.
    state.PolluteRamp = 10;
    state.PolluteAverage = 18;
    // CashFlow scales as (CashFlow/20) + 128 and clamps to 255: 5000/20 = 250.
    state.CashFlow = 5000;
    // ResPop >> 8 = 4, so HospPop 3 => NeedHosp=1, ChurchPop 5 => NeedChurch=-1.
    state.HospPop = 3;
    state.ChurchPop = 5;

    takeCensus(state, context);

    expect(state.ResHis[1]).toBe(10);
    expect(state.ResHis[SHORT_HISTORY_MAX]).toBe(70);
    expect(state.ComHis[1]).toBe(20);
    expect(state.ComHis[SHORT_HISTORY_MAX]).toBe(90);
    expect(state.IndHis[1]).toBe(30);
    expect(state.IndHis[SHORT_HISTORY_MAX]).toBe(80);
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

    // 120-year history range is 120..239 in Micropolis `Take2Census`.
    const LONG_HISTORY_START = 120;
    const LONG_HISTORY_SHIFT_START = 238;
    const LONG_HISTORY_MAX = 239;

    state.ResHis[LONG_HISTORY_START] = 5;
    state.ResHis[LONG_HISTORY_SHIFT_START] = 70;
    state.ResHis[LONG_HISTORY_MAX] = 200;
    state.ComHis[LONG_HISTORY_START] = 6;
    state.ComHis[LONG_HISTORY_SHIFT_START] = 90;
    state.ComHis[LONG_HISTORY_MAX] = 150;
    state.IndHis[LONG_HISTORY_START] = 7;
    state.IndHis[LONG_HISTORY_SHIFT_START] = 80;
    state.IndHis[LONG_HISTORY_MAX] = 160;
    // Non-zero sentinels to verify index-0 values copy into index 120.
    state.CrimeHis[0] = 11;
    state.PollutionHis[0] = 22;
    state.MoneyHis[0] = 33;

    // ResPop/8 becomes 10 for long-term graph (80 / 8).
    state.ResPop = 80;
    state.ComPop = 12;
    state.IndPop = 7;

    take2Census(state, context);

    expect(state.ResHis[LONG_HISTORY_START + 1]).toBe(5);
    expect(state.ResHis[LONG_HISTORY_MAX]).toBe(70);
    expect(state.ComHis[LONG_HISTORY_START + 1]).toBe(6);
    expect(state.ComHis[LONG_HISTORY_MAX]).toBe(90);
    expect(state.IndHis[LONG_HISTORY_START + 1]).toBe(7);
    expect(state.IndHis[LONG_HISTORY_MAX]).toBe(80);

    expect(state.Res2HisMax).toBe(70);
    expect(state.Com2HisMax).toBe(90);
    expect(state.Ind2HisMax).toBe(80);
    expect(state.Graph120Max).toBe(90);

    expect(state.ResHis[LONG_HISTORY_START]).toBe(10);
    expect(state.ComHis[LONG_HISTORY_START]).toBe(12);
    expect(state.IndHis[LONG_HISTORY_START]).toBe(7);
    expect(state.CrimeHis[LONG_HISTORY_START]).toBe(11);
    expect(state.PollutionHis[LONG_HISTORY_START]).toBe(22);
    expect(state.MoneyHis[LONG_HISTORY_START]).toBe(33);

    expect(changeCensus).toHaveBeenCalledTimes(1);
  });

  it('clamps money at zero and clears need flags when counts match', () => {
    const store = createClassicMapStore();
    const changeCensus = vi.fn();
    const context = createSimContext({ store, hooks: { changeCensus } });
    const state = createSimState();

    // ResPop >> 8 = 1, so matching HospPop/ChurchPop clears needs.
    state.ResPop = 256;
    state.HospPop = 1;
    state.ChurchPop = 1;
    // CashFlow scales to negative -> clamp to 0.
    state.CashFlow = -10000;

    takeCensus(state, context);

    expect(state.MoneyHis[0]).toBe(0);
    expect(state.NeedHosp).toBe(0);
    expect(state.NeedChurch).toBe(0);
    expect(changeCensus).toHaveBeenCalledTimes(1);
  });
});
