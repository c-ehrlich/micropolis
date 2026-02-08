# Stage 2 Plan: Simple Playable UI on LocalHost

## Stage Goal

Ship a playable browser game in `apps/web` using `CoreHost` + `LocalHost`, with no simulation logic in UI packages and full support for core tools, HUD, and save/load/scenarios.

## Stage Clarifications (Locked 2026-02-08)

- Runtime continues to consume existing integration surfaces while new bridge-host surfaces are introduced; no legacy API removals in this stage.
- In LocalHost mode, handshake/command flows assume deterministic local defaults: `roomId = "local-room"` and `clientId = "local-client"`.
- Snapshot cadence baseline for reconnect tests is every 64 ticks unless overridden by configuration.
- Keep this checklist and execution log updated as tasks complete.

## Required Context Before Any Task

- Read `/Users/cje/dev/city/AGENTS.md`.
- Read `/Users/cje/dev/city/MASTER_GAME_ALIGNMENT_PLAN.md`.
- Read `/Users/cje/dev/city/STAGE_1_MOCKED_BRIDGE_PLAN.md`.
- Read `/Users/cje/dev/city/apps/web/WORKING_GAME_PLAN.md`.
- Read `/Users/cje/dev/city/packages/sim-core/src/index.ts`.
- Read `/Users/cje/dev/city/packages/sim-io/src/index.ts`.

## Agent Rules for This Stage

- UI must consume `CoreHost`; no direct simulation orchestration in UI.
- Client optimism is visual-only pending state keyed by `commandId`.
- All authoritative state comes from host envelopes (`patch`/`snapshot`/`resync`).
- Save/load/scenario flows are included in this stage, not deferred.
- Add JSDoc for new exports and source-map behavior to Micropolis files.
- In tests, annotate magic values with source references.

## Global Verification (Run After Every Task)

- `pnpm typecheck`
- `pnpm lint`
- `pnpm format`

## Task Checklist

- [x] **2.1 Build web host-client runtime module**
  - Goal: Add a client runtime in `apps/web` that connects to `CoreHost`, handles handshake, and centralizes envelope processing.
  - Files to read first:
    - `/Users/cje/dev/city/apps/web/src/main.tsx`
    - `/Users/cje/dev/city/apps/web/src/routes/index.tsx`
    - `/Users/cje/dev/city/STAGE_1_MOCKED_BRIDGE_PLAN.md`
  - C references:
    - `/Users/cje/dev/city/ref/micropolis/src/sim/w_update.c`
    - `/Users/cje/dev/city/ref/micropolis/src/sim/w_sim.c`
  - Implementation steps:
    1. Add `apps/web/src/game/runtime/*` for host lifecycle and event reducer.
    2. Implement mandatory `hello` negotiation path.
    3. Track last applied `serverSeq` and `tick` in runtime state.
  - Task-specific verification:
    - Add unit tests for envelope routing and stale/gap handling behavior.
    - `pnpm --filter @city/web test`
  - Global verification:
    - Run the global verification block.
  - Done criteria:
    - UI runtime can connect to `LocalHost` and process events deterministically.

- [ ] **2.2 Implement map rendering with ordered patch application**
  - Goal: Render map state from host data and apply incremental updates in `serverSeq` order.
  - Files to read first:
    - `/Users/cje/dev/city/packages/sim-core/src/core/map-store.ts`
    - `/Users/cje/dev/city/packages/sim-core/src/core/map-flags.ts`
    - `/Users/cje/dev/city/apps/web/src/routes/index.tsx`
  - C references:
    - `/Users/cje/dev/city/ref/micropolis/src/sim/w_map.c`
    - `/Users/cje/dev/city/ref/micropolis/src/sim/g_map.c`
  - Implementation steps:
    1. Add canvas rendering module and initial color-map tile view.
    2. Apply snapshot baseline then ordered patch stream.
    3. Reject stale events and trigger resync on detected sequence gaps.
  - Task-specific verification:
    - Add renderer tests for snapshot+patch progression and stale drop behavior.
    - Add manual smoke steps in doc for visual correctness checks.
  - Global verification:
    - Run the global verification block.
  - Done criteria:
    - Map updates reflect host output without full redraw dependence.

- [ ] **2.3 Implement tool command UI and pending-visual lifecycle**
  - Goal: Support core tools and pending state flow from command send through `ack/reject`.
  - Files to read first:
    - `/Users/cje/dev/city/packages/sim-core/src/actions/tool-actions.ts`
    - `/Users/cje/dev/city/packages/sim-core/src/actions/tool-actions.c-oracle.test.ts`
    - `/Users/cje/dev/city/ref/micropolis/src/sim/w_tool.c`
  - C references:
    - `/Users/cje/dev/city/ref/micropolis/src/sim/w_tool.c`
    - `/Users/cje/dev/city/ref/micropolis/src/sim/s_zone.c`
  - Implementation steps:
    1. Add toolbar for road/rail/wire/bulldoze/R/C/I.
    2. Emit high-level `command` envelopes with `commandId`.
    3. Add pending overlay state and rollback on `reject`.
  - Task-specific verification:
    - Tests for pending create/settle/rollback transitions.
    - Tests for duplicate `commandId` correlation behavior.
  - Global verification:
    - Run the global verification block.
  - Done criteria:
    - Tool interactions are playable and command-correlated.

- [ ] **2.4 Implement HUD and simulation controls**
  - Goal: Show funds/date/demand/messages and allow pause/play/speed interactions through host commands.
  - Files to read first:
    - `/Users/cje/dev/city/packages/sim-core/src/systems/messages.ts`
    - `/Users/cje/dev/city/packages/sim-core/src/systems/date-time.ts`
    - `/Users/cje/dev/city/packages/sim-core/src/systems/valves.ts`
  - C references:
    - `/Users/cje/dev/city/ref/micropolis/src/sim/w_update.c`
    - `/Users/cje/dev/city/ref/micropolis/src/sim/w_date.c`
    - `/Users/cje/dev/city/ref/micropolis/src/sim/s_msg.c`
  - Implementation steps:
    1. Build HUD panels bound to host-projected scalar state.
    2. Add play/pause/speed control panel.
    3. Route message events into visible feed/log.
  - Task-specific verification:
    - Add UI tests for HUD updates after simulated host events.
    - Verify no direct sim-core mutation calls from UI components.
  - Global verification:
    - Run the global verification block.
  - Done criteria:
    - User can control sim and observe key city telemetry.

- [ ] **2.5 Add save/load/scenario flows in browser**
  - Goal: Support new city, save/export, load/import, and scenario entry from MVP.
  - Files to read first:
    - `/Users/cje/dev/city/packages/sim-io/src/load.ts`
    - `/Users/cje/dev/city/packages/sim-io/src/save.ts`
    - `/Users/cje/dev/city/packages/sim-io/src/scenarios.ts`
  - C references:
    - `/Users/cje/dev/city/ref/micropolis/src/sim/s_fileio.c`
    - `/Users/cje/dev/city/ref/micropolis/src/sim/s_init.c`
  - Implementation steps:
    1. Add UI controls for city reset/new and scenario selection.
    2. Add file import/export handlers for city data.
    3. Ensure host snapshot/bootstrap can seed UI after load.
  - Task-specific verification:
    - Add round-trip tests for save/load in web runtime.
    - Add scenario boot smoke tests.
  - Global verification:
    - Run the global verification block.
  - Done criteria:
    - Save/load/scenario flows work without bypassing host boundaries.

- [ ] **2.6 Add reconnect and resync UX handling**
  - Goal: Handle disconnect/reconnect and server-initiated resync without corrupting local UI state.
  - Files to read first:
    - `/Users/cje/dev/city/STAGE_1_MOCKED_BRIDGE_PLAN.md`
    - `/Users/cje/dev/city/MASTER_GAME_ALIGNMENT_PLAN.md`
  - C references:
    - `/Users/cje/dev/city/ref/micropolis/spec/integration/SPEC.md`
  - Implementation steps:
    1. Add reconnect state machine in web runtime.
    2. On reconnect, request snapshot then apply patch tail.
    3. Clear/resolve pending visuals safely during resync.
  - Task-specific verification:
    - Add tests for reconnect path and server-triggered resync path.
    - Confirm post-resync ordering invariants are preserved.
  - Global verification:
    - Run the global verification block.
  - Done criteria:
    - UI recovers from dropped/out-of-order streams predictably.

- [ ] **2.7 Add end-to-end playable smoke tests for LocalHost mode**
  - Goal: Capture user-level playable flow in automated tests.
  - Files to read first:
    - `/Users/cje/dev/city/apps/web/src/__tests__/basic.test.ts`
    - `/Users/cje/dev/city/packages/sim-core/src/__test__/golden-replay.test.ts`
  - C references:
    - `/Users/cje/dev/city/ref/micropolis/src/sim/sim.c`
    - `/Users/cje/dev/city/ref/micropolis/src/sim/w_tool.c`
  - Implementation steps:
    1. Add tests for: start city, place tool, tick sim, inspect HUD, save/load.
    2. Use deterministic seeded paths where possible.
    3. Document any fixture-specific values with source references.
  - Task-specific verification:
    - `pnpm --filter @city/web test`
    - Confirm flaky behavior does not exist across repeated runs.
  - Global verification:
    - Run the global verification block.
  - Done criteria:
    - Local playable definition is automated and repeatable.

- [ ] **2.8 Publish Stage 2 operation notes**
  - Goal: Document how to run/play/test LocalHost mode for downstream teams.
  - Files to read first:
    - `/Users/cje/dev/city/apps/web/WORKING_GAME_PLAN.md`
    - `/Users/cje/dev/city/STAGE_4_GLUE_AND_PLAYABLE_PLAN.md` (after created)
  - C references:
    - `/Users/cje/dev/city/ref/micropolis/src/sim/w_editor.c`
  - Implementation steps:
    1. Add short runbook for developer flow and common troubleshooting.
    2. Record known limitations before DO path lands.
    3. Mark checklist and execution log updates.
  - Task-specific verification:
    - Confirm all documented commands are current and executable.
  - Global verification:
    - Run the global verification block.
  - Done criteria:
    - Teams can run and validate LocalHost playable mode without tribal knowledge.

## Stage Exit Criteria

- `apps/web` is playable on `LocalHost` with core tools and HUD.
- Pending visuals and reject rollback semantics are functional.
- Save/load/scenario flows are included and tested.
- Reconnect/resync behavior is implemented for local harness conditions.

## Execution Log

- [ ] Add dated entries as tasks complete.
- 2026-02-08: Completed 2.1 by adding `apps/web` host-client runtime lifecycle + envelope reducer with mandatory `hello` negotiation, `serverSeq`/`tick` tracking, and web runtime stale/gap routing tests.
