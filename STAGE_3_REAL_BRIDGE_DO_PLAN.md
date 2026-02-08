# Stage 3 Plan: Real Bridge Runtime and Durable Object Host

## Stage Goal

Replace mock/skeleton behavior with a real authoritative bridge-backed runtime and a DO host adapter that preserves the same `CoreHost` and envelope contracts.

## Stage Clarifications (Locked 2026-02-08)

- Keep existing `@city/sim-integration` APIs intact in this stage; bridge/runtime/DO APIs are additive.
- DO adapter package target is `packages/sim-do-adapter`.
- Snapshot cadence default is every 64 ticks unless explicitly configured.
- Keep this checklist and execution log updated as tasks complete.

## Required Context Before Any Task

- Read `/Users/cje/dev/city/AGENTS.md`.
- Read `/Users/cje/dev/city/MASTER_GAME_ALIGNMENT_PLAN.md`.
- Read `/Users/cje/dev/city/STAGE_0_CONTRACT_FREEZE_PLAN.md`.
- Read `/Users/cje/dev/city/STAGE_1_MOCKED_BRIDGE_PLAN.md`.
- Read `/Users/cje/dev/city/packages/sim-integration/PLAN.md`.
- Read `/Users/cje/dev/city/packages/sim-integration/src/runtime.ts`.

## Agent Rules for This Stage

- `@city/core-bridge` remains protocol source-of-truth.
- `@city/sim-integration` consumes bridge contracts; it does not define competing envelope shapes.
- Durable Object transport details stay inside adapter packages.
- Reuse host conformance suite from Stage 1 for DoHost.
- Keep legacy Sugar/TTY/UDP support isolated and optional.
- Add JSDoc on new exports with C file references and parity notes.
- Do not delete/rename existing integration APIs in this stage; deprecate later after host switchability sign-off.

## Global Verification (Run After Every Task)

- `pnpm typecheck`
- `pnpm lint`
- `pnpm format`

## Task Checklist

- [x] **3.1 Align `sim-integration` runtime contracts to `@city/core-bridge`**
  - Goal: Remove protocol duplication and import canonical envelope/command/handshake types from bridge package.
  - Files to read first:
    - `/Users/cje/dev/city/packages/sim-integration/src/types.ts`
    - `/Users/cje/dev/city/packages/sim-integration/src/runtime.ts`
    - `/Users/cje/dev/city/packages/sim-integration/MULTIPLAYER-PLAN.md`
  - C references:
    - `/Users/cje/dev/city/ref/micropolis/src/sim/w_sim.c`
    - `/Users/cje/dev/city/ref/micropolis/src/sim/w_net.c`
  - Implementation steps:
    1. Replace local protocol typedefs with bridge imports.
    2. Keep orchestration/runtime concerns in `sim-integration`.
    3. Add compile-time assertions preventing protocol drift.
  - Task-specific verification:
    - `pnpm --filter @city/sim-integration typecheck`
    - `pnpm --filter @city/sim-integration test`
  - Global verification:
    - Run the global verification block.
  - Done criteria:
    - One protocol definition source exists in practice and in tests.

- [x] **3.2 Implement authoritative room runtime with idempotency**
  - Goal: Process commands deterministically per room, enforce `commandId` dedupe, and emit ordered events.
  - Files to read first:
    - `/Users/cje/dev/city/packages/sim-integration/src/runtime.integration.test.ts`
    - `/Users/cje/dev/city/packages/sim-core/src/sim/simulate.ts`
    - `/Users/cje/dev/city/packages/sim-core/src/actions/tool-actions.ts`
  - C references:
    - `/Users/cje/dev/city/ref/micropolis/src/sim/s_sim.c`
    - `/Users/cje/dev/city/ref/micropolis/src/sim/sim.c`
  - Implementation steps:
    1. Add room registry and per-room runtime context.
    2. Add idempotency store keyed by `commandId` per room.
    3. Emit `ack/reject/error` plus downstream `patch/snapshot` envelopes with `tick` + `serverSeq`.
  - Task-specific verification:
    - Add tests for command acceptance, reject path, duplicate dedupe, and deterministic ordering.
  - Global verification:
    - Run the global verification block.
  - Done criteria:
    - Runtime behavior is deterministic and authority-safe.

- [x] **3.3 Add snapshot + patch-tail persistence interfaces and implementation hooks**
  - Goal: Support reconnect/recovery with persistent snapshots and patch tails.
  - Files to read first:
    - `/Users/cje/dev/city/packages/sim-io/src/save.ts`
    - `/Users/cje/dev/city/packages/sim-io/src/load.ts`
    - `/Users/cje/dev/city/packages/sim-integration/src/runtime.ts`
  - C references:
    - `/Users/cje/dev/city/ref/micropolis/src/sim/s_fileio.c`
    - `/Users/cje/dev/city/ref/micropolis/src/sim/s_init.c`
  - Implementation steps:
    1. Define persistence adapter contract for snapshot and tail.
    2. Add snapshot cadence strategy (default every 64 ticks unless configured).
    3. Add replay-by-`serverSeq` bootstrap path.
  - Task-specific verification:
    - Tests for bootstrap from snapshot plus tail replay.
    - Tests for tail truncation and sequence continuity.
  - Global verification:
    - Run the global verification block.
  - Done criteria:
    - Reconnect path can recover without full replay from genesis.

- [x] **3.4 Implement DO adapter package scaffold and room authority mapping**
  - Goal: Create `packages/sim-do-adapter` for DO plumbing and map one room/city to one DO instance.
  - Files to read first:
    - `/Users/cje/dev/city/packages/sim-integration/src/index.ts`
    - `/Users/cje/dev/city/MASTER_GAME_ALIGNMENT_PLAN.md`
  - C references:
    - `/Users/cje/dev/city/ref/micropolis/src/sim/w_net.c`
  - Implementation steps:
    1. Add package scaffold at `packages/sim-do-adapter`.
    2. Implement runtime wiring entrypoints for websocket open/message/close.
    3. Add alarm/timer bridge to authoritative tick function.
  - Task-specific verification:
    - Package-level typecheck/lint/test scripts run successfully.
    - Adapter unit tests verify method routing to runtime APIs.
  - Global verification:
    - Run the global verification block.
  - Done criteria:
    - DO adapter can host a room runtime in tests.

- [x] **3.5 Implement websocket protocol handling with strict handshake**
  - Goal: Enforce `hello` lockstep and map wire messages to canonical envelope types.
  - Files to read first:
    - `/Users/cje/dev/city/STAGE_0_CONTRACT_FREEZE_PLAN.md`
    - `/Users/cje/dev/city/packages/sim-integration/src/runtime.ts`
  - C references:
    - `/Users/cje/dev/city/ref/micropolis/spec/integration/SPEC.md`
    - `/Users/cje/dev/city/ref/micropolis/src/sim/w_net.c`
  - Implementation steps:
    1. Add decode/encode utilities for envelope payloads.
    2. Reject non-handshaken clients from mutating commands.
    3. Distinguish `reject` vs `error` behavior path in websocket responses.
  - Task-specific verification:
    - Tests for valid handshake, mismatch rejection, and pre-hello command denial.
  - Global verification:
    - Run the global verification block.
  - Done criteria:
    - Protocol lockstep is enforced consistently across connections.

- [ ] **3.6 Implement DoHost and run host conformance suite**
  - Goal: Provide `DoHost` implementation compatible with `CoreHost` and pass Stage 1 shared conformance tests.
  - Files to read first:
    - `/Users/cje/dev/city/STAGE_1_MOCKED_BRIDGE_PLAN.md`
    - `/Users/cje/dev/city/packages/sim-integration/src/runtime.integration.test.ts`
  - C references:
    - `/Users/cje/dev/city/ref/micropolis/src/sim/s_sim.c`
    - `/Users/cje/dev/city/ref/micropolis/src/sim/w_sim.c`
  - Implementation steps:
    1. Build `DoHost` wrapper adapting DO transport to `CoreHost`.
    2. Run shared host conformance suite against `DoHost`.
    3. Resolve parity differences between `LocalHost` and `DoHost`.
  - Task-specific verification:
    - Conformance suite passes for `LocalHost` and `DoHost`.
    - Add multi-client ordering/idempotency tests.
  - Global verification:
    - Run the global verification block.
  - Done criteria:
    - UI can switch hosts without behavioral contract drift.

- [ ] **3.7 Add reconnect/resync hardening and presence flow**
  - Goal: Complete reconnect semantics and optional presence updates in DO mode.
  - Files to read first:
    - `/Users/cje/dev/city/STAGE_2_SIMPLE_UI_PLAN.md`
    - `/Users/cje/dev/city/STAGE_4_GLUE_AND_PLAYABLE_PLAN.md` (after created)
  - C references:
    - `/Users/cje/dev/city/ref/micropolis/spec/integration/SPEC.md`
  - Implementation steps:
    1. Add deterministic server-initiated `resync` triggers for gap/incompatibility scenarios.
    2. Add `presence` event handling for join/leave updates.
    3. Verify patch replay order and stale/drop semantics under reconnect.
  - Task-specific verification:
    - Integration tests for reconnect under dropped packet simulation.
    - Presence tests for multi-client join/leave churn.
  - Global verification:
    - Run the global verification block.
  - Done criteria:
    - DO runtime remains consistent across client churn and retries.

- [ ] **3.8 Publish Stage 3 migration notes and legacy adapter status**
  - Goal: Document bridge ownership finalization and legacy adapter boundaries.
  - Files to read first:
    - `/Users/cje/dev/city/packages/sim-integration/INTEGRATION-CONTRACT.md`
    - `/Users/cje/dev/city/packages/sim-integration/PLAN.md`
  - C references:
    - `/Users/cje/dev/city/ref/micropolis/micropolisactivity.py`
    - `/Users/cje/dev/city/ref/micropolis/src/sim/w_tk.c`
  - Implementation steps:
    1. Update docs to clarify optional legacy adapter status.
    2. Record migration decisions and known gaps.
    3. Update this checklist and execution log.
  - Task-specific verification:
    - Verify docs align with exported API and existing packages.
  - Global verification:
    - Run the global verification block.
  - Done criteria:
    - Stage 4 teams have unambiguous integration guidance.

## Stage Exit Criteria

- `sim-integration` consumes canonical bridge contracts.
- DO adapter and `DoHost` exist, pass conformance tests, and support authoritative rooms.
- Reconnect/resync/idempotency/ordering invariants are enforced under multi-client scenarios.

## Execution Log

- [x] Add dated entries as tasks complete.
- [x] 2026-02-08: Completed task 3.1 by introducing canonical bridge-owned envelope/command/handshake types in `@city/core-bridge`, updating `@city/sim-integration` multiplayer runtime contracts to import those types, and adding compile-time drift assertions/tests to enforce single-source protocol ownership.
- [x] 2026-02-08: Completed task 3.2 by adding an authoritative per-room multiplayer runtime in `@city/sim-integration` with room registry contexts, deterministic per-room command queue ordering, per-room `commandId` idempotency dedupe, and ordered `ack`/`reject`/`error` plus downstream `patch`/`snapshot` envelope emissions carrying monotonic `tick` and `serverSeq`, with focused tests for acceptance, rejection, dedupe, and deterministic ordering.
- [x] 2026-02-08: Completed task 3.3 by adding snapshot + patch-tail persistence contracts in `@city/sim-integration` multiplayer types, wiring authoritative runtime hooks for persistence-backed room bootstrap (`snapshot` + replay tail by `serverSeq`), adding configurable snapshot cadence with a Stage-locked default of 64 ticks plus tail truncation hooks, and adding focused tests for persisted bootstrap replay and post-truncation sequence continuity.
- [x] 2026-02-08: Completed task 3.4 by scaffolding `@city/sim-do-adapter` with package-level `typecheck`/`lint`/`test` scripts, implementing a room-scoped `RoomDoAdapter` that maps one room to one deterministic DO authority key, wiring websocket open/message/close entrypoints to `@city/sim-integration` runtime APIs (`connectClient`/`receiveCommand`/`disconnectClient`), bridging DO alarms to authoritative `tick(nowMs)`, and adding focused adapter unit tests for routing and room-authority fanout behavior.
- [x] 2026-02-08: Completed task 3.5 by hardening `@city/sim-do-adapter` websocket protocol handling with strict `hello` lockstep enforcement (bridge-v1 protocol/core payload match), adding validated JSON/binary envelope decode utilities that map wire payloads to canonical `@city/core-bridge` envelope types, denying pre-hello mutating `command` envelopes via bridge `reject` responses, routing protocol/authority/handshake mismatches through bridge `error` responses, and adding focused adapter tests for valid handshake, mismatch refusal, and pre-hello command denial.
