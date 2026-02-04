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
1. Map flag parity (C-style `NewMapFlags` updates).
Implement the missing `NewMapFlags` updates in PTL, Crime, and PopDen to match `ref/micropolis/src/sim/s_scan.c` (PLMAP/LVMAP, CRMAP/POMAP, PDMAP/RGMAP, DYMAP). Ensure phase 10/11 marking remains intact.

2. Emulate C bug in `VoteProblems`.
Replicate the out-of-bounds access behavior from `ref/micropolis/src/sim/s_eval.c` (the `x > PROBNUM` loop bound). Use explicit, well-annotated code to preserve the C bug, with comments pointing to `s_eval.c` and `sim.h` `PROBNUM`.

3. Emulate the zoning traffic quirk, but document it for potential removal.
Retain the simplified zone traffic gate behavior as a deliberate non-C quirk for now, with thorough documentation in `packages/sim-core/src/systems/zones.ts` explaining the difference from `MakeTraf` in `ref/micropolis/src/sim/s_traf.c` and why it is preserved. Make the full `MakeTraf` path easy to enable later (explicit switch or injection), and note the intended future cleanup.

4. Implement full `DoUpdateHeads`.
Complete the `DoUpdateHeads` port in `packages/sim-core/src/systems/date-time.ts` to include demand valves, funds, options, and message-port handling consistent with `ref/micropolis/src/sim/w_update.c`.

5. Budget message behavior.
Match C by clearing the message port before sending budget warning message 29, mirroring `ref/micropolis/src/sim/w_budget.c`.

6. UI/state fields and hook notes (no new fields yet).
Do not add new core state fields or hooks at this time. Instead, add a note in `packages/sim-ui` describing the missing `DoUpdateHeads`-related hooks and state (LastR/LastC/LastI, funds updates, options updates, message port handling), referencing `ref/micropolis/src/sim/w_update.c`.

7. Initialization fix.
Reset `PowerStackNum` in `initSimMemory` to mirror `ref/micropolis/src/sim/s_sim.c` before `DoPowerScan`.

8. Integer width behavior.
Leave JS number behavior unchanged (no 16-bit wrapping). Document the intentional divergence and the reasoning in code comments where most impactful.

Testing Plan
- Add targeted unit tests for map-flag updates, `VoteProblems` bug emulation, and the budget warning message path.
- Extend e2e fixtures as needed once the behavior changes land, ensuring any magic numbers are tied to C sources in comments.

Notes
This plan intentionally preserves the simplified zoning traffic quirk for now (see item 3) even though it diverges from C. All such divergences must be explicitly documented in code with pointers to C sources.
