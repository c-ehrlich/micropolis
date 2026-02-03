# SimCity TS Core Plan (`@packages/sim-core`)

## Checklist (Tasks + Verification)
- [x] Package skeleton + tooling  
  - Verify: `pnpm -C packages/sim-core test`
- [x] Core types + deterministic foundations (RNG, clocks, MapStore, patches)  
  - Verify: unit tests for RNG determinism, patch correctness/idempotence, MapStore swap
- [x] Tool actions + connectivity (all tools; `w_tool.c`/`w_con.c` parity)  
  - Verify: tool ordering tests; road/rail/wire adjacency golden tests vs table outputs
- [x] Scheduler API (stepPhase/stepTick/stepRealtimeTicks)  
  - Verify: stepTick == 16×stepPhase; realtime counter; `viewRect` throws
- [x] Save/Load + replay infra  
  - Verify: `.cty` round‑trip; endianness test; replay hash determinism
- [x] Simulation systems (phased, incremental)  
  - Verify: per‑system golden tests after each subsystem lands
- [x] Real‑time systems (objects + animations)  
  - Verify: deterministic object movement + map mutations under fixed seed
- [x] Test harness (golden replays + property‑based)  
  - Verify: golden replay hashes stable; property tests pass

## Source of Truth
- If in doubt, read the Micropolis C source in `ref/micropolis/src/sim/*.c` (especially `s_*.c`, `w_tool.c`, `w_con.c`, `w_sprite.c`, `rand.c`).

## Decisions Locked In
- Package location: `@packages/sim-core`.
- Core API: `stepPhase()` is the primitive; `stepTick()` is a 16-phase wrapper for tests/fast-forward.
- Real-time updates: implemented in core via `stepRealtimeTicks(n, viewRect?)`, global by default. Passing `viewRect` throws (explicitly unimplemented).
- Determinism: integer/fixed-point only in the sim core; floats allowed only in derived/UI layers.
- State model: double-buffered typed arrays with patch logging from day 1.
- Tool actions: apply immediately, stamped with `(simStep, order)`.
- Tool semantics follow Micropolis `w_tool.c` + `w_con.c`:
  - bounds + funds checks; costs spent immediately; auto-bulldoze cost where applicable
  - map mutated directly; derived layers update only via sim phases
  - road/rail/wire connectivity via `ConnecTile` + `_FixSingle` tables
- Save/load: `.cty` adapter first.
- Tests: parity scaffolding OK early; long-term unit tests + replay harness + property-based tests.

---

## 1) Package Skeleton + Tooling
**Goal:** create `@packages/sim-core` with a minimal build/test setup.

**Tasks**
- Add workspace package: `packages/sim-core`.
- TS config (ESM, strict) aligned with root.
- Vitest setup.
- Basic `index.ts` exports and folder structure.

**Tests that must pass**
- `pnpm -C packages/sim-core test` runs and passes a dummy test.

---

## 2) Core Types + Deterministic Foundations
**Goal:** lock all foundational types before logic.

**Tasks**
- Tile encoding constants (`TileMask`, `TileFlag`, tile ID ranges in `Tile`).
- Map dimensions (classic 120×100) and derived sizes.
- `Ruleset` interface with quirk flags.
- Deterministic PRNG (Micropolis LCG or equivalent).
- Sim clocks:
  - `simStep` (0–15)
  - `simWeeks` counter
  - `realtimeTick` counter
- Map storage:
  - `MapStore` (double-buffer + patch log) for all 18 layers:
    - 1:1: `map`, `power` (bitset-backed)
    - 1:2: `PopDensity`, `TrfDensity`, `PollutionMem`, `LandValueMem`, `CrimeMem`, `tem`, `tem2`
    - 1:4: `TerrainMem`, `Qtem`
    - 1:8: `RateOGMem`, `FireStMap`, `PoliceMap`, `PoliceMapEffect`, `FireRate`, `ComRate`, `STem`
  - Patch format: `{layer, index[], prev[], next[]}`.
  - Write API: `write(layer, index, value)`.

**Tests that must pass**
- RNG determinism: same seed + N steps => identical sequence.
- Patch correctness: applying patch to snapshot reproduces mutations.
- Patch idempotence: applying patch twice does not change state.
- MapStore swap: `beginTick` → writes → `commitTick` produces correct snapshot/patches.

---

## 3) Action Model + Command Queue
**Goal:** deterministic tool actions, replayable and ordered.

**Tasks**
- Define `ToolAction` union for all Micropolis tools:
  - res, com, ind, fire, query, police, wire, bulldoze, rail, road,
    chalk, eraser, stadium, park, seaport, coal, nuclear, airport, network.
- Stamping: `{simStep, order, tickId}`.
- Deterministic queue: stable ordering by `(simStep, order, seq)`.
- Port `w_tool.c`/`w_con.c` semantics:
  - immediate apply w/ bounds + funds checks
  - auto-bulldoze costs for zone placement
  - road/rail/wire connectivity via `ConnecTile` and `_FixSingle` adjacency tables
  - tool results: `ok | out-of-bounds | no-funds | reject` (match return codes)
  - tool sizes/offsets/costs from `w_tool.c` (`toolSize[]`, `toolOffset[]`, `CostOf[]`)
  - `ConnecTile` commands: 0=fix, 1=doze, 2=road, 3=rail, 4=wire
  - lay rules + costs from `w_con.c`:
    - road: dirt (10), bridge on water (50), road/rail/power crossings
    - rail: dirt (20), tunnel on water (100), rail/road/power crossings
    - wire: dirt (5), underwater wire (25), wire/road/rail crossings
  - bulldozer rules from `w_tool.c`:
    - zone center/big-zone rubble + explosions
    - water tiles require extra funds and spend (doze + water penalty)
  - multiplayer “pending tool” behavior exists in C; default to single-player but keep queue hooks
  - zone placement checks:
    - `check3x3`/`check4x4`/`check6x6` enforce bounds + empty/autoBulldoze rules
    - autoBulldoze uses `tally(tile)` to decide if a non-empty tile can be cleared (and adds cost per tile)
  - on success: spend cost, lay zone tiles, center `TileFlag.ZONEBIT`, then `check*border` (calls `ConnecTile` around perimeter)
  - park tool:
    - only on empty tile; 1/4 fountain (`Tile.FOUNTAIN|TileFlag.BURNBIT|TileFlag.BULLBIT|TileFlag.ANIMBIT`), else `Tile.WOODS2..Tile.WOODS5`
  - network tool:
    - auto-bulldozes eligible tile if funds > 0; then places `Tile.TELEBASE|TileFlag.CONDBIT|TileFlag.BURNBIT|TileFlag.BULLBIT|TileFlag.ANIMBIT`
  - bulldoze helper logic:
    - `checkSize` (3x3/4x4/6x6 zones) and `checkBigZone` (airport/large zones) determine rubble footprint
  - mirror canonical arrays (note: includes an extra slot for `specialState` in C):
    - `CostOf`:
      `[100,100,100,500,0,500,5,1,20,10,0,0,5000,10,3000,3000,5000,10000,100,0]`
    - `toolSize`:
      `[3,3,3,3,1,3,1,1,1,1,0,0,4,1,4,4,4,6,1,0]`
    - `toolOffset`:
      `[1,1,1,1,0,1,0,0,0,0,0,0,1,0,1,1,1,1,0,0]`
  - autoBulldoze eligibility (`tally`) from `w_tool.c`:
    - rivedge..rubble, power lines (`Tile.POWERBASE+2..Tile.POWERBASE+12`), tiny explosions (`Tile.TINYEXP..Tile.LASTTINYEXP+2`)

**Tests that must pass**
- Tool ordering: two actions with same simStep must apply in stable order.
- Replay determinism: same action log yields identical state hashes.
- Tool connectivity: road/rail/wire adjacency produces same tile rewrites as Micropolis tables.

---

## 4) Scheduler API + Clocks
**Goal:** mirror SimCity’s scheduling model.

**Tasks**
- Implement `stepPhase()`:
  - Executes one phase of the 16-phase weekly cycle.
  - Advances `simStep = (simStep + 1) & 15`.
- Implement `stepTick()`:
  - Loops `stepPhase()` 16 times.
- Implement `stepRealtimeTicks(n, viewRect?)`:
  - Updates objects + animations globally.
  - If `viewRect` is provided, throw with "not implemented" error.
- Optional: `SimSpeed` gating via a `SimFrame` helper (like original).

**Tests that must pass**
- `stepTick()` exactly equals 16 `stepPhase()` calls.
- `stepRealtimeTicks(n)` increments realtime counter deterministically.
- `stepRealtimeTicks(…, viewRect)` throws.

---

## 5) Save/Load + Replay Infrastructure
**Goal:** make real cities loadable and support replay logs.

**Tasks**
- `.cty` adapter: big-endian parse and emit.
- Length-based dimension sniffing.
- Accept only core spec sizes: 27,120 / 99,120 / 219,120 bytes.
- Preserve raw `MiscHis` (120 shorts) and expose scalar views for known indices:
  - CityTime (8..9), TotalFunds (50..51), auto flags (52..55), CityTax (56), SimSpeed (57),
    funding percents (58..63) as 16.16 fixed point.
- Load flow mirrors Micropolis:
  - normalize CityTime/CityTax/SimSpeed
  - `InitFundingLevel()` resets funding percents to 1.0 after load
- JSON replay schema:
  - `version`, `seed`, `mapSize`, `actions[]`, `ticks[]`.
- Hash utilities:
  - map hash + key scalars hash.

**Tests that must pass**
- `.cty` round-trip: load → save → reload yields identical map/histories.
- Replay determinism: replay log yields same hash every run.
- Endianness test: known byte pattern loads correctly.

---

## 6) Simulation Systems (Incremental, Phase-Aligned)
**Goal:** implement the core sim in pieces; after each piece add golden tests.

### 6.1 Map Scan Skeleton
- Slice iteration (1/8 of map per phase 1–8).
- Tile dispatch table (categories + handler stubs).

**Test gate**
- Slice boundaries are correct.
- Only tiles in the slice change.

### 6.2 Roads + Rails + Basic Deterioration
- Tile rewrites for traffic density.
- Simple deterioration rules.

**Test gate**
- Known traffic density input yields expected tile rewrite.
- Deterioration probability is deterministic with seed.

### 6.3 Power Scan + Powered Bits
- Power propagation.
- `TileFlag.PWRBIT` update on zones/conductors.

**Test gate**
- Known map with plant + lines matches expected powered tiles.

### 6.4 Land Value / Pollution / Crime / Pop Density
- Implement derived map calculations in the canonical phases:
  - Phase 12: land value/pollution aggregation
  - Phase 13: crime
  - Phase 14: pop density + com rate

**Test gate**
- Small deterministic maps produce expected outputs.
- Derived maps only change in their phases.

### 6.5 Zoning / Growth / Demand Valves
- Census accumulation during map scan.
- Phase 0: `setValves()`.
- Zone growth/decay logic with RNG.

**Test gate**
- Known seed + inputs yields stable zone changes.
- Census + valves match expected totals.

### 6.6 Disasters + Fire Analysis
- Phase 15: fire coverage + disaster event dispatch.
- Tile-level fire behavior during map scan.

**Test gate**
- Fire spread/decay deterministic with seed.
- Disaster triggers on expected conditions.

---

## 7) Real-Time Systems (Objects + Animations)
**Goal:** core “live feel” with deterministic realtime ticks.

**Tasks**
- Implement object update loop (train, ship, helicopter, airplane, monster, tornado, explosion, bus).
- Behavior parity from `w_sprite.c`:
  - per-type movement rules, animation cadence, collisions, map destruction/explosions
  - spawn rules (train/bus traffic, ship at water edges, copter/plane from airport, disasters)
  - key mechanics to mirror:
    - train: moves on rail, turns every 4th cycle, stops if no valid direction
    - bus: road-following with speed from traffic density; can bulldoze if blocked at high speed
    - ship: water/bridge channel movement; can destroy terrain if stranded
    - copter/plane: move to dest/origin, traffic checks, collision explosions
    - monster/tornado: random/goal-seeking motion, tile destruction, collisions
    - explosion: frame cadence then ignites surrounding fires
- Tile animation logic (fire/traffic/smoke), global pass.
- Power blink cadence.

**Test gate**
- Same `realtimeTicks` + seed yields identical map mutations.
- Objects move deterministically with fixed RNG.

---

## 8) Test Harness + Long-Term Test Strategy
**Goal:** ensure determinism and regression safety.

**Tasks**
- Golden replay runner:
  - Load `.cty`, run N weeks/ticks, produce hash.
  - Use fixtures from `ref/micropolis/cities/*.cty`.
- Property-based tests (fast-check):
  - Patch log correctness.
  - Serialization round-trip.
  - RNG determinism under random seeds.
- Cross-engine deterministic test (optional later): Chrome + Firefox.

**Test gate**
- Golden replay test is stable across runs.
- Property-based tests pass on CI.

---

## Suggested File/Folder Layout (`packages/sim-core`)
```
packages/sim-core/
  src/
    core/
      constants.ts
      ruleset.ts
      rng.ts
      clock.ts
      mapStore.ts
      types.ts
    sim/
      scheduler.ts
      stepPhase.ts
      stepTick.ts
      realtime.ts
    systems/
      mapScan.ts
      power.ts
      landValue.ts
      crime.ts
      popDensity.ts
      zoning.ts
      disasters.ts
      messages.ts
    actions/
      toolActions.ts
      actionQueue.ts
    io/
      cty.ts
      replay.ts
      hash.ts
    tests/
      ...
```

---

## “Done” Definition Per Step
- Step 2 done: RNG + MapStore + patches tested.
- Step 4 done: clock API + scheduler tests are green.
- Step 5 done: `.cty` round-trip + replay hash working.
- Step 6 done: each subsystem has at least one deterministic golden test.
- Step 8 done: full golden replay runs in CI.
