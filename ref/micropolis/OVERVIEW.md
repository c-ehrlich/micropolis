## Spec Coverage Checklist

Status note: this checklist tracks the TypeScript port status in this repository (code is source of truth).

- [x] Core simulation (`spec/core/SPEC.md`)
- [ ] UI/rendering/tools/sprites (`spec/ui/SPEC.md`) (core has UI-adjacent hooks/heads logic; `packages/sim-ui` remains a stub)
- [x] Terrain generation (`spec/terrain/SPEC.md`) (non-UI `GenerateMap` pipeline in `packages/sim-core/src/terrain`)
- [x] Persistence & scenarios (`spec/persistence/SPEC.md`) (`packages/sim-core` `.cty` + `packages/sim-io` load/save/scenario orchestration and parity tests)
- [ ] Resources/assets (`spec/resources/SPEC.md`)
- [ ] Scripting interface & Tcl commands (`spec/scripting/SPEC.md`)
- [ ] Platform integration (Sugar, networking) (`spec/integration/SPEC.md`)

# Micropolis Specification Overview

This repository is the classic Micropolis (SimCity) engine plus its Tk/Tcl UI and assets. This spec is organized as logical packages (not strict directory boundaries) so it can drive a re-implementation in a modern stack.

Specs live under `spec/<package>/SPEC.md`.

## Package Map

- `spec/core/SPEC.md`
  - Simulation core: map/tile model, simulation tick, zoning, growth, power, traffic, pollution/crime/land value, budgets, disasters, evaluation, history graphs, and city-wide state.
  - Source focus: `src/sim/s_*.c`, `src/sim/headers/sim.h`, `src/sim/sim.c`, `src/sim/s_alloc.c`.

- `spec/ui/SPEC.md`
  - Rendering, views, tools, sprites, overlays, graphs, date display, and UI update flow.
  - Source focus: `src/sim/w_*.c`, `src/sim/g_*.c`, `src/sim/headers/view.h`.

- `spec/terrain/SPEC.md`
  - Terrain/map generation and smoothing rules.
  - Source focus: `src/sim/s_gen.c`, `src/sim/terrain/*`.

- `spec/persistence/SPEC.md`
  - City file format, scenario loading, and save/load rules.
  - Source focus: `src/sim/s_fileio.c`, `cities/*`, `res/snro.*`.

- `spec/resources/SPEC.md`
  - Tileset, sprites, strings, sounds, and other runtime resources.
  - Source focus: `res/*`, `images/*`, `manual/*`.

- `spec/scripting/SPEC.md`
  - Tcl/Tk scripts and the C <-> script interface (commands/events).
  - Source focus: `res/*.tcl`, `src/sim/w_sim.c`, `src/sim/w_*`.

- `spec/integration/SPEC.md`
  - Platform glue (Sugar activity wrapper, optional networking hooks).
  - Source focus: `micropolisactivity.py`, `activity/*`, `src/sim/w_net.c`.

## High-Level Runtime Flow

1. Bootstrap sets resource paths, initializes simulation globals, and creates UI windows.
2. Tcl/Tk scripts create widgets and invoke C-level commands to start the simulation.
3. The simulation tick (`SimFrame -> Simulate`) advances time and runs subsystem passes.
4. Subsystems update the map and derived data layers; flags signal UI to redraw.
5. UI uses map + derived layers to render tiles, overlays, graphs, and sprites.
6. User tools mutate the map and funds; those changes flow back into the sim tick.
7. Save/load and scenarios serialize/restore core state + map + histories.

## Notes on Granularity

These specs aim to preserve behavior and data compatibility, not the legacy build system or Tk/X11 details. The UI spec emphasizes observable behavior and data contracts rather than windowing APIs.
