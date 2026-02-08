# Integration Contract (`@city/sim-integration`)

## Purpose

This document defines ownership boundaries between `@city/sim-integration`,
`@city/sim-core`, `@city/sim-ui`, and `@city/sim-io`.

Parity baseline for this package is the Micropolis integration surface in:

- `ref/micropolis/micropolisactivity.py` (Sugar process bridge)
- `ref/micropolis/src/sim/w_tk.c` (TTY stdin command loop)
- `ref/micropolis/src/sim/w_sim.c` and `ref/micropolis/src/sim/w_net.c` (NET Tcl commands + UDP hooks)

## Ownership Boundaries

| Package | Owns | Must Not Own |
| --- | --- | --- |
| `@city/sim-core` | Deterministic simulation state transitions, simulation systems, and hook contracts (`SimHooks`, `uiSet`, `sendMes`, `sendMesAt`, `makeSound`). | Transport adapters, process/stdin/stdout wiring, UDP socket wiring, and host runtime integration glue. |
| `@city/sim-integration` | Platform bridge runtime for Sugar/TTY/NET command transport and adapter boundaries for host I/O. | Simulation rules, map mutation logic, save/load file orchestration, UI rendering/state stores, or message string lookup. |
| `@city/sim-ui` | UI state/view rendering and user-facing handling of core hook outputs (messages, heads/options, map invalidation). | Simulation stepping rules, `.cty` persistence encoding/decoding, and low-level integration transport protocols. |
| `@city/sim-io` | `.cty`/scenario load-save orchestration and persistence adapters around `@city/sim-core` state/context. | Sugar/TTY/NET transport behavior and UI rendering/state policy. |

## Contract Rules

1. `@city/sim-integration` is a transport boundary layer only. It can forward events/commands, but must not reimplement `@city/sim-core` simulation behavior.
2. `@city/sim-core` remains the authority for simulation-side hook semantics and parity behavior; integration consumes those semantics but does not redefine them.
3. `@city/sim-ui` owns presentation decisions for core events/messages; integration may surface transport tokens, but UI interpretation stays in `@city/sim-ui`.
4. `@city/sim-io` owns persistence format parity and file orchestration; integration does not parse or serialize city/scenario files.
5. Cross-package composition must preserve one-way responsibilities: simulation logic in core, transport in integration, presentation in ui, persistence in io.

## Stage 3 Finalization Notes

Stage 3 migration decisions and legacy-adapter status are recorded in:

- `packages/sim-integration/STAGE_3_MIGRATION_NOTES.md`

Summary:

1. `@city/core-bridge` is the finalized protocol owner (`CoreHost`, envelopes, handshake, sequencing).
2. `@city/sim-do-adapter` owns DO/websocket/alarm transport boundaries.
3. Legacy Sugar/TTY/UDP adapters in `@city/sim-integration` remain available, but isolated behind feature flags and treated as optional compatibility surfaces rather than authoritative bridge-v1 runtime transport.

## Historical Stage 0 Migration Points

The Stage 0 contract owner is `@city/core-bridge`. Migration in `@city/sim-integration`
converged on that package for protocol definitions:

1. Use `packages/sim-integration/src/bridge-contract.ts` as the migration seam;
   it aliases integration-facing envelope types directly to `@city/core-bridge`
   (`IntegrationBridgeClientEnvelopeV1` / `IntegrationBridgeServerEnvelopeV1`).
2. Command ingress boundaries (TTY/NET/Sugar adapters) normalize incoming
   protocol intents into bridge-owned client envelopes before runtime orchestration.
3. Outbound authoritative events are emitted as bridge-owned server envelopes
   with explicit `tick` + `serverSeq` ordering metadata.
4. Version/schema checks use bridge-owned validators (`validateCoreBridgeV1HelloEnvelope`,
   `validateCoreBridgeV1CommandEnvelope`, `validateCoreBridgeV1Handshake`) rather
   than package-local protocol validators.
5. Stale/gap ordering behavior uses bridge-owned sequencing helpers to keep
   apply/drop/resync semantics consistent across local and DO hosts.

## Hook Pathways (`makeSound`, messages, UI hooks)

This section documents how the hooks connect across packages while keeping
`@city/sim-core` as the single owner of simulation behavior.

### 1) Sound pathway (`makeSound` -> `PlaySound`)

Micropolis parity chain:

1. Simulation code triggers `MakeSound(channel, id)` in C (`ref/micropolis/src/sim/w_sound.c`).
2. Tcl receives `UIMakeSound ...` and `EchoPlaySound` emits `PlaySound <token>` to stdout (`ref/micropolis/res/micropolis.tcl`).
3. Sugar bridge reads `PlaySound` and plays `<token>.wav` lowercased (`ref/micropolis/micropolisactivity.py`).

TypeScript ownership split:

- `@city/sim-core` decides when sound happens and what sound id/spec is emitted through `SimHooks.makeSound` (`packages/sim-core/src/core/sim-context.ts`).
- `@city/sim-integration` only transports/parses Sugar stdout `PlaySound` lines and forwards the token (`packages/sim-integration/src/runtime.ts`, `packages/sim-integration/src/sugar/stdout-protocol.ts`).
- `@city/sim-ui` (or host UI layer) chooses how to render/play audio.

### 2) Message pathway (`sendMes` / `sendMesAt`)

Micropolis parity chain:

1. Simulation enqueues messages via `SendMes` / `SendMesAt` (`ref/micropolis/src/sim/s_msg.c`).
2. `doMessage()` consumes `MessagePort`, handles picture-message requeue/expiry, and emits UI commands (`UISetMessage`, `UIShowPicture`) (`ref/micropolis/src/sim/s_msg.c`).
3. `DoUpdateHeads` reaches `doMessage()` via `updateDate()` (`ref/micropolis/src/sim/w_update.c`).

TypeScript ownership split:

- `@city/sim-core` keeps queueing/consumption behavior and exposes delivery through `SimHooks.sendMes` / `SimHooks.sendMesAt` (`packages/sim-core/src/systems/messages.ts`, `packages/sim-core/src/systems/date-time.ts`).
- `@city/sim-integration` does not maintain a second message queue, does not map message ids to strings, and does not implement message expiry policy.
- `@city/sim-ui` displays text/pictures and applies presentation policy.

### 3) Heads/UI pathway (`uiSet` keys)

Micropolis parity chain:

1. `DoUpdateHeads` computes funds/date/demand/options and emits Tcl UI setters (`UISetFunds`, `UISetDate`, `UISetDemand`, `UISetOptions`) (`ref/micropolis/src/sim/w_update.c`).

TypeScript ownership split:

- `@city/sim-core` computes and emits canonical `uiSet` keys/values (`packages/sim-core/src/systems/date-time.ts`).
- `@city/sim-integration` does not reinterpret `uiSet` keys and does not own head-window state.
- `@city/sim-ui` consumes `uiSet` outputs and updates view state/widgets.

### Required non-duplication rule

Composition code may wire core hooks into integration/runtime adapters, but it must
treat integration as transport only. Do not reimplement `doMessage`/`DoUpdateHeads`
semantics or sound/message decision logic outside `@city/sim-core`.

## Dependency Direction (Required)

- `@city/sim-core`: no dependency on `@city/sim-integration`, `@city/sim-ui`, or `@city/sim-io`.
- `@city/sim-integration`: may depend on shared types/adapters, but must not import simulation implementation internals from `@city/sim-core`.
- `@city/sim-ui`: may consume `@city/sim-core` outputs and `@city/sim-integration` runtime events.
- `@city/sim-io`: may consume `@city/sim-core` state/context contracts for load/save orchestration.

This separation preserves Micropolis parity layering: simulation (`sim/*.c`) stays distinct from integration transport (`micropolisactivity.py`, `w_tk.c`, `w_net.c`) and file orchestration (`s_fileio.c`).
