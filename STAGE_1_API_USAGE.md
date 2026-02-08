# Stage 1 API Usage: UI and Runtime Tracks

## Purpose

This document is the Stage 1 integration handoff for teams building:

- Stage 2 UI runtime (`apps/web`) on top of `CoreHost`.
- Stage 3 authoritative runtime/DO host implementations that must remain `CoreHost`-compatible.

The behavior documented here follows bridge contracts in `@city/core-bridge` and the integration intent from:

- `ref/micropolis/src/sim/w_sim.c` (command/version flow)
- `ref/micropolis/src/sim/w_tool.c` (tool success/reject outcomes)
- `ref/micropolis/src/sim/w_net.c` (ordered event fanout mindset)
- `ref/micropolis/spec/integration/SPEC.md` (snapshot/resync semantics)

## Canonical Exports To Use

Use only `@city/core-bridge` surfaces for Stage 1 integration:

```ts
import {
  LocalHost,
  MockHost,
  type CoreHost,
  type CoreHostEnvelope,
  type ClientHelloEnvelope,
  type ClientCommandEnvelope,
  type ClientRequestSnapshotEnvelope,
  getHostCommandOutcome,
  isHostCommandOutcomeEnvelope,
  HOST_REJECT_CODE,
  HOST_REJECT_REASON,
} from '@city/core-bridge';
```

For host implementers and runtime conformance:

```ts
import {
  defineCoreHostConformanceSuite,
  type HostConformanceSuiteAdapter,
} from '@city/core-bridge/host-conformance-suite';
```

Key defaults for deterministic local mode:

- `LOCAL_HOST_DEFAULT_ROOM_ID = "local-room"`
- `LOCAL_HOST_DEFAULT_CLIENT_ID = "local-client"`
- `LOCAL_HOST_DEFAULT_PROTOCOL_VERSION = "bridge-v1"`
- `LOCAL_HOST_DEFAULT_CORE_VERSION = "core-v1"`

## UI Track Usage

1. Create a `CoreHost` (`LocalHost` in Stage 2 local mode).
2. `subscribe()` before sending traffic so no initial `hello` event is missed.
3. Call `connect()`.
4. Send `hello` and require `HostHelloEnvelope.accepted === true` before commands.
5. Send `command` envelopes with unique `commandId`.
6. Settle pending visuals from `ack`/`reject` using `getHostCommandOutcome`.
7. Apply `patch`/`snapshot` in `serverSeq` order; treat `resync` as a hard re-bootstrap signal.

Minimal lifecycle sketch:

```ts
const host: CoreHost = new LocalHost();
const applied: CoreHostEnvelope[] = [];

host.subscribe((event) => {
  applied.push(event);
});

host.connect();
host.hello({
  kind: 'hello',
  roomId: 'local-room',
  clientId: 'local-client',
  protocolVersion: 'bridge-v1',
  coreVersion: 'core-v1',
});
```

## Runtime Track Usage

Stage 3 host implementations (`DoHost`) must satisfy `CoreHost` and pass the shared conformance suite from `@city/core-bridge/host-conformance-suite`.

Required behavior:

- Strict handshake gate: no command processing before accepted `hello`.
- Deterministic ordering: strictly increasing `serverSeq`, non-decreasing `tick`.
- `commandId` idempotency: duplicate outcomes replay (`ack`/`reject`) without reapplying patch.
- Snapshot recovery: support snapshot bootstrap, patch-tail replay, and `resync` on gaps/ahead cursors.
- Keep expected command denials on `reject`; reserve `error` for unexpected host/runtime faults.

## Event Flow Diagrams (Text)

### 1) Successful command lifecycle

```text
Client -> Host: connect()
Client -> Host: hello(roomId, clientId, protocolVersion, coreVersion)
Host -> Client: hello(accepted: true)
Client -> Host: command(commandId=cmd-1, type=tool.place)
Host -> Client: ack(commandId=cmd-1, tick=T, serverSeq=S)
Host -> Client: patch(tick=T, serverSeq=S+1)
```

### 2) Expected command rejection lifecycle

```text
Client -> Host: command(commandId=cmd-2, type=tool.place, mockToolResultCode=-2)
Host -> Client: reject(
  commandId=cmd-2,
  code=tool/no-funds,
  reject.reason=insufficient-funds,
  reject.pendingVisual.action=rollback
)
```

### 3) Snapshot replay and resync lifecycle

```text
Client -> Host: request_snapshot(afterServerSeq absent)
Host -> Client: snapshot(tick, serverSeq, baseline)

Client -> Host: request_snapshot(afterServerSeq=latestApplied-1)
Host -> Client: patch(...serverSeq ordered tail...)

Client -> Host: request_snapshot(afterServerSeq too old or ahead)
Host -> Client: resync(reason=server-seq-gap | server-seq-ahead)
```

## Reference Tests (Executable Contract)

- `packages/core-bridge/src/core-host.test.ts`
  - Compile-time contract assertions for `CoreHost` method/event types.
- `packages/core-bridge/src/local-host.test.ts`
  - `emits accepted hello with deterministic local default identity`
  - `supports explicit identity overrides and local tick scheduler hooks`
- `packages/core-bridge/src/command-outcome.test.ts`
  - `correlates successful command lifecycle to ack settlement`
  - `correlates reject lifecycle to rollback signal without emitting host error`
  - `keeps duplicate command outcomes idempotent with ack replay and no patch reapply`
- `packages/core-bridge/src/mock-authority-engine.test.ts`
  - Deterministic ordered `ack/reject/patch/snapshot/resync/error` coverage.
- `packages/core-bridge/src/host-conformance-suite.ts` (run via `packages/core-bridge/src/host-conformance-suite.test.ts`)
  - `enforces strict hello handshake before command processing`
  - `keeps outbound sequencing deterministic (strict serverSeq, non-decreasing tick)`
  - `enforces commandId idempotency (duplicate ack/reject without reapply patch)`
  - `supports snapshot bootstrap, patch-tail replay, and deterministic resync for gap/ahead cursors`
