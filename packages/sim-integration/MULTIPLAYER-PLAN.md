# Multiplayer Plan (Durable Object + Web UI)

## Goal

Evolve `@city/sim-integration` into a transport-agnostic integration runtime that can run an authoritative simulation in a Durable Object and stream state to a web client.

This plan treats current Sugar/TTY/UDP integration as optional adapters. The long-term primary transport is Durable Object + WebSocket.

## Scope and Non-Goals

### In Scope

- Define a stable multiplayer runtime contract.
- Add Durable Object and web-client adapters around that contract.
- Implement authoritative command processing + tick loop + state replication.
- Keep package boundaries clean with `@city/sim-core`, `@city/sim-ui`, and `@city/sim-io`.

### Out of Scope

- Rewriting simulation rules in `@city/sim-core`.
- Embedding transport-specific logic inside simulation code.

## Target Runtime Contract

Add a multiplayer contract surface in `@city/sim-integration` that does not depend on Node APIs.

```ts
// packages/sim-integration/src/multiplayer/types.ts

import type {
  BridgeClientCommandEnvelope,
  BridgeClientId,
  BridgeRoomId,
  BridgeServerEnvelope,
  BridgeServerSnapshotEnvelope,
} from "@city/core-bridge";

export type ClientId = BridgeClientId;
export type RoomId = BridgeRoomId;
export type ClientCommandEnvelope<T = unknown> = BridgeClientCommandEnvelope<T>;
export type ServerEventEnvelope<T = unknown> = BridgeServerEnvelope<T>;

export interface IntegrationPersistence {
  load(roomId: RoomId): Promise<Uint8Array | null>;
  save(roomId: RoomId, blob: Uint8Array): Promise<void>;
}

export interface IntegrationBroadcaster {
  sendToClient(clientId: ClientId, event: ServerEventEnvelope): void;
  sendToRoom(roomId: RoomId, event: ServerEventEnvelope): void;
}

export interface IntegrationRuntime {
  connectClient(roomId: RoomId, clientId: ClientId): Promise<void>;
  disconnectClient(roomId: RoomId, clientId: ClientId): Promise<void>;
  receiveCommand(cmd: ClientCommandEnvelope): Promise<void>;
  tick(nowMs: number): Promise<void>; // authoritative tick
  getSnapshot(roomId: RoomId): Promise<BridgeServerSnapshotEnvelope>;
}
```

## Durable Object Mapping

One Durable Object instance is the authority for one room/city:

- `fetch` + WebSocket upgrade: call `connectClient` on join.
- Incoming messages: call `receiveCommand`.
- Socket close: call `disconnectClient`.
- Durable Object alarm: call `tick(nowMs)` on a fixed cadence.
- Durable Object storage: implement `IntegrationPersistence`.
- WebSocket fanout: implement `IntegrationBroadcaster`.

## Client/Server Wire Protocol

### Client -> Server

- `join`
- `command`
- `request_snapshot`
- `ping`

All mutating commands include:

- `roomId`
- `clientId`
- `commandId` (idempotency + retry safety)
- `sentAtMs`
- typed command payload

### Server -> Client

- `ack`
- `snapshot`
- `patch`
- `presence`
- `error`

Rules:

- Every `patch` is tagged with authoritative `tick`.
- Client applies only forward ticks and drops old/out-of-order updates.
- Snapshot is the recovery baseline for reconnect.

## Authoritative State Model

- Server is authoritative for simulation state and progression.
- Client never applies speculative gameplay state that can diverge from server authority.
- Command processing is deterministic and ordered per room tick.
- Duplicate command envelopes (same `commandId`) are acknowledged but not re-applied.

## Package and Adapter Boundaries

- `@city/sim-core`: simulation rules/state transitions only; no transport, socket, or Durable Object awareness.
- `@city/sim-integration`: command validation/orchestration/tick hooks/event envelopes and transport-agnostic interfaces (`IntegrationPersistence`, `IntegrationBroadcaster`).
- `@city/sim-ui`: rendering/input, websocket client behavior, reconnect flow, and snapshot+patch application.
- `@city/sim-io` (or adapter packages): concrete runtime adapters (Durable Object storage/websocket plumbing, optional Node adapters).

## Phased Implementation Plan

### Phase 1: Contract Introduction

- [ ] Add `src/multiplayer/types.ts` with the contract above.
- [ ] Export multiplayer contract types from `src/index.ts`.
- [ ] Add compile-time contract tests to lock public signatures.

Checkpoint:

- [ ] `@city/sim-integration` compiles with new contract exports.

### Phase 2: Runtime Extension

- [ ] Extend `createIntegrationRuntime` to support room/client lifecycle and `receiveCommand`.
- [ ] Add command idempotency tracking by `commandId`.
- [ ] Add `getSnapshot` support for reconnect/bootstrap.
- [ ] Keep existing Sugar/TTY/UDP flows behind feature flags/adapters.

Checkpoint:

- [ ] Integration runtime tests cover command acceptance, dedupe, and snapshot retrieval.

### Phase 3: Durable Object Adapter

- [ ] Create Durable Object adapter package (for example `packages/sim-do-adapter`).
- [ ] Map websocket open/close/message to runtime APIs.
- [ ] Add alarm-driven tick loop wiring.
- [ ] Persist/load room snapshots in Durable Object storage.

Checkpoint:

- [ ] Adapter tests verify room authority, persistence, and fanout behavior.

### Phase 4: Web Client Adapter

- [ ] Create web client adapter package (for example `packages/sim-web-client`).
- [ ] Implement reconnect + snapshot request on reconnect.
- [ ] Apply `snapshot` then ordered `patch` stream by `tick`.
- [ ] Surface `ack`/`error` cleanly to UI command UX.

Checkpoint:

- [ ] Client adapter tests verify reconnect and out-of-order patch handling.

### Phase 5: Hardening + Contracts

- [ ] Document strict invariants (ordering, idempotency, authority).
- [ ] Add cross-package contract tests (`sim-core` hooks consumed by integration runtime).
- [ ] Document optional legacy adapter status (Sugar/TTY/UDP) and parity expectations.

Checkpoint:

- [ ] Contract docs + tests pass across integration + adapters.

## Risks and Mitigations

- Risk: State divergence between client and server.
- Mitigation: authoritative ticked patches + snapshot baseline + forward-only application.
- Risk: Duplicate/retried commands causing double-apply.
- Mitigation: required `commandId` idempotency tracking.
- Risk: Transport logic leaking into core simulation.
- Mitigation: strict adapter boundary and compile-time contract tests.

## Definition of Done

- [ ] Durable Object runs authoritative room simulation.
- [ ] Web UI joins room, sends commands, and stays synchronized via snapshot + patches.
- [ ] Runtime contract is transport-agnostic and documented.
- [ ] Existing legacy integration features remain isolated behind adapters/flags.
- [ ] Repository checks pass: `pnpm typecheck`, `pnpm lint`, `pnpm format`.
