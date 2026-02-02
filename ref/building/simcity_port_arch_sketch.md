# SimCity Port Architecture Notes (Hybrid Model + Immutable Boundary)

This note consolidates the conclusions from the discussion:
- resolve SimCity's real-time feel with discrete sim ticks
- pick a hybrid state representation
- keep in-place semantics inside a tick, but expose immutable snapshots + patch logs
- prefer double-buffer (variant 2) with tests

---

## 1) Simulation model: real-time feel + discrete ticks

**Core idea**: SimCity is real-time in presentation, but internally it is tick-based. Treat each sim step/week as an internal "turn" while still running a real-time render/input loop.

**Resolution**:
- Keep **two clocks**:
  - **real-time clock**: input, animations, object updates
  - **simulation clock**: 16-step scheduler (sim week)
- Treat each **sim step** as a deterministic internal turn.
- Player tools can be:
  - **Applied immediately** (faithful feel) but **stamped** with `(simStep, order)` for determinism
  - Or **queued** to apply at the next sim boundary if you want stricter determinism

**Recommended**: apply tool actions immediately, but log them with a stable order and simStep. This preserves the live feel while remaining replayable.

---

## 2) State representation: Hybrid (C)

We want a SimCity clone, so the primary map and derived layers should remain first-class.

### A) Packed tile map + derived maps (SimCity style)
**Pros**
- cache-friendly, fast scans
- faithful behavior + bit-level quirks
- compact memory, simple save/load

**Cons**
- opaque tile IDs/flags
- harder to debug
- extension requires lookup tables

### B) Entity-centric + sparse state (Athena style)
**Pros**
- expressive, typed, easier to extend
- clearer rules and tooling
- great for undo/AI

**Cons**
- slower for dense scans
- more allocations
- less faithful to SimCity quirks

### C) Hybrid (recommended)
**Use**:
- **packed primary map + derived maps** for core sim
- **separate object tables** for agents (train, ship, monster)
- **action/response logging** for determinism + replay

This keeps SimCity's performance + behavior while still borrowing strong tooling patterns from Athena.

---

## 3) Mutation style: why Athena is immutable, and what we should do

**Why Athena uses immutability**:
- turn-based action pipeline
- easy undo/replay/branching
- safe diffing for fog/visibility
- deterministic tests and AI search

**Why full immutability is less compelling for SimCity**:
- high-frequency ticks and dense grid mutations
- update order artifacts matter for behavior
- fast-forward would amplify GC/allocations

**Conclusion**: keep **in-place semantics inside the tick**, but expose **immutable snapshots at the boundary**. This gives correctness + tooling without losing fidelity.

---

## 4) Immutable boundary pattern (recommended)

**Inside the tick**: mutate a working buffer in place (faithful).

**Outside the tick**: only publish snapshots that are treated as immutable.

**Bridge**: patch logs + snapshot swap.

### Two variants

**Variant 1: copy-per-tick (clone)**
- Clone arrays at tick start
- Mutate clone in place
- Publish clone as next snapshot

**Variant 2: double-buffer + memcpy (preferred)**
- Keep `active` + `work` buffers for each layer
- `work.set(active)` at tick start
- Mutate `work` during tick
- Swap `active`/`work` at commit

**Pros/cons summary**
- Variant 1: simplest, more allocations/GC
- Variant 2: stable memory, less GC, best for long runs and fast-forward

---

## 5) Patch logging and undo

**Patch log**: record `(index, prev, next)` per layer for deltas and undo.

- UI can consume patches for dirty-rect redraws
- Undo uses the inverse patch (swap prev/next)
- Replay can use snapshots + patches

If patches get large, you can fall back to sending a full snapshot for that layer.

---

## 6) Minimal `MapStore` sketch (double-buffer + patch log)

Below is a minimal interface and implementation sketch. This keeps the sim logic independent of how storage is implemented.

```ts
// core layer IDs
export type LayerId =
  | "map"
  | "power"
  | "landValue"
  | "pollution"
  | "crime"
  | "traffic"
  | "popDensity";

export type Patch = {
  layer: LayerId;
  index: Uint32Array;
  prev: Uint16Array | Uint8Array;
  next: Uint16Array | Uint8Array;
};

export type TickResult = {
  patches: Patch[];
};

export interface MapStore {
  beginTick(): void;
  getLayer(layer: LayerId): Uint16Array | Uint8Array; // returns work buffer during tick
  commitTick(): TickResult;
  snapshot(layer: LayerId): Uint16Array | Uint8Array; // active buffer
}
```

```ts
class PatchWriter<T extends Uint8Array | Uint16Array> {
  private seen = new Map<number, number>();
  private idxs: number[] = [];
  private prev: number[] = [];
  private next: number[] = [];

  constructor(private arr: T) {}

  write(i: number, v: number) {
    const pos = this.seen.get(i);
    if (pos == null) {
      this.seen.set(i, this.idxs.length);
      this.idxs.push(i);
      this.prev.push(this.arr[i]);
      this.next.push(v);
    } else {
      this.next[pos] = v;
    }
    this.arr[i] = v;
  }

  finish(layer: LayerId): Patch | null {
    if (this.idxs.length === 0) return null;
    return {
      layer,
      index: Uint32Array.from(this.idxs),
      prev: (this.arr instanceof Uint16Array
        ? Uint16Array.from(this.prev)
        : Uint8Array.from(this.prev)) as any,
      next: (this.arr instanceof Uint16Array
        ? Uint16Array.from(this.next)
        : Uint8Array.from(this.next)) as any,
    };
  }
}
```

```ts
class DoubleBufferStore implements MapStore {
  private active = new Map<LayerId, Uint8Array | Uint16Array>();
  private work = new Map<LayerId, Uint8Array | Uint16Array>();
  private writers = new Map<LayerId, PatchWriter<any>>();

  beginTick() {
    for (const [layer, activeArr] of this.active.entries()) {
      const workArr = this.work.get(layer)!;
      workArr.set(activeArr); // memcpy
      this.writers.set(layer, new PatchWriter(workArr));
    }
  }

  getLayer(layer: LayerId) {
    return this.work.get(layer)!;
  }

  write(layer: LayerId, index: number, value: number) {
    this.writers.get(layer)!.write(index, value);
  }

  commitTick(): TickResult {
    const patches: Patch[] = [];
    for (const [layer, writer] of this.writers.entries()) {
      const patch = writer.finish(layer);
      if (patch) patches.push(patch);
    }

    // swap active/work
    for (const layer of this.active.keys()) {
      const a = this.active.get(layer)!;
      const w = this.work.get(layer)!;
      this.active.set(layer, w);
      this.work.set(layer, a);
    }

    this.writers.clear();
    return { patches };
  }

  snapshot(layer: LayerId) {
    return this.active.get(layer)!;
  }
}
```

**Notes**:
- In production, guard against writes after `commitTick()`.
- You can compile out patch logging for performance if needed.

---

## 7) Final choices (agreed)

- **Simulation model**: discrete sim ticks with real-time render loop
- **State representation**: hybrid (packed map + derived layers + object tables)
- **Mutation style**: double-buffer with patch log (mutable inside tick, immutable boundary)

