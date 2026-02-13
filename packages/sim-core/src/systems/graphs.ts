import type { SimState } from '../core/sim-state.ts';

/** Number of points per graph range in Micropolis `w_graph.c` (`0..119`). */
export const CENSUS_GRAPH_POINT_COUNT = 120;
/** Number of graph history channels in Micropolis (`RES..POLLUTION`). */
export const CENSUS_GRAPH_SERIES_COUNT = 6;

/**
 * Graph history channel keys in C order.
 *
 * Mirrors `RES_HIST..POLLUTION_HIST` in `ref/micropolis/src/sim/headers/sim.h`:
 * `0=res`, `1=com`, `2=ind`, `3=money`, `4=crime`, `5=pollution`.
 */
export const CENSUS_GRAPH_SERIES_KEYS = [
  'res',
  'com',
  'ind',
  'money',
  'crime',
  'pollution',
] as const;

export type CensusGraphSeriesKey = (typeof CENSUS_GRAPH_SERIES_KEYS)[number];

/**
 * One rendered graph-series payload for a single range (`10` or `120` years).
 *
 * Mirrors the post-`drawMonth` `History10[]`/`History120[]` byte arrays in
 * `ref/micropolis/src/sim/w_graph.c`.
 */
export interface CensusGraphSeriesData {
  res: Uint8Array;
  com: Uint8Array;
  ind: Uint8Array;
  money: Uint8Array;
  crime: Uint8Array;
  pollution: Uint8Array;
}

/**
 * Full rendered graph payload for both Micropolis ranges.
 *
 * Mirrors `History10[]` and `History120[]` buffers produced by `doAllGraphs`
 * in `ref/micropolis/src/sim/w_graph.c`.
 */
export interface CensusGraphData {
  history10: CensusGraphSeriesData;
  history120: CensusGraphSeriesData;
}

/**
 * Builds the rendered graph byte history buffers from sim census state.
 *
 * Mirrors `doAllGraphs` + `drawMonth` in `ref/micropolis/src/sim/w_graph.c`
 * (1:1 scale/clamp/reverse-index behavior).
 */
export function buildCensusGraphData(state: SimState): CensusGraphData {
  const scale10 = resolveCensusScale(state.ResHisMax, state.ComHisMax, state.IndHisMax);
  const scale120 = resolveCensusScale(state.Res2HisMax, state.Com2HisMax, state.Ind2HisMax);

  return {
    history10: {
      res: drawMonth(state.ResHis, 0, scale10),
      com: drawMonth(state.ComHis, 0, scale10),
      ind: drawMonth(state.IndHis, 0, scale10),
      money: drawMonth(state.MoneyHis, 0, 1.0),
      crime: drawMonth(state.CrimeHis, 0, 1.0),
      pollution: drawMonth(state.PollutionHis, 0, 1.0),
    },
    history120: {
      res: drawMonth(state.ResHis, 120, scale120),
      com: drawMonth(state.ComHis, 120, scale120),
      ind: drawMonth(state.IndHis, 120, scale120),
      money: drawMonth(state.MoneyHis, 120, 1.0),
      crime: drawMonth(state.CrimeHis, 120, 1.0),
      pollution: drawMonth(state.PollutionHis, 120, 1.0),
    },
  };
}

/**
 * Resolves the R/C/I scale factor used for one graph range.
 *
 * Mirrors:
 * - `AllMax = max(Res/Com/Ind maxes)`
 * - `if (AllMax <= 128) AllMax = 0`
 * - `scaleValue = AllMax ? 128.0 / AllMax : 1.0`
 * in `ref/micropolis/src/sim/w_graph.c`.
 */
function resolveCensusScale(resMax: number, comMax: number, indMax: number): number {
  let allMax = 0;
  if (resMax > allMax) {
    allMax = resMax;
  }
  if (comMax > allMax) {
    allMax = comMax;
  }
  if (indMax > allMax) {
    allMax = indMax;
  }
  if (allMax <= 128) {
    allMax = 0;
  }
  return allMax === 0 ? 1.0 : 128.0 / allMax;
}

/**
 * Projects one 120-point history range into rendered graph bytes.
 *
 * Mirrors `drawMonth` in `ref/micropolis/src/sim/w_graph.c`:
 * - `val = hist[x] * scale` (float -> short truncation)
 * - clamp to `[0, 255]`
 * - write at `s[119 - x]`.
 */
function drawMonth(hist: Int16Array, start: number, scale: number): Uint8Array {
  const series = new Uint8Array(CENSUS_GRAPH_POINT_COUNT);
  for (let x = 0; x < CENSUS_GRAPH_POINT_COUNT; x += 1) {
    const histValue = hist[start + x] ?? 0;
    const scaled = Math.trunc(histValue * scale);
    series[CENSUS_GRAPH_POINT_COUNT - 1 - x] = clampGraphByte(scaled);
  }
  return series;
}

/**
 * Clamps one graph sample to C unsigned-byte display domain.
 *
 * Mirrors `if (val < 0) val = 0; if (val > 255) val = 255;`
 * in `drawMonth` (`ref/micropolis/src/sim/w_graph.c`).
 */
function clampGraphByte(value: number): number {
  if (value < 0) {
    return 0;
  }
  if (value > 255) {
    return 255;
  }
  return value;
}
