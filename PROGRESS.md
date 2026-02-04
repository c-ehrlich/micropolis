## Fully implemented (in packages/sim-core)

- ref/micropolis/spec/core/SPEC.md (line 1) — core sim loop + subsystems are implemented across packages/sim-core/src/sim/simulate.ts (line 1) and packages/sim-core/src/systems/*.ts (line 1) (power/zones/traffic/ptl/crime/pop-density/fire/budget/census/eval/messages/disasters/valves/date-time/heat).

## Partially implemented

- ref/micropolis/spec/persistence/SPEC.md (line 1) — .cty binary format + meta packing/unpacking are implemented (cty.ts (line 1), cty-state.ts (line 1)), but scenario loading (snro.*) and the full UI-wired Save/Load flows from the spec are not.
- ref/micropolis/spec/ui/SPEC.md (line 1) — we have substantial “UI-adjacent” logic in sim-core (tool application + costs/sizes: tool-actions.ts (line 1); sprite/object runtime sim: realtime.ts (line 1)), but not the actual rendering/views/overlays/graphs/widgets described by the spec.

## Not implemented (in packages/sim-core)

- ref/micropolis/spec/terrain/SPEC.md — no terrain generation pipeline (MakeIsland/DoRivers/DoTrees, etc.).
- ref/micropolis/spec/resources/SPEC.md — no resource/asset loading (string tables, tilesets, sound files).
- ref/micropolis/spec/scripting/SPEC.md — no Tcl/Tk command API layer.
- ref/micropolis/spec/integration/SPEC.md — no Sugar/networking/stdin integration.

This matches the high-level checklist in OVERVIEW.md (line 1) (core checked; the others not).
