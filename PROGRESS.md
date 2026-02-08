## Progress Snapshot (Code-Verified, 2026-02-08)

This file tracks implementation status in the TypeScript port. Source of truth is code/tests in this repository.

## Implemented

- `ref/micropolis/spec/core/SPEC.md`:
  - Core simulation loop + systems are implemented in `packages/sim-core/src/sim/simulate.ts` and `packages/sim-core/src/systems/*.ts`.
  - Includes power, zones/growth, traffic, PTL, crime, pop density, fire coverage, budget, census/history, evaluation, messages/scenarios, disasters, valves, date/time, and optional heat.
- `ref/micropolis/spec/terrain/SPEC.md`:
  - Non-UI `GenerateMap` pipeline and terrain routines are implemented in `packages/sim-core/src/terrain/*.ts` with fixture + C-harness parity tests.
- `ref/micropolis/spec/persistence/SPEC.md`:
  - `.cty` read/write and state mapping live in `packages/sim-core/src/io/cty*.ts`.
  - C-style load/save/scenario orchestration and parity tests live in `packages/sim-io/src/*.ts` and `packages/micropolis-c-harness/src/core-parity*.ts`.
- `ref/micropolis/spec/resources/SPEC.md`:
  - `packages/sim-assets` is implemented with typed asset catalogs/parsers/loaders for strings, tiles, sprites, sounds, UI bitmaps, help docs, scenario resource helpers, generated manifests, and deterministic derived-image export/drift checks.
- `ref/micropolis/spec/scripting/SPEC.md`:
  - `packages/sim-scripting` is implemented with a Tcl-like runtime, command families (`sim`, `editorview`, `mapview`, `graphview`, `dateview`, `sprite`, `piemenu`, `interval`, optional `camview`), callback bridge helpers, feature flags, and colocated parity tests.
- `ref/micropolis/spec/integration/SPEC.md`:
  - `packages/sim-integration` is implemented with Sugar command bridging, stdout `PlaySound` parsing, TTY stdin channel parity behavior, NET UDP hooks, Node adapters, mixed-feature runtime orchestration tests, and an integration ownership contract.

## Partially Implemented

- `ref/micropolis/spec/ui/SPEC.md`:
  - UI-adjacent behavior exists in `sim-core` (heads/messages/map invalidation flags/tool actions), but rendering/widgets/view-state/event-loop implementation is still pending in `packages/sim-ui` and app-level UI packages.

## Remaining Major Tasks

- Build `packages/sim-ui` from stub to working UI state/render package (map invalidation, heads, messages, overlays, graphs, tool UX).
- Wire `sim-core` + `sim-scripting` + `sim-integration` together in app-level runtime flows (editor/docs/web) instead of package-isolated parity units.
- Finish remaining parity hardening tasks called out in package plans (for example scripting transcript tests and explicit quirk coverage).
