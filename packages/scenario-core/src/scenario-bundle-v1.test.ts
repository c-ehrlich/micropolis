import { describe, expect, it } from 'vitest';

import {
  parseScenarioBundleV1,
  SCENARIO_BUNDLE_V1_MAP_HEIGHT,
  SCENARIO_BUNDLE_V1_MAP_WIDTH,
  SCENARIO_BUNDLE_V1_TILE_COUNT,
  scenarioBundleV1Schema,
} from './scenario-bundle-v1.ts';

describe('scenarioBundleV1Schema', () => {
  it('accepts city-file-bytes map bundles', () => {
    const parsed = parseScenarioBundleV1({
      version: 1,
      key: 'builtin/dullsville',
      name: 'Dullsville',
      description: 'Classic tutorial scenario',
      tags: ['classic', 'tutorial'],
      start: {
        startYear: 1900,
        startFunds: 5000,
      },
      map: {
        kind: 'city-file-bytes',
        width: SCENARIO_BUNDLE_V1_MAP_WIDTH,
        height: SCENARIO_BUNDLE_V1_MAP_HEIGHT,
        cityFileBytes: 'AA==',
      },
    });

    expect(parsed.map.kind).toBe('city-file-bytes');
  });

  it('accepts tile-words map bundles with fixed dimensions and uint16 words', () => {
    // Magic numbers source: classic Micropolis map dimensions in
    // `ref/micropolis/src/sim/s_alloc.c` (`WORLD_X=120`, `WORLD_Y=100`) and
    // map word persistence in `ref/micropolis/src/sim/s_fileio.c` (`short` words).
    const tileWords = Array.from({ length: SCENARIO_BUNDLE_V1_TILE_COUNT }, (_, index) =>
      index % 2 === 0 ? 0 : 0xffff,
    );

    const parsed = parseScenarioBundleV1({
      version: 1,
      key: 'user/custom-harbor',
      name: 'Custom Harbor',
      description: '',
      tags: [],
      start: {
        startYear: 1975,
        startFunds: 20000,
      },
      map: {
        kind: 'tile-words',
        width: SCENARIO_BUNDLE_V1_MAP_WIDTH,
        height: SCENARIO_BUNDLE_V1_MAP_HEIGHT,
        tileWords,
      },
    });

    expect(parsed.map.kind).toBe('tile-words');
    if (parsed.map.kind === 'tile-words') {
      expect(parsed.map.tileWords).toHaveLength(SCENARIO_BUNDLE_V1_TILE_COUNT);
    }
  });

  it('rejects tile-words map bundles with invalid tile count', () => {
    const result = scenarioBundleV1Schema.safeParse({
      version: 1,
      key: 'user/too-short',
      name: 'Too Short',
      description: '',
      tags: [],
      start: {
        startYear: 2000,
        startFunds: 20000,
      },
      map: {
        kind: 'tile-words',
        width: SCENARIO_BUNDLE_V1_MAP_WIDTH,
        height: SCENARIO_BUNDLE_V1_MAP_HEIGHT,
        tileWords: [0, 1, 2],
      },
    });

    expect(result.success).toBe(false);
  });

  it('rejects bundles that contain both map forms at once', () => {
    const result = scenarioBundleV1Schema.safeParse({
      version: 1,
      key: 'user/mixed-map-forms',
      name: 'Mixed Map Forms',
      description: '',
      tags: [],
      start: {
        startYear: 2000,
        startFunds: 20000,
      },
      map: {
        kind: 'tile-words',
        width: SCENARIO_BUNDLE_V1_MAP_WIDTH,
        height: SCENARIO_BUNDLE_V1_MAP_HEIGHT,
        tileWords: Array.from({ length: SCENARIO_BUNDLE_V1_TILE_COUNT }, () => 0),
        cityFileBytes: 'AA==',
      },
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((issue) => issue.message.includes('exactly one map form')),
      ).toBe(true);
    }
  });

  it('rejects `gameLevel` in start params for v1 bundles', () => {
    const result = scenarioBundleV1Schema.safeParse({
      version: 1,
      key: 'user/no-game-level',
      name: 'No Game Level',
      description: '',
      tags: [],
      start: {
        startYear: 2000,
        startFunds: 20000,
        gameLevel: 2,
      },
      map: {
        kind: 'city-file-bytes',
        width: SCENARIO_BUNDLE_V1_MAP_WIDTH,
        height: SCENARIO_BUNDLE_V1_MAP_HEIGHT,
        cityFileBytes: 'AA==',
      },
    });

    expect(result.success).toBe(false);
  });

  it('rejects keys without builtin/user namespace prefixes', () => {
    const missingNamespace = scenarioBundleV1Schema.safeParse({
      version: 1,
      key: 'dullsville',
      name: 'Dullsville',
      description: '',
      tags: [],
      start: {
        startYear: 1900,
        startFunds: 5000,
      },
      map: {
        kind: 'city-file-bytes',
        width: SCENARIO_BUNDLE_V1_MAP_WIDTH,
        height: SCENARIO_BUNDLE_V1_MAP_HEIGHT,
        cityFileBytes: 'AA==',
      },
    });
    const unknownNamespace = scenarioBundleV1Schema.safeParse({
      version: 1,
      key: 'mod/dullsville',
      name: 'Dullsville',
      description: '',
      tags: [],
      start: {
        startYear: 1900,
        startFunds: 5000,
      },
      map: {
        kind: 'city-file-bytes',
        width: SCENARIO_BUNDLE_V1_MAP_WIDTH,
        height: SCENARIO_BUNDLE_V1_MAP_HEIGHT,
        cityFileBytes: 'AA==',
      },
    });

    expect(missingNamespace.success).toBe(false);
    expect(unknownNamespace.success).toBe(false);
  });
});
