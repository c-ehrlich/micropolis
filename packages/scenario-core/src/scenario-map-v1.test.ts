import { describe, expect, it } from 'vitest';

import {
  SCENARIO_BUNDLE_V1_MAP_HEIGHT,
  SCENARIO_BUNDLE_V1_MAP_WIDTH,
  SCENARIO_BUNDLE_V1_TILE_COUNT,
  type ScenarioBundleV1,
} from './scenario-bundle-v1.ts';
import {
  readScenarioMapTileWordsV1,
  SCENARIO_BUNDLE_V1_CITY_FILE_MAP_OFFSET_BYTES,
  transcodeScenarioMapCityFileBytesV1,
  transcodeScenarioMapRoundTripV1,
  transcodeScenarioMapTileWordsV1,
  writeScenarioBundleV1CityFileBytes,
  writeScenarioMapCityFileBytesV1,
} from './scenario-map-v1.ts';

function createDeterministicTileWords(): number[] {
  // Magic values source: classic map word domain is persisted as 16-bit shorts in
  // `ref/micropolis/src/sim/s_fileio.c` (`_save_short`/`_load_short` over `WORLD_X * WORLD_Y`).
  return Array.from(
    { length: SCENARIO_BUNDLE_V1_TILE_COUNT },
    (_, index) => ((index * 31) ^ 0x5a5a) & 0xffff,
  );
}

describe('scenario-map-v1', () => {
  it('round-trips tileWords -> cityFileBytes -> tileWords', () => {
    const tileWords = createDeterministicTileWords();
    const cityFileMap = writeScenarioMapCityFileBytesV1({
      kind: 'tile-words',
      width: SCENARIO_BUNDLE_V1_MAP_WIDTH,
      height: SCENARIO_BUNDLE_V1_MAP_HEIGHT,
      tileWords,
    });

    const decodedTileWords = readScenarioMapTileWordsV1(cityFileMap);

    expect(Array.from(decodedTileWords)).toEqual(tileWords);
  });

  it('round-trips cityFileBytes -> tileWords -> cityFileBytes with canonical output', () => {
    const tileWords = createDeterministicTileWords();
    const canonicalCityFileMap = writeScenarioMapCityFileBytesV1({
      kind: 'tile-words',
      width: SCENARIO_BUNDLE_V1_MAP_WIDTH,
      height: SCENARIO_BUNDLE_V1_MAP_HEIGHT,
      tileWords,
    });
    const noisyHeaderBytes = Buffer.from(canonicalCityFileMap.cityFileBytes, 'base64');

    // Magic offset source: `.cty` header layout in `ref/micropolis/src/sim/s_fileio.c`
    // (6 history arrays + 1 misc array precede `Map[WORLD_X][WORLD_Y]` words).
    noisyHeaderBytes[0] = 0x7f;
    noisyHeaderBytes[SCENARIO_BUNDLE_V1_CITY_FILE_MAP_OFFSET_BYTES - 1] = 0x44;

    const noisyCityFileMap = {
      ...canonicalCityFileMap,
      cityFileBytes: noisyHeaderBytes.toString('base64'),
    };
    const decodedTileWords = readScenarioMapTileWordsV1(noisyCityFileMap);
    const recanonicalizedCityFileMap = writeScenarioMapCityFileBytesV1(noisyCityFileMap);

    expect(Array.from(decodedTileWords)).toEqual(tileWords);
    expect(recanonicalizedCityFileMap).toEqual(canonicalCityFileMap);
  });

  it('transcodes city-file-bytes maps to deterministic tile-words payloads', () => {
    const tileWords = createDeterministicTileWords();
    const cityFileMap = transcodeScenarioMapCityFileBytesV1({
      kind: 'tile-words',
      width: SCENARIO_BUNDLE_V1_MAP_WIDTH,
      height: SCENARIO_BUNDLE_V1_MAP_HEIGHT,
      tileWords,
    });

    const transcodedTileWordsMap = transcodeScenarioMapTileWordsV1(cityFileMap);
    const secondTranscodedTileWordsMap = transcodeScenarioMapTileWordsV1(cityFileMap);

    expect(transcodedTileWordsMap).toEqual({
      kind: 'tile-words',
      width: SCENARIO_BUNDLE_V1_MAP_WIDTH,
      height: SCENARIO_BUNDLE_V1_MAP_HEIGHT,
      tileWords,
    });
    expect(secondTranscodedTileWordsMap).toEqual(transcodedTileWordsMap);
  });

  it('exposes deterministic round-trip transcode payloads', () => {
    const tileWords = createDeterministicTileWords();
    const cityFileMap = writeScenarioMapCityFileBytesV1({
      kind: 'tile-words',
      width: SCENARIO_BUNDLE_V1_MAP_WIDTH,
      height: SCENARIO_BUNDLE_V1_MAP_HEIGHT,
      tileWords,
    });
    const roundTripPayloads = transcodeScenarioMapRoundTripV1(cityFileMap);

    expect(roundTripPayloads.tileWords).toEqual({
      kind: 'tile-words',
      width: SCENARIO_BUNDLE_V1_MAP_WIDTH,
      height: SCENARIO_BUNDLE_V1_MAP_HEIGHT,
      tileWords,
    });
    expect(roundTripPayloads.cityFileBytes).toEqual(cityFileMap);
  });

  it('writes full bundles canonically to city-file-bytes maps', () => {
    const tileWords = createDeterministicTileWords();
    const sourceBundle: ScenarioBundleV1 = {
      version: 1,
      key: 'builtin/dullsville',
      name: 'Dullsville',
      description: 'Classic tutorial',
      tags: ['classic'],
      start: {
        startYear: 1900,
        startFunds: 5000,
      },
      map: {
        kind: 'tile-words',
        width: SCENARIO_BUNDLE_V1_MAP_WIDTH,
        height: SCENARIO_BUNDLE_V1_MAP_HEIGHT,
        tileWords,
      },
    };

    const canonicalBundle = writeScenarioBundleV1CityFileBytes(sourceBundle);

    expect(canonicalBundle.map.kind).toBe('city-file-bytes');
    expect(Array.from(readScenarioMapTileWordsV1(canonicalBundle.map))).toEqual(tileWords);
  });

  it('rejects malformed base64 city-file payloads', () => {
    expect(() =>
      readScenarioMapTileWordsV1({
        kind: 'city-file-bytes',
        width: SCENARIO_BUNDLE_V1_MAP_WIDTH,
        height: SCENARIO_BUNDLE_V1_MAP_HEIGHT,
        cityFileBytes: '!not-base64!',
      }),
    ).toThrow(/base64/i);
  });

  it('rejects city-file payloads that decode to the wrong byte length', () => {
    expect(() =>
      readScenarioMapTileWordsV1({
        kind: 'city-file-bytes',
        width: SCENARIO_BUNDLE_V1_MAP_WIDTH,
        height: SCENARIO_BUNDLE_V1_MAP_HEIGHT,
        cityFileBytes: 'AA==',
      }),
    ).toThrow(/27120 bytes/i);
  });
});
