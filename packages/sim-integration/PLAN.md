# Sim Integration Plan (`@city/sim-integration`)

## Agent Loop

Use this exact loop:

1. Pick the next unchecked task.
2. Implement only that task (and required supporting code).
3. Run tests/checks.
4. Mark the task checked.
5. Check off completed task(s) and record notes in `Execution Log`.

## Parity Sources (must reference in code/docs)

- `ref/micropolis/spec/integration/SPEC.md`
- `ref/micropolis/micropolisactivity.py`
- `ref/micropolis/src/sim/sim.c`
- `ref/micropolis/src/sim/w_tk.c`
- `ref/micropolis/src/sim/w_sim.c`
- `ref/micropolis/src/sim/w_net.c`
- `ref/micropolis/res/micropolis.tcl`

## Global Constraints Checklist

- [ ] Add JSDoc on every new exported function/class, citing the Micropolis source and whether it is 1:1 or intentionally different.
- [ ] Default runtime behavior is parity-first (`strict`) and any intentional hardening is behind an explicit opt-in mode.
- [ ] Keep Node APIs behind adapters so browser/runtime-specific code is isolated.
- [ ] Place tests next to implementation files (`foo.ts` -> `foo.test.ts`).

## Phase 1: Package Foundation

- [x] Create `src/types.ts` with core integration types (`ParityMode`, feature flags, Sugar buddy shape, TTY evaluator result, UDP hooks).
- [x] Create `src/runtime.ts` with `createIntegrationRuntime(options)` skeleton and no-op feature wiring.
- [x] Update `src/index.ts` to export the new public API.
- [x] Add `src/runtime.test.ts` to verify runtime creation and feature flag defaults.
- [ ] Checkpoint: `pnpm --filter @city/sim-integration typecheck` and `pnpm --filter @city/sim-integration test` pass.

## Phase 2: Sugar Outbound Command Bridge

- [x] Create `src/sugar/quote-tcl.ts` implementing `QuoteTCL` parity (`"` -> `\\"` only).
- [x] Add `src/sugar/quote-tcl.test.ts` for parity cases (quotes only; no backslash/braces escaping).
- [x] Create `src/sugar/activity-bridge.ts` to serialize outbound commands with trailing `\n`:
- [x] `SugarStartUp "<uri>"`
- [x] `SugarNickName "<nick>"`
- [x] `SugarShare`
- [x] `SugarQuit`
- [x] `SugarActivate`
- [x] `SugarDeactivate`
- [x] `SugarBuddyAdd "<key>" "<nick>" "<color>" "<address>"`
- [x] `SugarBuddyDel "<key>" "<nick>" "<color>" "<address>"`
- [x] Add `src/sugar/activity-bridge.test.ts` covering exact string output and buddy fallback field ordering.
- [ ] Checkpoint: all Sugar outbound tests pass.

## Phase 3: Sugar Stdout Protocol (`PlaySound`)

- [x] Create `src/sugar/stdout-protocol.ts` for line parsing using explicit `split(' ')` parity.
- [x] Implement strict-mode behavior for malformed `PlaySound` lines (missing arg should surface parity failure behavior).
- [x] Implement safe-mode behavior for malformed lines (return typed error; do not kill processing).
- [x] Add `src/sugar/stdout-protocol.test.ts` covering:
- [x] normal `PlaySound Name`
- [x] repeated spaces creating empty tokens
- [x] missing argument behavior in strict and safe modes
- [x] Ensure sound hook receives lowercased sound name for wav mapping parity.
- [ ] Checkpoint: stdout protocol tests pass in both modes.

## Phase 4: TTY Command Buffer + Channel

- [x] Create `src/tty/command-buffer.ts` to assemble multiline commands (`Tcl_AssembleCmd` equivalent behavior target).
- [x] Add `src/tty/command-buffer.test.ts` for continuation and completion behavior.
- [x] Create `src/tty/stdin-channel.ts` implementing `StdinProc` parity:
- [x] EOF + no partial + tty => trigger exit callback
- [x] EOF + no partial + non-tty => disable further reads
- [x] EOF + partial => treat as empty line and continue
- [x] print result when `(result != ok) || sim_tty`
- [ ] emit prompt exactly `sim:\n` after each command in tty mode
- [ ] emit initial prompt exactly `sim:\n` when tty channel starts
- [ ] Add `src/tty/stdin-channel.test.ts` for all branches above.
- [ ] Checkpoint: tty tests pass with deterministic prompt transcript snapshots.

## Phase 5: NET UDP Hooks

- [ ] Create `src/net/udp-hooks.ts` implementing `listenTo(port)` parity interface.
- [ ] Implement `hearFrom(fileSock)` parsing with exact `file<sock>` prefix requirement.
- [ ] Implement nonblocking receive loop parity (continue on EINTR, stop on EWOULDBLOCK).
- [ ] Emit callback string exactly: `HandlePacket <sock> {<ip>} {<byte0> <byte1> ...}`.
- [ ] Format each byte as `%3d ` equivalent (fixed width + trailing space).
- [ ] Implement strict mode port/address quirks; safe mode fixes (initialized addr length + normalized port handling).
- [ ] Add `src/net/udp-hooks.test.ts` for parser and formatter exactness.
- [ ] Checkpoint: UDP tests pass for strict and safe modes.

## Phase 6: Node Adapters

- [ ] Create `src/adapters/node-process.ts` for stdin/stdout wiring abstractions.
- [ ] Create `src/adapters/node-udp.ts` for UDP socket abstraction.
- [ ] Add adapter tests with fakes/mocks only (no real network required).
- [ ] Checkpoint: adapter tests pass and no direct Node dependency leaks outside adapters.

## Phase 7: Runtime Orchestration

- [ ] Wire Sugar, TTY, and NET modules into `createIntegrationRuntime`.
- [ ] Expose runtime API methods:
- [ ] `handleInputLine(line)`
- [ ] `handleOutputLine(line)`
- [ ] `share()`, `focusIn()`, `focusOut()`, `quit()`
- [ ] `buddyAppeared(buddy)`, `buddyDisappeared(buddy)`
- [ ] `listenTo(port)`, `hearFrom(fileSock)`
- [ ] Add `src/runtime.integration.test.ts` for mixed-feature scenarios:
- [ ] sugar-only
- [ ] tty-only
- [ ] net-only
- [ ] sugar+tty+net
- [ ] Checkpoint: integration tests pass with deterministic event logs.

## Phase 8: Cross-Package Contract

- [ ] Add `INTEGRATION-CONTRACT.md` describing ownership boundaries with `@city/sim-core`, `@city/sim-ui`, and `@city/sim-io`.
- [ ] Document how `makeSound`/message/UI hook pathways are connected without duplicating sim-core responsibilities.
- [ ] Add compile-time contract test(s) that validate integration runtime adapters can consume sim-core-style hooks.
- [ ] Checkpoint: docs and contract tests pass.

## Final Acceptance Checklist

- [ ] `@city/sim-integration` is no longer a stub and exports a working runtime.
- [ ] Sugar command transport is parity-tested.
- [ ] TTY stdin behavior matches expected prompt/eval flow.
- [ ] UDP hook behavior and callback formatting are parity-tested.
- [ ] strict vs safe behavior differences are documented and tested.
- [ ] Run full required checks:
- [ ] `pnpm typecheck`
- [ ] `pnpm lint`
- [ ] `pnpm format`

## Execution Log
- [x] 2026-02-07: Implemented `src/types.ts` with parity-mode, feature-flag, Sugar buddy, TTY evaluator result, and UDP hook type contracts; added source-linked JSDoc to Micropolis integration files.
- [x] 2026-02-07: Added `src/runtime.ts` with `createIntegrationRuntime(options)` scaffold, strict-default mode and feature normalization, plus feature-gated Sugar/TTY/NET no-op runtime methods for phased wiring.
- [x] 2026-02-07: Updated `src/index.ts` to export the integration runtime and integration type surface as the package public API.
- [x] 2026-02-07: Added `src/runtime.test.ts` to verify runtime creation defaults (`strict`, all features off) and partial feature override normalization behavior.
- [x] 2026-02-07: Added `src/sugar/quote-tcl.ts` with a 1:1 `QuoteTCL` parity implementation (`"` escaped to `\\"` only) and source-mapped JSDoc to `ref/micropolis/micropolisactivity.py`.
- [x] 2026-02-07: Added `src/sugar/quote-tcl.test.ts` with Micropolis `QuoteTCL` parity coverage confirming quote-only escaping (no backslash/braces escaping).
- [x] 2026-02-07: Added `src/sugar/activity-bridge.ts` to serialize Sugar outbound commands with trailing `\n` (startup, nickname, share/quit/focus, buddy add/del) including Micropolis-style buddy props/getter fallback ordering; added `src/sugar/activity-bridge.test.ts` for exact command output parity.
- [x] 2026-02-07: Completed Phase 2 task `SugarStartUp "<uri>"` by verifying/exporting `serializeSugarStartUpCommand` parity with `send_process('SugarStartUp "' + QuoteTCL(uri) + '"\n')` from `ref/micropolis/micropolisactivity.py`.
- [x] 2026-02-07: Completed Phase 2 task `SugarNickName "<nick>"` by verifying/exporting `serializeSugarNickNameCommand` parity with `send_process('SugarNickName "' + QuoteTCL(nick) + '"\n')` from `ref/micropolis/micropolisactivity.py`.
- [x] 2026-02-07: Completed Phase 2 task `SugarShare` by verifying/exporting `serializeSugarShareCommand` parity with `share()` -> `send_process('SugarShare\n')` from `ref/micropolis/micropolisactivity.py`.
- [x] 2026-02-07: Completed Phase 2 task `SugarQuit` by verifying/exporting `serializeSugarQuitCommand` parity with `quit_process()` -> `send_process('SugarQuit\n')` from `ref/micropolis/micropolisactivity.py`.
- [x] 2026-02-07: Completed Phase 2 task `SugarActivate` by verifying/exporting `serializeSugarActivateCommand` parity with `_focus_in_cb()` -> `send_process('SugarActivate\n')` from `ref/micropolis/micropolisactivity.py`.
- [x] 2026-02-07: Completed Phase 2 task `SugarDeactivate` by verifying/exporting `serializeSugarDeactivateCommand` parity with `_focus_out_cb()` -> `send_process('SugarDeactivate\n')` from `ref/micropolis/micropolisactivity.py`.
- [x] 2026-02-07: Completed Phase 2 task `SugarBuddyAdd "<key>" "<nick>" "<color>" "<address>"` by verifying `serializeSugarBuddyAddCommand` emits `SugarBuddyAdd "<key>" "<nick>" "<color>" "<address>"\n` with Micropolis `_buddy_appeared_cb` field precedence (props first, fallback to getters) from `ref/micropolis/micropolisactivity.py`.
- [x] 2026-02-07: Completed Phase 2 task `SugarBuddyDel "<key>" "<nick>" "<color>" "<address>"` by verifying `serializeSugarBuddyDelCommand` emits `SugarBuddyDel "<key>" "<nick>" "<color>" "<address>"\n` with Micropolis `_buddy_disappeared_cb` field precedence (props first, fallback to getters) from `ref/micropolis/micropolisactivity.py`.
- [x] 2026-02-07: Completed Phase 2 task `Add src/sugar/activity-bridge.test.ts covering exact string output and buddy fallback field ordering` by validating exact outbound command strings (including `\n` and `QuoteTCL` quoting) and full getter-fallback call ordering parity against `ref/micropolis/micropolisactivity.py`.
- [x] 2026-02-07: Completed Phase 3 task `Create src/sugar/stdout-protocol.ts for line parsing using explicit split(' ') parity` by adding a parity tokenizer/line parser that mirrors `line.strip().split(' ')` semantics from `ref/micropolis/micropolisactivity.py` and `ref/micropolis/spec/integration/SPEC.md`.
- [x] 2026-02-07: Completed Phase 3 task `Implement strict-mode behavior for malformed PlaySound lines` by adding `getPlaySoundToken` in `src/sugar/stdout-protocol.ts` so strict mode throws on missing `words[1]`, matching the parity failure surface described for `_stdout_thread_function` in `ref/micropolis/micropolisactivity.py` and `ref/micropolis/spec/integration/SPEC.md`.
- [x] 2026-02-07: Repaired strict-mode `PlaySound` malformed-line parity by changing the thrown strict error to `RangeError('list index out of range')`, preserving fatal failure semantics while matching Python `IndexError` text from `self.play_sound(words[1])` in `ref/micropolis/micropolisactivity.py`.
- [x] 2026-02-07: Repaired strict-mode `PlaySound` parity surfacing in `src/runtime.ts` by routing `handleOutputLine` through `parseSugarStdoutLine` + `getPlaySoundToken`, so malformed `PlaySound` lines throw through runtime handling like `_stdout_thread_function` does in `ref/micropolis/micropolisactivity.py`; added `src/runtime.test.ts` coverage for strict malformed-line failure and valid token dispatch.
- [x] 2026-02-07: Implemented safe-mode malformed `PlaySound` handling by returning typed `SugarStdoutMalformedLineError` (`PLAY_SOUND_MISSING_ARGUMENT`) from `getPlaySoundToken` instead of throwing, and updated runtime handling/tests so malformed lines are non-fatal and later stdout lines continue processing.
- [x] 2026-02-07: Completed Phase 3 task `Add src/sugar/stdout-protocol.test.ts covering` by adding parity tests for normal `PlaySound Name`, explicit-space empty-token behavior, strict/safe missing-argument handling, and lowercase sound-hook delivery parity with `play_sound(name.lower() + '.wav')` from `ref/micropolis/micropolisactivity.py`.
- [x] 2026-02-07: Checked Phase 3 task `normal PlaySound Name` after verifying `parseSugarStdoutLine('PlaySound Bulldozer')` and `getPlaySoundToken(..., 'strict')` parity with `_stdout_thread_function` (`words = line.strip().split(' ')`; `self.play_sound(words[1])`) in `ref/micropolis/micropolisactivity.py`.
- [x] 2026-02-07: Checked Phase 3 task `repeated spaces creating empty tokens` after verifying `parseSugarStdoutLine('PlaySound   Bulldozer')` preserves explicit-space empty tokens (`['PlaySound', '', '', 'Bulldozer']`) and `getPlaySoundToken(..., 'strict')` returns `words[1] === ''`, matching `line.strip().split(' ')` parity in `ref/micropolis/micropolisactivity.py`.
- [x] 2026-02-07: Checked Phase 3 task `missing argument behavior in strict and safe modes` by confirming strict mode throws `RangeError('list index out of range')` (Python `IndexError` parity for `words[1]`) and safe mode returns `SugarStdoutMalformedLineError('PLAY_SOUND_MISSING_ARGUMENT')` non-fatally in `src/sugar/stdout-protocol.ts` and `src/runtime.ts`, mirroring/parity-hardening `_stdout_thread_function` in `ref/micropolis/micropolisactivity.py`.
- [x] 2026-02-07: Checked Phase 3 task `Ensure sound hook receives lowercased sound name for wav mapping parity` by confirming `createIntegrationRuntime(...).handleOutputLine('PlaySound Bulldozer')` delivers `bulldozer` to `onSoundToken`, matching `play_sound(name.lower() + '.wav')` behavior in `ref/micropolis/micropolisactivity.py`; validated with `packages/sim-integration/src/runtime.test.ts` and `packages/sim-integration/src/sugar/stdout-protocol.test.ts`.
- [x] 2026-02-07: Completed Phase 4 task `Create src/tty/command-buffer.ts` by adding `TtyCommandBuffer.assemble(string)` as a parity-first port of `Tcl_AssembleCmd` command assembly (`ref/micropolis/src/tcl/tclassem.c`) with Tcl word parsing/backslash continuation behavior derived from `TclWordEnd`/`QuoteEnd`/`VarNameEnd`/`Tcl_Backslash` (`ref/micropolis/src/tcl/tclparse.c`) for `StdinProc` multiline input handling in `ref/micropolis/src/sim/w_tk.c`.
- [x] 2026-02-07: Completed Phase 4 task `Add src/tty/command-buffer.test.ts for continuation and completion behavior` by adding parity tests for brace and backslash-newline continuations plus zero-length forced completion, matching `Tcl_AssembleCmd` command assembly behavior in `ref/micropolis/src/tcl/tclassem.c` and `StdinProc` usage in `ref/micropolis/src/sim/w_tk.c`.
- [x] 2026-02-07: Completed Phase 4 task `Create src/tty/stdin-channel.ts implementing StdinProc parity` by adding `StdinChannel` + `TTY_PROMPT` in `packages/sim-integration/src/tty/stdin-channel.ts` to mirror `ref/micropolis/src/sim/w_tk.c` `StdinProc`/startup semantics (EOF handling with `gotPartial`, tty vs non-tty read shutdown, `Tcl_AssembleCmd`-style buffering, `(result != TCL_OK) || sim_tty` result printing, and exact `sim:\n` prompt emission).
- [x] 2026-02-07: Completed Phase 4 task `EOF + no partial + tty => trigger exit callback` by adding `src/tty/stdin-channel.test.ts` coverage that validates `consumeLine(null)` calls `onExit(0)` when `isTty` is true and no partial command is buffered, matching `if (!gotPartial && sim_tty) sim_exit(0);` in `ref/micropolis/src/sim/w_tk.c`.
- [x] 2026-02-07: Completed Phase 4 task `EOF + no partial + non-tty => disable further reads` by adding `src/tty/stdin-channel.test.ts` coverage that validates `consumeLine(null)` in non-tty mode calls the read-disable hook, flips `isReadEnabled()` false, and ignores subsequent input, matching `Tk_DeleteFileHandler(0)` behavior in `StdinProc` from `ref/micropolis/src/sim/w_tk.c`.
- [x] 2026-02-07: Completed Phase 4 task `EOF + partial => treat as empty line and continue` by adding `src/tty/stdin-channel.test.ts` coverage that validates `consumeLine(null)` after a partial line evaluates the buffered command (forced completion via empty input) instead of exiting/disabling reads, matching `line[0] = 0;` + `Tcl_AssembleCmd(buffer, line)` + eval flow in `StdinProc` from `ref/micropolis/src/sim/w_tk.c` and empty-string forced completion semantics in `ref/micropolis/src/tcl/tclassem.c`.
- [x] 2026-02-07: Completed Phase 4 task `print result when (result != ok) || sim_tty` by validating `StdinChannel.consumeLine` result-output gating against `StdinProc` in `ref/micropolis/src/sim/w_tk.c` (`if (*tk_mainInterp->result != 0) { if ((result != TCL_OK) || sim_tty) printf("%s\\n", tk_mainInterp->result); }`) via non-tty success suppression, non-tty error printing, and tty success printing tests in `src/tty/stdin-channel.test.ts`.
