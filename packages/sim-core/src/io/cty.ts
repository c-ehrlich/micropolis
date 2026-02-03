import { getOrThrow } from '../core/assert.ts';

export const CITY_HISTORY_LENGTH = 240;
export const CITY_MISC_LENGTH = 120;
export const CITY_FILE_HEADER_BYTES = (CITY_HISTORY_LENGTH * 6 + CITY_MISC_LENGTH) * 2;

export interface CityDimensions {
  width: number;
  height: number;
  mapLength: number;
  byteLength: number;
}

const CITY_SIZES: readonly CityDimensions[] = [
  { width: 120, height: 100, mapLength: 120 * 100, byteLength: 27120 },
  { width: 240, height: 200, mapLength: 240 * 200, byteLength: 99120 },
  { width: 360, height: 300, mapLength: 360 * 300, byteLength: 219120 },
] as const;

export interface CityHistories {
  res: Int16Array;
  com: Int16Array;
  ind: Int16Array;
  crime: Int16Array;
  pollution: Int16Array;
  money: Int16Array;
}

export interface CityFile {
  dimensions: CityDimensions;
  histories: CityHistories;
  misc: Int16Array;
  map: Uint16Array;
}

export interface CityMeta {
  cityTime: number;
  totalFunds: number;
  autoBulldoze: boolean;
  autoBudget: boolean;
  autoGo: boolean;
  userSoundOn: boolean;
  cityTax: number;
  simSpeed: number;
  policePercent: number;
  firePercent: number;
  roadPercent: number;
}

export function sniffCityDimensions(byteLength: number): CityDimensions {
  const match = CITY_SIZES.find((entry) => entry.byteLength === byteLength);
  if (!match) {
    throw new Error(`unsupported city file length: ${byteLength}`);
  }
  return match;
}

export function cityDimensionsForMap(width: number, height: number): CityDimensions {
  const match = CITY_SIZES.find((entry) => entry.width === width && entry.height === height);
  if (!match) {
    throw new Error(`unsupported city map dimensions: ${width}x${height}`);
  }
  return match;
}

export function createCityFile(dimensions: { width: number; height: number }): CityFile {
  const resolved = cityDimensionsForMap(dimensions.width, dimensions.height);
  return {
    dimensions: resolved,
    histories: {
      res: new Int16Array(CITY_HISTORY_LENGTH),
      com: new Int16Array(CITY_HISTORY_LENGTH),
      ind: new Int16Array(CITY_HISTORY_LENGTH),
      crime: new Int16Array(CITY_HISTORY_LENGTH),
      pollution: new Int16Array(CITY_HISTORY_LENGTH),
      money: new Int16Array(CITY_HISTORY_LENGTH),
    },
    misc: new Int16Array(CITY_MISC_LENGTH),
    map: new Uint16Array(resolved.mapLength),
  };
}

export function decodeCityFile(data: Uint8Array): CityFile {
  const dimensions = sniffCityDimensions(data.byteLength);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 0;

  const res = readInt16Array(view, offset, CITY_HISTORY_LENGTH);
  offset += CITY_HISTORY_LENGTH * 2;
  const com = readInt16Array(view, offset, CITY_HISTORY_LENGTH);
  offset += CITY_HISTORY_LENGTH * 2;
  const ind = readInt16Array(view, offset, CITY_HISTORY_LENGTH);
  offset += CITY_HISTORY_LENGTH * 2;
  const crime = readInt16Array(view, offset, CITY_HISTORY_LENGTH);
  offset += CITY_HISTORY_LENGTH * 2;
  const pollution = readInt16Array(view, offset, CITY_HISTORY_LENGTH);
  offset += CITY_HISTORY_LENGTH * 2;
  const money = readInt16Array(view, offset, CITY_HISTORY_LENGTH);
  offset += CITY_HISTORY_LENGTH * 2;
  const misc = readInt16Array(view, offset, CITY_MISC_LENGTH);
  offset += CITY_MISC_LENGTH * 2;
  const map = readUint16Array(view, offset, dimensions.mapLength);

  return {
    dimensions,
    histories: { res, com, ind, crime, pollution, money },
    misc,
    map,
  };
}

export function decodeCityFileForMap(
  data: Uint8Array,
  mapSize: { width: number; height: number },
): CityFile {
  const file = decodeCityFile(data);
  const target = cityDimensionsForMap(mapSize.width, mapSize.height);
  if (target.mapLength > file.map.length) {
    throw new Error('city file is smaller than target map size');
  }

  return {
    dimensions: target,
    histories: file.histories,
    misc: file.misc,
    map: file.map.slice(0, target.mapLength),
  };
}

export function encodeCityFile(city: CityFile): Uint8Array {
  const dimensions = cityDimensionsForMap(city.dimensions.width, city.dimensions.height);
  if (city.map.length !== dimensions.mapLength) {
    throw new Error('map length does not match dimensions');
  }
  if (city.misc.length !== CITY_MISC_LENGTH) {
    throw new Error('misc length must be 120 shorts');
  }
  for (const [name, arr] of Object.entries(city.histories)) {
    if (arr.length !== CITY_HISTORY_LENGTH) {
      throw new Error(`history length mismatch for ${name}`);
    }
  }

  const buffer = new Uint8Array(dimensions.byteLength);
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  let offset = 0;

  offset = writeInt16Array(view, offset, city.histories.res);
  offset = writeInt16Array(view, offset, city.histories.com);
  offset = writeInt16Array(view, offset, city.histories.ind);
  offset = writeInt16Array(view, offset, city.histories.crime);
  offset = writeInt16Array(view, offset, city.histories.pollution);
  offset = writeInt16Array(view, offset, city.histories.money);
  offset = writeInt16Array(view, offset, city.misc);
  writeUint16Array(view, offset, city.map);

  return buffer;
}

export function readCityMeta(misc: Int16Array): CityMeta {
  return {
    cityTime: readI32FromMisc(misc, 8),
    totalFunds: readI32FromMisc(misc, 50),
    autoBulldoze: getOrThrow(misc[52]) !== 0,
    autoBudget: getOrThrow(misc[53]) !== 0,
    autoGo: getOrThrow(misc[54]) !== 0,
    userSoundOn: getOrThrow(misc[55]) !== 0,
    cityTax: getOrThrow(misc[56]),
    simSpeed: getOrThrow(misc[57]),
    policePercent: readFixed16_16(misc, 58),
    firePercent: readFixed16_16(misc, 60),
    roadPercent: readFixed16_16(misc, 62),
  };
}

export function writeCityMeta(misc: Int16Array, meta: CityMeta): void {
  writeI32ToMisc(misc, 8, meta.cityTime);
  writeI32ToMisc(misc, 50, meta.totalFunds);
  misc[52] = meta.autoBulldoze ? 1 : 0;
  misc[53] = meta.autoBudget ? 1 : 0;
  misc[54] = meta.autoGo ? 1 : 0;
  misc[55] = meta.userSoundOn ? 1 : 0;
  misc[56] = meta.cityTax;
  misc[57] = meta.simSpeed;
  writeFixed16_16(misc, 58, meta.policePercent);
  writeFixed16_16(misc, 60, meta.firePercent);
  writeFixed16_16(misc, 62, meta.roadPercent);
}

export function normalizeCityMeta(meta: CityMeta): CityMeta {
  const cityTime = meta.cityTime < 0 ? 0 : meta.cityTime;
  const cityTax = meta.cityTax < 0 || meta.cityTax > 20 ? 7 : meta.cityTax;
  const simSpeed = meta.simSpeed < 0 || meta.simSpeed > 3 ? 3 : meta.simSpeed;
  return { ...meta, cityTime, cityTax, simSpeed };
}

export function initFundingLevel(meta: CityMeta): CityMeta {
  return { ...meta, policePercent: 1, firePercent: 1, roadPercent: 1 };
}

export function applyLoadNormalization(meta: CityMeta): CityMeta {
  return initFundingLevel(normalizeCityMeta(meta));
}

function readInt16Array(view: DataView, offset: number, length: number): Int16Array {
  const arr = new Int16Array(length);
  for (let i = 0; i < length; i += 1) {
    arr[i] = view.getInt16(offset + i * 2, false);
  }
  return arr;
}

function readUint16Array(view: DataView, offset: number, length: number): Uint16Array {
  const arr = new Uint16Array(length);
  for (let i = 0; i < length; i += 1) {
    arr[i] = view.getUint16(offset + i * 2, false);
  }
  return arr;
}

function writeInt16Array(view: DataView, offset: number, arr: Int16Array): number {
  for (let i = 0; i < arr.length; i += 1) {
    view.setInt16(offset + i * 2, getOrThrow(arr[i]), false);
  }
  return offset + arr.length * 2;
}

function writeUint16Array(view: DataView, offset: number, arr: Uint16Array): void {
  for (let i = 0; i < arr.length; i += 1) {
    view.setUint16(offset + i * 2, getOrThrow(arr[i]), false);
  }
}

function readI32FromMisc(misc: Int16Array, index: number): number {
  const hi = getOrThrow(misc[index]) & 0xffff;
  const lo = getOrThrow(misc[index + 1]) & 0xffff;
  return (hi << 16) | lo | 0;
}

function writeI32ToMisc(misc: Int16Array, index: number, value: number): void {
  const packed = value | 0;
  misc[index] = (packed >>> 16) & 0xffff;
  misc[index + 1] = packed & 0xffff;
}

function readFixed16_16(misc: Int16Array, index: number): number {
  return readI32FromMisc(misc, index) / 65536;
}

function writeFixed16_16(misc: Int16Array, index: number, value: number): void {
  writeI32ToMisc(misc, index, Math.trunc(value * 65536));
}
