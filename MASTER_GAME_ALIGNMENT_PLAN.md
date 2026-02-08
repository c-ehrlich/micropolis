# Unified Playable Game Plan (Master Alignment)

## Status

This document is the canonical plan for browser-playable city simulation and future multiplayer.
It supersedes strategy-level guidance in:

- `/Users/cje/dev/city/UI_BRIDGE_PLAN.md`
- `/Users/cje/dev/city/packages/sim-integration/MULTIPLAYER-PLAN.md`
- `/Users/cje/dev/city/apps/web/WORKING_GAME_PLAN.md`

Implementation plans should derive from this document.

## Goal

Deliver a playable browser game on `LocalHost` now, while locking a stable bridge contract that upgrades cleanly to Durable Object (DO) authoritative multiplayer later, without rewriting UI flows.

## Normative Decisions (Locked)

1. Canonical contract package is `@city/core-bridge`.
2. `@city/core-bridge` is initially thin (types/schemas/validation/wire envelopes), designed for DO migration.
3. UI goes through a host abstraction from day 1. `apps/web` uses `LocalHost` immediately.
4. Client optimism is allowed for visuals only (pending overlays/ghosts), never speculative authoritative sim state.
5. Keep both `reject` and `error`:
   - `reject`: expected command denial (validation/rules/funds/placement).
   - `error`: unexpected transport/runtime/internal fault.
6. `hello` version/protocol handshake is mandatory in v1 (including local mode).
7. Event ordering uses both `tick` and `serverSeq`.
8. Resync uses both client `request_snapshot` and server `resync` directives.
9. Tie-break for multiple events in the same tick is `serverSeq` (not timestamp).
10. No dedicated `WsHost` abstraction layer. DO websocket plumbing is adapter-level beneath the host/runtime contract.
11. Save/load/scenario entry are in playable scope from the start, not deferred.
12. Legacy Sugar/TTY/UDP paths remain supported as optional adapters for now.
13. Maintain strict lockstep versioning in v1 (no cross-version compatibility).
14. Stage 0 freezes the full client communication API (envelope names, required fields, and concrete payload shapes), not just envelope shells.
15. Existing `@city/sim-integration` Sugar/TTY/NET APIs remain in place during migration; bridge/multiplayer surfaces are additive until a later deprecation phase.
16. Default snapshot cadence is every 64 authoritative ticks unless explicitly overridden.
17. `LocalHost` uses deterministic default IDs in local mode (`roomId = "local-room"`, `clientId = "local-client"`).
18. Durable Object adapter package target is `packages/sim-do-adapter`.
19. Stage checklist state and execution logs in stage plan docs are living artifacts and must be updated as tasks complete.

## Target Architecture

### Package Roles

- `@city/core-bridge`:
  - canonical envelopes, command schema, handshake schema, sequencing rules
  - runtime-agnostic validation and fixtures
- `@city/sim-core`:
  - simulation rules/state transitions only
- `@city/sim-integration`:
  - authoritative orchestration/tick/runtime composition and adapter seams
  - consumes bridge types rather than defining competing protocol contracts
- `apps/web`:
  - thin client renderer/input/HUD/state projection
  - uses `CoreHost` API only (starts with `LocalHost`)
- DO adapter package (new or existing integration adapter surface):
  - websocket, persistence, alarms, room fanout, client connection lifecycle

### Host Abstraction

Define one host contract consumed by UI:

- `CoreHost` (stable client-facing host API)
- `LocalHost` (in-process authoritative runtime)
- `DoHost` (remote DO-backed authoritative runtime)

The UI must not know whether it is local or remote.

## Bridge Protocol v1

### Envelopes

- Client -> host: `hello`, `command`, `request_snapshot`, `ping`
- Host -> client: `hello`, `ack`, `reject`, `patch`, `snapshot`, `resync`, `presence`, `error`

### Required Fields

- command identity: `commandId`, `clientId`, `roomId`
- simulation/order: `tick`, `serverSeq`
- versioning: protocol/core version in `hello`

### Frozen Payload Baseline (Stage 0 Contract)

- `command` payloads are frozen as a concrete discriminated union for v1 city gameplay intents (tools, sim controls, city lifecycle, and persistence/scenario flows), not a generic opaque payload.
- `snapshot` payloads carry a full authoritative city projection suitable for reconnect/bootstrap:
  - map state baseline
  - HUD/scalar simulation state (funds/date/demand/speed/messages)
  - sequencing metadata needed for patch-tail replay
- `patch` payloads carry ordered incremental authoritative changes:
  - map deltas
  - scalar/HUD deltas
  - message/feed events and lifecycle events tied to the same `tick`/`serverSeq` ordering model
- For future game reuse, payloads may include a namespaced extension bag for forward expansion, but v1 city fields are still required and validated.

### Ordering and Replay Invariants

1. `serverSeq` is strictly monotonic per room across all outbound events.
2. `tick` is monotonic non-decreasing.
3. Multiple events can share a tick; apply in `serverSeq` order.
4. Client drops stale events (`serverSeq` <= last applied).
5. Gap detection in `serverSeq` triggers resync path.
6. Reconnect baseline is snapshot + patch tail replay by `serverSeq`.

### Command Processing and UX Semantics

1. Client sends high-level intent command with `commandId`.
2. UI may show pending visuals immediately.
3. Host emits:
   - `ack` + resulting `patch` on success
   - `reject` with reason on expected denial
   - `error` only for unexpected failures
4. Duplicate `commandId` is idempotent: acknowledge but never re-apply.

## Delivery Tracks and Phases

## Phase 0: Contract Freeze and Alignment Baseline

Objective: freeze protocol shape before substantial implementation divergence.

Deliverables:

- `@city/core-bridge` scaffold with v1 envelope/command/handshake schemas
- concrete `command`/`snapshot`/`patch` payload schemas for client communication
- fixture samples for each envelope kind
- compile-time/public API tests and validation tests
- explicit invariants doc (ordering/idempotency/resync/authority)

Exit criteria:

- all teams can build against the same frozen mock contract
- no unresolved naming mismatches (`reject` vs `error`, etc.)

## Phase 1: Mocked/Skeleton Bridge

Objective: produce a thin, testable bridge package used by UI and runtime in parallel.

Deliverables:

- `@city/core-bridge` exports:
  - envelope/command types
  - runtime validators
  - handshake helpers
  - sequence helpers (`tick` + `serverSeq` checks)
- mock host test harness:
  - deterministic command -> `ack/reject/patch` simulation
  - resync simulation (`resync` + snapshot replay)

Exit criteria:

- `apps/web` can run fully against mock/local host using only `CoreHost` + bridge contracts
- runtime track can implement against same contracts without touching UI internals

## Phase 2: Simple UI (Playable on LocalHost)

Objective: ship a playable browser game using `LocalHost` and frozen bridge contracts.

Scope:

- map rendering (incremental patch aware)
- core tools (road/rail/wire/bulldoze/R/C/I at minimum)
- sim controls (pause/play/speed)
- HUD (funds/date/demand/messages)
- pending-action visual state + rollback handling on `reject`
- save/load/scenario entry in-browser from start

Constraints:

- no simulation logic in UI package
- all interactions pass through `CoreHost` commands
- UI applies host events in strict sequence rules

Exit criteria:

- user can start city, build, run/pause, observe updates, save/load/scenario round-trip
- reconnect/resync flow works in local simulation harness

## Phase 3: Real Bridge Runtime + DO Host

Objective: replace mock/runtime placeholders with authoritative bridge-backed runtime and DO transport adapters.

Scope:

- migrate/align `@city/sim-integration` multiplayer runtime contracts to consume `@city/core-bridge`
- implement authoritative room runtime:
  - command validation/orchestration
  - tick loop
  - idempotency by `commandId`
  - snapshot + patch tail persistence model
- implement DO adapter:
  - websocket connect/disconnect/message mapping
  - alarm-driven ticking
  - storage-backed snapshots and tails
  - room fanout/presence

Exit criteria:

- DO-hosted room is authoritative and stable
- web client can switch from `LocalHost` to `DoHost` without UI architecture changes

## Phase 4: Glue, Switchability, and Playable End State

Objective: integrate tracks and prove one playable game with host switchability.

Scope:

- feature/config switch between `LocalHost` and `DoHost`
- end-to-end verification of:
  - handshake/version lockstep
  - command ack/reject paths
  - ordered patching (`tick + serverSeq`)
  - reconnect/resync correctness
  - save/load behavior in local and hosted paths as applicable

Exit criteria (playable definition):

- Yes, this phase yields a playable game.
- Game is playable on `LocalHost` and architecture-ready for DO multiplayer.
- DO mode supports synchronized multi-client play for core tool interactions.

## Parallelization Strategy

After Phase 0 freeze, run these tracks in parallel:

1. Track A: Mocked/skeleton bridge hardening (`@city/core-bridge` fixtures/tests/helpers).
2. Track B: Simple UI on `LocalHost` (`apps/web`, thin client only).
3. Track C: Real bridge runtime and DO adapter (`@city/sim-integration` + adapter package).

Phase 4 is the planned convergence point.

## Risks and Mitigations

1. Protocol drift between packages.
Mitigation: only `@city/core-bridge` owns protocol; others consume it.

2. Ordering bugs under burst updates.
Mitigation: enforce `serverSeq` invariants, gap detection, replay tests.

3. UI/runtime coupling regressions.
Mitigation: strict `CoreHost` boundary, no sim logic in UI.

4. Local vs DO behavior mismatch.
Mitigation: shared contract fixtures and host conformance tests run against both hosts.

5. Legacy adapter drag.
Mitigation: keep isolated and optional; do not block bridge/UI milestones on legacy parity work.

## Quality Gates

For each phase and before merges:

- `pnpm typecheck`
- `pnpm lint`
- `pnpm format`
- host conformance tests (`LocalHost` and `DoHost` once available)
- protocol fixture contract tests (`@city/core-bridge`)

## Stage Plan Documents

1. `/Users/cje/dev/city/STAGE_0_CONTRACT_FREEZE_PLAN.md`
2. `/Users/cje/dev/city/STAGE_1_MOCKED_BRIDGE_PLAN.md`
3. `/Users/cje/dev/city/STAGE_2_SIMPLE_UI_PLAN.md`
4. `/Users/cje/dev/city/STAGE_3_REAL_BRIDGE_DO_PLAN.md`
5. `/Users/cje/dev/city/STAGE_4_GLUE_AND_PLAYABLE_PLAN.md`
