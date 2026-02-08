# UI Bridge and Host Plan

## Goal

Build multiple UIs as thin clients over a shared simulation bridge, with a local-first
experience now and an easy path to server-authoritative multiplayer on Durable Objects later.

## Core Principles

- UI is a thin layer:
  - render state/events from core
  - send user intent as commands
  - no simulation logic in UI packages
- Shared simulation state is authoritative in the core host.
- Client-only state stays local per user (camera, menus, hover, selection, panel layout).
- High-level intent commands only (no raw tile mutation protocol).
- Strict version lockstep for v1.

## Architecture

1. `@city/core-bridge` (shared contract package)
- Define transport-agnostic envelopes:
  - `command`
  - `ack`
  - `reject`
  - `patch`
  - `snapshot`
  - `resync`
  - `hello` (protocol/core version handshake)
- Include typed high-level command schema and validation.
- Include sequencing fields (`serverSeq`, `tick`, `commandId`, `clientId`).

2. Host abstraction
- Define a `CoreHost` interface used by all UI apps.
- Implement `LocalHost` now (in-process).
- Implement `DoHost` later (Durable Object, one city session per object).
- No intermediate `WsHost` layer planned.

3. Optimistic client flow (local-first UX)
- On action:
  - apply immediate `pending` visual state (ghost/outlined/planned tiles)
  - send `command` with `commandId`
- On `ack + patch`:
  - settle pending visuals to committed state
- On `reject`:
  - rollback pending visuals and show reason

4. State sync and recovery
- Stream ordered patches during play.
- Emit periodic snapshots at fixed simulation tick intervals (default: every 64 ticks).
- Keep command/event log tail between snapshots.
- Reconnect/resync flow:
  - load latest snapshot
  - replay patch tail by sequence

## Delivery Phases

1. Bridge contract first
- Create `@city/core-bridge`.
- Add envelope + command + version handshake schema.
- Add contract tests and fixtures.

2. Local playable thin UI
- Build minimal playable UI on `LocalHost`.
- Include:
  - map rendering + incremental patch redraw
  - core tools (zone/place/bulldoze/road/power)
  - funds/date/demand/speed/messages
  - pending-action visuals
- Goal: validate existing simulation core/systems quickly.

3. Durable Object multiplayer host
- Add `DoHost` using same bridge contract.
- One city session per Durable Object (max 4 players expected).
- Server-authoritative command ordering and patch broadcast.
- Reconnect/resync from snapshot + patch tail.

4. Additional UIs
- Build Athena-inspired complex UI as separate app package.
- Build future 3D UI as separate renderer package.
- Both consume the same `@city/core-bridge` contract and host interface.

## Resolved Decisions (2026-02-08)

- Freeze the full client communication API in Stage 0 (envelopes + concrete payload shapes), not envelope shells only.
- Keep existing `@city/sim-integration` APIs during migration; new bridge/multiplayer APIs are additive for now.
- Snapshot cadence default is every 64 ticks.
- Local mode uses deterministic defaults: `roomId = "local-room"` and `clientId = "local-client"`.
- Durable Object adapter package target is `packages/sim-do-adapter`.
- Snapshot/patch contract direction:
  - `snapshot`: full authoritative baseline required for reconnect/bootstrap.
  - `patch`: ordered incremental deltas with `tick` + `serverSeq` semantics.

## v1 Non-Goals

- CRDT for authoritative simulation map/state.
- Cross-version bridge compatibility (strict lockstep only for now).
- Shared camera/menu/panel state across players.
