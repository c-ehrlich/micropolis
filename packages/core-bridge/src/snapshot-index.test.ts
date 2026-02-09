import { describe, expect, it } from 'vitest';

import { getCoreBridgeV1SnapshotTileIndex } from './types.ts';

describe('getCoreBridgeV1SnapshotTileIndex', () => {
  it('uses the frozen x-major snapshot layout formula', () => {
    // `WORLD_X=120` and `WORLD_Y=100` come from `ref/micropolis/src/sim/headers/sim.h`.
    // `Map[i] = base + i * WORLD_Y` in `ref/micropolis/src/sim/s_alloc.c` locks the
    // x-major stride (`index = x * WORLD_Y + y`) used by contiguous map reads/writes.
    expect(getCoreBridgeV1SnapshotTileIndex(0, 0, 100)).toBe(0);
    expect(getCoreBridgeV1SnapshotTileIndex(1, 0, 100)).toBe(100);
    expect(getCoreBridgeV1SnapshotTileIndex(1, 1, 100)).toBe(101);
    expect(getCoreBridgeV1SnapshotTileIndex(119, 99, 100)).toBe(11999);
  });

  it('truncates inputs to preserve C-style integer index math', () => {
    // C index arithmetic is integer-only; this mirrors truncation semantics.
    expect(getCoreBridgeV1SnapshotTileIndex(1.9, 2.8, 100.4)).toBe(102);
  });
});
