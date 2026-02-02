# Persistence and Scenarios

## Scope
This spec covers the binary city file format, save/load flows, and scenario loading. UI/script wiring is only described insofar as C calls into Tcl via Eval().

## Data Model (Persistence-Relevant)
- Map storage is a contiguous array of `short` tile values, indexed as `Map[x][y]` with `x` in `[0, World.WORLD_X-1]` and `y` in `[0, World.WORLD_Y-1]`. The underlying memory layout is column-major: all `y` for `x=0`, then all `y` for `x=1`, etc.
- History arrays are raw `short` buffers:
  - `ResHis`, `ComHis`, `IndHis`, `CrimeHis`, `PollutionHis`, `MoneyHis` are each `HISTLEN` bytes (480) allocated and treated as `HISTLEN / 2` shorts (240 entries).
  - `MiscHis` is `MISCHISTLEN` bytes (240) allocated and treated as `MISCHISTLEN / 2` shorts (120 entries).
- `QUAD` is a 32-bit signed integer (typedef `long` on most platforms; `int` on OSF1). It is used for `CityTime` and `TotalFunds` serialization within `MiscHis`.

## City File Format (.cty and scenario files)
### Endianness
- All data is stored as big-endian 16-bit shorts.
- 32-bit values stored inside `MiscHis` are written as two consecutive big-endian shorts that together represent a big-endian 32-bit integer.
- On little-endian builds (`MSDOS`, `OSF1`, `IS_INTEL` defined), each 16-bit element is byte-swapped on load/save. 32-bit values packed into `MiscHis` are additionally half-swapped (16-bit halves swapped) before save and after load to preserve big-endian word order.

### Layout (in order, no header)
All fields are written sequentially with no padding:
1. `ResHis` : 240 shorts (480 bytes)
2. `ComHis` : 240 shorts
3. `IndHis` : 240 shorts
4. `CrimeHis` : 240 shorts
5. `PollutionHis` : 240 shorts
6. `MoneyHis` : 240 shorts
7. `MiscHis` : 120 shorts (240 bytes)
8. `Map` : `World.WORLD_X * World.WORLD_Y` shorts (column-major, `x` outer, `y` inner)

### Byte offsets (derived from layout)
Offsets are from file start; all values are big-endian shorts.
- 0x0000: ResHis (480 bytes)
- 0x01E0: ComHis
- 0x03C0: IndHis
- 0x05A0: CrimeHis
- 0x0780: PollutionHis
- 0x0960: MoneyHis
- 0x0B40: MiscHis (240 bytes)
- 0x0C30: Map data begins

### File sizes accepted by loader
The loader accepts only the following total byte sizes and rejects all others:
- 27,120 bytes: normal city (120 x 100)
- 99,120 bytes: 2x2 city (240 x 200)
- 219,120 bytes: 3x3 city (360 x 300)

Notes:
- The loader always reads `World.WORLD_X * World.WORLD_Y` map shorts based on the current build. If the file is larger (e.g., 2x2 or 3x3 while running a normal build), the extra data is ignored; no resizing or additional reads occur.

### `MiscHis` field map (short indices)
`MiscHis` is used as a packed storage area for several runtime values. Indices are in shorts (16-bit).
- `8..9`  : `CityTime` as 32-bit big-endian integer.
- `50..51`: `TotalFunds` as 32-bit big-endian integer.
- `52`    : `autoBulldoze` (short, treated as boolean).
- `53`    : `autoBudget` (short, treated as boolean).
- `54`    : `autoGo` (short, treated as boolean).
- `55`    : `UserSoundOn` (short, treated as boolean).
- `56`    : `CityTax` (short, 0..20 expected).
- `57`    : `SimSpeed` (short, 0..3 expected).
- `58..59`: `policePercent` as 16.16 fixed-point 32-bit integer.
- `60..61`: `firePercent` as 16.16 fixed-point 32-bit integer.
- `62..63`: `roadPercent` as 16.16 fixed-point 32-bit integer.

## Save Flow
### `saveFile(filename)`
1. Open `filename` for writing (`"w"` on Unix, `"wb"` on MSDOS). On failure, return 0.
2. Pack runtime values into `MiscHis`:
   - `TotalFunds` -> `MiscHis[50..51]` (32-bit).
   - `CityTime` -> `MiscHis[8..9]` (32-bit).
   - `autoBulldoze`, `autoBudget`, `autoGo`, `UserSoundOn`, `CityTax`, `SimSpeed` -> indices `52..57`.
   - `policePercent`, `firePercent`, `roadPercent` -> indices `58..63` as 16.16 fixed-point (value * 65536, truncated to int).
   - For 32-bit values, perform the platform-specific half-swap so that the resulting file is big-endian.
3. Write the arrays in the layout order above using 16-bit short I/O and byte swapping as needed.
4. Close file and return 1 on success, 0 on any write error.

### `SaveCity()`
- If `CityFileName` is NULL, call `DoSaveCityAs()` (which triggers UI via `Eval("UISaveCityAs")`) and return.
- Otherwise call `saveFile(CityFileName)` and then:
  - On success: `DidSaveCity()` -> `Eval("UIDidSaveCity")`.
  - On failure: `DidntSaveCity(msg)` where `msg` is `Unable to save the city to the file named "<CityFileName>". <strerror or empty>` and then `Eval("UIDidntSaveCity {<msg>}")`.

### `SaveCityAs(filename)`
1. Replace `CityFileName` with a copy of `filename`.
2. Call `saveFile(CityFileName)`.
3. On success, derive a city name from `filename`:
   - Truncate at the last `'.'` (extension removed).
   - Strip path to basename (after last `'/'` on Unix or `'\\'` on MSDOS).
   - Pass the resulting basename to `setCityName()`.
4. Call `DidSaveCity()` (Eval).
5. On failure, call `DidntSaveCity(msg)` as in `SaveCity()`.

## Load Flow
### `_load_file(filename, dir)` (internal)
1. If `dir` is non-NULL, build `path = dir + "/" + filename` (or `"\\"` on MSDOS) and open that path; otherwise open `filename` directly.
2. Determine file size with `fseek`/`ftell`.
3. Accept only sizes 27120, 99120, 219120 bytes; otherwise return 0.
4. Read the arrays in the layout order above using 16-bit short I/O and byte swapping as needed.
5. Close file and return 1 on success; return 0 on any read error.

### `loadFile(filename)`
1. Call `_load_file(filename, NULL)`. On failure, return 0.
2. Extract packed values from `MiscHis`:
   - `TotalFunds` from `MiscHis[50..51]` (32-bit) and call `SetFunds(TotalFunds)`.
   - `CityTime` from `MiscHis[8..9]` (32-bit).
   - `autoBulldoze`, `autoBudget`, `autoGo`, `UserSoundOn` from `MiscHis[52..55]`.
   - `CityTax` from `MiscHis[56]`.
   - `SimSpeed` from `MiscHis[57]`.
   - `policePercent`, `firePercent`, `roadPercent` from `MiscHis[58..63]` as 16.16 fixed-point.
3. Normalize values:
   - If `CityTime < 0`, set `CityTime = 0`.
   - If `CityTax` outside `[0,20]`, set `CityTax = 7`.
   - If `SimSpeed` outside `[0,3]`, set `SimSpeed = 3`.
4. Call `setSpeed(SimSpeed)` and `setSkips(0)`.
5. Call `ChangeCensus()` and set `MustUpdateOptions = 1`.
6. Call `InitFundingLevel()` (resets `roadPercent`, `policePercent`, `firePercent` to 1.0, overriding any loaded values).
7. Set `ScenarioID = 0`, `InitSimLoad = 1`, `DoInitialEval = 0`.
8. Call `InitWillStuff()`, `DoSimInit()`, `InvalidateEditors()`, and `InvalidateMaps()`.
9. Return 1.

### `LoadCity(filename)`
1. Call `loadFile(filename)`.
2. On success:
   - Replace `CityFileName` with a copy of `filename` (full path preserved).
   - Derive city name from `filename` as in `SaveCityAs` and call `setCityName()`.
   - Call `gettimeofday(&start_time, NULL)`.
   - Call `InvalidateMaps()`, `InvalidateEditors()`, `DidLoadCity()` (Eval `"UIDidLoadCity"`).
   - Return 1.
3. On failure:
   - Build error message `Unable to load a city from the file named "<filename>". <strerror or empty>`.
   - Call `DidntLoadCity(msg)` -> `Eval("UIDidntLoadCity {<msg>}")`.
   - Return 0.

## Scenario Loading
### `LoadScenario(s)`
1. Free and clear `CityFileName`.
2. Call `SetGameLevel(0)`.
3. Clamp `s` to `[1,8]`.
4. Set scenario metadata from the table below:
   - `ScenarioID` (1..8)
   - `CityTime = (startYear - 1900) * 48 + 2`
   - `SetFunds(startFunds)`
   - Scenario name and file name
5. Call `setAnyCityName(name)`.
6. Call `InvalidateMaps()`, `InvalidateEditors()`, `setSpeed(3)`, set `CityTax = 7`.
7. Call `gettimeofday(&start_time, NULL)`.
8. Call `_load_file(fname, ResourceDir)` to load map + histories from resource directory.
9. Call `InitWillStuff()`, `InitFundingLevel()`, `UpdateFunds()`, `InvalidateEditors()`, `InvalidateMaps()`.
10. Set `InitSimLoad = 1`, `DoInitialEval = 0`, call `DoSimInit()`.
11. Call `DidLoadScenario()` -> `Eval("UIDidLoadScenario")`.
12. Call `Kick()` to start the simulation loop.

### Scenario table
- 1: Name "Dullsville", file `snro.111`, startYear 1900, startFunds 5000.
- 2: Name "San Francisco", file `snro.222`, startYear 1906, startFunds 20000.
- 3: Name "Hamburg", file `snro.333`, startYear 1944, startFunds 20000.
- 4: Name "Bern", file `snro.444`, startYear 1965, startFunds 20000.
- 5: Name "Tokyo", file `snro.555`, startYear 1957, startFunds 20000.
- 6: Name "Detroit", file `snro.666`, startYear 1972, startFunds 20000.
- 7: Name "Boston", file `snro.777`, startYear 2010, startFunds 20000.
- 8: Name "Rio de Janeiro", file `snro.888`, startYear 2047, startFunds 20000.

Scenario files live under the resource directory (`ResourceDir`) and use the same binary layout as city files.

## Edge Cases and Quirks
- File size validation is strict to the three sizes listed; other sizes fail immediately.
- When a file size is larger than the current build's `World.WORLD_X * World.WORLD_Y` map size (e.g., 2x2 or 3x3 in a normal build), only the first `World.WORLD_X * World.WORLD_Y` map shorts are read and the rest are ignored.
- Funding percentages loaded from `MiscHis` are immediately reset to 1.0 by `InitFundingLevel()` after load and scenario load; they are effectively not restored from the file.
- `LoadCity` and `SaveCityAs` modify the passed-in filename string by truncating at the last '.' to derive the city name before stripping the path.

## Source Map
- `src/sim/s_fileio.c`
- `src/sim/s_alloc.c`
- `src/sim/headers/sim.h`
- `src/sim/headers/mac.h`
- `src/sim/w_budget.c`
- `res/wscen.tcl`
