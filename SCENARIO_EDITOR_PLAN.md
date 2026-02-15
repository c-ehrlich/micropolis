# Scenario System + Scenario Editor Stage Plan

## Locked Decisions

1. No `legacyId` in canonical scenario definitions.
2. Final saved scenario payloads store compiled map data only.
3. `map` is a discriminated union.
4. Scenario editor is a separate app.
5. AI/image import is editor-only.
6. Gameplay supports built-in and user-loaded scenarios.
7. Add `Load Scenario...` to the Micropolis menu.
8. Scenario bundles are single JSON files.
9. Map size is `120x100` in v1.
10. `gameLevel` is configured at launch time, not stored in scenario definition.
11. AI import is deferred from initial implementation.
12. AI stack target is Vercel AI SDK + OpenRouter.
13. Canonical persisted map output is `cityFileBytes` (base64).
14. Reader accepts `cityFileBytes` and `tileWords`; writer canonicalizes to `cityFileBytes`.
15. Payloads containing both map forms at once are invalid.
16. Round-trip map transcoding tests are required.
17. Objective predicates are for win/lose in v1; future event-gating reuse is allowed.
18. V1 objectives are single-checkpoint (no staged objectives).
19. Behavior profiles are closed/registered (no arbitrary user runtime hooks).
20. `Load Scenario...` opens a pre-start dialog.
21. Scenario key convention is `builtin/*` and `user/*`.
22. Package split is fixed to 3 packages: `scenario-core`, `scenario-runtime`, `scenario-authoring`.
23. V1 schema includes broader predicate metrics, with curated UI exposure.
24. Import artifacts are ephemeral in v1.
25. Export is strict: validation/lint errors block export.
26. First shippable editor milestone is metadata + manual map editing + JSON export.
27. Script/objective authoring UI is explicitly deferred beyond first editor milestone.

## Stage 0 - Contracts, Schema, and Package Extraction
- [x] Stage status: complete

### Reference Files
- `packages/sim-io/src/scenarios.ts`
- `packages/sim-core/src/io/cty.ts`
- `packages/sim-core/src/io/cty-state.ts`
- `packages/sim-core/src/core/sim-state.ts`
- `apps/web/src/game/runtime/playable-scenario-choices.ts`

### Requirements (Task Checklist)
- [x] **0.1** Create `packages/scenario-core` with canonical TS types + Zod schemas for `ScenarioBundleV1`.
- [x] **0.2** Implement `cityFileBytes`/`tileWords` read support and canonical write-to-`cityFileBytes` behavior.
- [x] **0.3** Add validation for mutual exclusivity of map forms and key namespace conventions (`builtin/*`, `user/*`).
- [x] **0.4** Add deterministic transcoders and package-level APIs for map round-trip conversion.
- [x] **0.5** Wire consumers to read scenario definitions via `scenario-core` instead of ad hoc types.

### Good Tests
- Round-trip golden tests: `tileWords -> cityFileBytes -> tileWords` and reverse.
- Schema rejection tests: both map forms present, malformed base64, wrong dimensions.
- Key validation tests: reject missing namespace or unknown namespace prefix.

## Stage 1 - Runtime Decoupling from Numeric Scenario IDs
- [ ] Stage status: complete

### Reference Files
- `packages/sim-core/src/systems/init.ts`
- `packages/sim-core/src/systems/disasters.ts`
- `packages/sim-core/src/systems/messages.ts`
- `packages/sim-core/src/sim/realtime.ts`
- `ref/micropolis/src/sim/s_sim.c`
- `ref/micropolis/src/sim/s_disast.c`
- `ref/micropolis/src/sim/s_msg.c`

### Requirements (Task Checklist)
- [x] **1.1** Create `packages/scenario-runtime` with declarative event/objective runtime state.
- [x] **1.2** Replace hardcoded `ScenarioID` conditionals in sim runtime paths with scenario-runtime inputs.
- [x] **1.3** Port classic built-in scenarios to declarative data (`builtin/*`) with parity behavior.
- [x] **1.4** Implement closed behavior profile registry and map legacy behavior (including SF ship-honk variant).
- [x] **1.5** Keep deterministic behavior parity with fixed-seed runs.

### Good Tests
- Parity tests for each classic scenario’s timer/disaster cadence.
- Regression tests for objective evaluation parity (`DoScenarioScore`-equivalent outcomes).
- Deterministic replay/hash stability before vs after ID decoupling.

## Stage 2 - Gameplay Integration and Scenario Load UX
- [ ] Stage status: complete

### Reference Files
- `apps/web/src/features/playable-runtime/presentation/runtime-panel/menus/micropolis-menu.tsx`
- `apps/web/src/features/playable-runtime/presentation/runtime-panel/dialogs/scenario-dialog.tsx`
- `apps/web/src/game/runtime/playable-runtime-host.ts`
- `apps/web/src/game/runtime/protocol.ts`
- `packages/sim-io/src/scenarios.ts`

### Requirements (Task Checklist)
- [x] **2.1** Move scenario selection and runtime protocol to `scenarioKey`-based flows.
- [x] **2.2** Add `Load Scenario...` file picker in Micropolis menu for external scenario JSON.
- [x] **2.3** Add pre-start review dialog after loading scenario (metadata summary + difficulty selection + explicit start).
- [x] **2.4** Ensure built-in scenario catalog and user-loaded scenarios use same runtime entry path.
- [x] **2.5** Preserve deterministic load/save/replay behavior under new scenario loading path.

### Good Tests
- UI interaction tests for `Load Scenario...` menu and dialog transitions.
- Protocol tests asserting `scenarioKey` is propagated correctly.
- Load/save/replay smoke tests for one built-in and one external scenario.

## Stage 3 - Editor MVP (First Shippable)
- [ ] Stage status: complete

### Reference Files
- `apps/editor/`
- `packages/scenario-core/` (from Stage 0)
- `packages/scenario-authoring/` (new)
- `packages/sim-core/src/io/cty.ts`

### Requirements (Task Checklist)
- [x] **3.1** Scaffold `apps/scenario-editor` with route/layout/state foundations.
- [x] **3.2** Implement scenario metadata editing (`key`, name, description, tags, start params).
- [x] **3.3** Implement manual map editing + map preview for fixed `120x100`.
- [ ] **3.4** Implement strict export to bundle JSON (fail on validation/lint errors).
- [ ] **3.5** Implement bundle import/open flow for iterative edits.
- [ ] **3.6** Keep script/objective authoring UI out of MVP (deferred to later stage).
- [ ] **3.7** Keep AI import out of MVP (deferred to later stage).

### Good Tests
- Form validation tests for metadata constraints and key namespace enforcement.
- Map editing tests for tile mutation correctness and bounds safety.
- Export/import round-trip tests proving editor output is runtime-loadable.
- Negative tests verifying export fails on schema/lint violations.

## Stage 4 - Script and Objective Authoring UI (Post-MVP)
- [ ] Stage status: complete

### Reference Files
- `packages/scenario-runtime/` (from Stage 1)
- `packages/sim-core/src/systems/messages.ts`
- `packages/sim-core/src/systems/disasters.ts`
- `apps/scenario-editor/` (from Stage 3)

### Requirements (Task Checklist)
- [ ] **4.1** Add objective editor for predicate DSL (`metric`, `all`, `any`, `not`).
- [ ] **4.2** Add event/action editor for declarative scripts (`atTick`, `everyTicks`, actions union).
- [ ] **4.3** Add behavior profile assignment UI with closed profile validation.
- [ ] **4.4** Add authoring-time semantic validation (unknown metric, invalid op/type combos, empty `all/any`, etc.).
- [ ] **4.5** Integrate edited scripts/objectives into export pipeline.

### Good Tests
- UI-driven serialization tests from form model -> valid script/objective JSON.
- Validation tests for malformed predicate trees and invalid action payloads.
- Runtime smoke tests proving authored scripts execute through scenario-runtime.

## Stage 5 - AI-Assisted Image Import (Planned, Deferred)
- [ ] Stage status: complete

### Reference Files
- `packages/scenario-authoring/`
- `apps/scenario-editor/`
- `packages/sim-core/src/terrain/`
- `packages/sim-core/src/io/cty.ts`

### Requirements (Task Checklist)
- [ ] **5.1** Define ephemeral `featureMap` contract for vision extraction outputs.
- [ ] **5.2** Build deterministic compiler passes from `featureMap` -> compiled map.
- [ ] **5.3** Integrate Vercel AI SDK + OpenRouter provider adapter behind clear interfaces.
- [ ] **5.4** Add AI import review UX with confidence and correction tooling.
- [ ] **5.5** Enforce that saved bundles contain only compiled map output (no import artifacts).

### Good Tests
- Compiler determinism tests on fixed `featureMap` fixtures.
- Contract tests for provider adapter outputs -> schema-validated intermediates.
- Regression tests for invalid extraction data and correction workflows.

## Stage 6 - Compatibility, Migration, and Validation Tooling
- [ ] Stage status: complete

### Reference Files
- `packages/sim-io/src/scenarios.ts`
- `packages/scenario-core/`
- `packages/scenario-runtime/`
- `apps/web/src/game/runtime/`

### Requirements (Task Checklist)
- [ ] **6.1** Add versioned migration hooks for future schema evolution.
- [ ] **6.2** Add compatibility loader tests for built-in and external scenarios.
- [ ] **6.3** Add lint/fix diagnostics for authoring-time map/script problems.
- [ ] **6.4** Document scenario bundle contract and migration rules for contributors.

### Good Tests
- Backward compatibility tests with frozen historical scenario fixtures.
- Migration tests proving old bundle versions load and normalize correctly.
- Lint/fix tests for common invalid authoring states.

## Stage 7 - Hardening and Release Readiness
- [ ] Stage status: complete

### Reference Files
- `packages/micropolis-c-harness/src/core-parity.ts`
- `packages/sim-core/src/__test__/`
- `apps/scenario-editor/`
- `apps/web/`

### Requirements (Task Checklist)
- [ ] **7.1** Add full parity regression suite for all classic scenarios in declarative form.
- [ ] **7.2** Add E2E path: editor export -> gameplay load -> simulation smoke and replay checks.
- [ ] **7.3** Add performance/bundle-size benchmarks for scenario loading and map transcoding.
- [ ] **7.4** Stabilize docs, release checklist, and operator runbook for scenario workflows.

### Good Tests
- Full-scenario golden snapshots and deterministic replay comparisons.
- E2E automation covering built-in and user-authored scenario lifecycles.
- Performance assertions with thresholds for export/load/transcode operations.

## Notes for Operators

- Keep stage status checkboxes manual; orchestrator executes `Task Checklist` items.
- Use `scripts/auto-orchestrator.mjs queue` to view remaining tasks by stage stream.
- Use `scripts/auto-orchestrator.mjs drift` to detect missing stage/task structure issues.
