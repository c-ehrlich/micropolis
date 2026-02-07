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
- [ ] `SugarQuit`
- [ ] `SugarActivate`
- [ ] `SugarDeactivate`
- [ ] `SugarBuddyAdd "<key>" "<nick>" "<color>" "<address>"`
- [ ] `SugarBuddyDel "<key>" "<nick>" "<color>" "<address>"`
- [ ] Add `src/sugar/activity-bridge.test.ts` covering exact string output and buddy fallback field ordering.
- [ ] Checkpoint: all Sugar outbound tests pass.

## Phase 3: Sugar Stdout Protocol (`PlaySound`)

- [ ] Create `src/sugar/stdout-protocol.ts` for line parsing using explicit `split(' ')` parity.
- [ ] Implement strict-mode behavior for malformed `PlaySound` lines (missing arg should surface parity failure behavior).
- [ ] Implement safe-mode behavior for malformed lines (return typed error; do not kill processing).
- [ ] Add `src/sugar/stdout-protocol.test.ts` covering:
- [ ] normal `PlaySound Name`
- [ ] repeated spaces creating empty tokens
- [ ] missing argument behavior in strict and safe modes
- [ ] Ensure sound hook receives lowercased sound name for wav mapping parity.
- [ ] Checkpoint: stdout protocol tests pass in both modes.

## Phase 4: TTY Command Buffer + Channel

- [ ] Create `src/tty/command-buffer.ts` to assemble multiline commands (`Tcl_AssembleCmd` equivalent behavior target).
- [ ] Add `src/tty/command-buffer.test.ts` for continuation and completion behavior.
- [ ] Create `src/tty/stdin-channel.ts` implementing `StdinProc` parity:
- [ ] EOF + no partial + tty => trigger exit callback
- [ ] EOF + no partial + non-tty => disable further reads
- [ ] EOF + partial => treat as empty line and continue
- [ ] print result when `(result != ok) || sim_tty`
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
