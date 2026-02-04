# Terrain Generation (Micropolis Parity) Plan

## Goal
Implement Micropolis-classic terrain generation (map creation + smoothing passes) at behavioral parity with the C implementation, so that given the same seed and parameter settings we produce the same 120×100 tilemap output.

This work is **core simulation logic** (deterministic worldgen that writes to the `map` layer), so it should live in `packages/sim-core` rather than in UI/resource/scripting packages.

## Primary Sources (C + spec)
- Spec: `ref/micropolis/spec/terrain/SPEC.md`
- Canonical C implementation:
  - `ref/micropolis/src/sim/s_gen.c` (GenerateMap/MakeIsland/DoRivers/MakeLakes/DoTrees/Smooth*)
  - `ref/micropolis/src/sim/headers/macros.h` (`TestBounds`)
- Helpful wiring references (for API surface + UX defaults):
  - `ref/micropolis/src/sim/w_sim.c` (script commands + accessors for `TreeLevel`, `LakeLevel`, `CurveLevel`, `CreateIsland`)
  - `ref/micropolis/src/sim/terrain/terra.c` (legacy “terraforming UI” flow; useful conceptually, not canonical RNG)

## Parity Constraints
### Map layout + tile encoding
- C uses `Map[x][y]` with column-major contiguous storage.
- sim-core already uses column-major indexing everywhere (`index = x * WORLD_Y + y`).
- Terrain generation uses raw tile IDs plus status bits:
  - `BLBNBIT = BULLBIT + BURNBIT` is written onto woods and some edge tiles.
  - Some checks are “raw equality” (e.g. `Map[x][y] == REDGE` in `SmoothRiver`) vs masked checks (e.g. `(tile & LOMASK)` ranges in `SmoothWater`).

### RNG behavior
- C terrain uses Micropolis RNG (`SeedRand`, `Rand16`, `Rand(range)` with rejection sampling).
- sim-core’s `MicropolisRng` matches the LCG and rejection-sampling behavior (`packages/sim-core/src/core/rng.ts`).

### Non-determinism (`RandomlySeedRand`)
In C, `GenerateMap(seed)` calls `RandomlySeedRand()` at the end (except the “random island” early-return branch), which reseeds using wall-clock time (`tv_usec ^ tv_sec ^ sim_rand()` in `ref/micropolis/src/sim/s_gen.c`).

Plan:
- In production, mirror the behavior shape (reseed after generation).
- In tests, use a **controllable time/seed source** so the behavior is deterministic (inject via context/hook or pass an explicit reseed value).

## Golden Fixtures (how we prove parity)
### Why we need them
Even a 1:1 port is easy to get subtly wrong due to:
- masked vs unmasked comparisons,
- overwrite rules (e.g. `PutOnMap` channel/river logic),
- inclusive `Rand(range)` semantics,
- early-return branch behavior for random islands.

Golden fixtures let us assert byte-for-byte parity of the generated `map` layer.

### How to generate them (recommended approach)
Do **not** attempt to build the full Micropolis binary with Tk/X11 dependencies just to generate maps.

Instead:
- Create a tiny standalone C harness that embeds/compiles the exact terrain generator code from:
  - `ref/micropolis/src/sim/s_gen.c`
  - `ref/micropolis/src/sim/headers/macros.h` (or re-declare `TestBounds` exactly)
- Have the harness accept:
  - `seed`
  - `TreeLevel`, `LakeLevel`, `CurveLevel`, `CreateIsland`
- Emit the resulting map as a stable artifact:
  - `uint16` raw dump (preferred), or
  - JSON/hex text if that’s more convenient for review.

Store outputs under `packages/sim-core/fixtures/terrain/` and write Vitest tests that:
1) run the TS generator with the same inputs,
2) compare the entire `Uint16Array` (length `WORLD_X * WORLD_Y`) for equality.

### Useful in-tree information for fixtures
- `ref/micropolis/src/sim/w_sim.c` shows these generator knobs are part of the public control surface (Tcl command accessors), so they’re appropriate as explicit parameters in our TS API too.
- `ref/micropolis/src/sim/terrain/terra.c` shows a legacy interactive flow calling smoothing twice for trees and once for river after generation; `s_gen.c` already does this, but `terra.c` is a good sanity reference for expected UX.

## Integration / Orchestration
### How C handles it
In C, `GenerateSomeCity(seed)` is a monolithic orchestrator:
- generates the map (`GenerateMap(seed)`),
- resets core globals (`ScenarioID`, `CityTime`, `InitSimLoad`, `DoInitialEval`),
- resets editor/map UI state (`ResetMapState`, `ResetEditorState`),
- invalidates views (`InvalidateEditors`, `InvalidateMaps`),
- updates funds, runs `DoSimInit()`,
- signals UI (`Eval("UIDidGenerateNewCity")`) and kicks the loop (`Kick()`).

See `ref/micropolis/src/sim/s_gen.c`.

### Is this separation a downside in sim-core?
Not really: sim-core is intentionally UI-agnostic. The “kick / invalidate views / editor state” steps are UI/event-loop concerns, and we should keep them out of sim-core.

### Options for our implementation
**Option A (recommended): pure generator + core reset helper**
- sim-core exposes:
  - `generateMap(...)` (writes tiles only)
  - `resetForNewCityFromSeed(...)` (sets the core state fields and runs `initWillStuff`/`doSimInit`)
- The UI/integration layer:
  - invalidates/redraws, emits “generated new city” UI events, starts/continues the game loop.

Pros:
- deterministic + easy to test headless,
- keeps sim-core boundaries clean,
- avoids inventing fake UI/editor APIs in sim-core.

Cons:
- caller must remember to do UI-side work (invalidate/redraw/start loop).

**Option B: sim-core convenience orchestrator with hooks**
- sim-core exposes a `generateSomeCityLike(...)` that calls into hooks for UI lifecycle signals (e.g. “didGenerateNewCity”), but still doesn’t implement editor/view state.

Pros:
- reduces integration boilerplate.

Cons:
- increases coupling to hook surface; still cannot (and should not) own editor/view state.

### Why not replicate C verbatim?
Copying the C orchestration shape would either:
- force UI/editor concepts into sim-core, or
- add no-op placeholders that hide missing responsibilities.

Keeping a clean split makes correctness and testing easier.

## Proposed sim-core API shape (implementation sketch)
Implementation should live in sim-core, likely as:
- `packages/sim-core/src/terrain/generate.ts` (or `packages/sim-core/src/systems/terrain-gen.ts`)

Exports:
- `generateMap(state, context, opts)`
  - writes `context.store.getLayer('map')` in a store tick
  - mirrors `GenerateMap` from `ref/micropolis/src/sim/s_gen.c` / `ref/micropolis/spec/terrain/SPEC.md`
- Optional helper(s):
  - `clearMap(...)`, `clearUnnatural(...)`
  - `smoothRiver(...)`, `smoothTrees(...)`, `smoothWater(...)`

Options (`opts`) should include the generator knobs:
- `seed: number`
- `treeLevel: number` (mirrors `TreeLevel`)
- `lakeLevel: number` (mirrors `LakeLevel`)
- `curveLevel: number` (mirrors `CurveLevel`)
- `createIsland: number` (mirrors `CreateIsland`)
- `reseedAfter?: 'clock' | { seed: number } | false` (for production vs deterministic tests)

## Testing Plan
- Add fixture-driven parity tests under `packages/sim-core/src/__test__/terrain-gen-parity.test.ts`.
- Each test case loads a fixture (`Uint16Array`) and compares it to TS output for:
  - normal non-island path,
  - forced island (`createIsland=1`),
  - random-island path behavior (including “early return” skipping `RandomlySeedRand()`),
  - edge cases for `TreeLevel/LakeLevel/CurveLevel` (0, negative defaults, some positive values).

## Units of Work (agent-sized, testable)

- [x] Add terrain module skeleton + public exports.
  - Requirements:
    - Code: add `packages/sim-core/src/terrain/generate.ts` and (if helpful) `packages/sim-core/src/terrain/index.ts`.
    - Code: define `TerrainGenOptions` and a minimal `generateMap(...)` stub (throws or no-op).
    - Docs: JSDoc on every exported function pointing to `ref/micropolis/src/sim/s_gen.c` / `ref/micropolis/spec/terrain/SPEC.md` and stating whether the behavior is 1:1.
    - Tests: add a smoke test (e.g. `packages/sim-core/src/__test__/terrain-gen-smoke.test.ts`) that imports/executes a no-op `generateMap` without touching UI hooks.
  - C references:
    - `ref/micropolis/src/sim/s_gen.c`
    - `ref/micropolis/spec/terrain/SPEC.md`

- [x] Add a deterministic “terrain RNG adapter” for unit tests.
  - Requirements:
    - Code: define an internal RNG interface used by terrain code (e.g. `{ seed(n): void; next16(): number; rand(range): number }`).
    - Code: adapter for `MicropolisRng` (`packages/sim-core/src/core/rng.ts`) so production uses the real RNG unchanged.
    - Tests: add a tiny fake RNG (queue-backed `rand(...)` values) and verify inclusive `Rand(range)` semantics in a focused test.
  - C references:
    - `ref/micropolis/src/sim/s_gen.c` (SeedRand/Rand16/Rand)

- [x] Implement `TestBounds` + `indexFor` helpers (shared by terrain routines).
  - Requirements:
    - Code: implement `testBounds(x, y)` exactly as C’s macro.
    - Code: standardize on `indexFor(x,y) = x * WORLD_Y + y` for map access.
    - Tests: boundary cases (negative, max edges, just-in-bounds).
  - C references:
    - `ref/micropolis/src/sim/headers/macros.h` (`TestBounds`)

- [x] Implement `clearMap()` (DIRT fill) and `clearUnnatural()` (raw > WOODS => DIRT).
  - Requirements:
    - Code: `clearMap(map)` sets every tile to `Tile.DIRT`.
    - Code: `clearUnnatural(map)` matches C’s **raw** comparison (`tile > WOODS`, no masking).
    - Tests:
      - `clearMap` fills all tiles.
      - `clearUnnatural` clears tiles with flags set (e.g. `WOODS + BLBNBIT`) and leaves `<= WOODS` intact.
      - Test comments cite `ClearUnnatural` in `s_gen.c` (document magic numbers/behavior source).
  - C references:
    - `ref/micropolis/src/sim/s_gen.c` (`ClearMap`, `ClearUnnatural`)

- [x] Implement `PutOnMap` overwrite rules.
  - Requirements:
    - Code: port `PutOnMap(Mchar, Xoff, Yoff)` including:
      - `Mchar == 0` early return,
      - bounds clipping,
      - river/channel overwrite rules using `temp & LOMASK` (as in C).
    - Tests:
      - channel overwrites river; non-channel does not.
      - nothing overwrites channel.
      - out-of-bounds writes are ignored.
      - Test comments cite `PutOnMap` in `s_gen.c`.
  - C references:
    - `ref/micropolis/src/sim/s_gen.c` (`PutOnMap`)

- [x] Port `BRivPlop` + `SRivPlop` matrices.
  - Requirements:
    - Code: copy the `BRMatrix[9][9]` and `SRMatrix[6][6]` constants and apply via `PutOnMap`.
    - Tests:
      - Place a plop at a fixed `MapX/MapY` and assert specific offsets match expected IDs (from the matrices).
      - Verify `0` entries do not write (pre-fill with non-zero and assert unchanged).
      - Test comments cite the matrix definitions in `s_gen.c` (document magic numbers).
  - C references:
    - `ref/micropolis/src/sim/s_gen.c` (`BRivPlop`, `SRivPlop`)

- [x] Port `MoveMap(dir)` (8-way direction table).
  - Requirements:
    - Code: implement `MoveMap` with `dir & 7` masking and the exact `DirTab`.
    - Tests: for each dir 0..7, assert delta matches.
  - C references:
    - `ref/micropolis/src/sim/s_gen.c` (`MoveMap`)

- [x] Port `ERand(limit)` helper.
  - Requirements:
    - Code: `ERand(limit) = min(Rand(limit), Rand(limit))`.
    - Tests: deterministic fake RNG verifies min-of-two.
  - C references:
    - `ref/micropolis/src/sim/s_gen.c` (`ERand`)

- [x] Port `GetRandStart()` (seed-dependent start coordinates).
  - Requirements:
    - Code: `XStart = 40 + Rand(WORLD_X - 80)`; `YStart = 33 + Rand(WORLD_Y - 67)`; set `MapX/MapY`.
    - Tests: deterministic fake RNG verifies inclusive range and offsets; test comments cite C constants.
  - C references:
    - `ref/micropolis/src/sim/s_gen.c` (`GetRandStart`)

- [x] Port `IsTree` predicate.
  - Requirements:
    - Code: `IsTree(cell)` uses `(cell & LOMASK)` within `[WOODS_LOW..WOODS_HIGH]` (`TREEBASE..UNUSED_TRASH2`).
    - Tests: boundary values (20, 21, 39, 40) and flagged variants.
  - C references:
    - `ref/micropolis/src/sim/s_gen.c` (`IsTree`, `WOODS_LOW/WOODS_HIGH` defines)

- [x] Port `TreeSplash` + `DoTrees` (including “TreeLevel < 0” rules).
  - Requirements:
    - Code: implement `TreeSplash(xloc, yloc)` exactly (distance selection, random directions, DIRT-only placement via masked compare, write `WOODS + BLBNBIT`).
    - Code: implement `DoTrees()` amount selection and call `SmoothTrees()` twice.
    - Tests:
      - Amount selection for `TreeLevel < 0` vs `>= 0`.
      - `TreeSplash` doesn’t write on non-DIRT.
      - `DoTrees` calls smoothing twice (spy/stub).
      - Test comments cite `TreeSplash`/`DoTrees` in `s_gen.c` for “magic” constants.
  - C references:
    - `ref/micropolis/src/sim/s_gen.c` (`TreeSplash`, `DoTrees`)

- [x] Port `SmoothTrees` (TEdTab + checkerboard variant).
  - Requirements:
    - Code: implement 4-neighbor bitindex, `TEdTab`, odd/even `(x+y)&1` adjustment, and `BLBNBIT` writes.
    - Tests:
      - At least 3 bit patterns that map to known outputs.
      - Verify `(x+y)&1` variant for `temp != WOODS`.
      - Verify “temp == 0 => Map[x][y] = 0” deletion.
      - Test comments cite `TEdTab` in `s_gen.c` (document magic numbers).
  - C references:
    - `ref/micropolis/src/sim/s_gen.c` (`SmoothTrees`, `TEdTab`)

- [x] Port `SmoothRiver` (REdTab + random +1).
  - Requirements:
    - Code: process only tiles with raw equality `Map[x][y] == REDGE`.
    - Code: bitindex uses masked checks for “neighbor is not DIRT and not woods-range”.
    - Code: apply `REdTab` and `(temp != RIVER && Rand(1)) temp++`.
    - Tests:
      - Case where `Rand(1)=1` increments temp.
      - Case where `temp == RIVER` is not incremented.
      - Test comments cite `REdTab` in `s_gen.c`.
  - C references:
    - `ref/micropolis/src/sim/s_gen.c` (`SmoothRiver`, `REdTab`)

- [x] Port `SmoothWater` (3 passes).
  - Requirements:
    - Code: implement all three loops with the same masked/unmasked comparisons:
      - Pass 1: set `REDGE` when any 4-neighbor is outside `[WATER_LOW..WATER_HIGH]`.
      - Pass 2: convert interior non-channel water to `RIVER` when all 4-neighbors are water.
      - Pass 3: convert woods-range to `REDGE` when adjacent tile is exactly `RIVER` or `CHANNEL` (raw equality).
    - Tests:
      - Edge detection: water next to dirt -> REDGE.
      - Interior conversion: non-channel water surrounded by water -> RIVER.
      - Woods adjacency: woods next to exact `RIVER` -> REDGE.
      - Test comments cite `SmoothWater` in `s_gen.c`.
  - C references:
    - `ref/micropolis/src/sim/s_gen.c` (`SmoothWater`)

- [x] Port `MakeLakes` (cluster loops + SRiv/BRiv selection).
  - Requirements:
    - Code: `Lim1` selection (`LakeLevel < 0 ? Rand(10) : LakeLevel / 2`).
    - Code: coordinate selection offsets and `Lim2 = Rand(12) + 2`.
    - Code: `Rand(4)` choice (`!= 0 => SRivPlop` else `BRivPlop`) exactly.
    - Tests: deterministic fake RNG verifies number of plops and SRiv/BRiv selection; test comments cite `MakeLakes`.
  - C references:
    - `ref/micropolis/src/sim/s_gen.c` (`MakeLakes`)

- [x] Port `MakeNakedIsland` (base fill + border + perimeter plops).
  - Requirements:
    - Code: fill all tiles to `RIVER`, then interior `[5..WORLD_X-6]×[5..WORLD_Y-6]` to `DIRT`.
    - Code: perimeter plop loops (x and y step 2) using `ERand(RADIUS)` and exact constants.
    - Tests:
      - Verify the 5-tile water border rule (sample points).
      - Deterministic fake RNG verifies plop call counts.
      - Test comments cite `RADIUS=18` and island rules in `s_gen.c`.
  - C references:
    - `ref/micropolis/src/sim/s_gen.c` (`MakeNakedIsland`)

- [x] Port `MakeIsland` (naked island + SmoothRiver + DoTrees).
  - Requirements:
    - Code: `MakeIsland()` = `MakeNakedIsland(); SmoothRiver(); DoTrees();`.
    - Tests: spy-based test verifying call order and that lakes/rivers are not invoked.
  - C references:
    - `ref/micropolis/src/sim/s_gen.c` (`MakeIsland`)

- [ ] Port `DoRivers`, `DoBRiv`, `DoSRiv` (direction drift rules).
  - Requirements:
    - Code: implement the 3-river sequence from `DoRivers()` (including `LastDir ^ 4`).
    - Code: implement `DoBRiv` / `DoSRiv` loops with the exact bounds checks (`MapX+4/MapY+4` vs `+3/+3`), direction update rules, and `MoveMap(Dir)` masking.
    - Tests:
      - `Rand(r1) < 10` resets `Dir = LastDir`.
      - `Rand(r2) > 90` increments/decrements `Dir`.
      - `Dir` masking via `& 7` applied by driving `Dir` outside 0..7.
      - Test comments cite `DoRivers`/`DoBRiv`/`DoSRiv` in `s_gen.c`.
  - C references:
    - `ref/micropolis/src/sim/s_gen.c` (`DoRivers`, `DoBRiv`, `DoSRiv`)

- [ ] Implement `GenerateMap(seed)` pipeline (including early-return island branch).
  - Requirements:
    - Code: mirror step order and branch behavior:
      - `SeedRand(seed)`; random-island branch (`CreateIsland < 0 && Rand(100) < 10`) calls `MakeIsland()` then **returns** (skips `RandomlySeedRand()`).
      - `CreateIsland==1` uses `MakeNakedIsland()` else `ClearMap()`.
      - Conditional `DoRivers`, `MakeLakes`, then `SmoothRiver`, then conditional `DoTrees`, then `RandomlySeedRand()`.
    - Tests:
      - Branch tests for: random-island early return, forced island, normal clear map.
      - Verify “TreeLevel==0 disables DoTrees in normal pipeline” (but random-island still calls DoTrees via `MakeIsland`).
      - Verify reseed is skipped on early-return path.
      - Test comments cite both the spec and `s_gen.c`.
  - C references:
    - `ref/micropolis/src/sim/s_gen.c` (`GenerateMap`)
    - `ref/micropolis/spec/terrain/SPEC.md` (pipeline notes)

- [ ] Add a controllable `RandomlySeedRand` equivalent (parity shape + deterministic tests).
  - Requirements:
    - Code: implement reseed mixing equivalent to `SeedRand(tv_usec ^ tv_sec ^ sim_rand())` with an injected time source.
    - Tests: verify injection is honored and reseed runs only on non-early-return path.
  - C references:
    - `ref/micropolis/src/sim/s_gen.c` (`GenerateMap` reseed behavior)

- [ ] Add fixture-driven parity tests + first fixture.
  - Requirements:
    - Fixtures: commit one fixture under `packages/sim-core/fixtures/terrain/` (raw `uint16`, column-major).
    - Tests: `terrain-gen-parity.test.ts` loads the fixture and asserts exact equality with TS output.
    - Docs: test comments record exact parameters and cite `s_gen.c`/spec for “magic numbers”.
  - C references:
    - `ref/micropolis/src/sim/s_gen.c`
    - `ref/micropolis/spec/terrain/SPEC.md`

- [ ] Add fixtures for branch coverage (forced island + early-return random island).
  - Requirements:
    - Fixtures: at least two more fixtures:
      - `CreateIsland=1` (forced island),
      - `CreateIsland=-1` random-island early return (either choose a seed that triggers it, or allow the fixture generator to force the branch).
    - Tests: parity tests per fixture; explicitly assert reseed behavior difference.
  - C references:
    - `ref/micropolis/src/sim/s_gen.c`
    - `ref/micropolis/spec/terrain/SPEC.md` (early return note)

- [ ] Add fixtures for parameter edge cases (`TreeLevel/LakeLevel/CurveLevel` 0 and positive).
  - Requirements:
    - Fixtures: cases where each level is `0` (disables that stage) and at least one positive value.
    - Tests: parity tests per fixture; tests explain what “0 disables” means with C citations.
  - C references:
    - `ref/micropolis/src/sim/s_gen.c` (conditional stage gates)

- [ ] Add a core-only `resetForNewCityFromSeed` helper (no editor/UI state).
  - Requirements:
    - Code: helper that:
      - calls `generateMap`,
      - resets core fields (`ScenarioID/CityTime/InitSimLoad/DoInitialEval`, etc.),
      - runs `initWillStuff` and `doSimInit` in order.
    - Tests: verify state fields and map writes; UI hooks remain optional/no-op.
    - Docs: explicitly note what is *not* included vs C (`ResetEditorState`, `Kick`, Tcl `Eval`), and why.
  - C references:
    - `ref/micropolis/src/sim/s_gen.c` (`GenerateSomeCity`)
    - `ref/micropolis/src/sim/w_sim.c` (command exposure / integration surface)

## Next Steps
1) Implement TS terrain generator (1:1 port) with careful masked vs unmasked checks.
2) Add a small C harness to generate golden fixtures.
3) Land fixture-driven parity tests.
4) Decide whether to expose Option A only, or also provide Option B as a convenience.
