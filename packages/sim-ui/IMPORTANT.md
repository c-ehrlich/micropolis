# IMPORTANT

Wire `NewMapFlags`/`NewMap` from sim-core into map view invalidation/redraw logic (map overlays and map_state modes).

Add UI wiring for `DoUpdateHeads` parity. The C version updates demand valves, funds, and options state, and consumes the message port during date updates. See `ref/micropolis/src/sim/w_update.c` for the expected UI hooks and state (`LastR/LastC/LastI`, funds updates, options updates, `doMessage`/message port handling).

sim-core now emits `uiSet` keys (`demandR`, `demandC`, `demandI`, `funds`, `optionAutoBudget`, `optionAutoBulldoze`, `optionDisasters`), but sim-ui still needs to wire them and decide how to mirror the missing `Last*` state and picture-message requeue behavior.

Heads parity is still incomplete because sim-core does not yet track these C options fields: `autoGo`, `UserSoundOn`, `DoAnimation`, `DoMessages`, `DoNotices` (`ref/micropolis/src/sim/w_update.c` updateOptions). If/when those are added to `SimState`, extend the `uiSet` options wiring to match C.

Funds head updates are gated in sim-core via a `MustUpdateFunds` emulation. Callers that mutate `TotalFunds` directly must trigger a dirty flag (see `markFundsDirty` in `packages/sim-core/src/systems/date-time.ts`) or the funds head will not update, matching C `UpdateFunds`/`ReallyUpdateFunds` behavior.
