# Headless C Oracle Plan (Non-UI Parity)

Date: 2026-02-06

Goal
- Parity-test as much of Micropolis simulation behavior as possible against C, excluding UI/rendering stack behavior that is intentionally free to diverge.

Primary C references
- `ref/micropolis/src/sim/s_sim.c`
- `ref/micropolis/src/sim/s_scan.c`
- `ref/micropolis/src/sim/s_traf.c`
- `ref/micropolis/src/sim/s_power.c`
- `ref/micropolis/src/sim/s_zone.c`
- `ref/micropolis/src/sim/s_msg.c`
- `ref/micropolis/src/sim/s_disast.c`
- `ref/micropolis/src/sim/w_update.c` (logic only, UI effects stubbed)
- `ref/micropolis/src/sim/w_stubs.c` (funds/message side effects)
- `ref/micropolis/src/sim/s_fileio.c` (load/save behaviors used by core)

## Scope and Non-Goals

In scope
- Deterministic simulation logic and state transitions.
- Map layers, derived layers, scalar state, and message/scenario state.
- Tool semantics and phase/tick scheduling behavior.

Out of scope
- Tcl/Tk/X11 rendering, editor widgets, sound UI commands, and event-loop behavior.
- Pixel output parity, window invalidation internals, and UI timing artifacts.

## Strategy

Use a headless C oracle binary as the reference engine:
- Build a standalone binary in `packages/micropolis-c-harness`.
- Call it from TS parity tests (like terrain parity), but keep it generic for all systems.
- Compare TS and C at deterministic checkpoints (op-level, phase-level, tick-level, replay-level).

This extends the current terrain harness pattern (`packages/micropolis-c-harness/terrain/terrain_harness.c`) to core simulation behavior.

## Architecture

### 1) Oracle binary
- Name: `micropolis-core-oracle`.
- Location: `packages/micropolis-c-harness/build/core/micropolis-core-oracle`.
- Build via script: `packages/micropolis-c-harness/scripts/build-core-oracle.mjs`.

### 2) Headless shim layer
- Provide C stubs for UI-linked functions:
  - `Eval`, `UISet*`, graph/editor invalidation, sound callbacks, Tk/X callbacks.
- Keep simulation-visible side effects:
  - message port writes, funds dirty/update flags, scenario counters, sprite hooks (either deterministic stubs or minimal ports).
- Rule: if a callback mutates simulation state in C, it must be preserved in headless mode.

### 3) Oracle command contract
- `init-new-city` (with seed + options)
- `load-cty` (from bytes/path)
- `apply-tool` (tool id + coords + options)
- `step-phase` (one mod16 phase)
- `step-tick` (16 phases)
- `step-realtime` (deterministic realtime ticks; no UI loop)
- `snapshot` (full selected state)

Initial implementation can be CLI-per-invocation; move to a persistent process mode if startup cost is high.

### 4) Snapshot contract
- Map and derived arrays emitted as little-endian typed buffers with fixed order.
- Scalar block emitted as a versioned record (JSON or binary struct with explicit field list).
- Include parity-critical state:
  - clocks/counters, valves, funds/tax, population, flags, message/scenario fields, power/traffic maxima.
- Version snapshots to allow additive fields without breaking older tests.

## Determinism Requirements

- No wall-clock sources in oracle path.
- Seed RNG explicitly at each test case.
- No nondeterministic IO.
- Disable/replace random UI-triggered callbacks that do not affect simulation state.
- Real-time stepping must be deterministic and command-driven.

## Test Topology

Keep current split:
- `pnpm test`: no C build/exec.
- `pnpm test-parity`: C oracle build/exec enabled.

Add parity layers:
1. Op-level parity: isolated subsystem operations with small state.
2. Phase-level parity: compare after each mod16 phase.
3. Tick-level parity: compare after each full tick.
4. Replay parity: load fixture city + action log + N ticks with checkpoints.

Comparison policy:
- Exact equality for integer state and map words.
- Any intentional divergence must be documented in `PLAN-C-PARITY.md` and excluded explicitly in comparator rules.

## Rollout Plan

### Phase 0: Core oracle skeleton
- [x] Create `micropolis-core-oracle` package scripts and build wiring.
- [x] Add headless stub layer for UI/Tk/X entry points.
- [x] Implement `init-new-city`, `step-phase`, `snapshot`.
- [x] Add TS wrapper `@city/micropolis-c-harness/core-parity`.
- Exit criteria:
  - Oracle builds on dev + CI.
  - TS test can run one phase and read a valid snapshot.

### Phase 1: First subsystem parity (recommended next: Traffic)
- [x] Add focused oracle commands/snapshots needed for traffic (`MakeTraf` path, `TrfDensity`, `TrafMaxX/Y`, relevant map region).
- [x] Add parity tests that compare TS and C traffic results from identical seeds and maps.
- [x] Wire zoning traffic path to full `MakeTraf` parity mode and de-risk removal of simplified gate.
- Exit criteria:
  - Known traffic scenarios are byte-equal between TS and C.
  - Existing intentional traffic divergence can be removed or reduced with confidence.

### Phase 2: Power + zone interaction
- [ ] Add power scan + zone power-bit parity checkpoints.
- [ ] Compare `DoPowerScan` outputs and zone powered/unpowered counters under tick progression.
- Exit criteria:
  - Power map and powered zone effects match under replay checkpoints.

### Phase 3: Scan-derived systems
- [ ] PTL, crime, pop density, fire coverage parity checkpoints by phase.
- [ ] Compare map flags and key maxima/averages.
- Exit criteria:
  - Phase 12-15 snapshots match for deterministic fixtures.

### Phase 4: Messages, budget, scenarios, disasters
- [ ] Add message-port and date/update behavior parity checks.
- [ ] Add budget and scenario countdown parity checkpoints.
- [ ] Add disaster deterministic tests under fixed seeds.
- Exit criteria:
  - Multi-week replay parity passes across representative fixtures.

### Phase 5: Replay parity suite
- [ ] Define canonical `.cty` + action-log fixtures.
- [ ] Add checkpoint cadence (e.g., every 1/4/16 ticks).
- [ ] Gate heavy runs under `CITY_TEST_PARITY_*` env knobs.
- Exit criteria:
  - Stable replay parity hash/checkpoint suite in CI parity job.

## Risks and Mitigations

Risk: tight coupling to `sim.h`/X11/Tcl.
- Mitigation: isolate with headless stubs and a curated compile set; do not compile UI modules.

Risk: harness drift from reference C.
- Mitigation: prefer compiling lightly adapted reference C units over re-porting logic by hand; keep adaptation minimal and documented.

Risk: parity runtime cost.
- Mitigation: env-gated suites, batch commands, and optional persistent oracle process.

Risk: hidden intentional divergences.
- Mitigation: maintain an explicit divergence registry in `PLAN-C-PARITY.md`, enforced by comparator filters.

## Recommended Next Subsystem to Port/Parity-Harden

Traffic (`s_traf.c`) is the best next target.

Why traffic next
- It is already called out as an intentional divergence risk in zoning (`packages/sim-core/src/systems/zones.ts` simplified gate vs full `MakeTraf`).
- It is deterministic but branchy (direction choice, stack/backtracking, density writes), so C-oracle parity gives high confidence quickly.
- It has high downstream impact on growth/evaluation and therefore replay stability.
- The TS side already has a full `MakeTraf` port path (`packages/sim-core/src/systems/traffic.ts`), so parity work can start immediately without first writing large new TS functionality.

Suggested immediate task after this plan
- Add a traffic-focused oracle command and first parity suite comparing:
  - `MakeTraf` result code (`-1/0/1`)
  - `TrfDensity` deltas
  - `TrafMaxX/TrafMaxY`
  - any cop destination updates exposed by hooks/state.
