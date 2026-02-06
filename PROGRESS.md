## Progress Snapshot (Code-Verified)

This file tracks implementation status in the TypeScript port. Source of truth is code/tests in this repository.

## Implemented

- `ref/micropolis/spec/core/SPEC.md`:
  - Core simulation loop + systems are implemented in `packages/sim-core/src/sim/simulate.ts` and `packages/sim-core/src/systems/*.ts`.
  - Includes power, zones/growth, traffic, PTL, crime, pop density, fire coverage, budget, census/history, evaluation, messages/scenarios, disasters, valves, date/time, and optional heat.
- `ref/micropolis/spec/terrain/SPEC.md` (non-UI terrain generation):
  - `GenerateMap` pipeline and terrain routines are implemented in `packages/sim-core/src/terrain/*.ts`.
  - Fixture parity and C-harness parity tests exist in `packages/sim-core/src/terrain/*.c-harness.test.ts` plus fixtures in `packages/sim-core/fixtures/terrain/`.

## Partially Implemented

- `ref/micropolis/spec/persistence/SPEC.md`:
  - `.cty` format read/write and metadata mapping are implemented in `packages/sim-core/src/io/cty.ts` and `packages/sim-core/src/io/cty-state.ts`.
  - Scenario file loading (`snro.*`) and full C-style Save/Load orchestration are not yet implemented as public TS APIs.
- `ref/micropolis/spec/ui/SPEC.md`:
  - UI-adjacent logic exists in sim-core (`tool-actions.ts`, `realtime.ts`, heads/message behavior in core systems).
  - Actual rendering/widgets/overlays/graphs/UI event-loop behavior are out of scope in sim-core and not implemented in `packages/sim-ui` (stub package).

## Not Yet Implemented (Non-UI Adjacent Packages)

- `ref/micropolis/spec/resources/SPEC.md` package work (`packages/sim-assets`) remains a stub.
- `ref/micropolis/spec/scripting/SPEC.md` package work (`packages/sim-scripting`) remains a stub.
- `ref/micropolis/spec/integration/SPEC.md` package work (`packages/sim-integration`) remains a stub.
