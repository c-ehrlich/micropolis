import { describe, expect, it } from 'vitest';

import { buildNewCityPreviewMap, createRandomNewCityTerrainSeed } from './new-city.ts';

describe('runtime new-city preview helpers', () => {
  it('generates terrain seeds in the classic 16-bit range', () => {
    expect(createRandomNewCityTerrainSeed(() => 0)).toBe(0);
    expect(createRandomNewCityTerrainSeed(() => 0.5)).toBe(32_768);
    expect(createRandomNewCityTerrainSeed(() => 0.999_999)).toBe(65_535);
  });

  it('builds deterministic preview maps for the same seed', () => {
    const first = buildNewCityPreviewMap(0x1234);
    const second = buildNewCityPreviewMap(0x1234);
    const differentSeed = buildNewCityPreviewMap(0x1235);

    // Magic-number source: `WORLD_X`/`WORLD_Y` map size in
    // `ref/micropolis/src/sim/headers/sim.h` (120x100).
    expect(first.width).toBe(120);
    expect(first.height).toBe(100);
    expect(first.tileWords).toEqual(second.tileWords);
    expect(first.tileWords).not.toEqual(differentSeed.tileWords);
  });
});
