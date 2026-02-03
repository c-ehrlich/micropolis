# Sim Core Systems Checklist (Spec-Complete)

Purpose

- Convert PLAN-SYSTEMS into a concrete execution checklist.
- Each item includes references and success criteria.
- Test placement rule: `foo.ts` and `foo.test.ts` should be colocated. Only tests without an obvious home live in a root tests directory.

Legend

- References: where to look for behavior/spec details.
- Success criteria: tests + observable conditions to confirm completion.

---

- [x] 0. Foundations (SimState + SimContext + hooks)
  - References:
    - Plan: `packages/sim-core/PLAN-SYSTEMS.md` (Architecture targets, SimState/SimContext)
    - Spec: `ref/micropolis/spec/core/SPEC.md` (Global simulation state; External Hooks)
    - Micropolis: `ref/micropolis/src/sim/sim.c`, `ref/micropolis/src/sim/s_init.c`, `ref/micropolis/src/sim/s_sim.c`, `ref/micropolis/src/sim/w_stubs.c`
  - [x] Success criteria:
    - [x] SimState includes all SPEC fields (time, economy, population, valves, evaluation, disasters, city center, history ramps).
    - [x] SimContext contains MapStore + RNG + external hooks.
    - [x] Hooks interface exists with stubs wired through the core.
    - [x] Unit test ensures SimState defaults + hook calls are deterministic.

---

- [x] 1. Initialization and Reset
  - References:
    - Plan: PLAN-SYSTEMS (Init/Reset section)
    - Spec: SPEC “Initialization and Reset”
    - Micropolis: `s_init.c`, `s_alloc.c`, `sim.c`
  - [x] Success criteria:
    - [x] initMapArrays/InitWillStuff/DoSimInit/InitSimMemory/SimLoadInit/DoNilPower implemented.
    - [x] Loaded city path mirrors spec (ranges clamped, GameLevel set, AvCityTax derived).
    - [x] Tests: new city init, load init, and DoNilPower produce expected state hashes.

---

## 2) Simulate(mod16) Dispatcher + Phase Gates

- [x] References:
  - [x] Plan: PLAN-SYSTEMS (Phase execution map)
  - [x] Spec: SPEC “Simulation Time and Scheduling”
  - [x] Micropolis: `s_sim.c`, `sim.c`
- [x] Success criteria:
  - [x] Fcycle/Scycle/Spdcycle implemented with correct modulo behavior.
  - [x] Speed tables (SpdPwr/Ptl/Cri/Pop/Fir) used.
  - [x] All 16 cases dispatch correctly.
  - [x] Tests: phase-order test validates only expected systems run in each phase.

---

- [x] 3. MapScan Core + Tile Dispatch
  - References:
    - Plan: PLAN-SYSTEMS (Map Scan Pass)
    - Spec: SPEC “Map Scan Pass”
    - Micropolis: `s_scan.c`
  - [x] Success criteria:
    - [x] MapScan(x1,x2) iterates slice correctly and dispatches based on tile categories.
    - [x] NewPower + CONDBIT path calls SetZPower().
    - [x] Tests: slice boundaries, dispatch correctness, and no out-of-slice mutations.

---

- [x] 4. Roads (DoRoad)
  - References:
    - Plan: MapScan → Roads
    - Spec: “Road deterioration and traffic rendering (DoRoad)”
    - Micropolis: `s_scan.c`
  - [x] Success criteria:
    - [x] Deterioration rules match spec (RoadEffect, Random gates, rubble vs river).
    - [x] Bridge handling callout (DoBridge) integrated.
    - [x] Traffic density rendering matches DenTab/ANIMBIT logic.
    - [x] Tests: known map -> expected rewrites; deterministic under seed.

---

- [x] 5. Rails (DoRail)
  - References:
    - Plan: MapScan → Rails
    - Spec: “Rail deterioration (DoRail)”
    - Micropolis: `s_scan.c`
  - [x] Success criteria:
    - [x] Deterioration rules + GenerateTrain(x,y) hook (no-op acceptable with stub).
    - [x] Tests: deterministic decay + ensure rail count increments.

---

- [x] 6. Bridges (DoBridge)
  - References:
    - Plan: MapScan → Bridges
    - Spec: “Bridge open/close (DoBridge)”
    - Micropolis: `s_scan.c`
  - [x] Success criteria:
    - [x] Open/close patterns and boat distance logic integrated.
    - [x] Tests: bridge tiles flip based on stubbed boat distance + RNG.

---

## 7) Fire + Flood + Radiation (MapScan)

- [x] References:
  - [x] Plan: MapScan → Fire/Flood/Rad
  - [x] Spec: “DoFire”, “FireZone”, “DoRadTile”, “DoFlood”
  - [x] Micropolis: `s_scan.c`, `s_disast.c`
- [x] Success criteria:
  - [x] Fire spread/burnout matches rate rules and zone explosions.
  - [x] FireZone decreases ROG and sets BULLBIT in zone footprint.
  - [x] Radiation decays to dirt.
  - [x] Flood spread/decay matches FloodCnt behavior.
  - [x] Tests: controlled RNG yields expected tile transitions.

---

- 8. Power System
  - References:
    - Plan: Power System
    - Spec: “Power System”
    - Micropolis: `s_power.c`
  - [x] Success criteria:
    - [x] Power stack + PowerMap implemented.
    - [x] DoPowerScan BFS and capacity quirk implemented.
    - [x] SetZPower sets/clears PWRBIT correctly.
    - [x] Tests: known plant + wire map powers expected tiles; capacity limit triggers SendMes(40).

---

- 9. Zoning + Growth + ROG
  - References:
    - Plan: Zoning and Growth
    - Spec: “Zoning and Growth” (DoZone/DoResidential/DoCommercial/DoIndustrial etc.)
    - Micropolis: `s_zone.c`
  - [x] Success criteria:
    - [x] Zone dispatch works with powered/unpowered logic.
    - [x] Special zones (plant, nuclear, police, fire, stadium, airport, port) implemented.
    - [x] Growth/decay + plop logic matches spec.
    - [x] ROG updates (IncROG/DecROGMem) match limits.
    - [x] Tests: deterministic zone transitions under fixed seed.

---

- 10. Traffic System
  - References:
    - Plan: Traffic System
    - Spec: “Traffic System”
    - Micropolis: `s_traf.c`
  - [x] Success criteria:
    - [x] MakeTraf / FindPRoad / TryDrive / TryGo / DriveDone implemented.
    - [x] SetTrafMem updates TrfDensity and traffic maxima.
    - [x] DecTrafficMem decay matches spec.
    - [x] Tests: pathfinding determinism and density updates.

---

- [x] 11. PTL (Pollution/Terrain/Land Value)
  - References:
    - Plan: PTLScan
    - Spec: “Pollution, Terrain, Land Value”
    - Micropolis: `s_poll.c` / `s_ptl.c` (or equivalent)
  - [x] Success criteria:
    - [x] PTLScan fills tem/Qtem, LandValueMem, PollutionMem, averages + maxima.
    - [x] SmoothTerrain and smoothing passes implemented (with optional dithering flag).
    - [x] Tests: small map expected LV/pollution outputs.

---

- 12. Crime
  - References:
    - Plan: Crime
    - Spec: “Crime”
    - Micropolis: `s_crime.c`
  - [x] Success criteria:
    - [x] CrimeScan computes CrimeMem and averages; PoliceMapEffect snapshot.
    - [x] SmoothPSMap implemented.
    - [x] Tests: deterministic crime values with known inputs.

---

- 13. Pop Density + Commercial Rate
  - References:
    - Plan: PopDen
    - Spec: “Population Density and Commercial Rate”
    - Micropolis: `s_pop.c`
  - [x] Success criteria:
    - [x] PopDenScan, GetPDen, DistIntMarket implemented.
    - [x] City center derived from population weights.
    - [x] Tests: expected pop density and ComRate on tiny map.

---

- [x] 14. Fire Coverage (FireAnalysis)
  - References:
    - Plan: Fire Coverage
    - Spec: “Fire Coverage”
    - Micropolis: `s_fire.c`
  - [x] Success criteria:
    - [x] SmoothFSMap x3, FireRate copy, map flags set.
    - [x] Tests: FireStMap smoothing yields expected FireRate.

---

- [x] 15. Budget and Funding
  - References:
    - Plan: Budget and Funding
    - Spec: “Budget and Funding”
    - Micropolis: `s_budget.c`, `w_budget.c`
  - [x] Success criteria:
    - [x] CollectTax + DoBudgetNow + UpdateFundEffects implemented.
    - [x] Auto-budget logic + messages implemented.
    - [x] Tests: deterministic funds, effects scaling, and auto-budget behavior.

---

- 16. Census + Graphs
  - References:
    - Plan: Census and Graphs
    - Spec: “Census and Graphs”
    - Micropolis: `s_census.c` / `s_hist.c`
  - [x] Success criteria:
    - [x] ClearCensus, TakeCensus, Take2Census implemented (history shifts + ramps).
    - [x] NeedHosp/NeedChurch set correctly.
    - [x] Tests: history shift correctness and ramp updates.

---

- 17. Evaluation and Scoring
  - References:
    - Plan: Evaluation and Scoring
    - Spec: “Evaluation and Scoring”
    - Micropolis: `s_eval.c`
  - [ ] Success criteria:
    - [ ] CityEvaluation path matches spec.
    - [ ] All helper functions implemented (GetAssValue, DoPopNum, DoProblems, VoteProblems, GetScore, DoVotes, etc.).
    - [ ] Tests: expected scores and problem ordering for fixed inputs.

---

- 18. Messages and Scenarios
  - References:
    - Plan: Messages and Scenarios
    - Spec: “Messages and Scenarios”
    - Micropolis: `s_msg.c`, `s_scen.c`
  - [ ] Success criteria:
    - [ ] SendMessages, CheckGrowth, DoScenarioScore, SendMes implemented.
    - [ ] Scenario score countdown + thresholds match spec.
    - [ ] Tests: message emission for boundary conditions.

---

- [x] 19. Disasters
  - References:
    - Plan: Disasters
    - Spec: “Disasters”
    - Micropolis: `s_disast.c`
  - [x] Success criteria:
    - [x] DoDisasters + ScenarioDisaster implemented.
    - [x] MakeMeltdown/DoMeltdown/MakeEarthquake/SetFire/MakeFire/MakeFlood/DoFlood implemented.
    - [x] Tests: deterministic outcomes with fixed seed and stubs.

---

- 20. Demand Valves
  - References:
    - Plan: City Demand Valves
    - Spec: “City Demand Valves”
    - Micropolis: `s_valve.c`
  - [x] Success criteria:
    - [x] SetValves fully implemented (ratios, tax table, caps).
    - [x] Tests: valve outputs for known pop/tax conditions.

---

- 21. Date/Time Mapping
  - References:
    - Plan: Date and Time
    - Spec: “Date and Time”
    - Micropolis: `s_sim.c` / `w_sim.c`
  - [ ] Success criteria:
    - [ ] Year/month conversion from CityTime.
    - [ ] Year overflow behavior (reset + message).
    - [ ] Tests: known CityTime -> year/month outputs.

---

- 22. Heat Simulation (optional debug)
  - References:
    - Plan: Heat Simulation
    - Spec: “Heat Simulation (Optional Debug Mode)”
    - Micropolis: `sim.c`, `s_heat.c`
  - [ ] Success criteria:
    - [ ] Feature-flagged heat sim loop.
    - [ ] Tests: heat rules produce deterministic tile patterns for a small grid.

---

- 23. Integration Tests (end-to-end)
  - References:
    - Plan: Test strategy
    - Spec: All sections implicitly
    - Micropolis: city fixtures in `ref/micropolis/cities`
  - [ ] Success criteria:
    - [ ] Golden replay: `.cty` fixtures + N weeks produce stable hashes.
    - [ ] Phase isolation tests ensure each derived layer updates only in its phase.
    - [ ] Determinism: same seed + action log => identical hashes.
