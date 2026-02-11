import { describe, expect, it } from 'vitest';

import {
  listSimUiToolAssetHelpers,
  resolveSimUiDidToolSoundIntent,
  resolveSimUiToolAssetHelper,
  resolveSimUiToolHelpDocId,
  resolveSimUiToolHelpHtmlFileName,
  resolveSimUiToolIconAssetLookup,
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

  it('resolves DidTool success sounds for the full playable tool-state set', () => {
    // `DidTool(..., name, ...)` in `w_tool.c` dispatches `UIDidTool*` Tcl callbacks.
    // Each expected `soundSpec` here comes from the corresponding callback's
    // `UIMakeSoundOn $win edit ...` arguments in `ref/micropolis/res/micropolis.tcl`.
    expect(resolveSimUiDidToolSoundIntent(0)).toEqual({
      channel: 'edit',
      soundSpec: 'O -speed 140',
    });
    expect(resolveSimUiDidToolSoundIntent(1)).toEqual({
      channel: 'edit',
      soundSpec: 'A -speed 140',
    });
    expect(resolveSimUiDidToolSoundIntent(2)).toEqual({
      channel: 'edit',
      soundSpec: 'E -speed 140',
    });
    expect(resolveSimUiDidToolSoundIntent(3)).toEqual({
      channel: 'edit',
      soundSpec: 'O -speed 130',
    });
    expect(resolveSimUiDidToolSoundIntent(4)).toEqual({
      channel: 'edit',
      soundSpec: 'E -speed 200',
    });
    expect(resolveSimUiDidToolSoundIntent(5)).toEqual({
      channel: 'edit',
      soundSpec: 'E -speed 130',
    });
    expect(resolveSimUiDidToolSoundIntent(6)).toEqual({
      channel: 'edit',
      soundSpec: 'O -speed 120',
    });
    expect(resolveSimUiDidToolSoundIntent(7)).toEqual({ channel: 'edit', soundSpec: 'Rumble' });
    expect(resolveSimUiDidToolSoundIntent(8)).toEqual({
      channel: 'edit',
      soundSpec: 'O -speed 100',
    });
    expect(resolveSimUiDidToolSoundIntent(9)).toEqual({
      channel: 'edit',
      soundSpec: 'E -speed 100',
    });
    expect(resolveSimUiDidToolSoundIntent(12)).toEqual({
      channel: 'edit',
      soundSpec: 'O -speed 90',
    });
    expect(resolveSimUiDidToolSoundIntent(13)).toEqual({
      channel: 'edit',
      soundSpec: 'A -speed 130',
    });
    expect(resolveSimUiDidToolSoundIntent(14)).toEqual({
      channel: 'edit',
      soundSpec: 'E -speed 90',
    });
    expect(resolveSimUiDidToolSoundIntent(15)).toEqual({
      channel: 'edit',
      soundSpec: 'O -speed 75',
    });
    expect(resolveSimUiDidToolSoundIntent(16)).toEqual({
      channel: 'edit',
      soundSpec: 'E -speed 75',
    });
    expect(resolveSimUiDidToolSoundIntent(17)).toEqual({
      channel: 'edit',
      soundSpec: 'A -speed 50',
    });
  });

  it('resolves canonical icon asset keys with optional derived png overlays', () => {
    // `rail` is entry index 8 in `EditorPalletImages` from
    // `ref/micropolis/res/micropolis.tcl`; `ExclusivePallet` loads it via
    // `@images/icrail.xpm` or `@images/icrailhi.xpm`.
    expect(resolveSimUiToolIconAssetLookup(8)).toEqual({
      toolState: 8,
      highlighted: false,
      iconBitmapName: 'icrail',
      canonicalAssetKey: 'ref/micropolis/images/icrail.xpm',
      derivedPngPath: 'packages/sim-assets/generated-images/images/icrail.png',
    });

    expect(resolveSimUiToolIconAssetLookup(8, { highlighted: true })).toEqual({
      toolState: 8,
      highlighted: true,
      iconBitmapName: 'icrailhi',
      canonicalAssetKey: 'ref/micropolis/images/icrailhi.xpm',
      derivedPngPath: 'packages/sim-assets/generated-images/images/icrailhi.png',
    });

    expect(resolveSimUiToolIconAssetLookup(8, { includeDerivedPngPathLookup: false })).toEqual({
      toolState: 8,
      highlighted: false,
      iconBitmapName: 'icrail',
      canonicalAssetKey: 'ref/micropolis/images/icrail.xpm',
    });
  });

  it('returns undefined for out-of-range tool states including networkState', () => {
    // `networkState` is `18` in `ref/micropolis/src/sim/headers/sim.h`, but
    // there is no matching icon entry in `EditorPalletImages`.
    expect(resolveSimUiToolAssetHelper(18)).toBeUndefined();
    // `UIDidToolChlk`/`UIDidToolEraser` in `micropolis.tcl` do not call `UIMakeSoundOn`.
    expect(resolveSimUiDidToolSoundIntent(10)).toBeUndefined();
    expect(resolveSimUiDidToolSoundIntent(11)).toBeUndefined();
    expect(resolveSimUiToolIconBitmapName(18)).toBeUndefined();
    expect(resolveSimUiToolStringResource(18)).toBeUndefined();
    expect(resolveSimUiToolSoundToken(18)).toBeUndefined();
    expect(resolveSimUiToolHelpDocId(18)).toBeUndefined();
    expect(resolveSimUiToolIconAssetLookup(18)).toBeUndefined();
    expect(resolveSimUiToolAssetHelper(-1)).toBeUndefined();
    expect(resolveSimUiDidToolSoundIntent(-1)).toBeUndefined();
    expect(resolveSimUiToolAssetHelper(2.5)).toBeUndefined();
    expect(resolveSimUiDidToolSoundIntent(2.5)).toBeUndefined();
  });
});
