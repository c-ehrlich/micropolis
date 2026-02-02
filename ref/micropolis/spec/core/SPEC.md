# Micropolis Core Simulation Specification

Scope
- This spec defines the simulation core: map/tile model, time step, zoning/growth, power, traffic, pollution/crime/land value, budgets, disasters, evaluation, graphs, and city-wide state.
- UI rendering, tool input, and persistence are out of scope except where the core calls into those systems.

----------------------------------------------------------------
## Data Model

### Primitive types
- Byte: unsigned 8-bit integer.
- short: signed 16-bit integer.
- QUAD: signed 32-bit integer (defined as long on non-OSF1).

### World geometry
- World.WORLD_X = 120, World.WORLD_Y = 100 (map is 120x100 tiles).
- World.HWLDX = World.WORLD_X / 2 = 60, World.HWLDY = World.WORLD_Y / 2 = 50 (2x2 tiles per cell).
- World.QWX = World.WORLD_X / 4 = 30, World.QWY = World.WORLD_Y / 4 = 25 (4x4 tiles per cell).
- World.SmX = World.WORLD_X / 8 = 15, World.SmY = (World.WORLD_Y + 7) / 8 = 13 (8x8 tiles per cell).
- Tile coordinates (x,y) are integer indices in [0..World.WORLD_X-1], [0..World.WORLD_Y-1].

### Map storage
- Map: short* Map[World.WORLD_X].
  - Map[x][y] is the 16-bit tile value for tile (x,y).
  - Map is backed by a contiguous allocation of World.WORLD_X*World.WORLD_Y shorts.
- Derived grids (all index by [x][y]):
  - PopDensity[World.HWLDX][World.HWLDY] (Byte)
  - TrfDensity[World.HWLDX][World.HWLDY] (Byte)
  - PollutionMem[World.HWLDX][World.HWLDY] (Byte)
  - LandValueMem[World.HWLDX][World.HWLDY] (Byte)
  - CrimeMem[World.HWLDX][World.HWLDY] (Byte)
  - tem[World.HWLDX][World.HWLDY] (Byte scratch)
  - tem2[World.HWLDX][World.HWLDY] (Byte scratch)
  - TerrainMem[World.QWX][World.QWY] (Byte)
  - Qtem[World.QWX][World.QWY] (Byte scratch)
  - RateOGMem[World.SmX][World.SmY] (short) rate of growth
  - FireStMap[World.SmX][World.SmY] (short) fire station coverage (smoothed)
  - PoliceMap[World.SmX][World.SmY] (short) police coverage (smoothed)
  - PoliceMapEffect[World.SmX][World.SmY] (short) snapshot for overlays
  - FireRate[World.SmX][World.SmY] (short) fire risk map
  - ComRate[World.SmX][World.SmY] (short) commercial desirability by distance
  - STem[World.SmX][World.SmY] (short scratch)

### Power map
- PowerMap is a bitset array of shorts.
- PowerMap.POWERMAPROW = (World.WORLD_X + 15) / 16 = 8.
- POWERWORD(x,y) = (x >> 4) + (y * PowerMap.POWERMAPROW) for non-MEGA builds.
- PowerMap.PWRMAPSIZE = PowerMap.POWERMAPROW * World.WORLD_Y = 800.
- PowerMap.POWERMAPLEN = 1700 (allocated size; only first PowerMap.PWRMAPSIZE words are used).
- SETPOWERBIT(x,y): PowerMap[POWERWORD(x,y)] |= (1 << (x & 15)).

### History arrays
- HISTLEN = 480 bytes, MISCHISTLEN = 240 bytes.
- ResHis, ComHis, IndHis, MoneyHis, PollutionHis, CrimeHis: short arrays of 240 entries (indices 0..239).
- MiscHis: short array of 120 entries.

### Global simulation state (selected)
- CityTime (QUAD): simulation ticks (incremented in Simulate case 0).
- StartingYear (short), CityTax (short), GameLevel (short 0..2).
- SimSpeed (short 0..3), SimMetaSpeed (short).
- TotalFunds (QUAD) current money.
- Demand valves: RValve (short), CValve (short), IValve (short).
- Population counts (short): ResPop, ComPop, IndPop, TotalPop, etc.
- CityScore (short 0..1000), CityClass (short 0..5).
- Disaster state: DisasterEvent, DisasterWait, FloodCnt, FloodX/Y, MeltX/Y.

----------------------------------------------------------------
## Tile Encoding

### Tile word layout
- Map tile is a 16-bit short.
- Low 10 bits (mask TileMask.LOMASK = 1023) store tile ID.
- High 6 bits store flags (mask TileMask.ALLBITS = 64512).

### Status bits
- TileFlag.PWRBIT  = 0x8000 (bit 15): zone has power.
- TileFlag.CONDBIT = 0x4000 (bit 14): conductive (used by power scan).
- TileFlag.BURNBIT = 0x2000 (bit 13): burnable / floodable marker.
- TileFlag.BULLBIT = 0x1000 (bit 12): bulldozable marker.
- TileFlag.ANIMBIT = 0x0800 (bit 11): animated.
- TileFlag.ZONEBIT = 0x0400 (bit 10): zone center.

### Important tile ID constants
(IDs are low 10 bits; see sim.h for full list.)
- Terrain: Tile.DIRT=0, Tile.RIVER=2, Tile.REDGE=3, Tile.CHANNEL=4, Tile.FIRSTRIVEDGE=5..Tile.LASTRIVEDGE=20, Tile.TREEBASE=21..Tile.LASTTREE=36, Tile.WOODS=37, Tile.WOODS2=40..Tile.WOODS5=43.
- Rubble/Flood/Fire: Tile.RUBBLE=44..Tile.LASTRUBBLE=47, Tile.FLOOD=48..Tile.LASTFLOOD=51, Tile.RADTILE=52, Tile.FIREBASE=56..Tile.LASTFIRE=63.
- Roads: Tile.ROADBASE=64..Tile.LASTROAD=206, Tile.LTRFBASE=80, Tile.HTRFBASE=144, Tile.BRWH=79, Tile.BRWV=95, Tile.HBRDG0..3=828..831, Tile.VBRDG0..3=948..951.
- Power lines: Tile.POWERBASE=208..Tile.LASTPOWER=222.
- Rails: Tile.RAILBASE=224..Tile.LASTRAIL=238, Tile.RAILHPOWERV=221, Tile.RAILVPOWERH=222, Tile.ROADVPOWERH=239.
- Zones: Tile.RESBASE=240, Tile.FREEZ=244, Tile.HOUSE=249, Tile.LHTHR=249..Tile.HHTHR=260, Tile.RZB=265, Tile.HOSPITAL=409, Tile.CHURCH=418, Tile.COMBASE=423, Tile.COMCLR=427, Tile.CZB=436, Tile.INDBASE=612, Tile.INDCLR=616, Tile.IZB=625, Tile.PORTBASE=693, Tile.PORT=698..Tile.LASTPORT=708, Tile.AIRPORTBASE=709, Tile.AIRPORT=716, Tile.COALBASE=745, Tile.POWERPLANT=750..Tile.LASTPOWERPLANT=760, Tile.FIRESTBASE=761, Tile.FIRESTATION=765, Tile.POLICESTBASE=770, Tile.POLICESTATION=774, Tile.STADIUMBASE=779, Tile.STADIUM=784, Tile.FULLSTADIUM=800, Tile.NUCLEARBASE=811, Tile.NUCLEAR=816, Tile.LASTZONE=826.
- Smoke/animation: Tile.SMOKEBASE=852, Tile.COALSMOKE1..4=916..928, Tile.FOOTBALLGAME1..2=932..940, Tile.TINYEXP range Tile.SOMETINYEXP=864..Tile.LASTTINYEXP=867.

----------------------------------------------------------------
## Random Number Generation

- sim_rand() returns an unsigned 16-bit integer (0..65535) using a linear congruential generator:
  - next = next * 1103515245 + 12345
  - return ((next % ((65536) << 8)) >> 8)
- sim_srand(seed) sets next = seed.
- Rand16() returns sim_rand().
- Rand16Signed() returns sim_rand(), but if > 32767, returns 32767 - value, yielding a signed range [-32768..32767].
- Rand(range): inclusive range selection.
  - range is incremented by 1; rejection sampling ensures uniformity.
  - return value is in [0..range] after the increment (so Rand(5) yields 0..5).
- RandomlySeedRand() seeds with current time: SeedRand(tv_usec ^ tv_sec ^ sim_rand()).

----------------------------------------------------------------
## Simulation Time and Scheduling

### SimFrame
- If SimSpeed == 0, return immediately.
- Spdcycle increments mod 1024 each call.
- If SimSpeed == 1 and (Spdcycle % 5) != 0, return.
- If SimSpeed == 2 and (Spdcycle % 3) != 0, return.
- Fcycle increments mod 1024 each call.
- Call Simulate(Fcycle & 15) (16-phase cycle).

### Simulate(mod16)
Speed-dependent scan rates (x = min(SimSpeed, 3)):
- SpdPwr = {1, 2, 4, 5}
- SpdPtl = {1, 2, 7, 17}
- SpdCri = {1, 1, 8, 18}
- SpdPop = {1, 1, 9, 19}
- SpdFir = {1, 1, 10, 20}

Phase actions:
- Case 0:
  - Scycle++ mod 1024.
  - If DoInitialEval: CityEvaluation() once, then clear flag.
  - CityTime++.
  - AvCityTax += CityTax.
  - If (Scycle & 1) == 0: SetValves().
  - ClearCensus().
- Cases 1..8: MapScan is spread across 8 vertical slices:
  - MapScan(0, 1*World.WORLD_X/8), MapScan(1*World.WORLD_X/8, 2*World.WORLD_X/8), ..., MapScan(7*World.WORLD_X/8, World.WORLD_X).
- Case 9:
  - If CityTime % CENSUSRATE == 0 (CENSUSRATE=4): TakeCensus().
  - If CityTime % (CENSUSRATE*12) == 0 (48): Take2Census().
  - If CityTime % TAXFREQ == 0 (TAXFREQ=48): CollectTax(); CityEvaluation().
- Case 10:
  - If Scycle % 5 == 0: DecROGMem().
  - DecTrafficMem().
  - Mark maps dirty: NewMapFlags[TDMAP,RDMAP,ALMAP,REMAP,COMAP,INMAP,DYMAP]=1.
  - SendMessages().
- Case 11:
  - If Scycle % SpdPwr[x] == 0: DoPowerScan(); NewMapFlags[PRMAP]=1; NewPower=1.
- Case 12:
  - If Scycle % SpdPtl[x] == 0: PTLScan().
- Case 13:
  - If Scycle % SpdCri[x] == 0: CrimeScan().
- Case 14:
  - If Scycle % SpdPop[x] == 0: PopDenScan().
- Case 15:
  - If Scycle % SpdFir[x] == 0: FireAnalysis().
  - DoDisasters().

----------------------------------------------------------------
## Initialization and Reset

### initMapArrays()
- Allocates all map arrays and history buffers.
- Map is a contiguous short array of World.WORLD_X*World.WORLD_Y; Map[x] pointers are set to column starts.
- All 2x2, 4x4, 8x8 arrays are allocated and indexed by x-major order.
- History arrays are allocated as byte counts: HISTLEN (480) -> 240 shorts; MISCHISTLEN (240) -> 120 shorts.
- PowerMap allocated with PowerMap.POWERMAPLEN (1700) shorts.

### InitWillStuff()
- Seeds RNG, initializes graphs, sets defaults.
- Sets RoadEffect=32, PoliceEffect=1000, FireEffect=1000.
- CityScore=500, CityPop=-1, LastCityTime/Year/Month/Funds=-1.
- Clears maps: PopDensity, TrfDensity, PollutionMem, LandValueMem, CrimeMem, TerrainMem, RateOGMem, FireRate, ComRate, PoliceMap, PoliceMapEffect, FireStMap.
- Resets message state, funds/budget state, UpdateDelayed, ValveFlag.
- Destroys all sprites.
- DisasterEvent=0, TaxFlag=0.
- Resets key state, starts new game (DoNewGame), updates headers.

### DoSimInit()
- Fcycle = 0; Scycle = 0.
- If InitSimLoad == 2 (new city), InitSimMemory().
- If InitSimLoad == 1 (loaded city), SimLoadInit().
- SetValves(); ClearCensus(); MapScan(0, World.WORLD_X).
- DoPowerScan(); NewPower = 1.
- PTLScan(); CrimeScan(); PopDenScan(); FireAnalysis().
- NewMap = 1; doAllGraphs(); NewGraph = 1; TotalPop = 1; DoInitialEval = 1.

### InitSimMemory() (new city)
- Clears histories (Res/Com/Ind = 0; Money = 128; Crime/Pollution = 0).
- Clears ramps and valves (CrimeRamp, PolluteRamp, RValve, CValve, IValve, ResCap, ComCap, IndCap).
- EMarket = 6.0.
- DisasterEvent = 0; ScoreType = 0.
- PowerStackNum = 0; DoPowerScan(); NewPower=1.
- InitSimLoad = 0.

### SimLoadInit() (loaded city)
- Loads from MiscHis:
  - EMarket (index 1), ResPop (2), ComPop (3), IndPop (4), RValve (5), CValve (6), IValve (7), CrimeRamp (10), PolluteRamp (11), LVAverage (12), CrimeAverage (13), PolluteAverage (14), GameLevel (15), CityClass (16), CityScore (17).
- Validates ranges: CityTime >= 0; EMarket default 4.0; GameLevel 0..2; CityClass 0..5; CityScore 1..999 (else 500).
- Sets GameLevel with SetGameLevel().
- ResCap/ComCap/IndCap set to 0.
- AvCityTax = (CityTime % 48) * 7.
- PowerMap set to all 1 bits (first PowerMap.PWRMAPSIZE entries); DoNilPower() to mark TileFlag.PWRBIT on zones.
- ScenarioID clamped to 0..8. If ScenarioID > 0:
  - DisasterEvent = ScenarioID; DisasterWait = DisTab[ScenarioID];
  - ScoreType = ScenarioID; ScoreWait = ScoreWaitTab[ScenarioID].
- RoadEffect=32, PoliceEffect=1000, FireEffect=1000.
- InitSimLoad = 0.

### DoNilPower()
- Scans entire map; for each tile with TileFlag.ZONEBIT set, sets SMapX/Y, CChr, then SetZPower() to apply TileFlag.PWRBIT.

----------------------------------------------------------------
## Map Scan Pass

### MapScan(x1, x2)
For each x in [x1..x2-1], y in [0..World.WORLD_Y-1]:
- If Map[x][y] != 0:
  - CChr = Map[x][y]; CChr9 = CChr & TileMask.LOMASK; SMapX=x; SMapY=y.
  - If CChr9 < Tile.FLOOD (48): skip (no processing).
  - If CChr9 < Tile.ROADBASE (64):
    - If CChr9 >= Tile.FIREBASE (56):
      - FirePop++.
      - 25% chance: DoFire().
    - Else if CChr9 < Tile.RADTILE (52): DoFlood().
    - Else: DoRadTile().
    - Continue to next tile.
  - If NewPower && (CChr & TileFlag.CONDBIT): SetZPower().
  - If Tile.ROADBASE <= CChr9 < Tile.POWERBASE: DoRoad(); continue.
  - If (CChr & TileFlag.ZONEBIT): DoZone(); continue.
  - If Tile.RAILBASE <= CChr9 < Tile.RESBASE: DoRail(); continue.
  - If Tile.SOMETINYEXP <= CChr9 <= Tile.LASTTINYEXP: Map[x][y] = Tile.RUBBLE + (Rand16() & 3) + TileFlag.BULLBIT.

### Road deterioration and traffic rendering (DoRoad)
- RoadTotal++ each road tile.
- Deterioration when RoadEffect < 30:
  - If (Rand16() & 511) == 0 and (CChr & TileFlag.CONDBIT) == 0 and RoadEffect < (Rand16() & 31):
    - If ((CChr9 & 15) < 2) or ((CChr9 & 15) == 15): set to Tile.RIVER.
    - Else set to Tile.RUBBLE + (Rand16() & 3) + TileFlag.BULLBIT.
    - Return.
- If (CChr & TileFlag.BURNBIT) == 0, treat as bridge:
  - RoadTotal += 4.
  - If DoBridge() returns TRUE, return.
- Traffic density visualization:
  - tden from tile: 0 if CChr9 < Tile.LTRFBASE, 1 if < Tile.HTRFBASE, else 2 (and RoadTotal++ again for heavy).
  - Density = (TrfDensity[SMapX>>1][SMapY>>1] >> 6); if >1 then Density--. (Density in 0..2)
  - If tden != Density: set tile to same road shape with DenTab[Density] base.
    - DenTab = { Tile.ROADBASE, Tile.LTRFBASE, Tile.HTRFBASE }.
    - z = ((CChr9 - Tile.ROADBASE) & 15) + DenTab[Density].
    - Keep all status bits except TileFlag.ANIMBIT: z += CChr & (TileMask.ALLBITS - TileFlag.ANIMBIT).
    - If Density > 0, add TileFlag.ANIMBIT.
    - Map[SMapX][SMapY] = z.

### Rail deterioration (DoRail)
- RailTotal++ each rail tile.
- GenerateTrain(SMapX,SMapY) (external hook).
- Deterioration when RoadEffect < 30:
  - If (Rand16() & 511) == 0 and (CChr & TileFlag.CONDBIT) == 0 and RoadEffect < (Rand16() & 31):
    - If CChr9 < (Tile.RAILBASE + 2): set to Tile.RIVER.
    - Else set to Tile.RUBBLE + (Rand16() & 3) + TileFlag.BULLBIT.

### Bridge open/close (DoBridge)
- Uses boat sprite distance from GetBoatDis().
- If tile is Tile.BRWV (vertical closed bridge) and (Rand16() & 3) == 0 and GetBoatDis() > 340:
  - Replace a 7-tile pattern around (SMapX,SMapY) with open-bridge pattern VBRTAB2.
- If tile is Tile.BRWH (horizontal closed bridge) and same random and distance condition:
  - Replace 7-tile pattern with HBRTAB2.
- If GetBoatDis() < 300 or (Rand16() & 7) == 0:
  - If bridge is vertical (CChr9 & 1): check right neighbor == Tile.CHANNEL, then place VBRTAB open pattern over 7 tiles.
  - Else (horizontal): check tile above == Tile.CHANNEL, then place HBRTAB open pattern.
- Returns TRUE if any bridge open/close operation performed.

### Fire behavior (DoFire)
- Attempts to spread to 4 neighbors; each neighbor has 1/8 chance:
  - If neighbor tile has TileFlag.BURNBIT set:
    - If neighbor tile has TileFlag.ZONEBIT, call FireZone on that zone; if zone ID > Tile.IZB then MakeExplosionAt(center of tile).
    - Set neighbor tile to Tile.FIRE + (Rand16() & 3) + TileFlag.ANIMBIT.
- Fire burnout:
  - Rate = 10 by default; if FireRate[SMapX>>3][SMapY>>3] > 0 then Rate=3; >20 -> 2; >100 -> 1.
  - If Rand(Rate) == 0: replace current fire tile with Tile.RUBBLE + (Rand16() & 3) + TileFlag.BULLBIT.

### FireZone(Xloc,Yloc,ch)
- Decreases RateOGMem[Xloc>>3][Yloc>>3] by 20.
- Determine XYmax based on zone type (ch & TileMask.LOMASK):
  - If ch < Tile.PORTBASE: XYmax = 2.
  - Else if ch == Tile.AIRPORT: XYmax = 5.
  - Else XYmax = 4.
- For x in [-1..XYmax-1], y in [-1..XYmax-1]:
  - If in bounds and Map[x][y] has TileMask.LOMASK >= Tile.ROADBASE, set TileFlag.BULLBIT on that tile.

### Radiation decay (DoRadTile)
- If (Rand16() & 4095) == 0: Map[SMapX][SMapY] = 0 (Tile.DIRT).

----------------------------------------------------------------
## Power System

### Power stack
- PowerStackX/Y: arrays of length PWRSTKSIZE = (World.WORLD_X*World.WORLD_Y)/4.
- PowerStackNum is stack pointer (1-based in code).

### PushPowerStack()
- If PowerStackNum < PWRSTKSIZE - 2: increment and store SMapX/Y.

### PullPowerStack()
- If PowerStackNum > 0: set SMapX/Y to top and decrement.

### TestForCond(TFDir)
- Temporarily MoveMapSim(TFDir) (0=up,1=right,2=down,3=left).
- Returns TRUE if neighbor is conductive and not already powered:
  - Neighbor must have TileFlag.CONDBIT set.
  - Neighbor must not be powered in PowerMap (bit 0 for that x in PowerWord).
  - Additional check: CChr9 is not Tile.NUCLEAR or Tile.POWERPLANT. Note: CChr9 is not updated by DoPowerScan, so this compares against the last global CChr9 value.
- Restores SMapX/Y to original before return.

### DoPowerScan()
- Clears PowerMap[0..PowerMap.PWRMAPSIZE-1] to 0.
- MaxPower = CoalPop * 700 + NuclearPop * 2000.
- NumPower = 0.
- Capacity quirk: MaxPower uses total CoalPop/NuclearPop counts from MapScan, regardless of whether plants are connected to the powered network; disconnected plants still increase the global capacity limit.
- While PowerStackNum > 0:
  - PullPowerStack(); ADir = 4.
  - Do/while loop:
    - NumPower++; if NumPower > MaxPower: SendMes(40) and return.
    - MoveMapSim(ADir) (ADir==4 means no move).
    - SETPOWERBIT(SMapX,SMapY).
    - ConNum = 0; Dir=0..3 until ConNum >= 2:
      - If TestForCond(Dir) is TRUE: ConNum++; ADir = Dir.
    - If ConNum > 1: PushPowerStack().
    - Continue while ConNum > 0.

### SetZPower()
- Called on zone center (SMapX/SMapY, CChr/CChr9).
- If CChr9 is Tile.NUCLEAR or Tile.POWERPLANT, or PowerMap bit at (SMapX,SMapY) is set, then set TileFlag.PWRBIT on Map tile and return 1.
- Else clear TileFlag.PWRBIT and return 0.

----------------------------------------------------------------
## Zoning and Growth

### DoZone()
- ZonePwrFlg = SetZPower(); increment PwrdZCnt or unPwrdZCnt.
- Dispatch based on CChr9:
  - If CChr9 > Tile.PORTBASE: DoSPZone(ZonePwrFlg).
  - Else if CChr9 < Tile.HOSPITAL: DoResidential(ZonePwrFlg).
  - Else if CChr9 < Tile.COMBASE: DoHospChur().
  - Else if CChr9 < Tile.INDBASE: DoCommercial(ZonePwrFlg).
  - Else DoIndustrial(ZonePwrFlg).

### Special zones (DoSPZone)
- Tile.POWERPLANT:
  - CoalPop++; every 8 CityTime ticks: RepairZone(Tile.POWERPLANT,4).
  - PushPowerStack(); CoalSmoke(SMapX,SMapY).
- Tile.NUCLEAR:
  - If !NoDisasters and Rand(MltdwnTab[GameLevel]) == 0: DoMeltdown(SMapX,SMapY) and return.
  - NuclearPop++; every 8 ticks: RepairZone(Tile.NUCLEAR,4). PushPowerStack().
- Tile.FIRESTATION:
  - FireStPop++; every 8 ticks: RepairZone(Tile.FIRESTATION,3).
  - z = FireEffect (powered) or FireEffect/2 (unpowered).
  - If no perimeter road (FindPRoad() == FALSE), z /= 2.
  - FireStMap[SMapX>>3][SMapY>>3] += z.
- Tile.POLICESTATION:
  - PolicePop++; every 8 ticks: RepairZone(Tile.POLICESTATION,3).
  - z = PoliceEffect (powered) or PoliceEffect/2 (unpowered).
  - If no perimeter road, z /= 2.
  - PoliceMap[SMapX>>3][SMapY>>3] += z.
- Tile.STADIUM:
  - StadiumPop++; every 16 ticks: RepairZone(Tile.STADIUM,4).
  - If powered and (CityTime + SMapX + SMapY) % 32 == 0: DrawStadium(Tile.FULLSTADIUM); set two football tiles animated.
- Tile.FULLSTADIUM:
  - StadiumPop++; if (CityTime + SMapX + SMapY) % 8 == 0: DrawStadium(Tile.STADIUM).
- Tile.AIRPORT:
  - APortPop++; every 8 ticks: RepairZone(Tile.AIRPORT,6).
  - Radar tile at (SMapX+1, SMapY-1) gets TileFlag.ANIMBIT if powered, else not.
  - If powered: DoAirport() (random plane/copter).
- Tile.PORT:
  - PortPop++; every 16 ticks: RepairZone(Tile.PORT,4).
  - If powered and no ship sprite exists: GenerateShip().
  - No simulation-side adjacency check to water.

### RepairZone(ZCent, zsize)
- zsize is zone dimension (3 for 3x3, 4 for 4x4, 6 for 6x6). It decrements zsize then uses that as loop limit.
- Loops over a square from (-1,-1) to (zsize-1, zsize-1) relative to SMapX/SMapY.
- For each tile in bounds:
  - Skip if tile has TileFlag.ZONEBIT or TileFlag.ANIMBIT.
  - If low tile ID < Tile.RUBBLE or >= Tile.ROADBASE, set to ZCent - 3 - zsize + cnt + TileFlag.CONDBIT + TileFlag.BURNBIT.
  - cnt increments each cell; this restores original zone pattern.

### Residential growth
- RZPop(Ch9): returns (( (Ch9 - Tile.RZB) / 9 ) % 4) * 8 + 16.
- Tile.FREEZ zones (low-density): population is DoFreePop() (houses around).
- DoResidential(ZonePwrFlg):
  - ResZPop++; tpop = Tile.FREEZ ? DoFreePop() : RZPop(CChr9); ResPop += tpop.
  - If tpop > Rand(35): TrfGood = MakeTraf(0); else TrfGood = TRUE.
  - If TrfGood == -1: value = GetCRVal(); DoResOut(tpop,value); return.
  - If Tile.FREEZ or (Rand16() & 7) == 0:
    - locvalve = EvalRes(TrfGood); zscore = RValve + locvalve; if not powered, zscore = -500.
    - If zscore > -350 and (short)(zscore - 26380) > (short)Rand16Signed():
      - If tpop == 0 and (Rand16() & 3) == 0: MakeHosp(); return.
      - value = GetCRVal(); DoResIn(tpop,value); return.
    - If zscore < 350 and (short)(zscore + 26380) < (short)Rand16Signed():
      - value = GetCRVal(); DoResOut(tpop,value).

#### DoResIn(pop,value)
- If PollutionMem[SMapX>>1][SMapY>>1] > 128: return.
- If Tile.FREEZ:
  - If pop < 8: BuildHouse(value); IncROG(1); return.
  - If PopDensity[SMapX>>1][SMapY>>1] > 64: ResPlop(0,value); IncROG(8); return.
  - Otherwise return.
- Else (non-Tile.FREEZ): if pop < 40, ResPlop((pop/8)-1, value) and IncROG(8).

#### DoResOut(pop,value)
- If pop == 0: return.
- If pop > 16: ResPlop(((pop - 24)/8), value); IncROG(-8); return.
- If pop == 16:
  - IncROG(-8);
  - Set center to Tile.FREEZ with TileFlag.BLBNCNBIT|TileFlag.ZONEBIT.
  - For each tile in 3x3 around center (except center): if not Tile.FREEZ, set to Tile.LHTHR + value + Rand(2) + TileFlag.BLBNCNBIT.
- If pop < 16:
  - IncROG(-1);
  - Scan 3x3 area in a fixed order; if a house tile (Tile.LHTHR..Tile.HHTHR) found, replace it with a border tile (Tile.FREEZ-4 + Brdr[z] + TileFlag.BLBNCNBIT) and return.

### Commercial growth
- CZPop(Ch9): if Tile.COMCLR -> 0; else (( (Ch9 - Tile.CZB)/9 ) % 5) + 1.
- DoCommercial(ZonePwrFlg):
  - ComZPop++; tpop = CZPop(CChr9); ComPop += tpop.
  - If tpop > Rand(5): TrfGood = MakeTraf(1); else TRUE.
  - If TrfGood == -1: value=GetCRVal(); DoComOut(tpop,value); return.
  - If (Rand16() & 7) == 0:
    - locvalve = EvalCom(TrfGood); zscore = CValve + locvalve; if not powered, zscore = -500.
    - If TrfGood && zscore > -350 and (short)(zscore - 26380) > (short)Rand16Signed():
      - value=GetCRVal(); DoComIn(tpop,value); return.
    - If zscore < 350 and (short)(zscore + 26380) < (short)Rand16Signed():
      - value=GetCRVal(); DoComOut(tpop,value).

#### DoComIn(pop,value)
- z = LandValueMem[SMapX>>1][SMapY>>1] >> 5; if pop > z return.
- If pop < 5: ComPlop(pop,value); IncROG(8).

#### DoComOut(pop,value)
- If pop > 1: ComPlop(pop-2,value); IncROG(-8); return.
- If pop == 1: ZonePlop(Tile.COMBASE); IncROG(-8).

### Industrial growth
- IZPop(Ch9): if Tile.INDCLR -> 0; else (( (Ch9 - Tile.IZB)/9 ) % 4) + 1.
- DoIndustrial(ZonePwrFlg):
  - IndZPop++; SetSmoke(ZonePwrFlg); tpop = IZPop(CChr9); IndPop += tpop.
  - If tpop > Rand(5): TrfGood = MakeTraf(2); else TRUE.
  - If TrfGood == -1: DoIndOut(tpop, Rand16() & 1); return.
  - If (Rand16() & 7) == 0:
    - zscore = IValve + EvalInd(TrfGood); if not powered, zscore = -500.
    - If zscore > -350 and (short)(zscore - 26380) > (short)Rand16Signed(): DoIndIn(tpop, Rand16() & 1); return.
    - If zscore < 350 and (short)(zscore + 26380) < (short)Rand16Signed(): DoIndOut(tpop, Rand16() & 1).

#### DoIndIn(pop,value)
- If pop < 4: IndPlop(pop,value); IncROG(8).

#### DoIndOut(pop,value)
- If pop > 1: IndPlop(pop-2,value); IncROG(-8); return.
- If pop == 1: ZonePlop(Tile.INDCLR - 4); IncROG(-8).

### Hospital and church
- DoHospChur():
  - If Tile.HOSPITAL: HospPop++; every 16 ticks RepairZone(Tile.HOSPITAL,3). If NeedHosp == -1 and Rand(20) == 0, ZonePlop(Tile.RESBASE).
  - If Tile.CHURCH: ChurchPop++; every 16 ticks RepairZone(Tile.CHURCH,3). If NeedChurch == -1 and Rand(20) == 0, ZonePlop(Tile.RESBASE).
- MakeHosp():
  - If NeedHosp > 0: ZonePlop(Tile.HOSPITAL - 4); NeedHosp = FALSE; return.
  - Else if NeedChurch > 0: ZonePlop(Tile.CHURCH - 4); NeedChurch = FALSE.

### Zone plopping
- ResPlop(Den,Value): base = (((Value*4)+Den)*9) + Tile.RZB - 4; ZonePlop(base).
- ComPlop(Den,Value): base = (((Value*5)+Den)*9) + Tile.CZB - 4; ZonePlop(base).
- IndPlop(Den,Value): base = (((Value*4)+Den)*9) + Tile.IZB - 4; ZonePlop(base).
- ZonePlop(base):
  - First pass: if any tile in 3x3 around center has TileMask.LOMASK in [Tile.FLOOD..Tile.ROADBASE-1], abort (returns FALSE).
  - Second pass: set each 3x3 tile to base + TileFlag.BNCNBIT (TileFlag.BURNBIT|TileFlag.CONDBIT), incrementing base per tile.
  - Update CChr = Map[SMapX][SMapY], SetZPower(), and set TileFlag.ZONEBIT|TileFlag.BULLBIT on center tile.

### Land value and demand helpers
- GetCRVal():
  - LVal = LandValueMem[x>>1][y>>1] - PollutionMem[x>>1][y>>1].
  - Return 0 if <30, 1 if <80, 2 if <150, else 3.
- EvalRes(traf):
  - If traf < 0: return -3000.
  - Value = LandValueMem - PollutionMem; clamp to >=0; Value <<= 5 (x32); clamp to <=6000; return Value - 3000.
- EvalCom(traf):
  - If traf < 0: return -3000; else return ComRate[x>>3][y>>3].
- EvalInd(traf):
  - If traf < 0: return -1000; else return 0.

### House placement (BuildHouse)
- Scans 8 neighboring tiles (ordered by ZeX/ZeY).
- EvalLot(x,y):
  - If tile is non-zero and not in [Tile.RESBASE..Tile.RESBASE+8], return -1.
  - Score = 1 + number of adjacent (N,E,S,W) tiles that are non-zero and TileMask.LOMASK <= Tile.LASTROAD.
- Pick highest score; ties broken with 1/8 chance to switch.
- If a location selected, set tile to Tile.HOUSE + TileFlag.BLBNCNBIT + Rand(2) + (value * 3).

### Rate of growth
- IncROG(amount): RateOGMem[SMapX>>3][SMapY>>3] += amount << 2.
- DecROGMem(): each World.SmX/World.SmY cell moves 1 step toward 0; clamp to [-200,200].

----------------------------------------------------------------
## Traffic System

### MakeTraf(Zt)
- Zt: 0=residential, 1=commercial, 2=industrial.
- Saves SMapX/Y; sets Zsource=Zt; clears PosStackN.
- If FindPRoad() fails: return -1.
- If TryDrive() succeeds: SetTrafMem(); restore SMapX/Y; return TRUE.
- Else restore SMapX/Y; return FALSE.

### FindPRoad()
- Checks 12 perimeter tiles around zone center (predefined offsets) for RoadTest().
- On first match, sets SMapX/Y to road location and returns TRUE.
- Else returns FALSE.

### TryDrive()
- Performs random walk up to MAXDIS=30 steps.
- Uses TryGo(z) for each step; if dead end and PosStackN>0, backtrack (PosStackN--) and skip 3 steps (z+=3).
- If DriveDone() returns TRUE at any step, returns TRUE.
- If cannot progress and stack empty, returns FALSE.

### TryGo(z)
- Random direction start rdir = Rand16() & 3.
- Try 4 directions (rdir..rdir+3), skipping LDir (last direction backtrack).
- If RoadTest(neighbor tile) is TRUE:
  - MoveMapSim(direction), set LDir = (direction + 2) & 3.
  - If z is odd, PushPos() (save position).
  - Return TRUE.
- If none, return FALSE.

### DriveDone()
- For Zsource (0/1/2), target ranges:
  - TARGL = { Tile.COMBASE, Tile.LHTHR, Tile.LHTHR }
  - TARGH = { Tile.NUCLEAR, Tile.PORT, Tile.COMBASE }
- If any adjacent tile (N,E,S,W) has TileMask.LOMASK in [TARGL[Zsource]..TARGH[Zsource]], return TRUE.
- Else FALSE.

### SetTrafMem()
- For each saved position in stack:
  - If Map tile is in road range (Tile.ROADBASE..Tile.POWERBASE-1):
    - z = TrfDensity[x>>1][y>>1] + 50.
    - If z > 240 and Rand(5) == 0:
      - z = 240; set TrafMaxX/Y = (x<<4, y<<4).
      - If a COP sprite exists with control == -1: set its dest_x/dest_y to TrafMax.
    - Store TrfDensity[x>>1][y>>1] = z.

### RoadTest(tile)
- x = tile & TileMask.LOMASK.
- Returns TRUE if:
  - x >= Tile.ROADBASE, x <= Tile.LASTRAIL, and
  - NOT (Tile.POWERBASE <= x < Tile.RAILHPOWERV).

### Traffic decay
- DecTrafficMem():
  - For each TrfDensity cell:
    - If z > 24: z -= 34 if z > 200 else z -= 24.
    - Else set to 0.

----------------------------------------------------------------
## Pollution, Terrain, Land Value

### PTLScan()
- Clears Qtem (4x4 grid) to 0.
- For each 2x2 cell (x,y in World.HWLDX/World.HWLDY):
  - Plevel=0, LVflag=0.
  - For each of 4 tiles in that 2x2 cell:
    - loc = Map[Mx][My] & TileMask.LOMASK.
    - If loc == 0: continue.
    - If loc < Tile.RUBBLE: Qtem[x>>1][y>>1] += 15 (terrain boost). Continue.
    - Plevel += GetPValue(loc).
    - If loc >= Tile.ROADBASE: LVflag++.
  - Clamp Plevel to 255; tem[x][y] = Plevel.
  - If LVflag > 0:
    - dis = 34 - GetDisCC(x,y); dis <<= 2;
    - dis += TerrainMem[x>>1][y>>1];
    - dis -= PollutionMem[x][y];
    - if CrimeMem[x][y] > 190, dis -= 20;
    - clamp dis to [1..250]; LandValueMem[x][y] = dis.
    - accumulate LVAverage (LVtot/LVnum).
  - Else LandValueMem[x][y]=0.
- Smooth pollution: DoSmooth(); DoSmooth2().
- For each 2x2 cell: PollutionMem[x][y] = tem[x][y]; compute PolluteAverage over non-zero cells; track max pollution (PolMaxX/Y) with random tie-break (1/4 chance).
- SmoothTerrain() updates TerrainMem based on Qtem.
- Mark NewMapFlags[DYMAP,PLMAP,LVMAP]=1.

### GetPValue(loc)
- If loc < Tile.POWERBASE:
  - If loc >= Tile.HTRFBASE: return 75.
  - Else if loc >= Tile.LTRFBASE: return 50.
  - Else if loc > Tile.FIREBASE: return 90.
  - Else if loc >= Tile.RADTILE: return 255 (radioactivity).
  - Else return 0.
- If loc <= LASTIND: return 0.
- If loc < Tile.PORTBASE: return 50 (industrial).
- If loc <= Tile.LASTPOWERPLANT: return 100 (ports, airports, coal, nuclear).
- Else return 0.

### GetDisCC(x,y)
- Computes manhattan distance from city center (CCx2, CCy2) in 2x2 grid units.
- Returns min(distance, 32).

### SmoothTerrain()
- If (DonDither & 1): serpentine dithering smoothing using Qtem neighbors and internal accumulator.
- Else: for each cell, TerrainMem = ((sum of 4 neighbors >>2) + Qtem) >>1.

----------------------------------------------------------------
## Crime

### CrimeScan()
- SmoothPSMap() three times on PoliceMap (8x8 grid).
- For each 2x2 cell (x,y):
  - If LandValueMem[x][y] == 0: CrimeMem[x][y]=0.
  - Else:
    - z = 128 - LandValueMem[x][y];
    - z += PopDensity[x][y]; if z > 300, z = 300.
    - z -= PoliceMap[x>>2][y>>2]; clamp to [0..250].
    - CrimeMem[x][y] = z; accumulate CrimeAverage over non-zero cells.
    - Track CrimeMaxX/Y (tie-break: if equal and Rand16()&3 == 0).
- PoliceMapEffect = PoliceMap (copy after smoothing).
- Mark NewMapFlags[DYMAP,CRMAP,POMAP]=1.

### SmoothPSMap()
- For each World.SmX/World.SmY cell, averages 4-neighbor PoliceMap values, then halves:
  - edge = (neighbors sum >>2) + PoliceMap[x][y]; STem = edge >>1.
- Copies STem back into PoliceMap.

----------------------------------------------------------------
## Population Density and Commercial Rate

### PopDenScan()
- Clears tem (2x2 grid).
- For each tile (x,y): if Map[x][y] has TileFlag.ZONEBIT:
  - SMapX/SMapY = x/y; z = GetPDen(Map[x][y] & TileMask.LOMASK) << 3; clamp to <=254.
  - tem[x>>1][y>>1] = z.
  - Accumulate Xtot, Ytot, Ztot for city center.
- Smooth data: DoSmooth(), DoSmooth2(), DoSmooth().
- PopDensity[x][y] = tem2[x][y] << 1.
- DistIntMarket(): sets ComRate based on distance to city center.
- City center:
  - If Ztot > 0: CCx = Xtot / Ztot; CCy = Ytot / Ztot.
  - Else: CCx = World.HWLDX; CCy = World.HWLDY.
  - CCx2 = CCx >> 1; CCy2 = CCy >> 1.
- Mark NewMapFlags[DYMAP,PDMAP,RGMAP]=1.

### GetPDen(Ch9)
- Tile.FREEZ: returns DoFreePop().
- Residential: returns RZPop(Ch9).
- Commercial: returns CZPop(Ch9) << 3.
- Industrial: returns IZPop(Ch9) << 3.
- Else 0.

### DistIntMarket()
- For each World.SmX/World.SmY cell:
  - z = GetDisCC(x<<2, y<<2); z <<= 2; z = 64 - z; ComRate[x][y] = z.

### DoSmooth / DoSmooth2
- Both compute 2x2 grid smoothing using 4-neighbor + center average.
- If DonDither bit 2 (DoSmooth) or bit 4 (DoSmooth2) is set, uses serpentine dithering accumulator.
- Non-dither version: for each cell, z = (neighbors sum + center) >> 2; clamp to <=255.

----------------------------------------------------------------
## Fire Coverage

### FireAnalysis()
- SmoothFSMap() three times on FireStMap.
- Copies FireStMap to FireRate.
- Mark NewMapFlags[DYMAP,FIMAP]=1.

### SmoothFSMap()
- Same 4-neighbor averaging as SmoothPSMap, applied to FireStMap.

----------------------------------------------------------------
## Budget and Funding

### CollectTax()
- If TaxFlag is set, skips budgeting for this cycle.
- AvCityTax = AvCityTax / 48 (value computed but unused), then AvCityTax = 0.
- Compute annual funds:
  - PoliceFund = PolicePop * 100.
  - FireFund = FireStPop * 100.
  - RoadFund = (RoadTotal + RailTotal*2) * RLevels[GameLevel].
  - TaxFund = ((TotalPop * LVAverage) / 120) * CityTax * FLevels[GameLevel].
  - RLevels = {0.7, 0.9, 1.2}; FLevels = {1.4, 1.2, 0.8}.
- If TotalPop > 0:
  - CashFlow = TaxFund - (PoliceFund + FireFund + RoadFund).
  - DoBudget().
- Else: reset RoadEffect=32, PoliceEffect=1000, FireEffect=1000.

### Budget allocation (DoBudgetNow)
- fireInt = FireFund * firePercent, policeInt = PoliceFund * policePercent, roadInt = RoadFund * roadPercent.
- total = fireInt + policeInt + roadInt.
- yumDuckets = TaxFund + TotalFunds.
- If yumDuckets > total: fireValue=fireInt; policeValue=policeInt; roadValue=roadInt.
- Else if total > 0:
  - Allocate in order: road, then fire, then police. If insufficient for a category, allocate remaining and set that percent to remaining/fund; all later categories set to 0.
- Else (total==0): all values=0, percents reset to 1.0.
- fireMaxValue/policeMaxValue/roadMaxValue = FireFund/PoliceFund/RoadFund.
- If autoBudget is off or from menu:
  - Show budget UI and wait.
  - If not from menu: FireSpend/PoliceSpend/RoadSpend set to computed values, then Spend(-(TaxFund - total)).
- If autoBudget is on and not from menu:
  - If yumDuckets > total: Spend(-(TaxFund - total)), set spends to full funds.
  - Else: autoBudget=0, MustUpdateOptions=1, SendMes(29), fall back to manual flow.

### UpdateFundEffects()
- RoadEffect = (RoadSpend / RoadFund) * 32 (float) or 32 if RoadFund==0.
- PoliceEffect = (PoliceSpend / PoliceFund) * 1000 or 1000 if PoliceFund==0.
- FireEffect = (FireSpend / FireFund) * 1000 or 1000 if FireFund==0.
- Calls drawCurrPercents() to update UI.

----------------------------------------------------------------
## Census and Graphs

### ClearCensus()
- Resets all per-tick population counters, totals, and facility counts to 0.
- Resets PowerStackNum to 0 and clears FireStMap/PoliceMap.

### TakeCensus()
- Shifts 10-year history (indexes 0..119):
  - For x from 118 down to 0: move ResHis[x] to ResHis[x+1] (same for Com/Ind, Crime, Pollution, Money).
  - Updates ResHisMax/ComHisMax/IndHisMax and Graph10Max.
- Sets current values:
  - ResHis[0] = ResPop / 8; ComHis[0] = ComPop; IndHis[0] = IndPop.
  - CrimeRamp += (CrimeAverage - CrimeRamp) / 4; CrimeHis[0] = CrimeRamp.
  - PolluteRamp += (PolluteAverage - PolluteRamp) / 4; PollutionHis[0] = PolluteRamp.
  - MoneyHis[0] = clamp((CashFlow / 20) + 128, 0..255).
  - CrimeHis[0] and PollutionHis[0] clamped to <=255.
- NeedHosp/NeedChurch:
  - Compare HospPop/ChurchPop to ResPop >> 8 (ResPop/256).
  - Set TRUE if less, FALSE if equal, -1 if greater.

### Take2Census()
- Shifts 120-year history (indexes 120..239):
  - For x from 238 down to 120: move ResHis[x] to ResHis[x+1] (same for Com/Ind, Crime, Pollution, Money).
  - Updates Res2HisMax/Com2HisMax/Ind2HisMax and Graph120Max.
- Sets ResHis[120], ComHis[120], IndHis[120] from current; Crime/Pollution/Money copied from index 0.

----------------------------------------------------------------
## Evaluation and Scoring

### CityEvaluation()
- If TotalPop > 0: GetAssValue(), DoPopNum(), DoProblems(), GetScore(), DoVotes(), ChangeEval().
- Else EvalInit() then ChangeEval().

### GetAssValue()
- CityAssValue = (RoadTotal*5 + RailTotal*10 + PolicePop*1000 + FireStPop*1000 + HospPop*400 + StadiumPop*3000 + PortPop*5000 + APortPop*10000 + CoalPop*3000 + NuclearPop*6000) * 1000.

### DoPopNum()
- CityPop = (ResPop + ComPop*8 + IndPop*8) * 20.
- deltaCityPop = CityPop - OldCityPop (if OldCityPop == -1, treat as current).
- CityClass thresholds:
  - 0 village, >2000 town, >10000 city, >50000 capital, >100000 metropolis, >500000 megalopolis.

### DoProblems()
- ProblemTable[0..6]:
  - 0: CrimeAverage
  - 1: PolluteAverage
  - 2: LVAverage * 0.7
  - 3: CityTax * 10
  - 4: AverageTrf()
  - 5: GetUnemployment()
  - 6: GetFire()
- VoteProblems() fills ProblemVotes.
- Select top 4 problems into ProblemOrder[0..3] by highest votes among 0..6; if none, use 7.

### VoteProblems()
- Repeated sampling loop:
  - z increments until 100 or count 600.
  - For each step: if Rand(300) < ProblemTable[x], ProblemVotes[x]++ and z++.
  - x cycles 0..PROBNUM (10) (values beyond 6 stay 0).

### AverageTrf()
- Average traffic density over cells with LandValueMem != 0.
- TrafficAverage = (TrfTotal / count) * 2.4 (count starts at 1).

### GetUnemployment()
- b = (ComPop + IndPop) << 3.
- If b == 0: return 0.
- r = ResPop / b.
- b = (r - 1) * 255; clamp to <=255.

### GetFire()
- return min(FirePop * 5, 255).

### GetScore()
- x = sum of ProblemTable[0..6], then x = x/3, clamp to <=256.
- z = (256 - x) * 4; clamp 0..1000.
- Apply modifiers:
  - If ResCap/ComCap/IndCap: z *= 0.85 for each cap.
  - RoadEffect < 32: z -= (32 - RoadEffect).
  - PoliceEffect < 1000: z *= (0.9 + PoliceEffect / 10000.1).
  - FireEffect < 1000: z *= (0.9 + FireEffect / 10000.1).
  - If RValve/CValve/IValve < -1000: z *= 0.85 for each.
- Population trend multiplier SM:
  - If CityPop == 0 or deltaCityPop == 0: SM=1.0.
  - Else if deltaCityPop == CityPop: SM=1.0.
  - Else if deltaCityPop > 0: SM = (deltaCityPop / CityPop) + 1.0.
  - Else: SM = 0.95 + (deltaCityPop / (CityPop - deltaCityPop)).
- z = z * SM; then z -= GetFire(); z -= CityTax.
- Power penalty: SM = PwrdZCnt / (PwrdZCnt + unPwrdZCnt) if total > 0 else 1.0; z *= SM.
- Clamp z to 0..1000.
- CityScore = (CityScore + z) / 2; deltaCityScore = CityScore - OldCityScore.

### DoVotes()
- CityYes/CityNo from 100 trials: if Rand(1000) < CityScore then Yes else No.

----------------------------------------------------------------
## Messages and Scenarios

### SendMessages()
- Handles scenario score countdown: if ScenarioID and ScoreType and ScoreWait > 0, decrement; when hits 0, DoScenarioScore(ScoreType).
- Calls CheckGrowth().
- Computes TotalZPop = ResZPop + ComZPop + IndZPop; PowerPop = NuclearPop + CoalPop.
- On CityTime & 63 (0..63), emits messages based on thresholds:
  - 1: need residential (TotalZPop/4 >= ResZPop) -> SendMes(1).
  - 5: need commercial (TotalZPop/8 >= ComZPop) -> SendMes(2).
  - 10: need industrial (TotalZPop/8 >= IndZPop) -> SendMes(3).
  - 14: need roads (TotalZPop > 10 and TotalZPop*2 > RoadTotal) -> SendMes(4).
  - 18: need rails (TotalZPop > 50 and TotalZPop > RailTotal) -> SendMes(5).
  - 22: need power (TotalZPop > 10 and PowerPop == 0) -> SendMes(6).
  - 26: need stadium (ResPop > 500 and StadiumPop == 0): SendMes(7); ResCap=1 else 0.
  - 28: need port (IndPop > 70 and PortPop == 0): SendMes(8); IndCap=1 else 0.
  - 30: need airport (ComPop > 100 and APortPop == 0): SendMes(9); ComCap=1 else 0.
  - 32: if powered ratio < 0.7: SendMes(15).
  - 35: if PolluteAverage > 60: SendMes(-10).
  - 42: if CrimeAverage > 100: SendMes(-11).
  - 45: if TotalPop > 60 and FireStPop == 0: SendMes(13).
  - 48: if TotalPop > 60 and PolicePop == 0: SendMes(14).
  - 51: if CityTax > 12: SendMes(16).
  - 54: if RoadEffect < 20 and RoadTotal > 30: SendMes(17).
  - 57: if FireEffect < 700 and TotalPop > 20: SendMes(18).
  - 60: if PoliceEffect < 700 and TotalPop > 20: SendMes(19).
  - 63: if TrafficAverage > 60: SendMes(-12).

### CheckGrowth()
- Every 4 CityTime ticks (CityTime & 3 == 0), compute city population:
  - ThisCityPop = (ResPop + ComPop*8 + IndPop*8) * 20.
  - If LastCityPop crosses thresholds 2000, 10000, 50000, 100000, 500000, send message -35..-39 on first crossing; update LastCategory.
  - Update LastCityPop.

### DoScenarioScore(type)
- Default z = -200 (lose).
- Adjust z = -100 for success conditions:
  - Type 1/2/3: CityClass >= 4.
  - Type 4: TrafficAverage < 80.
  - Type 5: CityScore > 500.
  - Type 6: CrimeAverage < 60.
  - Type 7: CityScore > 500.
  - Type 8: CityScore > 500.
- SendMes(z); if z == -200, DoLoseGame().

### SendMes(Mnum)
- If Mnum < 0: send picture message if different from last.
- If Mnum > 0: send if message port is empty.
- Stores MessagePort and optional MesX/MesY (via SendMesAt).

----------------------------------------------------------------
## Disasters

### DoDisasters()
- Disaster chance by GameLevel: DisChance = {10*48, 5*48, 60}.
- FloodCnt-- if >0.
- If DisasterEvent != 0, ScenarioDisaster().
- If NoDisasters: return.
- If Rand(DisChance[level]) == 0, pick Rand(8) and dispatch:
  - 0,1: SetFire().
  - 2,3: MakeFlood().
  - 4: no event.
  - 5: MakeTornado().
  - 6: MakeEarthquake().
  - 7,8: if PolluteAverage > 60, MakeMonster().

### ScenarioDisaster()
- Based on DisasterEvent:
  - 2: if DisasterWait == 1, MakeEarthquake().
  - 3: DropFireBombs().
  - 5: if DisasterWait == 1, MakeMonster().
  - 7: if DisasterWait == 1, MakeMeltdown().
  - 8: if DisasterWait % 24 == 0, MakeFlood().
- DisasterWait-- each call; when 0, DisasterEvent=0.

### MakeMeltdown()
- Finds first Tile.NUCLEAR tile; calls DoMeltdown(x,y).

### DoMeltdown(SX,SY)
- Sets MeltX/Y to center.
- MakeExplosion at four corners around plant.
- Sets 4x4 area to Tile.FIRE + (Rand16() & 3) + TileFlag.ANIMBIT.
- For 200 attempts: pick random point in box [SX-20..SX+19], [SY-15..SY+14]; if in bounds and tile not TileFlag.ZONEBIT and (tile has TileFlag.BURNBIT or tile==0), set to Tile.RADTILE.
- SendMesAt(-43,SX,SY).

### MakeEarthquake()
- Calls DoEarthQuake() (external hook).
- Sends message -23 at city center (CCx,CCy).
- For random time 300..999 steps:
  - Pick random tile; if Vunerable(tile) is TRUE:
    - 3/4 chance: set to Tile.RUBBLE + (Rand16() & 3) + TileFlag.BULLBIT.
    - 1/4 chance: set to Tile.FIRE + (Rand16() & 7) + TileFlag.ANIMBIT.

### SetFire()
- Pick random tile; if not TileFlag.ZONEBIT and TileMask.LOMASK in (Tile.LHTHR..Tile.LASTZONE), set to Tile.FIRE + (Rand16() & 7) + TileFlag.ANIMBIT; set CrashX/Y; SendMesAt(-20,x,y).

### MakeFire()
- Try up to 40 times: pick random tile; if tile has TileFlag.BURNBIT and not TileFlag.ZONEBIT and TileMask.LOMASK in (21..Tile.LASTZONE), set to Tile.FIRE + (Rand16() & 7) + TileFlag.ANIMBIT; SendMesAt(20,x,y).

### MakeFlood()
- Try up to 300 times: pick random tile; if TileMask.LOMASK in (4..20) (river edge), check 4 neighbors for floodable:
  - Floodable if tile == 0 or (tile has TileFlag.BULLBIT and TileFlag.BURNBIT).
  - On first floodable neighbor: set to Tile.FLOOD, FloodCnt=30, SendMesAt(-42,xx,yy), set FloodX/Y.

### DoFlood() (called from MapScan when encountering Tile.FLOOD tiles)
- If FloodCnt > 0: for each of 4 neighbors, with 1/8 probability:
  - If neighbor is TileFlag.BURNBIT set, or 0, or TileMask.LOMASK in [Tile.WOODS5..Tile.FLOOD-1]:
    - If neighbor has TileFlag.ZONEBIT, FireZone() it.
    - Set neighbor to Tile.FLOOD + Rand(2).
- If FloodCnt == 0: with probability 1/16, clear flood tile to 0.

----------------------------------------------------------------
## City Demand Valves

### SetValves()
- Stores key values in MiscHis[1,2,3,4,5,6,7,10,11,12,13,14,15,16,17].
- NormResPop = ResPop / 8; TotalPop = NormResPop + ComPop + IndPop; LastTotalPop updated.
- Employment = (ComHis[1] + IndHis[1]) / NormResPop if NormResPop>0 else 1.
- Migration = NormResPop * (Employment - 1).
- Births = NormResPop * 0.02.
- PjResPop = NormResPop + Migration + Births.
- LaborBase = ResHis[1] / (ComHis[1] + IndHis[1]) if denominator > 0 else 1; clamp to [0..1.3].
- IntMarket = (NormResPop + ComPop + IndPop) / 3.7.
- PjComPop = IntMarket * LaborBase.
- External market factor temp based on GameLevel: 1.2 (easy), 1.1 (medium), 0.98 (hard).
- PjIndPop = IndPop * LaborBase * temp; minimum 5.
- Ratios:
  - Rratio = PjResPop / NormResPop (or 1.3 if NormResPop==0), Cratio = PjComPop / ComPop (or PjComPop), Iratio = PjIndPop / IndPop (or PjIndPop).
  - Each ratio clamped to max 2.
- z = CityTax + GameLevel; clamp to <=20.
- TaxTable[0..20] = {200,150,120,100,80,50,30,0,-10,-40,-100,-150,-200,-250,-300,-350,-400,-450,-500,-550,-600}.
- Convert ratios to valve deltas: (ratio-1)*600 + TaxTable[z].
- Apply to valves with caps:
  - RValve in [-2000,2000], CValve/IValve in [-1500,1500].
- If ResCap and RValve > 0, set RValve=0; same for ComCap, IndCap.
- Set ValveFlag = 1 (UI update).

----------------------------------------------------------------
## Date and Time

- CityTime increments once per Simulate case 0.
- Year/month conversion:
  - year = (CityTime / 48) + StartingYear.
  - month index = (CityTime % 48) >> 2 (0..11).
- If year >= 1,000,000: SetYear(StartingYear), send message -40.

----------------------------------------------------------------
## Heat Simulation (Optional Debug Mode)

- If heat_steps > 0, sim_loop runs sim_heat() heat_steps times per loop instead of SimFrame().
- sim_heat() treats Map as a cellular automaton using CLIPPER_LOOP_BODY.
- There are two rulesets (heat_rule 0 or 1) and a wrap mode (heat_wrap 0..4) for boundary behavior.
- Output tiles are written into Map with TileFlag.ANIMBIT|TileFlag.BURNBIT|TileFlag.BULLBIT and TileMask.LOMASK from heat computations.

----------------------------------------------------------------
## External Hooks / Side Effects

The core invokes these external functions (UI/sprite/persistence) and expects them to exist:
- Sprite system: DestroyAllSprites(), GenerateTrain(), GenerateShip(), GeneratePlane(), GenerateCopter(), GetSprite(type), MoveObjects(), MakeExplosion(x,y), MakeExplosionAt(px,py), MakeSound(...), DoEarthQuake(), StopEarthquake().
- UI/graph updates: DoUpdateHeads(), doAllGraphs(), ChangeCensus(), ChangeEval(), drawBudgetWindow(), drawCurrPercents().
- Budget UI flow: ShowBudgetWindowAndStartWaiting(), UpdateBudgetWindow().
- Messages/UI glue: SendMesAt(), DoLoseGame(), DoWinGame(), UISet* commands.

----------------------------------------------------------------
## Source Map

Primary sources used:
- src/sim/headers/sim.h
- src/sim/headers/mac.h
- src/sim/headers/macros.h
- src/sim/headers/view.h
- src/sim/s_alloc.c
- src/sim/s_init.c
- src/sim/s_sim.c
- src/sim/s_zone.c
- src/sim/s_power.c
- src/sim/s_traf.c
- src/sim/s_scan.c
- src/sim/s_eval.c
- src/sim/s_disast.c
- src/sim/s_msg.c
- src/sim/w_budget.c
- src/sim/w_update.c
- src/sim/w_stubs.c
- src/sim/w_util.c
- src/sim/w_sim.c
- src/sim/sim.c
- src/sim/rand.c
