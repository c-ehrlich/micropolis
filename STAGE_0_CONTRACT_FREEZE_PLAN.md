# Stage 0 Plan: Contract Freeze and Alignment Baseline

## Stage Goal

Freeze a single bridge contract in `@city/core-bridge` so all subsequent work (mock bridge, UI, real DO bridge, glue) builds against one protocol and one host abstraction.

## Stage Clarifications (Locked 2026-02-08)

- Freeze the full client communication API in this stage, including concrete `command`/`snapshot`/`patch` payload schemas.
- Preserve existing `@city/sim-integration` APIs during migration; bridge contract adoption is additive for now.
- Snapshot cadence default is every 64 ticks unless explicitly overridden.
- Local-mode defaults are deterministic: `roomId = "local-room"` and `clientId = "local-client"`.
- DO adapter target package is `packages/sim-do-adapter` (implemented in Stage 3).
- Keep this checklist and execution log updated as each task lands.

## Required Context Before Any Task

- Read `/Users/cje/dev/city/AGENTS.md`.
- Read `/Users/cje/dev/city/MASTER_GAME_ALIGNMENT_PLAN.md`.
- Read `/Users/cje/dev/city/UI_BRIDGE_PLAN.md`.
- Read `/Users/cje/dev/city/packages/sim-integration/MULTIPLAYER-PLAN.md`.
- Read `/Users/cje/dev/city/apps/web/WORKING_GAME_PLAN.md`.
- Read `/Users/cje/dev/city/ref/micropolis/spec/integration/SPEC.md`.

## Agent Rules for This Stage

- Keep `@city/core-bridge` thin: contracts, schemas, validation, fixtures, and helpers only.
- Do not place simulation rules in `@city/core-bridge`.
- Add JSDoc on every new exported function/type with Micropolis source references and whether behavior is 1:1 or intentionally different.
- For integer math parity concerns, check C source first and document any intentional TypeScript difference.
- If you hit undefined/index type issues, use `assertDefined` where appropriate.
- Update checklist state and execution log in this file as tasks complete.
- Do not remove existing `@city/sim-integration` public APIs in this stage.

## Global Verification (Run After Every Task)

- `pnpm typecheck`
- `pnpm lint`
- `pnpm format`

## Task Checklist

- [x] **0.1 Create `@city/core-bridge` package scaffold**
  - Goal: Add package folder, `package.json`, `tsconfig.json`, `src/index.ts`, and baseline scripts.
  - Files to read first:
    - `/Users/cje/dev/city/pnpm-workspace.yaml`
    - `/Users/cje/dev/city/package.json`
    - `/Users/cje/dev/city/packages/sim-core/package.json`
    - `/Users/cje/dev/city/packages/sim-integration/package.json`
  - C references:
    - `/Users/cje/dev/city/ref/micropolis/spec/integration/SPEC.md` (protocol intent reference, not a direct package map)
  - Implementation steps:
    1. Create `packages/core-bridge/`.
    2. Add minimal package metadata and scripts (`lint`, `typecheck`, optional `test` if tests are added in this task).
    3. Export placeholder bridge surface from `src/index.ts`.
  - Task-specific verification:
    - `pnpm --filter @city/core-bridge typecheck`
    - `pnpm --filter @city/core-bridge lint`
  - Global verification:
    - Run the global verification block.
  - Done criteria:
    - Package is discovered by workspace and lint/typecheck succeeds.
    - No runtime protocol details yet, only scaffold.

- [x] **0.2 Define v1 envelope and field contracts**
  - Goal: Introduce canonical envelope types for `hello`, `command`, `ack`, `reject`, `patch`, `snapshot`, `resync`, `presence`, `error`, `ping`, `request_snapshot`, and freeze concrete payload schemas.
  - Files to read first:
    - `/Users/cje/dev/city/MASTER_GAME_ALIGNMENT_PLAN.md`
    - `/Users/cje/dev/city/UI_BRIDGE_PLAN.md`
    - `/Users/cje/dev/city/packages/sim-integration/MULTIPLAYER-PLAN.md`
  - C references:
    - `/Users/cje/dev/city/ref/micropolis/spec/integration/SPEC.md`
    - `/Users/cje/dev/city/ref/micropolis/src/sim/w_net.c` (network message mindset)
    - `/Users/cje/dev/city/ref/micropolis/src/sim/w_sim.c` (command handling mindset)
  - Implementation steps:
    1. Add `src/types.ts` for canonical envelope discriminants and payload wrappers.
    2. Require identity/order/version fields where mandated (`roomId`, `clientId`, `commandId`, `tick`, `serverSeq`, protocol/core version in `hello`).
    3. Define concrete v1 city payload unions/objects for `command`, `patch`, and `snapshot` (not generic `unknown` payloads).
    4. Export types from `src/index.ts`.
  - Task-specific verification:
    - Add compile-time type tests for required field presence and discriminated unions.
    - `pnpm --filter @city/core-bridge typecheck`
  - Global verification:
    - Run the global verification block.
  - Done criteria:
    - No conflicting protocol shapes remain inside the new package.
    - Event names and required fields match master plan.

- [x] **0.3 Add command schema and handshake schema validators**
  - Goal: Add runtime validation helpers for command envelopes and `hello` compatibility checks.
  - Files to read first:
    - `/Users/cje/dev/city/packages/sim-integration/src/runtime.ts`
    - `/Users/cje/dev/city/packages/sim-integration/src/types.ts`
    - `/Users/cje/dev/city/ref/micropolis/spec/integration/SPEC.md`
  - C references:
    - `/Users/cje/dev/city/ref/micropolis/src/sim/w_sim.c`
    - `/Users/cje/dev/city/ref/micropolis/src/sim/w_tk.c`
  - Implementation steps:
    1. Add validators (type guards or schema-style validators) in `packages/core-bridge/src/validation.ts`.
    2. Add handshake helper enforcing strict lockstep protocol/core versions.
    3. Add error payload shape for validator failures.
  - Task-specific verification:
    - Add unit tests for accept/reject cases (valid envelope, missing fields, version mismatch).
    - `pnpm --filter @city/core-bridge test` (if test script exists)
  - Global verification:
    - Run the global verification block.
  - Done criteria:
    - Validation failure modes are deterministic and documented.
    - Handshake mismatch behavior is explicit and test-covered.

- [x] **0.4 Define sequencing invariants and helpers (`tick` + `serverSeq`)**
  - Goal: Provide shared helpers to enforce monotonic ordering and stale/gap detection semantics.
  - Files to read first:
    - `/Users/cje/dev/city/MASTER_GAME_ALIGNMENT_PLAN.md`
    - `/Users/cje/dev/city/packages/sim-integration/MULTIPLAYER-PLAN.md`
  - C references:
    - `/Users/cje/dev/city/ref/micropolis/src/sim/s_sim.c`
    - `/Users/cje/dev/city/ref/micropolis/src/sim/sim.c`
  - Implementation steps:
    1. Add sequence state helpers (for `lastAppliedServerSeq`, `lastTick`).
    2. Encode rules: strict monotonic `serverSeq`, non-decreasing `tick`, stale drop, gap detect trigger.
    3. Export helper result enums for caller behavior (apply/drop/resync).
  - Task-specific verification:
    - Add table-driven tests for in-order, same tick/different seq, stale seq, and gap.
    - `pnpm --filter @city/core-bridge typecheck`
  - Global verification:
    - Run the global verification block.
  - Done criteria:
    - Replay/apply decision logic is reusable by both local and DO clients.

- [x] **0.5 Build canonical fixture corpus**
  - Goal: Create static fixtures for every envelope kind and key edge cases.
  - Files to read first:
    - `/Users/cje/dev/city/packages/sim-core/fixtures/replay/manifest.json`
    - `/Users/cje/dev/city/packages/sim-io/fixtures/load-replay/manifest.json`
  - C references:
    - `/Users/cje/dev/city/ref/micropolis/spec/integration/SPEC.md`
  - Implementation steps:
    1. Add `packages/core-bridge/fixtures/` with JSON fixtures for happy path and failure path cases.
    2. Include explicit duplicate `commandId`, out-of-order seq, and version mismatch fixtures.
    3. Include concrete `command`/`snapshot`/`patch` payload fixture examples used by web/runtime tests.
    4. Add fixture manifest and loading utility for tests.
  - Task-specific verification:
    - Add tests that validate fixtures against schema helpers.
    - `pnpm --filter @city/core-bridge test`
  - Global verification:
    - Run the global verification block.
  - Done criteria:
    - Fixtures can be consumed by other packages for cross-package conformance tests.

- [ ] **0.6 Add cross-package contract conformance tests**
  - Goal: Ensure `sim-integration` and future host implementations can consume bridge contracts without drift.
  - Files to read first:
    - `/Users/cje/dev/city/packages/sim-integration/src/index.ts`
    - `/Users/cje/dev/city/packages/sim-integration/src/runtime.integration.test.ts`
    - `/Users/cje/dev/city/packages/sim-integration/INTEGRATION-CONTRACT.md`
  - C references:
    - `/Users/cje/dev/city/ref/micropolis/src/sim/w_sim.c`
    - `/Users/cje/dev/city/ref/micropolis/src/sim/w_net.c`
  - Implementation steps:
    1. Add compile-time tests proving no duplicated incompatible protocol types remain.
    2. Add at least one runtime wiring test in `sim-integration` that consumes `@city/core-bridge` envelope types.
    3. Document migration points for `sim-integration` to bridge-owned contracts.
  - Task-specific verification:
    - `pnpm --filter @city/sim-integration test`
    - `pnpm --filter @city/sim-integration typecheck`
  - Global verification:
    - Run the global verification block.
  - Done criteria:
    - Protocol ownership is practically enforceable by tests.

- [ ] **0.7 Publish Stage 0 alignment notes**
  - Goal: Record final protocol decisions and unresolved questions in repo docs for Stage 1 consumers.
  - Files to read first:
    - `/Users/cje/dev/city/MASTER_GAME_ALIGNMENT_PLAN.md`
    - `/Users/cje/dev/city/STAGE_1_MOCKED_BRIDGE_PLAN.md` (after created)
  - C references:
    - `/Users/cje/dev/city/ref/micropolis/spec/integration/SPEC.md`
  - Implementation steps:
    1. Add/update docs summarizing final v1 envelope inventory, ordering invariants, and handshake behavior.
    2. Link fixtures and tests that define the contract baseline.
    3. Mark completed checklist items and write execution log entries.
  - Task-specific verification:
    - Verify all referenced docs/paths resolve and no stale naming remains.
  - Global verification:
    - Run the global verification block.
  - Done criteria:
    - Stage 1 and Stage 2 implementers can start without protocol ambiguity.

## Stage Exit Criteria

- `@city/core-bridge` exists and is the canonical protocol owner.
- Envelope/handshake/order rules are frozen, validated, and fixture-backed.
- Cross-package tests detect contract drift.

## Execution Log

- [2026-02-08] Completed task 0.1 by scaffolding `packages/core-bridge` with `package.json`, `tsconfig.json`, baseline `lint`/`typecheck` scripts, and a placeholder `src/index.ts` bridge surface export.
- [2026-02-08] Completed task 0.2 by adding frozen v1 envelope contracts in `packages/core-bridge/src/types.ts` (including concrete `command`/`patch`/`snapshot` payload schemas and required identity/order/version fields), exporting them via `packages/core-bridge/src/index.ts`, and adding compile-time contract coverage in `packages/core-bridge/src/types.test.ts`.
- [2026-02-08] Completed task 0.3 by adding runtime command/hello schema validators and strict lockstep handshake checks in `packages/core-bridge/src/validation.ts`, exporting validation APIs via `packages/core-bridge/src/index.ts`, adding validator unit coverage in `packages/core-bridge/src/validation.test.ts`, and wiring package test support in `packages/core-bridge/package.json` and `packages/core-bridge/vitest.config.ts`.
- [2026-02-08] Completed task 0.4 by adding sequencing state helpers and invariant decision APIs in `packages/core-bridge/src/sequencing.ts` (strict monotonic `serverSeq`, non-decreasing `tick`, stale drop, gap/tick-regression resync), exporting sequencing contracts from `packages/core-bridge/src/index.ts`, and adding table-driven coverage in `packages/core-bridge/src/sequencing.test.ts`.
- [2026-02-08] Completed task 0.5 by adding `packages/core-bridge/fixtures/` canonical happy/edge JSON fixtures with a manifest, implementing typed fixture loading utilities in `packages/core-bridge/src/fixtures.ts`, exporting fixture APIs via `packages/core-bridge/src/index.ts`, and adding schema/sequencing/handshake-backed fixture validation coverage in `packages/core-bridge/src/fixtures.test.ts`.
