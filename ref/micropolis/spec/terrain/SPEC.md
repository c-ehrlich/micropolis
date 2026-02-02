# Micropolis Terrain Generation Specification

Scope
- This spec defines terrain generation and terrain smoothing: random map creation, island shaping, rivers/lakes/trees, and the smoothing passes that convert raw water/woods into edge tiles.
- Simulation, zoning/growth, budgets, UI rendering, and persistence are out of scope except where terrain generation calls into those systems.

----------------------------------------------------------------
## Data Model

### World geometry and map storage
- World.WORLD_X = 120, World.WORLD_Y = 100 (map is 120x100 tiles).
- Tile coordinates (x,y) are integer indices in [0..World.WORLD_X-1], [0..World.WORLD_Y-1].
- Map: short *Map[World.WORLD_X], backed by a contiguous World.WORLD_X*World.WORLD_Y short array.
  - Map[x][y] is the 16-bit tile value for tile (x,y).

### Tile encoding (terrain-relevant)
- Tile word is 16 bits.
- Low 10 bits store tile ID: TileMask.LOMASK = 1023.
- High bits store status flags. Terrain generation uses:
  - TileFlag.BULLBIT = 4096 (bit 12)
  - TileFlag.BURNBIT = 8192 (bit 13)
  - TileFlag.BLBNBIT = TileFlag.BULLBIT + TileFlag.BURNBIT = 12288

Terrain tile IDs (low 10 bits):
- Tile.DIRT = 0
- Tile.RIVER = 2
- Tile.REDGE = 3
- Tile.CHANNEL = 4
- Tile.FIRSTRIVEDGE = 5
- Tile.LASTRIVEDGE = 20
- Tile.TREEBASE = 21
- Tile.LASTTREE = 36
- Tile.WOODS = 37
- UNUSED_TRASH1 = 38
- UNUSED_TRASH2 = 39

Ranges used by terrain generation:
- WATER_LOW = Tile.RIVER (2)
- WATER_HIGH = Tile.LASTRIVEDGE (20)
- WOODS_LOW = Tile.TREEBASE (21)
- WOODS_HIGH = UNUSED_TRASH2 (39)
- A tile is a "tree" if (tile & TileMask.LOMASK) is in [WOODS_LOW..WOODS_HIGH].

### Generation parameters (globals)
- TreeLevel (int, default -1): controls tree density. See DoTrees/TreeSplash.
- LakeLevel (int, default -1): controls lake count. See MakeLakes.
- CurveLevel (int, default -1): controls river curviness. See DoBRiv/DoSRiv.
- CreateIsland (int, default -1): island mode
  - -1: 10% chance of random island, otherwise normal map
  - 0: never island
  - 1: always island (starts with island base, then continues normal pipeline)

Internal working state:
- XStart, YStart (short): initial river start point.
- MapX, MapY (short): current cursor for plops/splashes.
- Dir, LastDir (short): current and preferred river direction. Treated modulo 8.

### Random number generation (used by terrain)
- sim_rand() is a linear congruential generator:
  - next = next * 1103515245 + 12345
  - return ((next % 16777216) >> 8) in [0..65535]
- Rand16() returns sim_rand().
- Rand(range): uniform integer in [0..range], inclusive.
  - Uses rejection on Rand16() to avoid modulo bias.
- SeedRand(seed): sim_srand(seed).
- RandomlySeedRand(): SeedRand(tv_usec ^ tv_sec ^ sim_rand()).
- ERand(limit): returns min(Rand(limit), Rand(limit)).

----------------------------------------------------------------
## Entry Points and Side Effects

### GenerateNewCity()
- Calls GenerateSomeCity(Rand16()).

### GenerateSomeCity(seed)
- If CityFileName != NULL: free it and set to NULL.
- Updates start_time via gettimeofday().
- Calls GenerateMap(seed).
- Resets core state:
  - ScenarioID = 0
  - CityTime = 0
  - InitSimLoad = 2
  - DoInitialEval = 0
- Calls (in order):
  - InitWillStuff()
  - ResetMapState()
  - ResetEditorState()
  - InvalidateEditors()
  - InvalidateMaps()
  - UpdateFunds()
  - DoSimInit()
  - Eval("UIDidGenerateNewCity")
  - Kick()

### GenerateMap(seed)
- Generates terrain into Map. See "Map Generation Pipeline" below.

### ClearMap()
- Sets every Map[x][y] = Tile.DIRT.

### ClearUnnatural()
- For each tile: if Map[x][y] > Tile.WOODS (raw value, no masking), set Map[x][y] = Tile.DIRT.
  - This clears any tile with status bits or IDs above 37 (including trees and all built tiles).

### SmoothRiver(), SmoothTrees(), SmoothWater()
- In-place smoothing passes described below.
- When invoked via script commands, they are followed by Kick() (UI refresh).

----------------------------------------------------------------
## Map Generation Pipeline (GenerateMap)

GenerateMap(seed) executes the following steps in order:
1. SeedRand(seed).
2. If CreateIsland < 0 and Rand(100) < 10:
   - Call MakeIsland().
   - Return immediately (no further steps, and no RandomlySeedRand()).
3. If CreateIsland == 1:
   - Call MakeNakedIsland().
   - Continue with remaining steps.
4. Else (CreateIsland != 1):
   - Call ClearMap().
5. GetRandStart().
6. If CurveLevel != 0: DoRivers().
7. If LakeLevel != 0: MakeLakes().
8. SmoothRiver().
9. If TreeLevel != 0: DoTrees().
10. RandomlySeedRand().

Notes:
- The early return on the random-island path means the RNG state after MakeIsland() is preserved; RandomlySeedRand() is not called in that case.
- In the random-island path, DoTrees() is called inside MakeIsland() regardless of TreeLevel (TreeLevel still affects density).
- In the random-island path, DoRivers() and MakeLakes() are skipped entirely.

----------------------------------------------------------------
## Island Generation

### MakeNakedIsland()
1. Set every Map[x][y] = Tile.RIVER.
2. For x in [5..World.WORLD_X-6], y in [5..World.WORLD_Y-6], set Map[x][y] = Tile.DIRT (creates a 5-tile water border).
3. For x from 0 to World.WORLD_X-5, step 2:
   - MapX = x
   - MapY = ERand(RADIUS)
   - BRivPlop()
   - MapY = (World.WORLD_Y - 10) - ERand(RADIUS)
   - BRivPlop()
   - MapY = 0
   - SRivPlop()
   - MapY = World.WORLD_Y - 6
   - SRivPlop()
4. For y from 0 to World.WORLD_Y-5, step 2:
   - MapY = y
   - MapX = ERand(RADIUS)
   - BRivPlop()
   - MapX = (World.WORLD_X - 10) - ERand(RADIUS)
   - BRivPlop()
   - MapX = 0
   - SRivPlop()
   - MapX = World.WORLD_X - 6
   - SRivPlop()

Constants:
- RADIUS = 18

### MakeIsland()
- Calls MakeNakedIsland(), then SmoothRiver(), then DoTrees().
- Does not call MakeLakes(), DoRivers(), or SmoothWater().

----------------------------------------------------------------
## Rivers

### GetRandStart()
- XStart = 40 + Rand(World.WORLD_X - 80)
- YStart = 33 + Rand(World.WORLD_Y - 67)
- MapX = XStart; MapY = YStart

### MoveMap(dir)
- Direction is masked: dir = dir & 7.
- Direction table (dx, dy):
  - 0: (0, -1)
  - 1: (1, -1)
  - 2: (1, 0)
  - 3: (1, 1)
  - 4: (0, 1)
  - 5: (-1, 1)
  - 6: (-1, 0)
  - 7: (-1, -1)
- MapX += dx; MapY += dy.

### DoRivers()
1. LastDir = Rand(3); Dir = LastDir; DoBRiv().
2. MapX = XStart; MapY = YStart; LastDir = LastDir ^ 4; Dir = LastDir; DoBRiv().
3. MapX = XStart; MapY = YStart; LastDir = Rand(3); DoSRiv().

### DoBRiv()
- r1, r2:
  - If CurveLevel < 0: r1 = 100, r2 = 200.
  - Else: r1 = CurveLevel + 10, r2 = CurveLevel + 100.
- While TestBounds(MapX + 4, MapY + 4) is true:
  1. BRivPlop()
  2. Direction update:
     - If Rand(r1) < 10: Dir = LastDir.
     - Else:
       - If Rand(r2) > 90: Dir++.
       - If Rand(r2) > 90: Dir--.
  3. MoveMap(Dir).

### DoSRiv()
- r1, r2 computed exactly as in DoBRiv().
- While TestBounds(MapX + 3, MapY + 3) is true:
  1. SRivPlop()
  2. Direction update identical to DoBRiv().
  3. MoveMap(Dir).

Notes:
- LastDir is not updated inside DoBRiv/DoSRiv; it remains the initial preferred direction for the entire river.
- Dir may drift outside [0..7], but MoveMap masks it with & 7.
- The bounds checks (MapX + 4 / MapY + 4 for BRiv, MapX + 3 / MapY + 3 for SRiv) are less strict than the plop extents; PutOnMap() still clips to bounds.

----------------------------------------------------------------
## Lakes

### MakeLakes()
- Determine number of lake clusters (Lim1):
  - If LakeLevel < 0: Lim1 = Rand(10) (0..10 inclusive).
  - Else: Lim1 = LakeLevel / 2 (integer division).
- For each cluster t in [0..Lim1-1]:
  - x = Rand(World.WORLD_X - 21) + 10
  - y = Rand(World.WORLD_Y - 20) + 10
  - Lim2 = Rand(12) + 2 (2..14 inclusive)
  - For z in [0..Lim2-1]:
    - MapX = x - 6 + Rand(12)
    - MapY = y - 6 + Rand(12)
    - If Rand(4) != 0: SRivPlop() else BRivPlop().

----------------------------------------------------------------
## Trees

### DoTrees()
- Determine number of splashes (Amount):
  - If TreeLevel < 0: Amount = Rand(100) + 50 (50..150 inclusive).
  - Else: Amount = TreeLevel + 3.
- For each splash:
  - xloc = Rand(World.WORLD_X - 1)
  - yloc = Rand(World.WORLD_Y - 1)
  - TreeSplash(xloc, yloc)
- After all splashes: SmoothTrees() twice (back-to-back).

### TreeSplash(xloc, yloc)
- Determine path length (dis):
  - If TreeLevel < 0: dis = Rand(150) + 50 (50..200 inclusive).
  - Else: dis = Rand(100 + (TreeLevel * 2)) + 50.
- MapX = xloc; MapY = yloc.
- For z in [0..dis-1]:
  1. dir = Rand(7) (0..7 inclusive).
  2. MoveMap(dir).
  3. If MapX/MapY out of bounds: return immediately.
  4. If (Map[MapX][MapY] & TileMask.LOMASK) == Tile.DIRT:
     - Map[MapX][MapY] = Tile.WOODS + TileFlag.BLBNBIT.

----------------------------------------------------------------
## Plops and Placement

### PutOnMap(Mchar, Xoff, Yoff)
- If Mchar == 0: return.
- Xloc = MapX + Xoff; Yloc = MapY + Yoff.
- If out of bounds: return.
- If Map[Xloc][Yloc] is non-zero:
  - temp = Map[Xloc][Yloc] & TileMask.LOMASK.
  - If temp == Tile.RIVER and Mchar != Tile.CHANNEL: return.
  - If temp == Tile.CHANNEL: return.
- Map[Xloc][Yloc] = Mchar.

### BRivPlop()
- Uses this 9x9 matrix (rows y, columns x):
  - 0 0 0 3 3 3 0 0 0
  - 0 0 3 2 2 2 3 0 0
  - 0 3 2 2 2 2 2 3 0
  - 3 2 2 2 2 2 2 2 3
  - 3 2 2 2 4 2 2 2 3
  - 3 2 2 2 2 2 2 2 3
  - 0 3 2 2 2 2 2 3 0
  - 0 0 3 2 2 2 3 0 0
  - 0 0 0 3 3 3 0 0 0
- For each cell (x,y), call PutOnMap(matrix[y][x], x, y).

### SRivPlop()
- Uses this 6x6 matrix (rows y, columns x):
  - 0 0 3 3 0 0
  - 0 3 2 2 3 0
  - 3 2 2 2 2 3
  - 3 2 2 2 2 3
  - 0 3 2 2 3 0
  - 0 0 3 3 0 0
- For each cell (x,y), call PutOnMap(matrix[y][x], x, y).

----------------------------------------------------------------
## Smoothing

All smoothing is in-place on Map, scanning x-major order (x outer, y inner). No temporary copy is used; earlier updates can affect later checks.

### SmoothRiver()
- Processes only tiles where Map[x][y] == Tile.REDGE (exact match).
- For each such tile, compute bitindex using 4 neighbors in this order:
  - z=0: (x-1, y)
  - z=1: (x, y+1)
  - z=2: (x+1, y)
  - z=3: (x, y-1)
  - For each neighbor: bitindex = (bitindex << 1) + 1 if:
    - neighbor in bounds, AND
    - (Map[nx][ny] & TileMask.LOMASK) != Tile.DIRT, AND
    - neighbor TileMask.LOMASK is not in [WOODS_LOW..WOODS_HIGH].
- Lookup table REdTab (index 0..15):
  - [0]=13+TileFlag.BULLBIT
  - [1]=13+TileFlag.BULLBIT
  - [2]=17+TileFlag.BULLBIT
  - [3]=15+TileFlag.BULLBIT
  - [4]=5+TileFlag.BULLBIT
  - [5]=2
  - [6]=19+TileFlag.BULLBIT
  - [7]=17+TileFlag.BULLBIT
  - [8]=9+TileFlag.BULLBIT
  - [9]=11+TileFlag.BULLBIT
  - [10]=2
  - [11]=13+TileFlag.BULLBIT
  - [12]=7+TileFlag.BULLBIT
  - [13]=9+TileFlag.BULLBIT
  - [14]=5+TileFlag.BULLBIT
  - [15]=2
- temp = REdTab[bitindex & 15].
- If temp != Tile.RIVER and Rand(1) != 0: temp++ (randomly selects the alternate edge variant).
- Map[x][y] = temp.

### SmoothTrees()
- Processes only tiles where IsTree(Map[x][y]) is true (TileMask.LOMASK in [WOODS_LOW..WOODS_HIGH]).
- Compute bitindex using the same 4-neighbor order as SmoothRiver, incrementing when neighbor is also a tree.
- Lookup table TEdTab (index 0..15):
  - [0]=0  [1]=0  [2]=0  [3]=34
  - [4]=0  [5]=0  [6]=36 [7]=35
  - [8]=0  [9]=32 [10]=0 [11]=33
  - [12]=30 [13]=31 [14]=29 [15]=37
- temp = TEdTab[bitindex & 15].
- If temp != 0:
  - If temp != Tile.WOODS and ((x + y) & 1) != 0: temp = temp - 8.
  - Map[x][y] = temp + TileFlag.BLBNBIT.
- Else (temp == 0): Map[x][y] = 0.

### SmoothWater()
Three passes, each scanning x-major order.

Pass 1: mark water edges.
- If current tile TileMask.LOMASK is in [WATER_LOW..WATER_HIGH] and any 4-neighbor tile's TileMask.LOMASK is outside that range, set Map[x][y] = Tile.REDGE.

Pass 2: fill interior water.
- If current tile TileMask.LOMASK is in [WATER_LOW..WATER_HIGH] AND TileMask.LOMASK != Tile.CHANNEL AND all 4 neighbors' TileMask.LOMASK are in [WATER_LOW..WATER_HIGH], set Map[x][y] = Tile.RIVER.

Pass 3: woods adjacent to water.
- If current tile TileMask.LOMASK is in [WOODS_LOW..WOODS_HIGH] and any 4-neighbor tile is exactly Tile.RIVER or Tile.CHANNEL (raw equality, no masking), set Map[x][y] = Tile.REDGE.

----------------------------------------------------------------
## Edge Cases and Limits

- GenerateMap() early-returns on the random-island branch, skipping RandomlySeedRand(). This leaves the RNG state seeded by the map seed and advanced by island generation.
- CreateIsland random-island chance uses Rand(100) < 10; Rand(100) is 0..100 inclusive, so the probability is 10/101.
- TreeLevel == 0 disables DoTrees() in the normal pipeline, but the random-island path still calls DoTrees() (with Amount = TreeLevel + 3 = 3 splashes).
- PutOnMap() will never overwrite an existing Tile.CHANNEL tile; it will only overwrite Tile.RIVER if the new tile is Tile.CHANNEL.
- TreeSplash() stops immediately when it steps out of bounds; it does not continue elsewhere.
- SmoothTrees() may delete trees (sets Map[x][y] = 0) when the lookup yields temp == 0.
- ClearUnnatural() compares raw tile values, so any tile with high status bits set (including trees with TileFlag.BLBNBIT) is cleared.

----------------------------------------------------------------
## Source Map
- src/sim/s_gen.c (terrain generation, plops, smoothing, island logic)
- src/sim/s_sim.c (Rand, Rand16, RandomlySeedRand, SeedRand)
- src/sim/rand.c (sim_rand implementation)
- src/sim/headers/sim.h (tile IDs, status bits, map globals)
- src/sim/headers/macros.h (TestBounds macro)
- src/sim/s_alloc.c (Map allocation/layout)
- src/sim/w_sim.c (script entry points for terrain commands)
