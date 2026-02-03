import { describe, expect, it } from 'vitest';

import { SIM_CORE_VERSION } from '../index.ts';

describe('sim-core package skeleton', () => {
  it('exports a version string', () => {
    expect(SIM_CORE_VERSION).toBe('0.0.0');
  });
});
