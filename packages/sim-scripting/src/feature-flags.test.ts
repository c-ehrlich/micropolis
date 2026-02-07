import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SIM_SCRIPTING_FEATURE_FLAGS,
  resolveSimScriptingFeatureFlags,
} from './feature-flags.ts';

describe('sim scripting feature flags', () => {
  it('defaults CAM, NET, and legacy extras to disabled', () => {
    // Mirrors builds where `CAM`/`NET` are not defined in `w_tk.c`/`w_sim.c`.
    expect(resolveSimScriptingFeatureFlags()).toEqual(DEFAULT_SIM_SCRIPTING_FEATURE_FLAGS);
  });

  it('supports enabling optional features individually', () => {
    expect(resolveSimScriptingFeatureFlags({ CAM: true })).toEqual({
      CAM: true,
      NET: false,
      legacyExtras: false,
    });

    expect(resolveSimScriptingFeatureFlags({ NET: true })).toEqual({
      CAM: false,
      NET: true,
      legacyExtras: false,
    });

    expect(resolveSimScriptingFeatureFlags({ legacyExtras: true })).toEqual({
      CAM: false,
      NET: false,
      legacyExtras: true,
    });
  });
});
