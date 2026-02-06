# Terrain Op Parity Plan (C <-> TS)

This plan extends existing full-pipeline `GenerateMap(...)` parity with operation-level parity tests that isolate one C routine at a time.

Primary C reference: `ref/micropolis/src/sim/s_gen.c`.

## Decisions Locked

- Use one harness binary: `packages/micropolis-c-harness/build/terrain/micropolis-terrain-harness`.
- Keep current `GenerateMap` CLI behavior as the default (backward-compatible).
- Add `--op <name>` mode for operation-level parity.
- For `--op` mode, require `--input-map <path>` for all map-transform ops.
- For RNG-dependent ops, `--seed <u32>` means "call `SeedRand(seed)` immediately before the op".
- Build step in `@city/micropolis-c-harness` is acceptable.
- Generic parity helpers belong in `@city/micropolis-c-harness`; sim-core keeps terrain-specific generators and assertions.
- Property tests should avoid meaningless inputs and focus on terrain-relevant tile distributions.

## Why This Contract

- Op-level tests are most useful when the input map is explicit, reproducible, and independent of earlier pipeline steps.
- Pipeline RNG-state parity is already covered by full `GenerateMap` parity tests.
- Re-seeding immediately before an op keeps per-op parity tests deterministic and debuggable.
- Backward compatibility prevents churn in existing harness-based tests and fixture tooling.

## Harness Contract

### Binary and modes

- Binary path: `packages/micropolis-c-harness/build/terrain/micropolis-terrain-harness`.
- Default mode (no `--op`): current `GenerateMap` flow and flags stay intact.
- Op mode: `--op <name>`.

### Shared map I/O

- map size: `WORLD_X * WORLD_Y` (`120 * 100`).
- order: x-major (`index = x * WORLD_Y + y`).
- encoding: `u16le`.
- input in op mode: `--input-map <path>` required.
- output: `--format u16le|json` and optional `--dump-path <path>`.

### RNG in op mode

- RNG ops require `--seed <u32>`.
- Harness behavior: `SeedRand(seed)` directly before calling the op.

### Planned op names

- `noop` (Phase 0 map I/O round-trip helper)
- `smoothTrees`
- `putOnMap`
- `smoothWater`
- `smoothRiver`
- `brivPlop`
- `srivPlop`
- `makeLakes`
- `doRivers`

## Test Topology

- `pnpm test`: no C compile/exec.
- `pnpm test-parity`: C compile/exec allowed and parity suites enabled.
- Existing full-map parity remains in `packages/sim-core/src/terrain/generate.c-harness.test.ts`.
- New op-level parity tests live next to terrain modules in `packages/sim-core/src/terrain/`.
- Repro knobs for property parity:
  - `CITY_TEST_PARITY_RUNS`
  - `CITY_TEST_PARITY_FC_SEED`

## Helper Ownership

Create shared helper module(s) in `@city/micropolis-c-harness` for:

- read/write x-major `u16le` map files,
- harness invocation wrapper (`runTerrainHarness(...)`),
- common mismatch reporter (`x/y/index/expected/actual`),
- optional temporary-case batch runner later.

Sim-core-specific parity helpers stay in sim-core:

- biased fast-check generators for terrain-relevant tiles,
- adapters that call TS terrain routines with op-specific args.

## LLM-Sized Delivery Checklist

Each item is intentionally small and verifiable. Every item must end with at least one parity test (unit and/or property).

### Phase 0: foundation and compatibility

- [x] `P0.1` Add `--op` parsing to harness while preserving current default mode.
  - Code: extend `packages/micropolis-c-harness/terrain/terrain_harness.c`.
  - Test: existing `GenerateMap` parity test still passes unchanged.
  - Done when: running harness without `--op` is behaviorally identical to today.

- [x] `P0.2` Add shared map-loader and map-dumper helpers in C (`u16le` x-major input/output).
  - Code: harness helper functions for loading `--input-map`.
  - Test: round-trip test in parity suite (`input -> harness --op noop -> output`) preserves bytes.
  - Done when: C harness can safely load and re-emit a map with exact equality.

- [x] `P0.3` Add JS/TS parity helper module in `@city/micropolis-c-harness` with JSDoc.
  - Code: harness runner + `u16le` decode/encode + mismatch formatter.
  - Test: one sim-core parity test switched to the shared helper.
  - Done when: sim-core no longer duplicates low-level harness I/O logic in that test.

### Phase 1: first two high-value ops

- [ ] `P1.1` Implement `--op smoothTrees`.
  - C refs: `SmoothTrees`, `TEdTab` in `ref/micropolis/src/sim/s_gen.c`.
  - Test: `smooth-trees.c-harness.test.ts` with deterministic fixture parity + property parity using tree-biased maps.
  - Done when: C op output equals TS `smoothTrees(...)` across fixed and property cases.

- [ ] `P1.2` Implement `--op putOnMap`.
  - C ref: `PutOnMap` in `ref/micropolis/src/sim/s_gen.c`.
  - Test: `put-on-map.c-harness.test.ts` covering overwrite edge cases and randomized target-cell states.
  - Done when: channel/river overwrite behavior matches exactly for both fixed and property tests.

### Phase 2: core smoothing parity

- [ ] `P2.1` Implement `--op smoothWater`.
  - C ref: `SmoothWater` in `ref/micropolis/src/sim/s_gen.c`.
  - Test: `smooth-water.c-harness.test.ts` with branch-biased maps (water/woods edges and flagged tiles).
  - Done when: all three passes match map-for-map.

- [ ] `P2.2` Implement `--op smoothRiver` with op-local seeding semantics.
  - C ref: `SmoothRiver` in `ref/micropolis/src/sim/s_gen.c`.
  - Test: `smooth-river.c-harness.test.ts` with `--seed`, plus property runs that stress `Rand(1)` branch.
  - Done when: edge tile choices and optional `temp++` behavior match exactly.

### Phase 3: plop and pipeline components

- [ ] `P3.1` Implement `--op brivPlop` and `--op srivPlop`.
  - C refs: `BRivPlop`, `SRivPlop` in `ref/micropolis/src/sim/s_gen.c`.
  - Test: `river-plops.c-harness.test.ts` with map cursor variants and bounds-clipping cases.
  - Done when: matrix applications match exactly.

- [ ] `P3.2` Implement `--op makeLakes`.
  - C ref: `MakeLakes` in `ref/micropolis/src/sim/s_gen.c`.
  - Test: `make-lakes.c-harness.test.ts` for fixed + property cases; include odd `LakeLevel` values to confirm C integer truncation (`LakeLevel / 2`).
  - Done when: lake counts and plop-type distribution match for identical inputs and seeds.

- [ ] `P3.3` Implement `--op doRivers`.
  - C refs: `DoRivers`, `DoBRiv`, `DoSRiv` in `ref/micropolis/src/sim/s_gen.c`.
  - Test: `do-rivers.c-harness.test.ts` with explicit `xStart/yStart`, fixed seeds, and branch-biased property inputs.
  - Done when: river walk and direction drift behavior match exactly.

### Phase 4: scale and performance

- [ ] `P4.1` Extend full `GenerateMap` fixture matrix (stage gates + island branches + odd levels).
  - C ref: `GenerateMap` in `ref/micropolis/src/sim/s_gen.c`.
  - Test: expand `generate.c-harness.test.ts` fixture manifest.
  - Done when: fixture matrix covers `TreeLevel/LakeLevel/CurveLevel` in `{-1,0,1}` plus forced and random islands.

- [ ] `P4.2` Add optional batch parity execution mode if runtime becomes a bottleneck.
  - Scope: keep off critical path; enable only for larger property suites.
  - Test: compare batch and per-case harness outputs for identical case sets.
  - Done when: outputs are identical and parity runtime decreases materially.

## Op Coverage Tracker

- [ ] `smoothTrees`
- [ ] `putOnMap`
- [ ] `smoothWater`
- [ ] `smoothRiver`
- [ ] `brivPlop`
- [ ] `srivPlop`
- [ ] `makeLakes`
- [ ] `doRivers`

## Definition of Done (Global)

- `pnpm test` remains free of C compile/exec.
- `pnpm test-parity` compiles/executes harness and runs full-map + op-level parity.
- Every new/updated function and test includes JSDoc/comments that cite the relevant Micropolis C function and file, including source for asserted constants.
- Property generators stay terrain-relevant (avoid random meaningless 16-bit tile states).
