# Stage 4 Plan: Glue, Host Switchability, and Playable Sign-Off

## Stage Goal

Converge Stage 1/2/3 outputs into one cohesive product where `apps/web` can switch between `LocalHost` and `DoHost` without architectural rewrites, with clear playable acceptance criteria.

## Stage Clarifications (Locked 2026-02-08)

- Glue work must preserve both existing legacy integration APIs and new bridge/host APIs; removals are deferred.
- Local mode parity remains anchored to deterministic defaults: `roomId = "local-room"` and `clientId = "local-client"`.
- Snapshot cadence baseline across parity tests remains every 64 ticks unless a test explicitly overrides it.
- Keep this checklist and execution log updated as tasks complete.

## Required Context Before Any Task

- Read `/Users/cje/dev/city/AGENTS.md`.
- Read `/Users/cje/dev/city/MASTER_GAME_ALIGNMENT_PLAN.md`.
- Read `/Users/cje/dev/city/STAGE_1_MOCKED_BRIDGE_PLAN.md`.
- Read `/Users/cje/dev/city/STAGE_2_SIMPLE_UI_PLAN.md`.
- Read `/Users/cje/dev/city/STAGE_3_REAL_BRIDGE_DO_PLAN.md`.

## Agent Rules for This Stage

- Do not redefine bridge or host contracts during glue unless a blocking defect is found.
- Keep UI host-agnostic and switch hosts via composition/config only.
- Preserve strict handshake and ordering invariants in both modes.
- Any bug fix must include a regression test where feasible.
- Keep logs/diagnostics useful but non-authoritative; state comes from host events.

## Global Verification (Run After Every Task)

- `pnpm typecheck`
- `pnpm lint`
- `pnpm format`

## Task Checklist

- [x] **4.1 Implement host factory and mode switching in web app**
  - Goal: Add one explicit host selection path (`LocalHost` vs `DoHost`) without UI branching by business logic.
  - Files to read first:
    - `/Users/cje/dev/city/apps/web/src/main.tsx`
    - `/Users/cje/dev/city/STAGE_2_SIMPLE_UI_PLAN.md`
    - `/Users/cje/dev/city/STAGE_3_REAL_BRIDGE_DO_PLAN.md`
  - C references:
    - `/Users/cje/dev/city/ref/micropolis/src/sim/w_sim.c`
  - Implementation steps:
    1. Add host factory module in `apps/web/src/game/host-factory.ts` (or equivalent).
    2. Support mode selection from env/config flag.
    3. Keep downstream UI runtime bound only to `CoreHost`.
  - Task-specific verification:
    - Add tests verifying identical runtime wiring API for both host modes.
  - Global verification:
    - Run the global verification block.
  - Done criteria:
    - Host selection is centralized and test-covered.

- [x] **4.2 Unify bootstrapping and handshake failure UX**
  - Goal: Ensure both hosts follow the same startup and error-handling behavior for `hello`/version mismatch.
  - Files to read first:
    - `/Users/cje/dev/city/STAGE_0_CONTRACT_FREEZE_PLAN.md`
    - `/Users/cje/dev/city/apps/web/src/routes/index.tsx`
  - C references:
    - `/Users/cje/dev/city/ref/micropolis/spec/integration/SPEC.md`
  - Implementation steps:
    1. Centralize handshake state transitions in the web runtime.
    2. Render clear user-facing mismatch/error states.
    3. Keep protocol-specific text and codes consistent with bridge validators.
  - Task-specific verification:
    - Tests for successful handshake and version mismatch in both modes.
  - Global verification:
    - Run the global verification block.
  - Done criteria:
    - Startup flow is predictable and diagnostic in local and DO modes.

- [x] **4.3 Validate command lifecycle parity across host modes**
  - Goal: Confirm command -> pending visual -> `ack/reject` -> commit/rollback behavior is equivalent across LocalHost and DoHost.
  - Files to read first:
    - `/Users/cje/dev/city/STAGE_2_SIMPLE_UI_PLAN.md`
    - `/Users/cje/dev/city/STAGE_3_REAL_BRIDGE_DO_PLAN.md`
    - `/Users/cje/dev/city/packages/sim-core/src/actions/tool-actions.ts`
  - C references:
    - `/Users/cje/dev/city/ref/micropolis/src/sim/w_tool.c`
    - `/Users/cje/dev/city/ref/micropolis/src/sim/s_zone.c`
  - Implementation steps:
    1. Add parity E2E tests for at least one successful and one rejected placement flow.
    2. Verify no speculative authoritative state is applied on client.
    3. Validate duplicate `commandId` retry behavior.
  - Task-specific verification:
    - Run host-mode matrix tests (LocalHost and DoHost).
    - Capture deterministic command lifecycle logs for both modes.
  - Global verification:
    - Run the global verification block.
  - Done criteria:
    - Command lifecycle behavior is equivalent where it should be.

- [x] **4.4 Validate ordering, reconnect, and resync invariants end-to-end**
  - Goal: Prove `tick + serverSeq` ordering and resync correctness through black-box tests.
  - Files to read first:
    - `/Users/cje/dev/city/STAGE_1_MOCKED_BRIDGE_PLAN.md`
    - `/Users/cje/dev/city/STAGE_3_REAL_BRIDGE_DO_PLAN.md`
    - `/Users/cje/dev/city/apps/web/src/game/runtime` (or equivalent path from Stage 2)
  - C references:
    - `/Users/cje/dev/city/ref/micropolis/spec/integration/SPEC.md`
  - Implementation steps:
    1. Add tests for same-tick multi-event ordering by `serverSeq`.
    2. Add stale event drop and gap-triggered `resync` tests.
    3. Add reconnect tests that recover via snapshot + patch tail.
  - Task-specific verification:
    - E2E matrix pass for ordering/reconnect/resync scenarios.
  - Global verification:
    - Run the global verification block.
  - Done criteria:
    - Recovery and ordering behavior are robust under failure conditions.

- [x] **4.5 Validate save/load/scenario behavior in integrated runtime**
  - Goal: Confirm persistence and scenario boot continue to work after host switchability glue.
  - Files to read first:
    - `/Users/cje/dev/city/packages/sim-io/src/load.ts`
    - `/Users/cje/dev/city/packages/sim-io/src/save.ts`
    - `/Users/cje/dev/city/STAGE_2_SIMPLE_UI_PLAN.md`
  - C references:
    - `/Users/cje/dev/city/ref/micropolis/src/sim/s_fileio.c`
    - `/Users/cje/dev/city/ref/micropolis/src/sim/s_init.c`
  - Implementation steps:
    1. Re-run and extend Stage 2 save/load/scenario smoke tests under integrated runtime.
    2. Verify data round-trip consistency after host mode changes.
    3. Document any host-mode-specific persistence limitations.
  - Task-specific verification:
    - Save/load/scenario test suite passes in LocalHost mode and, where relevant, DoHost mode.
  - Global verification:
    - Run the global verification block.
  - Done criteria:
    - Persistence features remain stable after convergence.

- [x] **4.6 Performance and stability pass**
  - Goal: Ensure desktop-browser responsiveness and stability for practical play sessions.
  - Files to read first:
    - `/Users/cje/dev/city/apps/web/WORKING_GAME_PLAN.md`
    - `/Users/cje/dev/city/packages/sim-core/src/core/map-flags.ts`
    - `/Users/cje/dev/city/packages/sim-core/src/core/map-store.ts`
  - C references:
    - `/Users/cje/dev/city/ref/micropolis/src/sim/g_map.c`
    - `/Users/cje/dev/city/ref/micropolis/src/sim/w_map.c`
  - Implementation steps:
    1. Measure frame/update costs with representative city state.
    2. Optimize redraw policy (dirty regions/invalidation) where needed.
    3. Add stability soak checks for longer sessions.
  - Task-specific verification:
    - Capture pre/post metrics and soak test outcomes in docs.
  - Global verification:
    - Run the global verification block.
  - Done criteria:
    - Play sessions are stable and responsive on baseline desktop hardware.

- [x] **4.7 Playable sign-off and release checklist**
  - Goal: Provide final acceptance report and explicit go/no-go criteria.
  - Files to read first:
    - `/Users/cje/dev/city/MASTER_GAME_ALIGNMENT_PLAN.md`
    - `/Users/cje/dev/city/PROGRESS.md`
  - C references:
    - `/Users/cje/dev/city/ref/micropolis/spec/integration/SPEC.md`
  - Implementation steps:
    1. Create release checklist covering protocol, host parity, gameplay, persistence, and test status.
    2. Record known issues with severity and owner.
    3. Mark all completed tasks and update execution log.
  - Task-specific verification:
    - Ensure each exit criterion has linked evidence (test, log, or manual validation note).
  - Global verification:
    - Run the global verification block.
  - Done criteria:
    - Team has a concrete sign-off artifact for playable milestone.

## Stage Exit Criteria

- Host switching works without UI architecture changes.
- Core playable flows pass in LocalHost and validated DoHost paths.
- Protocol handshake, ordering, idempotency, and resync invariants are e2e validated.
- Save/load/scenario behavior remains stable in integrated product.

## Execution Log

- [ ] Add dated entries as tasks complete.
- 2026-02-08: Completed task 4.1 by adding a centralized `apps/web` host factory with env/config mode selection (`local` vs `do`), introducing host-agnostic runtime wiring bound only to `CoreHost`, wiring `apps/web/src/main.tsx` through the new factory/runtime path, and adding focused tests that verify equivalent lifecycle wiring behavior across both host modes.
- 2026-02-08: Completed task 4.2 by centralizing web runtime bootstrap state transitions around a shared `hello` handshake validator, unifying LocalHost/DoHost startup event flow (`connected` -> `hello`) with deterministic mismatch diagnostics, rendering explicit user-facing handshake/runtime status in `apps/web/src/routes/index.tsx`, and adding focused runtime tests that cover successful handshake plus version-mismatch failure paths in both host modes.
- 2026-02-08: Completed task 4.3 by extending `apps/web` `CoreHost`/runtime command lifecycle glue with deterministic client pending-visual tracking (`pending` before host response), host-emitted `ack`/`reject`/authoritative `patch` events shared by both `LocalHost` and `DoHost`, duplicate `commandId` idempotent retry handling (`ack` without re-apply), and host-mode matrix tests that capture identical deterministic lifecycle logs for successful and rejected placement flows while verifying no speculative authoritative client commit before `patch`.
- 2026-02-08: Completed task 4.4 by extending `apps/web` host/runtime glue with strict `tick + serverSeq` sequencing guards, stale-event drop handling, gap-triggered snapshot resync requests, and snapshot baseline application semantics; adding host-side snapshot replay support for local/do shims; and adding a host-mode matrix runtime black-box suite that validates same-tick ordering by `serverSeq`, stale-drop + gap-resync recovery, and reconnect recovery through snapshot + patch tail replay.
- 2026-02-08: Completed task 4.5 by adding integrated runtime save/load/scenario smoke coverage in `apps/web/src/game/runtime.persistence.test.ts`, re-running Stage 2 persistence flows under a `LocalHost`/`DoHost` runtime matrix, validating deterministic load->save stabilization semantics from `s_fileio.c` plus scenario boot constants from `LoadScenario`, and documenting the current host-specific limitation that Stage 4 host shims still use shared in-memory deterministic authority (no host-side durable persistence yet), so persistence validation currently runs through shared `sim-io` orchestration while runtime host mode is connected.
- 2026-02-08: Completed task 4.6 by running a focused map-update performance/stability pass: optimized `packages/sim-core` `DoubleBufferMapStore` with lazy per-layer tick preparation plus guarded write bounds, added `NewMap`/`NewMapFlags`-aware redraw planning with patch-driven dirty-rectangle invalidation aligned to `w_map.c`/`g_map.c` map mode semantics, added long-run 4096-tick soak coverage for deterministic patch replay stability, and recorded pre/post benchmark metrics plus soak outcomes in `STAGE_4_PERFORMANCE_AND_STABILITY_NOTES.md`.
- 2026-02-08: Completed task 4.7 by producing `STAGE_4_PLAYABLE_SIGNOFF_CHECKLIST.md` as the final Stage 4 acceptance artifact with explicit go/no-go criteria, an evidence-linked checklist for protocol/host parity/gameplay/persistence/test status, and a known-issues register with severity and ownership; also marked task 4.7 complete in this plan.
