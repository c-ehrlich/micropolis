import { describe, expect, it } from 'vitest';

import {
  listSimUiToolAssetHelpers,
  resolveSimUiToolAssetHelper,
  resolveSimUiToolHelpDocId,
  resolveSimUiToolHelpHtmlFileName,
  resolveSimUiToolIconBitmapName,
  resolveSimUiToolSoundFileName,
  resolveSimUiToolSoundToken,
  resolveSimUiToolStringResource,
  SIM_UI_TOOL_COUNT,
  SIM_UI_TOOL_STRING_TABLE_ID,
} from './sim-ui.ts';

describe('sim-ui helper parity', () => {
  it('keeps canonical 18-entry editor tool ordering', () => {
    // The 18-entry count and ordering come from `EditorPalletImages` /
    // `EditorPalletSounds` in `ref/micropolis/res/micropolis.tcl`.
    const helpers = listSimUiToolAssetHelpers();
    expect(helpers).toHaveLength(SIM_UI_TOOL_COUNT);
    expect(SIM_UI_TOOL_COUNT).toBe(18);

    expect(helpers[0]).toEqual({
      toolState: 0,
      iconBitmapName: 'icres',
      highlightedIconBitmapName: 'icreshi',
      stringResource: { type: 'stri', id: SIM_UI_TOOL_STRING_TABLE_ID, oneBasedIndex: 1 },
      soundToken: 'Res',
      normalizedSoundToken: 'res',
      soundFileName: 'res.wav',
      helpDocId: 'Editor.ToolRes',
      helpHtmlFileName: 'Editor.ToolRes.html',
    });

    expect(helpers[17]).toEqual({
      toolState: 17,
      iconBitmapName: 'icairp',
      highlightedIconBitmapName: 'icairphi',
      stringResource: { type: 'stri', id: SIM_UI_TOOL_STRING_TABLE_ID, oneBasedIndex: 18 },
      soundToken: 'Airport',
      normalizedSoundToken: 'airport',
      soundFileName: 'airport.wav',
      helpDocId: 'Editor.ToolAirport',
      helpHtmlFileName: 'Editor.ToolAirport.html',
    });
  });

  it('resolves icon/string/sound/help helpers for a tool state', () => {
    expect(resolveSimUiToolIconBitmapName(8)).toBe('icrail');
    expect(resolveSimUiToolIconBitmapName(8, true)).toBe('icrailhi');
    expect(resolveSimUiToolStringResource(8)).toEqual({
      type: 'stri',
      id: SIM_UI_TOOL_STRING_TABLE_ID,
      oneBasedIndex: 9,
    });
    expect(resolveSimUiToolSoundToken(8)).toBe('Rail');
    expect(resolveSimUiToolSoundFileName(8)).toBe('rail.wav');
    expect(resolveSimUiToolHelpDocId(8)).toBe('Editor.ToolRail');
    expect(resolveSimUiToolHelpHtmlFileName(8)).toBe('Editor.ToolRail.html');
  });

  it('returns undefined for out-of-range tool states including networkState', () => {
    // `networkState` is `18` in `ref/micropolis/src/sim/headers/sim.h`, but
    // there is no matching icon entry in `EditorPalletImages`.
    expect(resolveSimUiToolAssetHelper(18)).toBeUndefined();
    expect(resolveSimUiToolIconBitmapName(18)).toBeUndefined();
    expect(resolveSimUiToolStringResource(18)).toBeUndefined();
    expect(resolveSimUiToolSoundToken(18)).toBeUndefined();
    expect(resolveSimUiToolHelpDocId(18)).toBeUndefined();
    expect(resolveSimUiToolAssetHelper(-1)).toBeUndefined();
    expect(resolveSimUiToolAssetHelper(2.5)).toBeUndefined();
  });
});
