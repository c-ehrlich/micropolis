## Progress Snapshot (Code-Verified)

This file tracks implementation status in the TypeScript port. Source of truth is code/tests in this repository.

## Implemented

- `ref/micropolis/spec/core/SPEC.md`:
  - Core simulation loop + systems are implemented in `packages/sim-core/src/sim/simulate.ts` and `packages/sim-core/src/systems/*.ts`.
  - Includes power, zones/growth, traffic, PTL, crime, pop density, fire coverage, budget, census/history, evaluation, messages/scenarios, disasters, valves, date/time, and optional heat.
- `ref/micropolis/spec/terrain/SPEC.md` (non-UI terrain generation):
  - `GenerateMap` pipeline and terrain routines are implemented in `packages/sim-core/src/terrain/*.ts`.
  - Fixture parity and C-harness parity tests exist in `packages/sim-core/src/terrain/*.c-harness.test.ts` plus fixtures in `packages/sim-core/fixtures/terrain/`.
- `ref/micropolis/spec/persistence/SPEC.md`:
  - `.cty` format read/write and metadata mapping are implemented in `packages/sim-core/src/io/cty.ts` and `packages/sim-core/src/io/cty-state.ts`.
  - Public load/scenario orchestration APIs are implemented in `packages/sim-io/src/load.ts` (`loadFileLikeC`, `loadCityLikeC`, `loadScenarioLikeC`) plus `snro.*` scenario table/resource helpers in `packages/sim-io/src/scenarios.ts` and `packages/sim-io/src/node-files.ts`.
  - Public save orchestration APIs are implemented in `packages/sim-io/src/save.ts` (`saveFileLikeC`, `saveCityLikeC`, `saveCityAsLikeC`) plus Node save-to-path wrappers in `packages/sim-io/src/node-files.ts`.
  - Byte-for-byte save parity checks against the Micropolis C oracle are implemented in `packages/sim-io/src/save-parity.test.ts` via `packages/micropolis-c-harness/src/core-parity.ts` (`runCoreOracleSaveCty`).
  - Cross-language `.cty` interoperability parity is covered in `packages/sim-io/src/persistence-roundtrip-parity.test.ts`, including TS-save->C-load, C-save->TS-load, TS<->C round-trips, load normalization parity, fixed-point percent truncation checks, stdin-bytes oracle load plumbing (`runCoreOracleLoadCtyBytes`), accepted file-size behavior (`27120`, `99120`, `219120`), and invalid-size rejection parity across TS + C loaders.
  - Harness-level command equivalence coverage now verifies that `load-cty --cty-path` and `load-cty-bytes` produce identical loaded oracle state for the same valid payload, and also fail identically on invalid payloads while preserving pre-load oracle state; reusable non-throwing failure-probe wrapper APIs now expose load-command `exitStatus`/`signal`/`stderr` plus pre/post `save-cty` bytes for unchanged-state assertions (`packages/micropolis-c-harness/src/core-parity.ts`, `packages/micropolis-c-harness/src/core-parity.test.ts`); non-I/O parity callsites in sim-core use bytes-based loader plumbing (`packages/sim-core/src/io/cty.test.ts`).

## Partially Implemented

- `ref/micropolis/spec/ui/SPEC.md`:
  - UI-adjacent logic exists in sim-core (`tool-actions.ts`, `realtime.ts`, heads/message behavior in core systems).
  - Actual rendering/widgets/overlays/graphs/UI event-loop behavior are out of scope in sim-core and not implemented in `packages/sim-ui` (stub package).

## Not Yet Implemented (Non-UI Adjacent Packages)

- `ref/micropolis/spec/resources/SPEC.md` package work (`packages/sim-assets`) remains a stub.
- `ref/micropolis/spec/scripting/SPEC.md` package work (`packages/sim-scripting`) remains a stub.
- `ref/micropolis/spec/integration/SPEC.md` package work (`packages/sim-integration`) remains a stub.
