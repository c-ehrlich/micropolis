# C-Parity Plan (Sim Core)

Goal
Make sim-core match Micropolis C behavior as closely as practical, while explicitly documenting any intentional divergences.

Scope
Core simulation systems in `packages/sim-core`, with references to `ref/micropolis/src/sim` and `ref/micropolis/spec`.

Inputs
- `ref/micropolis/spec/core/SPEC.md`
- `ref/micropolis/spec/persistence/SPEC.md`
- `ref/micropolis/src/sim/s_sim.c`
- `ref/micropolis/src/sim/s_scan.c`
- `ref/micropolis/src/sim/s_eval.c`
- `ref/micropolis/src/sim/s_traf.c`
- `ref/micropolis/src/sim/w_update.c`
- `ref/micropolis/src/sim/w_budget.c`

Plan
- [x] Map flag parity (C-style `NewMapFlags` updates).
Implement the missing `NewMapFlags` updates in PTL, Crime, and PopDen to match `ref/micropolis/src/sim/s_scan.c` (PLMAP/LVMAP, CRMAP/POMAP, PDMAP/RGMAP, DYMAP). Ensure phase 10/11 marking remains intact.

- [x] Emulate C bug in `VoteProblems`.
Replicate the out-of-bounds access behavior from `ref/micropolis/src/sim/s_eval.c` (the `x > PROBNUM` loop bound). Use explicit, well-annotated code to preserve the C bug, with comments pointing to `s_eval.c` and `sim.h` `PROBNUM`.

- [x] Zoning traffic gate parity by default, with legacy simplified mode kept as opt-in.
Use full `MakeTraf` behavior by default in zoning (C-parity path), while keeping an explicit `trafficMode: 'simplified'` option in `packages/sim-core/src/systems/zones.ts` for de-risking and experiments. Document that simplified mode is intentionally non-C and must not be the default parity mode.

- [x] Implement full `DoUpdateHeads` (core behavior).
Complete the `DoUpdateHeads` port in `packages/sim-core/src/systems/date-time.ts` to include demand valves, funds (with `MustUpdateFunds` gating), options (limited to fields tracked in sim-core), and message-port handling consistent with `ref/micropolis/src/sim/w_update.c`.

- [x] Budget message behavior.
Match C by clearing the message port before sending budget warning message 29, mirroring `ref/micropolis/src/sim/w_budget.c`.

- [x] UI/state fields and hook notes (no new fields yet).
Do not add new core state fields or hooks at this time. Instead, add a note in `packages/sim-ui` describing the missing `DoUpdateHeads`-related hooks and state (LastR/LastC/LastI, funds updates, options updates, message port handling), referencing `ref/micropolis/src/sim/w_update.c`.

- [x] Initialization fix.
Reset `PowerStackNum` in `initSimMemory` to mirror `ref/micropolis/src/sim/s_sim.c` before `DoPowerScan`.

- [x] Integer width behavior.
Leave JS number behavior unchanged (no 16-bit wrapping). Document the intentional divergence and the reasoning in code comments where most impactful.

- [x] Heads parity: add missing option fields to `SimState` and persistence.
Add missing option fields and ensure `updateOptions` covers the full C set from `ref/micropolis/src/sim/w_update.c`:
- Persisted in `.cty` (see `ref/micropolis/spec/persistence/SPEC.md` / `ref/micropolis/src/sim/s_fileio.c`):
  - `autoGo`, `UserSoundOn` (already parsed/written by `packages/sim-core/src/io/cty.ts`, but not currently wired into `SimState`).
- UI/runtime-only in C (not part of the `.cty` persistence spec):
  - `DoAnimation`, `DoMessages`, `DoNotices` (decide whether these live in sim-core state, tool context, or sim-ui).
Then extend `packages/sim-core/src/systems/date-time.ts` `updateOptions` to emit the additional options via `uiSet`.

- [x] Heads parity: audit all `TotalFunds` mutations to call `markFundsDirty`.
Ensure every path that changes `TotalFunds` marks funds dirty so `DoUpdateHeads` behaves like `ref/micropolis/src/sim/w_update.c`:
- C parity requirement: `UpdateHeads()` forces a funds refresh by setting `MustUpdateFunds = 1` before `DoUpdateHeads()`; ensure the first `runUiUpdate`/`doUpdateHeads` run updates funds even if nothing has called `markFundsDirty` yet.
- Prefer centralizing mutations via explicit helpers mirroring C:
  - `Spend(dollars)` / `SetFunds(dollars)` in `ref/micropolis/src/sim/w_stubs.c` (both imply `UpdateFunds()`).
  - TS equivalents should update `TotalFunds` and call `markFundsDirty`.

- [ ] Heads parity: wire `uiSet` heads keys in `packages/sim-ui`.
Consume `demandR/demandC/demandI`, `funds`, and options keys, and wire `NewMapFlags`/`NewMap` into map invalidation/redraw logic (see `packages/sim-ui/IMPORTANT.md` + `ref/micropolis/src/sim/w_update.c`).

- [x] Message parity: model picture-message requeue and timeouts.
`doMessage` in `ref/micropolis/src/sim/s_msg.c` requeues picture messages (`MessagePort = pictId`) and manages expiry (via `MesNum`, `LastMesTime`, and `TickCount()`); decide whether this behavior lives in sim-core or sim-ui and implement parity accordingly.
Also reconcile/adjust sim-core date handling so it matches the C call chain `updateDate()` -> `doMessage()` in `ref/micropolis/src/sim/w_update.c`:
- Ensure the megalinium rollover message uses the message-port gated `SendMes(-40)` path (not an unconditional UI hook call), matching `ref/micropolis/src/sim/w_update.c`.
- Avoid unconditional MessagePort consumption in `updateDate` if/when picture-message requeue is implemented (see `packages/sim-core/PLAN-C-PARITY-REVIEW.md`).

Testing Plan
- [x] Add targeted unit tests for map-flag updates, `VoteProblems` bug emulation, and the budget warning message path.
- [x] Add targeted unit tests for remaining heads/message parity.
Cover at least:
- `UpdateHeads`-style first-run funds update (w_update.c `UpdateHeads`/`ReallyUpdateFunds`).
- Megalinium rollover message -40 honoring message-port gating (w_update.c `updateDate` + s_msg.c `SendMes`).
- Picture message requeue + expiry if/when `doMessage` parity is implemented (s_msg.c `doMessage`).
- [ ] Extend e2e fixtures as needed once the behavior changes land, ensuring any magic numbers are tied to C sources in comments.

Notes
Any intentional divergences from C must be explicitly documented in code with pointers to C sources. The zoning `simplified` traffic mode is one such opt-in divergence and is not the default parity path.
