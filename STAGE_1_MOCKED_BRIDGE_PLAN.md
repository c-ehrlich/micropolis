# Stage 1 Plan: Mocked and Skeleton Bridge

## Stage Goal

Create a deterministic mocked bridge and a `LocalHost` skeleton that fully exercise the canonical `@city/core-bridge` contract, enabling UI and runtime teams to work in parallel.

## Stage Clarifications (Locked 2026-02-08)

- Preserve existing `@city/sim-integration` APIs; Stage 1 host/bridge work is additive.
- `LocalHost` uses deterministic local defaults: `roomId = "local-room"` and `clientId = "local-client"`.
- Snapshot cadence default for hosted snapshot emission/rebuild tests is every 64 ticks unless explicitly configured.
- Keep this checklist and execution log updated as tasks complete.

## Required Context Before Any Task

- Read `/Users/cje/dev/city/AGENTS.md`.
- Read `/Users/cje/dev/city/MASTER_GAME_ALIGNMENT_PLAN.md`.
- Read `/Users/cje/dev/city/STAGE_0_CONTRACT_FREEZE_PLAN.md`.
- Read `/Users/cje/dev/city/packages/sim-integration/src/runtime.ts`.
- Read `/Users/cje/dev/city/apps/web/WORKING_GAME_PLAN.md`.

## Agent Rules for This Stage

- Depend on `@city/core-bridge` types/schemas; do not redefine protocol structures.
- Implement `CoreHost` API first, then `LocalHost` and test mock host(s) against it.
- Mock host behavior must be deterministic and replayable.
- Pending visuals are allowed, but no speculative authoritative state mutation in client logic.
- Add JSDoc for all new exports with Micropolis references and 1:1 vs intentional-diff notes.
- Do not remove legacy `@city/sim-integration` surfaces while adding host/bridge APIs.

## Global Verification (Run After Every Task)

- `pnpm typecheck`
- `pnpm lint`
- `pnpm format`

## Task Checklist

- [x] **1.1 Define `CoreHost` interface in a bridge-owned location**
  - Goal: Create stable host API consumed by UI independent of transport.
  - Files to read first:
    - `/Users/cje/dev/city/MASTER_GAME_ALIGNMENT_PLAN.md`
    - `/Users/cje/dev/city/STAGE_0_CONTRACT_FREEZE_PLAN.md`
    - `/Users/cje/dev/city/packages/sim-integration/src/runtime.ts`
  - C references:
    - `/Users/cje/dev/city/ref/micropolis/src/sim/w_sim.c`
    - `/Users/cje/dev/city/ref/micropolis/src/sim/w_net.c`
  - Implementation steps:
    1. Add `CoreHost` interface and host event stream contract (or callback registration API).
    2. Include required lifecycle methods (`hello`, command send, snapshot request, connect/disconnect semantics).
    3. Export from `@city/core-bridge`.
  - Task-specific verification:
    - Add compile-time tests ensuring `CoreHost` uses canonical envelope types.
    - `pnpm --filter @city/core-bridge typecheck`
  - Global verification:
    - Run the global verification block.
  - Done criteria:
    - UI can type against `CoreHost` without importing runtime internals.

- [x] **1.2 Implement deterministic mock authority engine**
  - Goal: Add an in-memory authority simulator that emits `ack/reject/patch/snapshot/resync/error` deterministically.
  - Files to read first:
    - `/Users/cje/dev/city/packages/sim-core/src/actions/tool-actions.ts`
    - `/Users/cje/dev/city/packages/sim-core/src/sim/simulate.ts`
    - `/Users/cje/dev/city/ref/micropolis/spec/integration/SPEC.md`
  - C references:
    - `/Users/cje/dev/city/ref/micropolis/src/sim/w_tool.c`
    - `/Users/cje/dev/city/ref/micropolis/src/sim/s_sim.c`
  - Implementation steps:
    1. Create mock runtime module in bridge or dedicated adapter package.
    2. Add deterministic event generator for command success/reject cases.
    3. Ensure every outbound event gets `tick` + `serverSeq`.
  - Task-specific verification:
    - Add unit tests covering deterministic output for fixed inputs.
    - Include duplicate `commandId` idempotency test.
  - Global verification:
    - Run the global verification block.
  - Done criteria:
    - Mock engine can drive UI workflows without real sim runtime.

- [x] **1.3 Implement `LocalHost` skeleton on top of mock engine**
  - Goal: Provide a concrete local host implementation that satisfies `CoreHost`.
  - Files to read first:
    - `/Users/cje/dev/city/packages/sim-integration/src/runtime.integration.test.ts`
    - `/Users/cje/dev/city/packages/sim-integration/src/index.ts`
  - C references:
    - `/Users/cje/dev/city/ref/micropolis/src/sim/sim.c`
    - `/Users/cje/dev/city/ref/micropolis/src/sim/s_scan.c`
  - Implementation steps:
    1. Implement `LocalHost` class/function with lifecycle setup, command intake, and event dispatch.
    2. Wire strict `hello` handshake and version lockstep.
    3. Use deterministic local identity defaults (`local-room` / `local-client`) unless explicit overrides are provided.
    4. Include basic tick scheduling hooks for local mode.
  - Task-specific verification:
    - Add `LocalHost` conformance tests against `CoreHost`.
    - Verify `hello` mismatch produces deterministic refusal path.
  - Global verification:
    - Run the global verification block.
  - Done criteria:
    - `LocalHost` can be instantiated and exercised without UI.

- [x] **1.4 Add resync and snapshot replay mechanics to mock/local host**
  - Goal: Model reconnect behavior (`request_snapshot` and server `resync`) before DO work starts.
  - Files to read first:
    - `/Users/cje/dev/city/MASTER_GAME_ALIGNMENT_PLAN.md`
    - `/Users/cje/dev/city/packages/sim-integration/MULTIPLAYER-PLAN.md`
  - C references:
    - `/Users/cje/dev/city/ref/micropolis/spec/integration/SPEC.md`
  - Implementation steps:
    1. Add snapshot baseline generation.
    2. Add patch tail tracking by `serverSeq`.
    3. Implement gap detection -> `resync` behavior.
  - Task-specific verification:
    - Add reconnect tests: snapshot bootstrap, patch tail replay, forced gap/resync.
    - Assert order is by `serverSeq` for same `tick`.
  - Global verification:
    - Run the global verification block.
  - Done criteria:
    - Client simulation harness can recover from dropped events deterministically.

- [x] **1.5 Add command rejection and pending-visual support hooks**
  - Goal: Make host outcomes explicit for UI pending visuals and rollback UX.
  - Files to read first:
    - `/Users/cje/dev/city/apps/web/WORKING_GAME_PLAN.md`
    - `/Users/cje/dev/city/UI_BRIDGE_PLAN.md`
    - `/Users/cje/dev/city/packages/sim-core/src/actions/tool-actions.ts`
  - C references:
    - `/Users/cje/dev/city/ref/micropolis/src/sim/w_tool.c`
    - `/Users/cje/dev/city/ref/micropolis/src/sim/s_msg.c`
  - Implementation steps:
    1. Define canonical reject reasons/codes and payload shape.
    2. Distinguish `reject` vs `error` in host emissions.
    3. Add helper for UI to correlate acks/rejects with `commandId`.
  - Task-specific verification:
    - Tests for successful command lifecycle and reject lifecycle with rollback signal.
    - Tests for duplicate command ack-without-reapply.
  - Global verification:
    - Run the global verification block.
  - Done criteria:
    - UI can implement pending visuals without guessing host semantics.

- [x] **1.6 Create host conformance test suite reusable by LocalHost and DoHost**
  - Goal: Define a shared behavior test suite any host implementation must pass.
  - Files to read first:
    - `/Users/cje/dev/city/packages/sim-integration/src/runtime.integration.test.ts`
    - `/Users/cje/dev/city/STAGE_3_REAL_BRIDGE_DO_PLAN.md` (after created)
  - C references:
    - `/Users/cje/dev/city/ref/micropolis/src/sim/s_sim.c`
    - `/Users/cje/dev/city/ref/micropolis/src/sim/w_net.c`
  - Implementation steps:
    1. Create host test harness package/module with adapter hooks.
    2. Add required behavior tests: handshake, ordering, idempotency, snapshot/resync.
    3. Run harness against mock host and `LocalHost`.
  - Task-specific verification:
    - Ensure conformance suite passes for both implementations.
  - Global verification:
    - Run the global verification block.
  - Done criteria:
    - Stage 3 can plug DoHost into the same suite.

- [x] **1.7 Document Stage 1 API usage for UI and runtime tracks**
  - Goal: Publish integration notes so parallel tracks can consume host/bridge surfaces consistently.
  - Files to read first:
    - `/Users/cje/dev/city/STAGE_2_SIMPLE_UI_PLAN.md` (after created)
    - `/Users/cje/dev/city/STAGE_3_REAL_BRIDGE_DO_PLAN.md` (after created)
  - C references:
    - `/Users/cje/dev/city/ref/micropolis/spec/integration/SPEC.md`
  - Implementation steps:
    1. Document `CoreHost` API and expected event flow.
    2. Provide sample command lifecycle sequence diagrams in text/markdown.
    3. Mark completed checklist items and add execution log entries.
  - Task-specific verification:
    - Verify docs reference existing exported symbols and test names.
  - Global verification:
    - Run the global verification block.
  - Done criteria:
    - Stage 2/3 implementers can begin without API ambiguity.

## Stage Exit Criteria

- `CoreHost` is stable and bridge-owned.
- Deterministic mock host and `LocalHost` skeleton pass conformance tests.
- Reconnect/resync and reject/error semantics are implemented and documented.

## Execution Log

- [ ] Add dated entries as tasks complete.
- 2026-02-08: Completed task 1.1 by adding `@city/core-bridge` with canonical envelope types, a bridge-owned `CoreHost` interface, and compile-time contract coverage.
- 2026-02-08: Completed task 1.2 by adding a deterministic in-memory `MockAuthorityEngine` in `@city/core-bridge` with ordered `ack/reject/patch/snapshot/resync/error` emission, `tick`/`serverSeq` stamping, and duplicate `commandId` idempotency tests.
- 2026-02-08: Completed task 1.3 by implementing a deterministic `LocalHost` on `MockAuthorityEngine` with strict `hello` lockstep/version refusal semantics, default local identity (`local-room`/`local-client`), and local tick scheduling hooks with CoreHost conformance tests.
- 2026-02-08: Completed task 1.4 by adding deterministic snapshot baseline cadence, `serverSeq`-indexed patch-tail replay for `request_snapshot`, and forced gap/ahead `resync` handling in both `MockAuthorityEngine` and `LocalHost` with reconnect-focused tests.
- 2026-02-08: Completed task 1.5 by defining canonical reject code/reason payloads (with pending-visual rollback directives), keeping expected denials on `reject` vs host/runtime faults on `error`, and adding `commandId` outcome-correlation helpers plus lifecycle/idempotency tests.
- 2026-02-08: Completed task 1.6 by adding a reusable host conformance suite module with adapter hooks (handshake, ordering, idempotency, snapshot/resync), adding a deterministic `MockHost` `CoreHost` adapter, and running the shared suite against both `MockHost` and `LocalHost`.
- 2026-02-08: Completed task 1.7 by publishing `STAGE_1_API_USAGE.md` with Stage 2 UI and Stage 3 runtime integration guidance for `CoreHost`, documented command/reject/resync event flows, and references to canonical exports plus conformance/behavior tests.
