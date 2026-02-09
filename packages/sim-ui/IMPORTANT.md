# IMPORTANT

This package is currently a stub. The next work is mostly wiring sim-core outputs into UI state.

## Map invalidation (`NewMap` / `NewMapFlags`)
- Wire `SimState.NewMap` and `SimState.NewMapFlags` into map view invalidation/redraw (base tiles + overlays + map_state modes).
- After one map update cycle, the UI should clear `state.NewMap = 0` and clear all C map-flag slots (`state.NewMapFlags[0..NMAPS-1]`), matching `sim_update_maps` in `ref/micropolis/src/sim/sim.c`.
- These flags mirror the C `NewMap` / `NewMapFlags` behavior in `ref/micropolis/src/sim/s_scan.c` (and are set during scans like PTL, Crime, PopDen, Fire coverage, etc).

## Heads (`DoUpdateHeads` / `uiSet` keys)
sim-core’s canonical UI update entry point is `runUiUpdate()` / `doUpdateHeads()` in `packages/sim-core/src/systems/date-time.ts` (mirrors `DoUpdateHeads` in `ref/micropolis/src/sim/w_update.c`).

Wire the emitted `uiSet` keys into UI state:
- Date: `date`, `dateMonth`, `dateYear`
- Demand: `demandR`, `demandC`, `demandI`
- Funds: `funds` (string label, e.g. `"Funds: $1,234"`, formatted like `ref/micropolis/src/sim/w_util.c`)
- Options (mirrors `updateOptions` in `ref/micropolis/src/sim/w_update.c`):
  - `optionAutoBudget`, `optionAutoGo`, `optionAutoBulldoze`, `optionDisasters`
  - `optionUserSoundOn`, `optionDoAnimation`, `optionDoMessages`, `optionDoNotices`

Notes:
- sim-core preserves C’s “LastR/LastC/LastI” and “MustUpdateFunds” gating internally via WeakMap caches; sim-ui does not need to store those C internals.
- When the UI mutates option fields directly on `SimState`, it should also set `state.MustUpdateOptions = 1` so sim-core re-emits options on the next heads update (C does this to drive `UpdateOptionsMenu`).

## Messages (message port, picture requeue, expiry)
Micropolis calls `doMessage()` from `updateDate()` (`ref/micropolis/src/sim/w_update.c` + `ref/micropolis/src/sim/s_msg.c`). sim-core mirrors that by calling `doMessage()` from `updateDate()` in `packages/sim-core/src/systems/date-time.ts`.

Integrations must provide these hooks:
- `SimHooks.sendMes(id)` and `SimHooks.sendMesAt(id, x, y)` to display messages (text and picture).
- `SimHooks.tickCount()` to drive message expiry timing (C uses `TickCount()`).

Behavior to preserve in sim-ui:
- Picture messages are delivered as negative ids (e.g. `-35`). sim-core will requeue the corresponding *text* message (positive id) for the next tick, matching C.
- Text messages expire after ~30 seconds (C uses `60 * 30` ticks) if nothing new arrives.
- Coordinate-tagged messages are delivered via `sendMesAt`; if `state.autoGo` is enabled, the UI should auto-pan/auto-go-to those coords (C does this in `s_msg.c`).
- Avoid using `_consumeMessagePort()` from sim-core; `doMessage()` already consumes/requeues the port like C, and double-consuming will break picture-message requeue.

## Funds mutation
Funds head updates are gated to match C (`UpdateFunds`/`ReallyUpdateFunds` in `ref/micropolis/src/sim/w_update.c`).
- Prefer using sim-core helpers (`setFunds` / `spendFunds`) rather than mutating `state.TotalFunds` directly.
- If something must mutate `state.TotalFunds` directly, it must call `markFundsDirty(state)` (`packages/sim-core/src/systems/date-time.ts`) or the UI funds head may not update.
