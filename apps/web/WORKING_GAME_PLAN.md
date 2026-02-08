# Browser Working Game Plan (`apps/web`)

## Purpose

Define the shortest path from the current `apps/web` shell to a playable browser game, using existing `sim-core` and `sim-io` functionality.

This plan is implementation-focused and complements the higher-level host/bridge strategy in `/Users/cje/dev/city/UI_BRIDGE_PLAN.md`.

## Current Baseline

- `apps/web` is a minimal TanStack/Vite shell with no game runtime.
- `sim-core` has broad simulation coverage and parity tests.
- `sim-io` already supports C-like city/scenario load/save orchestration.
- `sim-ui` package is still effectively a stub.

## Working Game Definition (MVP)

A user can:

1. Start a city (generated map).
2. Run/pause simulation and change speed.
3. Place core tools (at minimum: road, rail, wire, bulldoze, residential, commercial, industrial).
4. See map updates, funds, date, demand, and messages.
5. Save/load city data in-browser.

## Phase Plan

## Phase 1: Runtime Wiring (Core Loop + Systems)

Scope:

- Build a web runtime adapter in `apps/web` that composes full sim systems into `runSimLoop`.
- Initialize and retain:
  - `SimState` (`createSimState`)
  - `SimContext` (`createSimContext`)
  - tool context (`createToolContext`)
- Compose phase handlers from `sim-core` systems:
  - map scan handlers (zones/roads/rail/bridges/disasters/rad/flood/fire)
  - phase scans (`doPowerScan`, `ptlScan`, `crimeScan`, `popDenScan`, `fireAnalysis`)
  - economy/census/evaluation/date-time systems
- Ensure initialization order mirrors core expectations (`initWillStuff` / `doSimInit` style setup).

Acceptance:

- Simulation ticks consistently without throwing.
- Map store and scalar state advance over time.

Estimate: 2-4 days.

## Phase 2: Minimal Playable UI

Scope:

- Add a canvas map renderer (debug color mapping first, no final art dependency).
- Add toolbar for core tools and click/drag placement.
- Add sim controls (pause/play, speed).
- Wire hook outputs into visible HUD:
  - funds/date/demand/options/messages via `uiSet` and `sendMes`/`sendMesAt`.
- Keep tool funds and sim funds synchronized after each action.

Acceptance:

- User can build and observe city evolution live in browser.
- HUD updates correctly with simulation.

Estimate: 3-5 days.

## Phase 3: New City + Save/Load + Scenario Entry

Scope:

- New city flow via terrain generation/reset.
- Load `.cty` and scenario bytes using `@city/sim-io`.
- Save/export city bytes from browser.
- Add minimal UI for scenario selection and file import/export.

Acceptance:

- Round-trip save/load works in browser.
- Scenario load produces expected start state and runs.

Estimate: 2-4 days.

## Phase 4: Realtime Objects and Feedback

Scope:

- Integrate realtime object loop and hooks (train/ship/plane/copter/monster/tornado/explosion paths).
- Render simple sprite markers first (can be non-final art).
- Optional initial sound hooks (basic on/off and event routing).

Acceptance:

- Realtime entities appear and update during play.
- Disaster/object events are visible to user.

Estimate: 3-5 days.

## Phase 5: Stability + Performance + UX Floor

Scope:

- Redraw throttling/dirty invalidation using `NewMap` + `NewMapFlags`.
- Basic camera/pan/zoom and minimap-level usability.
- Add integration tests around:
  - runtime boot
  - tool placement and funds coupling
  - save/load smoke

Acceptance:

- Session remains stable for extended play.
- Interaction remains responsive on desktop browsers.

Estimate: 3-5 days.

## Key Risks and Mitigations

1. Risk: runtime composition drift from C order.
Mitigation: keep an explicit system-composition module with comments mapping each call to source C file behavior.

2. Risk: divergence between `ToolContext.funds` and `SimState.TotalFunds`.
Mitigation: single synchronization path after tool actions; add assertions and tests.

3. Risk: map redraw cost at full 120x100 updates each frame.
Mitigation: start full redraw for correctness, then switch to dirty-flag invalidation.

4. Risk: UI hooks called but not surfaced consistently.
Mitigation: central hook reducer in web app, with state snapshot dev panel while implementing.

## Out of Scope for MVP

- 1:1 Micropolis Tk/X11 UI reproduction.
- Athena-style advanced UI/animation polish.
- Multiplayer host/bridge rollout.

## Suggested Implementation Order

1. Runtime composition module.
2. Canvas renderer + tool placement.
3. HUD/messages.
4. Save/load/scenarios.
5. Realtime objects + perf pass.
