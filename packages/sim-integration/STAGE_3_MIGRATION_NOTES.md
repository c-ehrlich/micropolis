# Stage 3 Migration Notes (`@city/sim-integration`)

Date: 2026-02-08

## Purpose

Record Stage 3 decisions so Stage 4 can integrate `LocalHost`/`DoHost` without
reopening protocol ownership or legacy-adapter scope questions.

## Bridge Ownership Finalization

Stage 3 finalizes `@city/core-bridge` as the only owner of:

- canonical envelope and payload contracts
- handshake validation and lockstep compatibility checks
- sequencing invariants (`tick` + `serverSeq`)
- host contract (`CoreHost`)

`@city/sim-integration` consumes bridge contracts for authoritative runtime
behavior (`src/multiplayer/runtime.ts`, `src/multiplayer/types.ts`) and does
not define competing protocol shapes.

`@city/sim-do-adapter` owns Durable Object transport concerns (`DoHost`,
`LocalHost`, `RoomDoAdapter`) and keeps websocket/alarm wiring out of
`@city/sim-integration`.

## Legacy Adapter Status (Optional and Isolated)

The legacy integration runtime remains available and intentionally isolated
behind feature flags in `createIntegrationRuntime`:

- `sugar` adapter (`src/sugar/*`, `src/runtime.ts`)
- `tty` adapter (`src/tty/*`, `src/runtime.ts`)
- `net` UDP adapter (`src/net/*`, `src/adapters/node-udp.ts`)

These adapters are parity ports of legacy Micropolis integration surfaces:

- Sugar process bridge and buddy/presence hooks:
  `ref/micropolis/micropolisactivity.py`
- TTY stdin/eval/prompt loop:
  `ref/micropolis/src/sim/w_tk.c`
- UDP listen/hear transport hooks:
  `ref/micropolis/src/sim/w_sim.c`, `ref/micropolis/src/sim/w_net.c`

Parity note: legacy adapters are not part of the bridge-v1 authoritative room
protocol. They remain supported for compatibility workflows, but DO/WebSocket
is the primary Stage 3 authority path.

## Stage 3 Migration Decisions

- Room authority is one runtime per room/DO binding.
- Mutating command processing is idempotent by `commandId`.
- Reconnect recovery is snapshot + ordered patch-tail replay by `serverSeq`.
- Default snapshot cadence remains 64 ticks unless overridden.
- `hello` lockstep enforcement is strict for protocol/core version mismatch.
- Presence fanout is additive and optional (`DEFAULT_DO_PRESENCE_ENABLED = false`).
- Existing `@city/sim-integration` legacy APIs remain additive (no removals in Stage 3).

## Known Gaps Handed to Stage 4

- Host mode selection and integration wiring in `apps/web` (`LocalHost` vs
  `DoHost`) is Stage 4 glue work.
- End-to-end playable acceptance in web UI across both host modes is not a
  Stage 3 deliverable.
- Legacy adapter deprecation/removal timing is still undecided; Stage 3 keeps
  them isolated and optional.
