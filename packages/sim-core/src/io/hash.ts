const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

function fnv1aStep(hash: number, byte: number): number {
  return Math.imul(hash ^ (byte & 0xff), FNV_PRIME) >>> 0;
}

export function hashBytes(bytes: Uint8Array, seed = FNV_OFFSET): number {
  let hash = seed >>> 0;
  for (let i = 0; i < bytes.length; i += 1) {
    hash = fnv1aStep(hash, bytes[i] ?? 0);
  }
  return hash >>> 0;
}

export function hashUint16(values: Uint16Array, seed = FNV_OFFSET): number {
  let hash = seed >>> 0;
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i] ?? 0;
    hash = fnv1aStep(hash, value >>> 8);
    hash = fnv1aStep(hash, value & 0xff);
  }
  return hash >>> 0;
}

export function hashInt16(values: Int16Array, seed = FNV_OFFSET): number {
  let hash = seed >>> 0;
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i] ?? 0;
    const packed = value & 0xffff;
    hash = fnv1aStep(hash, packed >>> 8);
    hash = fnv1aStep(hash, packed & 0xff);
  }
  return hash >>> 0;
}

export function hashScalars(values: readonly number[], seed = FNV_OFFSET): number {
  let hash = seed >>> 0;
  for (const value of values) {
    const packed = value | 0;
    hash = fnv1aStep(hash, (packed >>> 24) & 0xff);
    hash = fnv1aStep(hash, (packed >>> 16) & 0xff);
    hash = fnv1aStep(hash, (packed >>> 8) & 0xff);
    hash = fnv1aStep(hash, packed & 0xff);
  }
  return hash >>> 0;
}

export function mixHashes(...hashes: number[]): number {
  return hashScalars(hashes);
}

export function hashMap(map: Uint16Array): number {
  return hashUint16(map);
}
