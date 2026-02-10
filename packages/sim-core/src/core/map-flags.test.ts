import { describe, expect, it } from 'vitest';

import { assertDefined } from './assert.ts';
import {
  getMapStateDrawModeEntry,
  MAP_FLAG_COUNT,
  MAP_FLAGS,
  MAP_STATE_DRAW_MODE_TABLE,
} from './map-flags.ts';

describe('MAP_STATE_DRAW_MODE_TABLE', () => {
  it('matches g_map.c setUpMapProcs map_state order and draw proc names', () => {
    expect(MAP_STATE_DRAW_MODE_TABLE).toEqual([
      { mapFlag: 'ALMAP', drawProc: 'drawAll' },
      { mapFlag: 'REMAP', drawProc: 'drawRes' },
      { mapFlag: 'COMAP', drawProc: 'drawCom' },
      { mapFlag: 'INMAP', drawProc: 'drawInd' },
      { mapFlag: 'PRMAP', drawProc: 'drawPower' },
      { mapFlag: 'RDMAP', drawProc: 'drawLilTransMap' },
      { mapFlag: 'PDMAP', drawProc: 'drawPopDensity' },
      { mapFlag: 'RGMAP', drawProc: 'drawRateOfGrowth' },
      { mapFlag: 'TDMAP', drawProc: 'drawTrafMap' },
      { mapFlag: 'PLMAP', drawProc: 'drawPolMap' },
      { mapFlag: 'CRMAP', drawProc: 'drawCrimeMap' },
      { mapFlag: 'LVMAP', drawProc: 'drawLandMap' },
      { mapFlag: 'FIMAP', drawProc: 'drawFireRadius' },
      { mapFlag: 'POMAP', drawProc: 'drawPoliceRadius' },
      { mapFlag: 'DYMAP', drawProc: 'drawDynamic' },
    ]);
  });

  it('stays index-aligned with MAP_FLAGS slots', () => {
    for (let index = 0; index < MAP_FLAG_COUNT; index += 1) {
      const entry = MAP_STATE_DRAW_MODE_TABLE[index];
      assertDefined(entry);
      expect(MAP_FLAGS[entry.mapFlag]).toBe(index);
    }
  });
});

describe('getMapStateDrawModeEntry', () => {
  it('returns the matching table row for valid map_state indexes', () => {
    expect(getMapStateDrawModeEntry(MAP_FLAGS.ALMAP)).toEqual({
      mapFlag: 'ALMAP',
      drawProc: 'drawAll',
    });
    expect(getMapStateDrawModeEntry(MAP_FLAGS.PDMAP)).toEqual({
      mapFlag: 'PDMAP',
      drawProc: 'drawPopDensity',
    });
    expect(getMapStateDrawModeEntry(MAP_FLAGS.DYMAP)).toEqual({
      mapFlag: 'DYMAP',
      drawProc: 'drawDynamic',
    });
  });

  it('returns null for out-of-range map_state values', () => {
    // `MapCmdMapState` in w_map.c rejects `state < 0 || state >= NMAPS`.
    expect(getMapStateDrawModeEntry(-1)).toBeNull();
    expect(getMapStateDrawModeEntry(MAP_FLAG_COUNT)).toBeNull();
  });
});
