# PLAN-C-PARITY Review Notes

Date: 2026-02-04

These notes capture a parity audit of `packages/sim-core/PLAN-C-PARITY.md` against:
- `packages/sim-core/src/**`
- `ref/micropolis/src/sim/**.c`
- `ref/micropolis/spec/**`

They exist to avoid losing context while iterating on the parity plan.

## Findings (high signal)

### Options / persistence
- Micropolis `updateOptions` (`ref/micropolis/src/sim/w_update.c`) includes these option bits:
  - `autoBudget`, `autoGo`, `autoBulldoze`, `!NoDisasters`, `UserSoundOn`, `DoAnimation`, `DoMessages`, `DoNotices`.
- `.cty` persistence stores only `autoBulldoze`, `autoBudget`, `autoGo`, `UserSoundOn` at `MiscHis[52..55]`
  (see `ref/micropolis/spec/persistence/SPEC.md` and `ref/micropolis/src/sim/s_fileio.c`).
- Our `.cty` adapter already parses/writes `autoGo` and `userSoundOn` in `packages/sim-core/src/io/cty.ts`,
  but it is not currently wired into `SimState` (and `readCityMeta` isn’t used outside tests).

### Funds head gating (MustUpdateFunds)
- Micropolis `UpdateHeads()` sets `MustUpdateFunds = 1` before calling `DoUpdateHeads()`
  (`ref/micropolis/src/sim/w_update.c`).
- sim-core emulates `MustUpdateFunds` via a WeakMap gate in
  `packages/sim-core/src/systems/date-time.ts` (`markFundsDirty`), but:
  - New states start with `mustUpdate=false`, so the funds head will not update on the first heads run
    unless something calls `markFundsDirty`.

### Megalinium rollover message gating
- Micropolis rollover uses `SendMes(-40)` (i.e. message-port gated) inside `updateDate()`
  (`ref/micropolis/src/sim/w_update.c`).
- sim-core currently calls `context.hooks.sendMes(-40)` directly in
  `packages/sim-core/src/systems/date-time.ts`, bypassing message-port gating.

### doMessage() parity (picture requeue + expiry)
- Micropolis `updateDate()` calls `doMessage()` (`ref/micropolis/src/sim/w_update.c`), and `doMessage()`:
  - consumes `MessagePort` into `MesNum`,
  - expires positive messages after ~30 seconds (via `TickCount()`/`LastMesTime`),
  - requeues picture messages by setting `MessagePort = pictId` to resend the *text* message next time,
  - performs `autoGo` UI auto-goto behavior when `MesX/MesY` are set,
  - avoids redundant UISetMessage updates via `HaveLastMessage`/`LastMessage`
    (`ref/micropolis/src/sim/s_msg.c`).
- sim-core currently:
  - has `SendMes`/`SendMesAt` message-port gating (`packages/sim-core/src/systems/messages.ts`),
  - has `_consumeMessagePort()` (clears `MessagePort`),
  - does **not** implement `MesNum`/`LastMesTime` expiry or the picture-message requeue behavior.
- sim-core `updateDate()` calls `_consumeMessagePort()` unconditionally, which will conflict with any future
  attempt to implement picture-message requeue via `MessagePort = pictId`.

### sim-ui wiring status
- `packages/sim-ui` is currently a stub; `packages/sim-ui/IMPORTANT.md` calls out missing wiring for:
  - `NewMapFlags`/`NewMap` invalidation/redraw behavior
  - `uiSet` keys (`demand*`, `funds`, options)
  - message-port + picture requeue behavior

