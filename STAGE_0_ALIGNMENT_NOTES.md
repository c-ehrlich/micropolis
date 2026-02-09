# Stage 0 Alignment Notes (Contract Freeze)

## Purpose

These notes publish the frozen Stage 0 bridge contract for Stage 1+ implementers.
`@city/core-bridge` is now the single protocol owner.

Micropolis parity baseline:

- `ref/micropolis/spec/integration/SPEC.md`
- `ref/micropolis/src/sim/w_sim.c`
- `ref/micropolis/src/sim/w_tk.c`
- `ref/micropolis/src/sim/w_net.c`
- `ref/micropolis/src/sim/s_sim.c`
- `ref/micropolis/src/sim/sim.c`

Parity note: envelope transport/type modeling is intentionally different from the C Tcl/stdio/UDP wiring model, but command authority, deterministic ordering intent, and lockstep compatibility behavior are preserved.

## Frozen v1 Envelope Inventory

Contract source: `packages/core-bridge/src/types.ts`.

Client -> host envelopes:

- `hello`
- `command`
- `request_snapshot`
- `ping`

Host -> client envelopes:

- `hello`
- `ack`
- `reject`
- `patch`
- `snapshot`
- `resync`
- `presence`
- `error`

Shared required identity/order/version fields:

- identity: `roomId`, `clientId`
- command lifecycle: `commandId` on `command`/`ack`/`reject`
- ordering metadata: `tick`, `serverSeq` on sequenced host events
- lockstep hello payload: `protocolVersion`, `cityPayloadVersion`, `coreVersion`, `snapshotCadenceTicks`

Frozen default constants:

- `CORE_BRIDGE_V1_PROTOCOL_VERSION = "core-bridge/v1"`
- `CORE_BRIDGE_V1_CITY_PAYLOAD_VERSION = "city/v1"`
- `CORE_BRIDGE_V1_DEFAULT_SNAPSHOT_CADENCE_TICKS = 64`
- `CORE_BRIDGE_V1_LOCAL_ROOM_ID = "local-room"`
- `CORE_BRIDGE_V1_LOCAL_CLIENT_ID = "local-client"`

Frozen concrete payload baselines:

- `command`: typed city union (`tool_apply`, `sim_pause`, `sim_resume`, `sim_set_speed`, `city_new`, `city_load`, `city_save`, `scenario_start`)
- `patch`: authoritative incremental deltas (`mapDeltas`, `hud`, `messageFeed`, `lifecycle`) where map deltas are frozen as `{ x, y, tile }` (no linear `index` deltas).
- `snapshot`: authoritative full projection (`map`, `hud`, `lifecycle`, `replay`) where `map.tiles` ordering is frozen as x-major `index = x * height + y` (classic Micropolis world uses `index = x * WORLD_Y + y`).

## Ordering and Replay Invariants

Contract source: `packages/core-bridge/src/sequencing.ts`.

Rules:

1. `serverSeq` is strict monotonic forward-only.
2. `tick` is non-decreasing.
3. Multiple events may share a `tick`; `serverSeq` order is authoritative.
4. Stale events (`serverSeq <= lastAppliedServerSeq`) are dropped.
5. `serverSeq` gaps trigger `resync`.
6. `tick` regression triggers `resync`.

Decision surface:

- `CoreBridgeV1SequenceAction`: `apply`, `drop`, `resync`
- `CoreBridgeV1SequenceReason`: `initial_event`, `in_order`, `stale_server_seq`, `server_seq_gap`, `tick_regression`

## Host/Client Authority Boundary (Frozen)

Authority contract sources:

- `packages/core-bridge/src/core-host.ts`
- `packages/core-bridge/src/types.ts`
- `apps/web/src/game/runtime/reducer.ts`
- `apps/web/src/game/runtime/map-state.ts`
- `apps/web/src/game/runtime/hud-state.ts`

Rules:

1. Host owns authoritative simulation progression and state publication (`ack`, `reject`, `patch`, `snapshot`, `resync`) through sequenced envelopes.
2. Client runtime is projection-only for authoritative state: map and HUD are updated only from host envelopes, never from client-issued commands.
3. Client may keep local pending tool visuals keyed by `commandId` (`pendingTools`) for UX parity with pending tool feedback intent in `ref/micropolis/src/sim/w_tool.c`; these markers are non-authoritative and must not mutate authoritative map/HUD projections.
4. Pending visuals settle only when host emits command outcomes (`ack`/`reject`) or resync transitions clear them.

## Funds Coupling Invariant (Frozen)

Contract sources:

- `packages/sim-core/src/core/sim-state.ts`
- `packages/sim-core/src/systems/funds.ts`
- `packages/sim-core/src/actions/tool-actions.ts`

Micropolis parity sources:

- `ref/micropolis/src/sim/w_tool.c`
- `ref/micropolis/src/sim/w_stubs.c`
- `ref/micropolis/src/sim/s_fileio.c`

Rules:

1. `SimState.TotalFunds` is the single canonical funds value in runtime state.
2. `ToolContext.funds` is derived tool-execution state only; it must never become an independent source of truth.
3. Tool flows must synchronize `ToolContext.funds` from canonical `SimState.TotalFunds` before tool evaluation and synchronize back from canonical funds state after every tool outcome (success, reject, out-of-bounds, no-funds).
4. Lifecycle and IO flows (`new-city`, `load-city`, `scenario_start`) that update funds through `setFunds`/`spendFunds` must preserve the same canonical ownership so HUD/head publication remains consistent with `DoUpdateHeads` expectations.

## Handshake and Validation Behavior

Contract source: `packages/core-bridge/src/validation.ts`.

Handshake/version ownership source:

- `packages/core-bridge/src/local-host.ts` and `packages/core-bridge/src/types.ts` are the only Stage 0 owners for handshake/version defaults.
- Web adapters consume these values (`apps/web/src/game/handshake.ts`, `apps/web/src/game/runtime/protocol.ts`) and must not introduce new web-local handshake/version constants.

Schema validators:

- `validateCoreBridgeV1CommandEnvelope`
- `validateCoreBridgeV1HelloEnvelope`
- `isCoreBridgeV1CommandEnvelope`
- `isCoreBridgeV1HelloEnvelope`

Strict lockstep validator:

- `validateCoreBridgeV1Handshake`

Handshake behavior:

1. `hello` must pass envelope schema checks first.
2. `protocolVersion`, `cityPayloadVersion`, and `coreVersion` must match expected values exactly.
3. Any mismatch produces deterministic failure metadata with `version_mismatch` and a `protocol_violation` error payload shape.

## Contract Baseline Fixtures and Tests

Fixtures:

- manifest: `packages/core-bridge/fixtures/manifest.json`
- happy single-envelope corpus: `packages/core-bridge/fixtures/happy/`
- edge corpus:
  - `packages/core-bridge/fixtures/edge/duplicate-command-id.json`
  - `packages/core-bridge/fixtures/edge/out-of-order-seq.json`
  - `packages/core-bridge/fixtures/edge/version-mismatch-hello.json`

Stage 0 contract-lock tests:

- compile-time envelope lock: `packages/core-bridge/src/types.test.ts`
- validator/handshake lock: `packages/core-bridge/src/validation.test.ts`
- ordering invariant lock: `packages/core-bridge/src/sequencing.test.ts`
- fixture conformance lock: `packages/core-bridge/src/fixtures.test.ts`
- cross-package conformance lock: `packages/sim-integration/src/bridge-contract.test.ts`

Migration boundary notes:

- `packages/sim-integration/INTEGRATION-CONTRACT.md` (Stage 0 bridge migration points)

## Unresolved Questions for Stage 1 Consumers

1. `CoreHost` final API surface is still pending Stage 1 task 1.1; do not fork envelope types while defining host signatures.
2. Mock/local host lifecycle sequencing details (`connect`, `disconnect`, snapshot replay triggers) are pending Stage 1 tasks 1.2 to 1.4.
3. Final UI-facing reject/error lifecycle correlation helper behavior is pending Stage 1 task 1.5.
4. Shared host conformance harness details for `LocalHost` and future `DoHost` are pending Stage 1 task 1.6.
