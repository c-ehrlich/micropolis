# Sim Core Systems Plan (Full SPEC Coverage)

Purpose

- Deliver a complete, deterministic simulation core that fully implements `ref/micropolis/spec/core/SPEC.md`.
- Define the concrete systems, state, and phase execution required for `Simulate(mod16)`.

Scope

- This plan is strictly the simulation core. UI, rendering, Tcl, and external platform glue are out of scope except where the core calls hooks.
- All SPEC sections must be covered by the time this plan is complete.

---

## Current baseline (already implemented)

- Core constants/types: world geometry, tile IDs/flags/masks.
- RNG (Micropolis LCG) + determinism tests.
- Clocks + scheduler primitives (`stepPhase/stepTick/simFrame`).
- MapStore (double-buffer + patch logging) for all map/derived layers.
- Tool actions + connectivity rules (w_tool.c / w_con.c parity).
- Persistence (`.cty` read/write + misc/meta normalization).
- MapScan slice iteration skeleton + dispatch hooks.
- Realtime sprite/object systems (train/ship/copter/tornado/monster, etc.).

Status update (2026-02-07):
- The systems in this plan are implemented and covered in
  `packages/sim-core/PLAN-SYSTEMS-CHECKLIST.md` (all items checked).
- Keep this file as the architecture/coverage reference; use the checklist file for completion tracking.

---

## Architecture targets

### 1) SimState (authoritative city state)

A single struct holding everything the SPEC names as global state. Suggested categories:

- Time/speed: CityTime, StartingYear, SimSpeed, SimMetaSpeed, Fcycle, Scycle, Spdcycle.
- Economy: TotalFunds, CityTax, GameLevel, CashFlow, TaxFund, RoadFund/PoliceFund/FireFund, RoadSpend/PoliceSpend/FireSpend, RoadEffect/PoliceEffect/FireEffect, autoBudget flags.
- Population/census: ResPop, ComPop, IndPop, TotalPop, ResZPop/ComZPop/IndZPop, Hospital/Church/Police/Fire/Port/Airport/Coal/Nuclear/Stadium counts.
- Demand valves: RValve/CValve/IValve, ResCap/ComCap/IndCap, ValveFlag.
- City evaluation: CityScore, CityClass, CityPop, deltaCityPop, OldCityPop, OldCityScore, CityAssValue, ProblemTable/Votes/Order, CityYes/CityNo.
- Environment: LVAverage, CrimeAverage, PolluteAverage, CrimeRamp, PolluteRamp, TrafficAverage.
- Power/traffic maxima: TrafMaxX/Y, PolMaxX/Y, FirePop, RoadTotal, RailTotal, PwrdZCnt, unPwrdZCnt.
- Disasters/scenarios: DisasterEvent, DisasterWait, FloodCnt, FloodX/Y, MeltX/Y, CrashX/Y, ScenarioID, ScoreType, ScoreWait.
- City center: CCx/CCy, CCx2/CCy2.
- MiscHis views: expose required entries for load/save compatibility.

### 2) SimContext

- MapStore instance + derived layer accessors.
- RNG instance.
- Ruleset/quirks (e.g., power capacity counts disconnected plants).
- External hooks (sprites, UI, messages, budget UI).

### 3) External hooks interface (core expects these)

- Sprite system: DestroyAllSprites, GenerateTrain(x,y)/Ship/Plane/Copter, GetSprite, MoveObjects,
  MakeExplosion/MakeExplosionAt, MakeSound, DoEarthQuake, StopEarthquake.
- UI: DoUpdateHeads, doAllGraphs, ChangeCensus, ChangeEval, drawBudgetWindow, drawCurrPercents.
- Messages/scenarios: SendMes, SendMesAt, DoLoseGame, DoWinGame, UISet\* (where applicable).

---

## Phase execution map (Simulate)

SimFrame gating (already in scheduler) must drive `Simulate(Fcycle & 15)`.
Additional core counters required:

- Spdcycle increments mod 1024 (gate logic).
- Fcycle increments mod 1024.
- Scycle increments mod 1024 (case 0).

Speed tables (x = min(SimSpeed, 3)):

- SpdPwr = {1,2,4,5}
- SpdPtl = {1,2,7,17}
- SpdCri = {1,1,8,18}
- SpdPop = {1,1,9,19}
- SpdFir = {1,1,10,20}

Simulate(mod16) phases:

- Case 0: Scycle++, DoInitialEval once, CityTime++, AvCityTax += CityTax, SetValves() every other cycle, ClearCensus().
- Case 1..8: MapScan slices (x in 1/8 vertical bands).
- Case 9: TakeCensus/Take2Census (CityTime % 4 / % 48), CollectTax() + CityEvaluation() (CityTime % 48).
- Case 10: DecROGMem (Scycle % 5), DecTrafficMem(), mark map dirty flags, SendMessages().
- Case 11: DoPowerScan() when Scycle % SpdPwr[x] == 0; mark PRMAP + NewPower.
- Case 12: PTLScan() when Scycle % SpdPtl[x] == 0.
- Case 13: CrimeScan() when Scycle % SpdCri[x] == 0.
- Case 14: PopDenScan() when Scycle % SpdPop[x] == 0.
- Case 15: FireAnalysis() when Scycle % SpdFir[x] == 0; DoDisasters().

---

## System checklist (SPEC coverage)

### A) Initialization and Reset

- initMapArrays(): allocate all map/derived arrays (already MapStore covers sizes; add init zeros if needed).
- InitWillStuff(): set defaults (effects, scores, flags), clear derived maps, reset message/budget state, destroy sprites.
- DoSimInit(): initialize counters, load/new-city branch, run initial scans (MapScan full, power, PTL, crime, popden, fire), set NewMap/NewGraph flags, set DoInitialEval.
- InitSimMemory() (new city): clear histories, reset ramps/valves, run DoPowerScan, set InitSimLoad=0.
- SimLoadInit() (loaded city): restore from MiscHis, validate ranges, set GameLevel, set AvCityTax, DoNilPower().
- DoNilPower(): scan all zones and SetZPower() to apply power bits without connectivity.

### B) Map Scan Pass (cases 1..8)

- MapScan(x1,x2): iterate tiles and dispatch.
- DoRoad(): deterioration, bridge handling, traffic density rendering.
- DoRail(): deterioration, GenerateTrain(x,y).
- DoBridge(): open/close logic with boat distance hook.
- DoFire(): spread + burnout logic.
- FireZone(): burnable flag + ROG penalty.
- DoRadTile(): radiation decay.
- DoFlood(): flood spread and decay (triggered when encountering Tile.FLOOD).
- Tiny explosions -> rubble rewrite in scan.

### C) Power System (case 11)

- PowerMap bitset + power stack arrays.
- PushPowerStack()/PullPowerStack().
- TestForCond(): conductive neighbor scan (not already powered).
- DoPowerScan(): BFS using stack; respects MaxPower capacity and power-plant capacity quirk.
- SetZPower(): set/clear PWRBIT for zones, plants always powered.

### D) Zoning and Growth (MapScan dispatch)

- DoZone(): dispatch to residential/commercial/industrial/special zones.
- DoSPZone(): power plant, nuclear, fire station, police, stadium, airport, port behaviors.
- RepairZone(): restore zone patterns.
- Residential growth: RZPop, DoResidential, DoResIn/DoResOut, BuildHouse.
- Commercial growth: CZPop, DoCommercial, DoComIn/DoComOut.
- Industrial growth: IZPop, DoIndustrial, DoIndIn/DoIndOut.
- Hospital/Church: DoHospChur + MakeHosp.
- ZonePlop / ResPlop / ComPlop / IndPlop.
- Rate of growth: IncROG + DecROGMem.
- Demand helpers: GetCRVal, EvalRes/EvalCom/EvalInd.

### E) Traffic System

- MakeTraf(), FindPRoad(), TryDrive(), TryGo(), DriveDone().
- SetTrafMem() (density accumulation + cop destination).
- RoadTest().
- DecTrafficMem().

### F) Pollution, Terrain, Land Value (case 12)

- PTLScan(): compute tem/Qtem, LandValueMem, PollutionMem.
- GetPValue(), GetDisCC(), SmoothTerrain().
- DoSmooth/DoSmooth2 (shared smoothing with optional dithering).

### G) Crime (case 13)

- CrimeScan(): uses PoliceMap smoothing + LandValue/PopDensity.
- SmoothPSMap(); PoliceMapEffect snapshot.

### H) Population Density + Commercial Rate (case 14)

- PopDenScan(): zone population map, smoothing, city center update.
- GetPDen(), DistIntMarket().

### I) Fire Coverage (case 15)

- FireAnalysis(): SmoothFSMap() x3, copy to FireRate.
- SmoothFSMap().

### J) Budget and Funding (case 9)

- CollectTax(): compute funds, call DoBudget when population > 0, reset effects when not.
- DoBudgetNow(): allocation logic, auto-budget behavior, send messages.
- UpdateFundEffects(): RoadEffect/PoliceEffect/FireEffect + UI update.

### K) Census and Graphs (case 9)

- ClearCensus(): reset per-tick counters and clear FireStMap/PoliceMap.
- TakeCensus(): 10-year history shift + ramps, NeedHosp/NeedChurch.
- Take2Census(): 120-year history shift.

### L) Evaluation and Scoring (case 9)

- CityEvaluation(): core entry.
- GetAssValue(), DoPopNum(), DoProblems(), VoteProblems(), AverageTrf(), GetUnemployment(), GetFire(), GetScore(), DoVotes().
- EvalInit() and ChangeEval() (UI hook).

### M) Messages and Scenarios (case 10)

- SendMessages(): threshold-driven messaging + scenario score countdown.
- CheckGrowth(): population milestone messages.
- DoScenarioScore(): win/lose logic + messages.
- SendMes(): message port logic.

### N) Disasters (case 15)

- DoDisasters(): random + scenario disaster dispatch.
- ScenarioDisaster(): timed scenario events.
- MakeMeltdown(), DoMeltdown(), MakeEarthquake(), SetFire(), MakeFire(), MakeFlood().
- DoFlood() integrated in MapScan.

### O) City Demand Valves (case 0)

- SetValves(): full valve calculation, caps, tax influence, clamps.

### P) Date and Time

- Year/month mapping from CityTime; year overflow handling.

### Q) Heat Simulation (optional debug)

- sim_heat loop + rulesets; if supported, gate behind feature flag.

---

## Implementation order (pragmatic sequencing)

1. SimState + SimContext + external hook interfaces.
2. Init/reset flows (InitWillStuff, DoSimInit, SimLoadInit, DoNilPower).
3. Simulate loop with Fcycle/Scycle/Spd tables and MapScan wiring.
4. MapScan body: road/rail/bridge/fire/flood/rad/tinyexp.
5. Power system.
6. Zoning/growth + ROG.
7. Traffic system.
8. PTLScan + smoothing + land value.
9. Crime + police smoothing.
10. Pop density + com rate + city center.
11. Fire coverage.
12. Budget/funding.
13. Census/history graphs.
14. Evaluation/scoring.
15. Messages/scenarios.
16. Disasters.
17. Demand valves tuning.
18. Date/time.
19. Optional heat sim.

---

## Test strategy (must accompany systems)

- Golden tests per subsystem (small deterministic maps).
- Phase-order tests: ensure only the correct phase mutates each derived map.
- Replay hashes: run N weeks on fixtures after full sim loop is wired.
- Property tests for invariants:
  - PowerMap correctness on small graphs.
  - Zone growth monotonicity under fixed valves (no impossible transitions).
  - MapScan does not write outside slice.

---

## Definition of Done

- Every SPEC section listed in the checklist above is implemented.
- Simulate(mod16) executes all required systems with correct cadence.
- Golden replay hashes are stable across runs and platforms.
- All subsystem tests are green.
