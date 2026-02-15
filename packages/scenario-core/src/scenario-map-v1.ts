import {
  SCENARIO_BUNDLE_V1_MAP_HEIGHT,
  SCENARIO_BUNDLE_V1_MAP_WIDTH,
  SCENARIO_BUNDLE_V1_TILE_COUNT,
  type ScenarioBundleV1,
  type ScenarioMapCityFileBytesV1,
  type ScenarioMapV1,
} from './scenario-bundle-v1.ts';

const CITY_FILE_HISTORY_LENGTH = 240;
const CITY_FILE_MISC_LENGTH = 120;

/**
 * Fixed byte offset of map words inside classic Micropolis city files.
 * Mirrors the history + misc short-array layout in `saveFile`/`loadFile` from
 * `ref/micropolis/src/sim/s_fileio.c` (1:1 byte offset for `WORLD_X * WORLD_Y` map words).
 */
export const SCENARIO_BUNDLE_V1_CITY_FILE_MAP_OFFSET_BYTES =
  (CITY_FILE_HISTORY_LENGTH * 6 + CITY_FILE_MISC_LENGTH) * 2;

/**
 * Fixed byte length for v1 `cityFileBytes` payloads.
 * Mirrors classic `27120` byte city/scenario files for `WORLD_X=120`, `WORLD_Y=100`
 * in `ref/micropolis/src/sim/s_fileio.c` (same map payload capacity).
 */
export const SCENARIO_BUNDLE_V1_CITY_FILE_BYTE_LENGTH =
  SCENARIO_BUNDLE_V1_CITY_FILE_MAP_OFFSET_BYTES + SCENARIO_BUNDLE_V1_TILE_COUNT * 2;

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const BASE64_DECODE_TABLE = createBase64DecodeTable();

/**
 * Read map words from either Stage 0 map payload form.
 * Mirrors map-word byte order from `_load_short((&Map[0][0]), WORLD_X * WORLD_Y, ...)`
 * in `ref/micropolis/src/sim/s_fileio.c` for city-file maps, while also accepting
 * direct `tileWords` arrays as an authoring convenience.
 */
export function readScenarioMapTileWordsV1(map: ScenarioMapV1): Uint16Array {
  if (map.kind === 'tile-words') {
    return Uint16Array.from(map.tileWords);
  }

  const cityFileBytes = decodeBase64Strict(map.cityFileBytes);
  if (cityFileBytes.byteLength !== SCENARIO_BUNDLE_V1_CITY_FILE_BYTE_LENGTH) {
    throw new Error(
      `cityFileBytes must decode to ${SCENARIO_BUNDLE_V1_CITY_FILE_BYTE_LENGTH} bytes for ${SCENARIO_BUNDLE_V1_MAP_WIDTH}x${SCENARIO_BUNDLE_V1_MAP_HEIGHT} maps`,
    );
  }

  const tileWords = new Uint16Array(SCENARIO_BUNDLE_V1_TILE_COUNT);
  const cityFileView = new DataView(
    cityFileBytes.buffer,
    cityFileBytes.byteOffset,
    cityFileBytes.byteLength,
  );

  for (let index = 0; index < SCENARIO_BUNDLE_V1_TILE_COUNT; index += 1) {
    const byteOffset = SCENARIO_BUNDLE_V1_CITY_FILE_MAP_OFFSET_BYTES + index * 2;
    tileWords[index] = cityFileView.getUint16(byteOffset, false);
  }

  return tileWords;
}

/**
 * Canonically write map words to the `cityFileBytes` payload form.
 * Mirrors `_save_short((&Map[0][0]), WORLD_X * WORLD_Y, ...)` in
 * `ref/micropolis/src/sim/s_fileio.c` for map serialization order and endianness.
 * Parity difference: non-map history/misc regions are always zeroed so output is a
 * deterministic compiled-map payload for Stage 0 bundles.
 */
export function writeScenarioMapCityFileBytesV1(map: ScenarioMapV1): ScenarioMapCityFileBytesV1 {
  const tileWords = readScenarioMapTileWordsV1(map);
  const cityFileBytes = new Uint8Array(SCENARIO_BUNDLE_V1_CITY_FILE_BYTE_LENGTH);
  const cityFileView = new DataView(cityFileBytes.buffer, cityFileBytes.byteOffset);

  for (let index = 0; index < SCENARIO_BUNDLE_V1_TILE_COUNT; index += 1) {
    const byteOffset = SCENARIO_BUNDLE_V1_CITY_FILE_MAP_OFFSET_BYTES + index * 2;
    cityFileView.setUint16(byteOffset, tileWords[index] ?? 0, false);
  }

  return {
    kind: 'city-file-bytes',
    width: SCENARIO_BUNDLE_V1_MAP_WIDTH,
    height: SCENARIO_BUNDLE_V1_MAP_HEIGHT,
    cityFileBytes: encodeBase64(cityFileBytes),
  };
}

/**
 * Canonically write an entire Stage 0 bundle to `map.kind = "city-file-bytes"`.
 * Not a direct C function: this wraps `s_fileio.c` map-byte parity semantics in a
 * JSON contract writer that guarantees one persisted map form.
 */
export function writeScenarioBundleV1CityFileBytes(bundle: ScenarioBundleV1): ScenarioBundleV1 {
  return {
    ...bundle,
    map: writeScenarioMapCityFileBytesV1(bundle.map),
  };
}

function createBase64DecodeTable(): Int16Array {
  const table = new Int16Array(128);
  table.fill(-1);
  for (let index = 0; index < BASE64_ALPHABET.length; index += 1) {
    table[BASE64_ALPHABET.charCodeAt(index)] = index;
  }
  return table;
}

function decodeBase64Strict(value: string): Uint8Array {
  if (value.length === 0 || value.length % 4 !== 0 || !BASE64_RE.test(value)) {
    throw new Error('cityFileBytes must be valid base64 text');
  }

  const paddingLength = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  const byteLength = (value.length / 4) * 3 - paddingLength;
  const bytes = new Uint8Array(byteLength);
  let outputIndex = 0;

  for (let index = 0; index < value.length; index += 4) {
    const first = decodeBase64Character(value.charCodeAt(index));
    const second = decodeBase64Character(value.charCodeAt(index + 1));
    const thirdCode = value.charCodeAt(index + 2);
    const fourthCode = value.charCodeAt(index + 3);
    const third = thirdCode === 61 ? 0 : decodeBase64Character(thirdCode);
    const fourth = fourthCode === 61 ? 0 : decodeBase64Character(fourthCode);
    const chunk = (first << 18) | (second << 12) | (third << 6) | fourth;

    if (outputIndex < byteLength) {
      bytes[outputIndex] = (chunk >>> 16) & 0xff;
      outputIndex += 1;
    }
    if (outputIndex < byteLength) {
      bytes[outputIndex] = (chunk >>> 8) & 0xff;
      outputIndex += 1;
    }
    if (outputIndex < byteLength) {
      bytes[outputIndex] = chunk & 0xff;
      outputIndex += 1;
    }
  }

  return bytes;
}

function decodeBase64Character(charCode: number): number {
  if (charCode > 127) {
    throw new Error('cityFileBytes must be valid base64 text');
  }

  const value = BASE64_DECODE_TABLE[charCode];
  if (value === undefined || value < 0) {
    throw new Error('cityFileBytes must be valid base64 text');
  }

  return value;
}

function encodeBase64(bytes: Uint8Array): string {
  if (bytes.length === 0) {
    return '';
  }

  let output = '';

  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    const chunk = (first << 16) | ((second ?? 0) << 8) | (third ?? 0);

    output += BASE64_ALPHABET[(chunk >>> 18) & 0x3f];
    output += BASE64_ALPHABET[(chunk >>> 12) & 0x3f];
    output += second === undefined ? '=' : BASE64_ALPHABET[(chunk >>> 6) & 0x3f];
    output += third === undefined ? '=' : BASE64_ALPHABET[chunk & 0x3f];
  }

  return output;
}
