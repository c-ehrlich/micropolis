import { PowerMap, World } from './constants.ts';

const { WORLD_X, WORLD_Y, HWLDX, HWLDY, QWX, QWY, SmX, SmY } = World;
const { POWERMAPROW, PWRMAPSIZE } = PowerMap;

type LayerKind = 'u8' | 'u16' | 'i16';

type LayerLayout = 'tile' | 'bitset';

type LayerScale = 1 | 2 | 4 | 8;

export type LayerId =
  | 'map'
  | 'power'
  | 'popDensity'
  | 'trfDensity'
  | 'pollutionMem'
  | 'landValueMem'
  | 'crimeMem'
  | 'tem'
  | 'tem2'
  | 'terrainMem'
  | 'qtem'
  | 'rateOGMem'
  | 'fireStMap'
  | 'policeMap'
  | 'policeMapEffect'
  | 'fireRate'
  | 'comRate'
  | 'sTem';

export type LayerArray = Uint8Array | Uint16Array | Int16Array;

export interface LayerDef {
  id: LayerId;
  kind: LayerKind;
  layout: LayerLayout;
  scale: LayerScale;
  width: number;
  height: number;
  length: number;
}

export interface Patch {
  layer: LayerId;
  index: Uint32Array;
  prev: LayerArray;
  next: LayerArray;
}

export interface TickResult {
  patches: Patch[];
}

export interface MapStore {
  beginTick(): void;
  getLayer(layer: LayerId): LayerArray;
  write(layer: LayerId, index: number, value: number): void;
  commitTick(): TickResult;
  snapshot(layer: LayerId): LayerArray;
  layerInfo(layer: LayerId): LayerDef;
}

export const CLASSIC_LAYER_DEFS: Record<LayerId, LayerDef> = {
  map: {
    id: 'map',
    kind: 'u16',
    layout: 'tile',
    scale: 1,
    width: WORLD_X,
    height: WORLD_Y,
    length: WORLD_X * WORLD_Y,
  },
  power: {
    id: 'power',
    kind: 'u16',
    layout: 'bitset',
    scale: 1,
    width: POWERMAPROW,
    height: WORLD_Y,
    length: PWRMAPSIZE,
  },
  popDensity: {
    id: 'popDensity',
    kind: 'u8',
    layout: 'tile',
    scale: 2,
    width: HWLDX,
    height: HWLDY,
    length: HWLDX * HWLDY,
  },
  trfDensity: {
    id: 'trfDensity',
    kind: 'u8',
    layout: 'tile',
    scale: 2,
    width: HWLDX,
    height: HWLDY,
    length: HWLDX * HWLDY,
  },
  pollutionMem: {
    id: 'pollutionMem',
    kind: 'u8',
    layout: 'tile',
    scale: 2,
    width: HWLDX,
    height: HWLDY,
    length: HWLDX * HWLDY,
  },
  landValueMem: {
    id: 'landValueMem',
    kind: 'u8',
    layout: 'tile',
    scale: 2,
    width: HWLDX,
    height: HWLDY,
    length: HWLDX * HWLDY,
  },
  crimeMem: {
    id: 'crimeMem',
    kind: 'u8',
    layout: 'tile',
    scale: 2,
    width: HWLDX,
    height: HWLDY,
    length: HWLDX * HWLDY,
  },
  tem: {
    id: 'tem',
    kind: 'u8',
    layout: 'tile',
    scale: 2,
    width: HWLDX,
    height: HWLDY,
    length: HWLDX * HWLDY,
  },
  tem2: {
    id: 'tem2',
    kind: 'u8',
    layout: 'tile',
    scale: 2,
    width: HWLDX,
    height: HWLDY,
    length: HWLDX * HWLDY,
  },
  terrainMem: {
    id: 'terrainMem',
    kind: 'u8',
    layout: 'tile',
    scale: 4,
    width: QWX,
    height: QWY,
    length: QWX * QWY,
  },
  qtem: {
    id: 'qtem',
    kind: 'u8',
    layout: 'tile',
    scale: 4,
    width: QWX,
    height: QWY,
    length: QWX * QWY,
  },
  rateOGMem: {
    id: 'rateOGMem',
    kind: 'i16',
    layout: 'tile',
    scale: 8,
    width: SmX,
    height: SmY,
    length: SmX * SmY,
  },
  fireStMap: {
    id: 'fireStMap',
    kind: 'i16',
    layout: 'tile',
    scale: 8,
    width: SmX,
    height: SmY,
    length: SmX * SmY,
  },
  policeMap: {
    id: 'policeMap',
    kind: 'i16',
    layout: 'tile',
    scale: 8,
    width: SmX,
    height: SmY,
    length: SmX * SmY,
  },
  policeMapEffect: {
    id: 'policeMapEffect',
    kind: 'i16',
    layout: 'tile',
    scale: 8,
    width: SmX,
    height: SmY,
    length: SmX * SmY,
  },
  fireRate: {
    id: 'fireRate',
    kind: 'i16',
    layout: 'tile',
    scale: 8,
    width: SmX,
    height: SmY,
    length: SmX * SmY,
  },
  comRate: {
    id: 'comRate',
    kind: 'i16',
    layout: 'tile',
    scale: 8,
    width: SmX,
    height: SmY,
    length: SmX * SmY,
  },
  sTem: {
    id: 'sTem',
    kind: 'i16',
    layout: 'tile',
    scale: 8,
    width: SmX,
    height: SmY,
    length: SmX * SmY,
  },
};

class PatchWriter<T extends LayerArray> {
  private seen = new Map<number, number>();
  private idxs: number[] = [];
  private prev: number[] = [];
  private next: number[] = [];

  constructor(private arr: T) {}

  write(index: number, value: number) {
    const existing = this.seen.get(index);
    if (existing == null) {
      const current = this.arr[index];
      if (current === value) {
        return;
      }
      this.seen.set(index, this.idxs.length);
      this.idxs.push(index);
      this.prev.push(current);
      this.next.push(value);
    } else {
      this.next[existing] = value;
    }
    this.arr[index] = value;
  }

  finish(layer: LayerId): Patch | null {
    if (this.idxs.length === 0) {
      return null;
    }

    const filteredIdxs: number[] = [];
    const filteredPrev: number[] = [];
    const filteredNext: number[] = [];

    for (let i = 0; i < this.idxs.length; i += 1) {
      if (this.prev[i] === this.next[i]) {
        continue;
      }
      filteredIdxs.push(this.idxs[i]);
      filteredPrev.push(this.prev[i]);
      filteredNext.push(this.next[i]);
    }

    if (filteredIdxs.length === 0) {
      return null;
    }

    return {
      layer,
      index: Uint32Array.from(filteredIdxs),
      prev: cloneTypedArray(this.arr, filteredPrev),
      next: cloneTypedArray(this.arr, filteredNext),
    };
  }
}

function cloneTypedArray(arr: LayerArray, values: number[]): LayerArray {
  if (arr instanceof Uint8Array) {
    return Uint8Array.from(values);
  }
  if (arr instanceof Uint16Array) {
    return Uint16Array.from(values);
  }
  return Int16Array.from(values);
}

function createLayerArray(kind: LayerKind, length: number): LayerArray {
  switch (kind) {
    case 'u8':
      return new Uint8Array(length);
    case 'u16':
      return new Uint16Array(length);
    case 'i16':
      return new Int16Array(length);
    default:
      return new Uint8Array(length);
  }
}

export class DoubleBufferMapStore implements MapStore {
  private active = new Map<LayerId, LayerArray>();
  private work = new Map<LayerId, LayerArray>();
  private writers = new Map<LayerId, PatchWriter<LayerArray>>();
  private inTick = false;
  private layerOrder: LayerId[];

  constructor(private layerDefs: Record<LayerId, LayerDef> = CLASSIC_LAYER_DEFS) {
    this.layerOrder = Object.keys(layerDefs) as LayerId[];
    for (const id of this.layerOrder) {
      const def = layerDefs[id];
      this.active.set(id, createLayerArray(def.kind, def.length));
      this.work.set(id, createLayerArray(def.kind, def.length));
    }
  }

  layerInfo(layer: LayerId): LayerDef {
    return this.layerDefs[layer];
  }

  beginTick(): void {
    if (this.inTick) {
      throw new Error('beginTick called while already in a tick');
    }
    for (const id of this.layerOrder) {
      const activeArr = this.active.get(id)!;
      const workArr = this.work.get(id)!;
      workArr.set(activeArr);
      this.writers.set(id, new PatchWriter(workArr));
    }
    this.inTick = true;
  }

  getLayer(layer: LayerId): LayerArray {
    if (!this.inTick) {
      throw new Error('getLayer called outside of a tick');
    }
    return this.work.get(layer)!;
  }

  write(layer: LayerId, index: number, value: number): void {
    if (!this.inTick) {
      throw new Error('write called outside of a tick');
    }
    const writer = this.writers.get(layer);
    if (!writer) {
      throw new Error(`no patch writer for layer ${layer}`);
    }
    writer.write(index, value);
  }

  commitTick(): TickResult {
    if (!this.inTick) {
      throw new Error('commitTick called outside of a tick');
    }

    const patches: Patch[] = [];
    for (const [layer, writer] of this.writers.entries()) {
      const patch = writer.finish(layer);
      if (patch) {
        patches.push(patch);
      }
    }

    for (const id of this.layerOrder) {
      const activeArr = this.active.get(id)!;
      const workArr = this.work.get(id)!;
      this.active.set(id, workArr);
      this.work.set(id, activeArr);
    }

    this.writers.clear();
    this.inTick = false;
    return { patches };
  }

  snapshot(layer: LayerId): LayerArray {
    return this.active.get(layer)!;
  }
}

export function createClassicMapStore(): DoubleBufferMapStore {
  return new DoubleBufferMapStore(CLASSIC_LAYER_DEFS);
}

export function applyPatch<T extends LayerArray>(target: T, patch: Patch): T {
  const indexes = patch.index;
  const next = patch.next;
  for (let i = 0; i < indexes.length; i += 1) {
    target[indexes[i]] = next[i];
  }
  return target;
}
