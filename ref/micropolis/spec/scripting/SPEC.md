# Scripting Interface & Tcl Commands

## Scope
This spec covers the Tcl/Tk scripting layer and the C <-> Tcl command bridge. It defines:
- How the Tcl interpreter is created and bootstrapped.
- Tcl commands implemented in C ("sim", view widgets, sprites, custom widgets).
- Tcl procedures called from C (UI callbacks) and their default script behavior.
- Argument validation, ranges, return values, and update scheduling.

It intentionally avoids UI layout details; see `spec/ui/SPEC.md` for widget layout and rendering.

## Initialization and Interpreter
### Tk/Tcl bootstrap (w_tk.c)
- `tk_main()` creates a Tcl extended interpreter and the main Tk window:
  - `tk_mainInterp = Tcl_CreateExtendedInterp()`.
  - `MainWindow = Tk_CreateMainWindow(tk_mainInterp, FirstDisplay, "Micropolis")`.
  - Window class is set to "Tk". The background is set using a gray 3D border if available, else white.
- Tcl commands registered (in this order):
  - `sim` (simulation bridge)
  - `mapview`, `editorview` (tile views)
  - `graphview`, `dateview`
  - `sprite`
  - optional `camview` if `CAM` is compiled
  - `piemenu` (pie menu widget)
  - `interval` (two-handle slider widget)
- `sim = MakeNewSim()` allocates the main Sim container.
- Tcl script entry point: `source $ResourceDir/micropolis.tcl` is evaluated via `Eval()`.
- `sim_init()` is called after the scripts are sourced.
- If `sim_tty` is set (tty mode), `StdinProc` is registered for stdin and provides a Tcl REPL.
- Finally, `UIStartMicropolis {HomeDir} {ResourceDir} {HostName}` is evaluated and Tk_MainLoop begins.

### Eval and error handling
- `Eval(char *buf)` calls `Tcl_Eval(tk_mainInterp, buf, ...)`.
- On error, it prints: `Micropolis: error in TCL code: <result>\n<errorInfo>` to stderr.

### Update scheduling (Kick/Timer)
- `Kick()` schedules a single idle callback (`DelayedUpdate`) which calls `sim_update()` and resets `sim_skip`.
- `StartMicropolisTimer()` schedules `MicropolisTimerProc` via `Tk_DoWhenIdle(ReallyStartMicropolisTimer)`.
- `ReallyStartMicropolisTimer()` schedules a microtimer with delay `sim_delay`. If `NeedRest > 0` or `ShakeNow` is active, delay is forced to at least 50000 microseconds.
- `MicropolisTimerProc()` decrements `NeedRest` (if > 0), calls `sim_loop(1)` when `SimSpeed != 0`, then restarts or stops the timer.

## Coordinate Systems and Units
- Tile coordinates: integer tiles, 0 <= x < WORLD_X, 0 <= y < WORLD_Y.
- Pixel coordinates: 1 tile = 16 units. The center of a tile is `(tile << 4) + 8`.
- View-local coordinates: x/y from Tk events relative to the view window (pixels). These are converted to tile or pixel coordinates via `ViewToTileCoords`/`ViewToPixelCoords`.

## Tcl Command API (C -> Tcl)
Commands implemented in C are registered into the Tcl interpreter and are called by scripts.
All commands return `TCL_OK` and set `interp->result` unless specified. Most argument errors return `TCL_ERROR` without a detailed message (some widget commands do include messages).

### `sim` command (w_sim.c)
Syntax: `sim <Subcommand> ?args?`
- Dispatch is via a hash table; subcommand names are case sensitive.
- If `<Subcommand>` is not found, `TCL_ERROR` is returned.

#### Accessors (read/write)
These accept either 2 or 3 args: `sim <Var>` or `sim <Var> <int>`. If a value is supplied, it is parsed and stored, then the current value is returned.
- `TreeLevel`, `LakeLevel`, `CurveLevel`, `CreateIsland` (terrain generation controls).
- `OverRide`, `Expensive` (tool/budget flags).
- `Players`, `Votes` (multiplayer coordination).
- `BobHeight` (UI animation parameter).
- `PendingTool`, `PendingX`, `PendingY` (pending vote tool state).
No range checking is performed.

#### Read-only getters
- `Displays`: returns the global `Displays` string (a Tcl list string such as `{display1} {display2}`).
- `WorldX`, `WorldY`: return `WORLD_X` and `WORLD_Y`.
- `LandValue`: returns `LVAverage`.
- `Traffic`: returns `AverageTrf()`.
- `Crime`: returns `CrimeAverage`.
- `Unemployment`: returns `GetUnemployment()`.
- `Fires`: returns `GetFire()`.
- `Pollution`: returns `PolluteAverage`.
- `PolMaxX`, `PolMaxY`: return `(PolMaxX << 4) + 8` and `(PolMaxY << 4) + 8` (pixel centers).
- `TrafMaxX`, `TrafMaxY`: return `TrafMaxX`, `TrafMaxY` (raw values).
- `MeltX`, `MeltY`: return `(MeltX << 4) + 8`, `(MeltY << 4) + 8`.
- `CrimeMaxX`, `CrimeMaxY`: return `(CrimeMaxX << 4) + 8`, `(CrimeMaxY << 4) + 8`.
- `CenterX`, `CenterY`: return `(CCx << 4) + 8`, `(CCy << 4) + 8`.
- `FloodX`, `FloodY`: return `(FloodX << 4) + 8`, `(FloodY << 4) + 8`.
- `CrashX`, `CrashY`: return `(CrashX << 4) + 8`, `(CrashY << 4) + 8`.
- `Platform`: returns `"msdos"` if `MSDOS` defined, else `"unix"`.
- `Version`: returns `MicropolisVersion` string.
- `MultiPlayerMode`: read-only, returns `MultiPlayerMode`.
- `SugarMode`: read-only, returns `SugarMode`.

#### Session control and redraw
- `GameStarted`: calls `GameStarted()` then `Kick()`.
- `InitGame`: calls `InitGame()` then `Kick()`.
- `SaveCity`: calls `SaveCity()`.
- `SaveCityAs <path>`: calls `SaveCityAs(path)`.
- `ReallyQuit`: calls `ReallyQuit()`.
- `UpdateHeads`: calls `UpdateHeads()` then `Kick()`.
- `UpdateMaps`: calls `UpdateMaps()` then `Kick()`.
- `UpdateEditors`: calls `UpdateEditors()` then `Kick()`.
- `RedrawMaps`: calls `RedrawMaps()` then `Kick()`.
- `RedrawEditors`: calls `RedrawEditors()` then `Kick()`.
- `UpdateGraphs`: calls `UpdateGraphs()` then `Kick()`.
- `UpdateEvaluation`: calls `UpdateEvaluation()` then `Kick()`.
- `UpdateBudget`: calls `UpdateBudget()` then `Kick()`.
- `UpdateBudgetWindow`: calls `UpdateBudgetWindow()` then `Kick()`.
- `DoBudget`: calls `DoBudget()` then `Kick()`.
- `DoBudgetFromMenu`: calls `DoBudgetFromMenu()` then `Kick()`.
- `Update`: calls `sim_update()` (no `Kick`).

#### Time/speed controls
- `Speed ?speed?`: accepts 0..7. Calls `setSpeed(speed)` and `Kick()`. `setSpeed` clamps to 0..3, so values 4..7 behave as 3. Returns current `SimSpeed`.
- `Delay ?delay?`: accepts >= 0. Sets `sim_delay` and `Kick()`. Returns `sim_delay`.
- `Skips ?skips?`: accepts >= 0. Calls `setSkips(skips)` and `Kick()`. Returns `sim_skips`.
- `Skip ?skip?`: accepts >= 0. Sets `sim_skip`. Returns `sim_skip`.
- `Pause`: calls `Pause()` then `Kick()`.
- `Resume`: calls `Resume()` then `Kick()`.
- `NeedRest ?n?`: set/get `NeedRest`.

#### City/game setup
- `CityName ?name?`: if `name` provided, calls `setCityName(name)` (non-alnum converted to `_`). Returns `CityName`.
- `CityFileName ?path?`: if provided, frees previous value, and copies `argv[2]` into a newly allocated buffer. NOTE: allocation uses `strlen(argv[0]) + 1` (the subcommand string) instead of `strlen(argv[2])`, which can truncate/overflow in the legacy code; reimplementation should mimic this behavior if compatibility is required. Returns `CityFileName` or empty string if NULL.
- `GameLevel ?level?`: `level` must be 0..2. Calls `SetGameLevelFunds(level)` and returns `GameLevel`.
- `Year ?year?`: sets city year via `SetYear(year)` (clamps below `StartingYear`) and returns `CurrentYear()`.
- `GenerateNewCity`: calls `GenerateNewCity()`.
- `GenerateSomeCity <seed>`: calls `GenerateSomeCity(seed)`.
- `LoadCity <path>`: calls `LoadCity(path)`.
- `LoadScenario <id>`: calls `LoadScenario(id)`.

#### Budget and options
- `Funds ?amount?`: amount must be >= 0. Sets `TotalFunds`, sets `MustUpdateFunds = 1`, `Kick()`. Returns `TotalFunds`.
- `TaxRate ?rate?`: rate must be 0..20. Sets `CityTax`, calls `drawBudgetWindow()`, `Kick()`. Returns `CityTax`.
- `RoadFund ?percent?`, `FireFund ?percent?`, `PoliceFund ?percent?`: percent 0..100.
  - Sets `<service>Percent = percent / 100.0`.
  - Sets spend to `(maxValue * percent)/100`.
  - Calls `UpdateFundEffects()` and `Kick()`.
  - Returns percent as integer (0..100).
- `AutoBudget ?0|1?`: sets `autoBudget`, sets `MustUpdateOptions = 1`, `Kick()`, calls `UpdateBudget()`. Returns `autoBudget`.
- `AutoGoto ?0|1?`: sets `autoGo`, sets `MustUpdateOptions = 1`, `Kick()`. Returns `autoGo`.
- `AutoBulldoze ?0|1?`: sets `autoBulldoze`, sets `MustUpdateOptions = 1`, `Kick()`. Returns `autoBulldoze`.
- `Disasters ?0|1?`: sets `NoDisasters = val ? 0 : 1` (so 1 means disasters enabled). Sets `MustUpdateOptions = 1`, `Kick()`. Returns 1 if disasters enabled, 0 if disabled.
- `Sound ?0|1?`: sets `UserSoundOn`, sets `MustUpdateOptions = 1`, `Kick()`. Returns `UserSoundOn`.
- `DoAnimation ?0|1?`: sets `DoAnimation`, sets `MustUpdateOptions = 1`, `Kick()`. Returns `DoAnimation`.
- `DoMessages ?0|1?`: sets `DoMessages`, sets `MustUpdateOptions = 1`, `Kick()`. Returns `DoMessages`.
- `DoNotices ?0|1?`: sets `DoNotices`, sets `MustUpdateOptions = 1`, `Kick()`. Returns `DoNotices`.

#### Terrain smoothing and map clearing
- `SmoothTrees`, `SmoothWater`, `SmoothRiver`, `ClearMap`, `ClearUnnatural`: call corresponding routines and `Kick()`.

#### Disasters and sprites
- `StartBulldozer`, `StopBulldozer`: call sound control helpers.
- `MakeFire`, `MakeFlood`, `MakeTornado`, `MakeEarthquake`, `MakeMonster`, `MakeMeltdown`: call disaster creators.
- `FireBomb`: calls `FireBomb()`.
- `MakeExplosion <tileX> <tileY>`: tile coords (0..WORLD_X-1, 0..WORLD_Y-1). Calls `MakeExplosion(x,y)`.
- `MonsterGoal <x> <y>`: pixel coords in sprite space. Ensures GOD sprite exists, sets dest_x/dest_y, control = -2, count = -1.
- `MonsterDirection <dir>`: dir must be -1..7. Ensures GOD sprite exists; sets `sprite->control = dir`.
- `HelicopterGoal <x> <y>`: pixel coords. Ensures COP sprite exists (spawns with `GenerateCopter(x,y)` if missing); sets dest_x/dest_y.

#### Map access and dynamic data
- `Tile <x> <y> ?tile?`: tile coords. If `tile` provided, sets `Map[x][y] = tile` without masking. Returns map value.
- `Fill <tile>`: fills entire map with `tile` value. Returns `tile`.
- `DynamicData <index> ?value?`: index 0..31. If value provided, stores it, sets `NewMapFlags[DYMAP] = 1`, `Kick()`. Returns `DynamicData[index]`.
- `ResetDynamic`: sets indices 0..15 to alternating -99999 (even) and 99999 (odd), sets `NewMapFlags[DYMAP] = 1`, `Kick()`.

#### Overlay and flush
- `EraseOverlay`: calls `EraseOverlay()`.
- `DoOverlay ?int?`: set/get `DoOverlay` (no range check). Returns value.
- `DonDither ?int?`: set/get `DonDither` (requires >=0 if set). Returns value.
- `Flush`: no-op (always returns OK).
- `FlushStyle ?style?`: set/get `FlushStyle` (style must be >= 0). Returns value.

#### Misc
- `Rand ?max?`: with arg, returns `Rand(max)`, else `Rand16()`.
- `Dollars`: expects no args; calls `makeDollarDecimalStr(argv[1], ...)` and returns the result. This formats the literal string "Dollars" as a dollar value in the legacy code.
- `QuoteURL <string>`: URL-escapes input. Valid length <= 255. Escapes <32, >=128, '+', '%', '&', '<', '>', '"', '\'' to `%XX`. Spaces become `+`.
- `OpenWebBrowser <url>`: length <= 255. Executes `netscape -no-about-splash '<url>' &` via `system()` and returns the system call result.
- `Performance`: enables performance timing and zeros per-editor counters.
- `CollapseMotion ?int?`: set/get `tkCollapseMotion` (no range check).

### Tile view commands (`editorview`, `mapview`)
Creation:
- `editorview pathName ?options?`
- `mapview pathName ?options?`
Both create a Tk window and a `SimView` instance. The returned pathName becomes the widget command.

Shared configuration options (`TileViewConfigSpecs`):
- `-font` (default `"-Adobe-Helvetica-Bold-R-Normal-*-140-*"`)
- `-messagevar` (string var name, default NULL)
- `-width` (pixels, default 0)
- `-height` (pixels, default 0)

Creation behavior:
- `editorview` uses class `EditorView`, registers for visibility/expose/structure/enter/leave/motion events, and calls `DoNewEditor`.
- `mapview` uses class `MapView`, registers for visibility/expose/structure events, and calls `DoNewMap`.
- `ConfigureTileView` requests geometry:
  - Map view always uses `MAP_W` x `MAP_H`.
  - Editor view uses `-width`/`-height` if non-zero.
- Visibility is tracked from Tk events and by the `Visible` subcommand.

#### `editorview` subcommands
Syntax: `<view> <Subcommand> ?args?`
- `configure ?option ?value??`: standard Tk configure semantics.
- `position ?x y?`: set/get `view->w_x`, `view->w_y`.
- `size ?w h?`: set/get `view->w_width`, `view->w_height`.
- `AutoGoto ?0|1?`: enable auto-goto; setting resets auto goals. Returns `auto_goto`.
- `Sound ?0|1?`: set/get `view->sound`.
- `Skip ?n?`: set/get `view->skips` (also sets `view->skip = view->skips`).
- `Update`: sets `view->skip = 0`.
- `Pan ?x y?`: if args given, calls `DoPanTo(view, x, y)` and `Kick()`. Returns `pan_x pan_y`. (x/y are pixel coords.)
- `ToolConstrain x y`: view-local coords; converts to tile coords via `ViewToTileCoords`. If `x == -1` or `y == -1`, disables constraint for that axis. Sets `tool_x_const`, `tool_y_const`.
- `ToolState ?state?`: set/get tool state via `setWandState(view, state)`.
- `ToolMode ?mode?`: set/get `view->tool_mode`.
- `DoTool <tool> <tileX> <tileY>`: tool in [0..lastState], tile coords; calls `DoTool()` and `Kick()`.
- `ToolDown x y`, `ToolDrag x y`, `ToolUp x y`: view-local coords; calls `ToolDown/Drag/Up` and `Kick()`.
- `PanStart x y`: records `last_x/last_y` (view-local coords).
- `PanTo x y`: view-local coords. Computes `dx/dy` from last position (unless constrained) and calls `DoPanBy(dx,dy)` + `Kick()`.
- `PanBy dx dy`: pixels; calls `DoPanBy(dx,dy)` + `Kick()`.
- `TweakCursor`: calls `XWarpPointer` (no args).
- `Visible ?0|1?`: sets `visible = arg && Tk_IsMapped`, returns `visible`.
- `KeyDown <char>`, `KeyUp <char>`: passes first character of string to `doKeyDown`/`doKeyUp`.
- `TileCoord x y`: view-local coords; converts to tile coords and returns `x y`.
- `ChalkStart x y`, `ChalkTo x y`: view-local coords; draws chalk using `COLOR_WHITE`.
- `AutoGoing ?0|1?`: set/get `auto_going`. If `auto_goto == -1`, sets `auto_goto = 0`.
- `AutoSpeed ?speed?`: speed must be >= 1.
- `AutoGoal ?x y?`: pixel coords. Sets `auto_x_goal/auto_y_goal`. If distance from current pan > 64 pixels, sets `auto_going = 1`; if `auto_goto == 0`, sets `auto_goto = -1`.
- `SU <value> xyzzy`: only sets `super_user` when last arg is literal `xyzzy`.
- `ShowMe ?0|1?`: set/get `show_me` (cursor display in view).
- `Follow ?spriteName?`: finds sprite by name in `sim->sprite` list; sets `view->follow`. If set, triggers `HandleAutoGoto(view)`.
- `ShowOverlay ?0|1?`: set/get `show_overlay`.
- `OverlayMode ?int?`: set/get `overlay_mode`.
- `DynamicFilter ?int?`: set/get `dynamic_filter`.

#### `mapview` subcommands
Syntax: `<view> <Subcommand> ?args?`
- `configure ?option ?value??`: Tk configure.
- `position ?x y?`: set/get `w_x`, `w_y`.
- `size ?w h?`: set/get `w_width`, `w_height`.
- `MapState ?state?`: state must be 0..NMAPS-1. Calls `DoSetMapState(view,state)` and `Kick()`; returns `map_state`.
- `ShowEditors ?0|1?`: set/get `show_editors`.
- `PanStart x y`: view-local coords. Finds an editor view on the same X display and stores it in `track_info` if the point is within its pan-rectangle (scaled by 3/16 and padded by 4). Records `last_x/last_y`.
- `PanTo x y`: view-local coords. If `track_info` points to an editor view, converts delta to editor pixels via `dx = dx * 16 / 3`, `dy = dy * 16 / 3`, then calls `DoPanBy(ed, dx, dy)` and `Kick()`.
- `Visible ?0|1?`: sets `visible = arg && Tk_IsMapped`.
- `ViewAt x y`: requires valid tile coords; currently returns the string "Sorry Not Implemented Yet".

### `graphview` widget
Creation: `graphview pathName ?options?`
- Class: `GraphView`. Event handlers update visibility and redraw.
- `GraphUpdateTime` = 100 ms (timer-based redraw).

Configuration options:
- `-font` default `"-Adobe-Helvetica-Bold-R-Normal-*-140-*"`
- `-background` default `"#b0b0b0"` (color) or `"#ffffff"` (mono)
- `-borderwidth` default `"0"`
- `-relief` default `"flat"`

Subcommands:
- `configure ?option ?value??` (Tk configure)
- `position ?x y?` (set/get)
- `size ?w h?` (set/get)
- `Visible ?0|1?` (set/get)
- `Range ?10|120?` (months). Sets `graph->range` and `NewGraph = 1`.
- `Mask ?mask?`: mask 0..63 (6-bit). Sets `graph->mask` and `NewGraph = 1`.

Graph data sources:
- Histories in order: Residential, Commercial, Industrial, Cash Flow, Crime, Pollution.
- `mask` bit 0 corresponds to Residential; bit 5 to Pollution.

### `dateview` widget
Creation: `dateview pathName ?options?`
- Class: `DateView`. Event handlers update visibility and redraw.
- `DateUpdateTime` = 200 ms (timer-based redraw).

Configuration options:
- `-font` default `"-Adobe-Helvetica-Bold-R-Normal-*-140-*"`
- `-background` default `"#b0b0b0"` (color) or `"#ffffff"` (mono)
- `-borderwidth` default `"2"`
- `-padx` default `"1"`
- `-pady` default `"1"`
- `-width` default `"0"` (0 means auto-width)
- `-monthtab` default `"7"`
- `-yeartab` default `"13"`

Subcommands:
- `configure ?option ?value??`
- `position ?x y?`
- `size ?w h?`
- `Visible ?0|1?`
- `Reset`: sets `date->reset = 1` and schedules redraw.
- `Set <month> <year>`: month 0..11, year >= 0; schedules redraw.

### `sprite` command
Creation: `sprite <name> <type>`
- `type` must be 1..OBJN-1.
- Creates a new `SimSprite`, registers a Tcl command with the sprite name, and sets `frame = 0` (invisible until initialized).

Sprite types (`sim.h`):
- 1 `TRA`, 2 `COP`, 3 `AIR`, 4 `SHI`, 5 `GOD`, 6 `TOR`, 7 `EXP`, 8 `BUS`.

Sprite subcommands (`<spriteName> <Subcommand> ?value?`):
- Read/write integer fields: `type`, `frame`, `x`, `y`, `width`, `height`, `x_offset`, `y_offset`, `x_hot`, `y_hot`, `orig_x`, `orig_y`, `dest_x`, `dest_y`, `count`, `sound_count`, `dir`, `new_dir`, `step`, `flag`, `control`, `turn`, `accel`, `speed`.
- Read-only string: `name`.
- `Init <x> <y>`: x/y in pixel coords (0 <= x < WORLD_X<<4, 0 <= y < WORLD_Y<<4). Calls `InitSprite` to reset sprite fields for its type.
- `Explode`: calls `ExplodeSprite(sprite)`.

### `piemenu` widget
Creation: `piemenu pathName ?options?`
- Creates an override-redirect window with save-under enabled.
- Class: `PieMenu`.

Menu configuration options (selected defaults from w_piem.c):
- `-activebackground` default `#bfbfbf` (mono `WHITE`).
- `-activeborderwidth` default `"2"`.
- `-activeforeground` default `BLACK`.
- `-background` default `#bfbfbf` (mono `WHITE`).
- `-borderwidth` default `"2"`.
- `-cursor` default `"circle"`.
- `-foreground` default `BLACK`.
- `-font` default `"-Adobe-Helvetica-Bold-R-Normal-*-120-*"`.
- `-title` default `""`.
- `-preview` default `""` (menu-level preview, currently unused by C).
- `-titlefont` default same as `-font`.
- `-initialangle` default `0`.
- `-inactiveradius` default `8`.
- `-minradius` default `16`.
- `-extraradius` default `2`.
- `-fixedradius` default `0`.
- `-active` default `-1`.
- `-popupdelay` default `250` (ms).
- `-shaped` default `1`.

Entry configuration options:
- `-label` (string, default NULL)
- `-command` (Tcl command, command entries only)
- `-preview` (Tcl command, runs on activation)
- `-piemenu` (submenu name, piemenu entries)
- `-bitmap` (pixmap)
- `-font` (default NULL)
- `-background`, `-activebackground` (borders, default NULL)
- `-xoffset`, `-yoffset` (int, default 0)

Widget subcommands:
- `activate <index>`: sets active entry and (if preview flag is true) runs entry preview command. `index` forms:
  - integer 0..numEntries-1
  - `active`, `last`, `none`
  - `@x,y` (view coords)
  - pattern matching entry labels
- `show`: immediately pops up the menu (`NowPopupPieMenu`).
- `pending`: returns 1 if popup is pending, else 0.
- `defer`: defers popup (schedules after delay).
- `add <command|piemenu> ?entryOptions?`: appends a new entry.
- `configure ?option ?value??`: menu configuration.
- `delete <index>`: deletes entry.
- `entryconfigure <index> ?option value ...?`: per-entry configuration.
- `index <string>`: converts a string index (see above) to numeric, or `none`.
- `invoke <index>`: runs entry command if present.
- `post <x> <y> ?group?`: maps and positions the menu so its center is at (x,y). Shares events with `group` (default `default`).
- `unpost`: unmaps menu and unposts submenus.
- `grab <window>` / `ungrab <window>`: uses XGrabPointer/XUngrabPointer.
- `distance`: returns radial distance from menu center to last tracked pointer (rounded).
- `direction`: returns angle (0..359 degrees) from menu center to pointer, using `atan2`.

### `interval` widget
Creation: `interval pathName ?options?`
- Class: `Interval`. It is a two-handle scale with min/max values.

Configuration options (Tk scale defaults from `src/tk/default.h`):
- `-activeforeground` default `LIGHTPINK1` (mono `WHITE`).
- `-background` default `BISQUE2` (mono `WHITE`).
- `-borderwidth` default `"2"`.
- `-command` default NULL.
- `-cursor` default NULL.
- `-font` default `"-Adobe-Helvetica-Bold-R-Normal-*-120-*"`.
- `-foreground` default `BLACK`.
- `-from` default `"0"`.
- `-label` default NULL.
- `-length` default `"100"`.
- `-orient` default `"vertical"`.
- `-relief` default `"flat"`.
- `-showvalue` default `"1"`.
- `-sliderforeground` default `BISQUE3` (mono `WHITE`).
- `-min` default `"0"`.
- `-max` default `"9999"`.
- `-state` default `"normal"` (accepts `normal` or `disabled`).
- `-tickinterval` default `"0"`.
- `-to` default `"100"`.
- `-width` default `"15"`.

Widget subcommands:
- `configure ?option ?value??`.
- `get`: returns `minValue maxValue`.
- `set <minValue> <maxValue>`: values are swapped if min > max; values are clamped to `[from,to]` (respecting direction). If state is `disabled`, no change is made.
- `reset`: sets range to `[fromValue, toValue]`.

### `camview` widget (optional, `CAM` builds)
Creation: `camview pathName ?options?`
- Class: `Cam`. Registers event handlers and creates a `SimCam` instance.

SimCam config options:
- `-width`, `-height` (pixels).

Cam (per-camera) config options (`CamConfigSpecs`):
- `-wrap`, `-steps`, `-frob`, `-x`, `-y`, `-width`, `-height`, `-dx`, `-dy`, `-gx`, `-gy`, `-dragging`, `-setx`, `-sety`, `-setwidth`, `-setheight`, `-setx0`, `-sety0`, `-setx1`, `-sety1` (all integer pixel values).

`camview` subcommands:
- `configure ?option ?value??`: configure SimCam.
- `position ?x y?`: set/get `w_x`, `w_y`.
- `size ?w h?`: set/get `w_width`, `w_height`.
- `Visible ?0|1?`: set/get `visible`.
- `StoreColor <index> <r> <g> <b>`: stores color into X colormap via `XStoreColor`.
- `NewCam <name> <ruleOrNumber> <x> <y> <w> <h> ?options?`: creates/overwrites a named camera. `ruleOrNumber` is a rule name string unless it parses to a non-zero int (then used as neighborhood number).
- `DeleteCam <name>`: destroys named cam.
- `RandomizeCam <name>`: randomizes named cam.
- `ConfigCam <name> ?options?`: configures a named cam using `CamConfigSpecs`.
- `FindCam <x> <y>`: returns name of cam containing the point or empty string.
- `FindSomeCam <x> <y>`: returns name of cam containing point; if none, returns first cam in list or empty string.

### Networking (optional, `NET` builds)
- `sim ListenTo <port>`: calls `udp_listen(port)` and returns the socket integer.
- `sim HearFrom file<sock>`: expects `argv[2]` of the form `fileNNN` where NNN is an int; calls `udp_hear(sock)`.
- `udp_hear` emits Tcl callback: `HandlePacket <sock> {<ip>} {<byte0> <byte1> ...}`.

## C -> Tcl Callbacks (UI Procedures)
C calls Tcl by constructing and evaluating Tcl strings (mostly `UI*` procedures). The following procedures must exist.

### Startup and lifecycle
- `UIStartMicropolis {homedir} {resourcedir} {hostname}`
  - Called once after scripts are loaded. Default Tcl behavior:
    - Sets `HomeDir`, `ResourceDir`, `HostName`.
    - Calls `sim InitGame` and `sim GameStarted`.
    - For each display in `[sim Displays]`, calls `AddPlayer`.
    - If no head windows are created, calls `sim ReallyQuit`.
- `UIPlayNewCity`: called by C when starting a new city; default Tcl behavior is `UIGenerateNewCity` then `UIPlayGame`.
- `UIReallyStartGame`: default shows splash mode (`UISplashMode`).
- `UIStartLoad`: default calls `UIPlayGame`.
- `UIStartScenario <id>`: default loads scenario, enters play mode, shows picture.
- `UINewGame`: default resets UI state and starts play flow (see `micropolis.tcl`).
- `DoStopMicropolis`: called when toolkit is stopping; default destroys root window and stops sound.

### File I/O
- `UISaveCityAs`: opens save dialog (Tcl only); called when C wants "Save As".
- `UIDidSaveCity`: called after successful save.
- `UIDidntSaveCity {msg}`: called on save failure.
- `UIDidLoadCity`: called after successful load.
- `UIDidntLoadCity {msg}`: called on load failure.
- `UIDidLoadScenario`: called after scenario load.

### Simulation status updates
- `UISetFunds {funds}`: update head window funds labels.
- `UISetDate {date} {month} {year}`: update `DateView` widgets and `CurrentDate`.
- `UISetDemand {r} {c} {i}`: updates RCI demand bars and globals `DemandRes`, `DemandCom`, `DemandInd`.
- `UISetOptions {autobudget} {autogoto} {autobulldoze} {disasters} {sound} {animation} {messages} {notices}`: updates globals.
- `UISetSpeed {speed}`: updates `Time` and running indicators, uses `UIUpdateRunning`.
- `UISetGameLevel {level}`: updates `GameLevel` and scenario selection UI.
- `UISetCityName {name}`: updates `CityName` and window titles.
- `UISetMapState {viewPath} {state}`: updates map window title/variables to reflect state.

### Budget and evaluation
- `UIShowBudgetAndWait`: opens budget UI, pauses simulation, starts timer, triggers `sim UpdateBudget` and `sim UpdateBudgetWindow`.
- `UIUpdateBudget`: refreshes auto-budget UI state.
- `UISetBudget {cashflow} {previous} {current} {collected} {taxrate}`: updates budget and head window tax widgets.
- `UISetBudgetValues {roadgot} {roadwant} {roadpercent} {policegot} {policewant} {policepercent} {firegot} {firewant} {firepercent}`: updates budget sliders/labels if budget window is visible.
- `UISetEvaluation {changed} {score} {ps0} {ps1} {ps2} {ps3} {pv0} {pv1} {pv2} {pv3} {pop} {delta} {assessed} {cityclass} {citylevel} {goodyes} {goodno} {title}`:
  - Updates evaluation windows when visible and emits a status message.

### Messages and notices
- `UISetMessage {msg} ?tag?`: shows status text in editor and head windows when `DoMessages` is enabled.
- `UIPopUpMessage {msg}`: shows a pop-up message (notice window).
- `UIShowPicture {id} ?parms?`: displays a notice card if `DoNotices` is enabled.
- `UIShowZoneStatus {zone} {density} {value} {crime} {pollution} {growth} {x} {y}`: shows query picture and stores query coordinates.
- `UIAutoGoto {x} {y} ?except?`: converts tile coords to pixels, sets `AutoGoal` on editor views with AutoGoto enabled, triggers `sim UpdateMaps`.
- `UILoseGame`, `UIWinGame`: show endgame screens.

### Tool feedback and pending votes
- `UIDidTool<NAME> {win} {x} {y}`: tool-specific sound feedback. `NAME` values: `Res`, `Com`, `Ind`, `Fire`, `Qry`, `Pol`, `Wire`, `Dozr`, `Rail`, `Road`, `Chlk`, `Eraser`, `Stad`, `Park`, `Seap`, `Coal`, `Nuc`, `Airp`.
- `UISetToolState {viewPath} {state}`: updates pallet selection and tool cost labels.
- `DoPendTool {viewPath} {tool} {tileX} {tileY}`: called when a tool action requires a vote (multi-player). Default Tcl behavior uses `PendingTool/PendingX/PendingY` and `Votes` to manage voting UI.
- `UIDidPan {viewPath} {x} {y}`: called during auto-scroll panning; default Tcl handler forwards drags when tool mode == 1.
- `UIDidStopPan {viewPath}`: called when panning stops; default Tcl handler plays skid sound and tweaks cursor.

### Disasters
- `UIEarthQuake`: called when quake starts. Default Tcl handler is empty; effects are usually in UI scripts.

### Sound
- `UIInitializeSound`: sets up sound server.
- `UIShutDownSound`: shuts down sound server.
- `UIMakeSound {channel} {sound} ?opts?`: plays a one-shot sound.
- `UIMakeSoundOn {viewPath} {channel} {sound} ?opts?`: plays sound for a specific view.
- `UIStartSound {channel} {sound} ?opts?`: starts a looping sound.
- `UIStopSound {sound}`: stops a looping sound.
- `UISoundOff`: stops all sounds.

### Networking (optional)
- `HandlePacket <sock> {<ip>} {<byte0> <byte1> ...}`: emitted by `udp_hear` on each received UDP packet.

## Tcl Script Entry Points (default behavior)
The default UI implementation lives in `res/micropolis.tcl` and `res/w_*.tcl`. The key entry points and expectations are:
- `UIStartMicropolis` is the single bootstrap; it must call `sim InitGame` and `sim GameStarted` before building UI windows.
- `UIPlayGame` enters play state: `sim Resume`, `sim Speed 3`, `sim AutoGoto 1`, initializes head/editor windows, and sets `sim NeedRest 10`.
- `UIGenerateNewCity` builds a history entry and calls `sim GenerateNewCity` or `sim GenerateSomeCity`, then sets `sim CityName` and `sim GameLevel`.
- `UIShowBudgetAndWait` pauses the sim and triggers budget updates; it relies on `sim UpdateBudget` and `sim UpdateBudgetWindow` to populate values.
- `UISetMapState` updates per-map selection state and optionally opens dynamic filter UI when state == 14.
- `MapPanDown/Drag/Up` call mapview `PanStart`/`PanTo` and then `sim UpdateMaps`/`sim UpdateEditors` on release.
- `UIAutoGoto` and `UIAutoGotoOn` convert tile coords to pixel coords `(tile*16 + 8)` before calling editor view `AutoGoal`.

## Source map
- `src/sim/w_tk.c`
- `src/sim/w_sim.c`
- `src/sim/w_map.c`
- `src/sim/w_editor.c`
- `src/sim/w_graph.c`
- `src/sim/w_date.c`
- `src/sim/w_sprite.c`
- `src/sim/w_piem.c`
- `src/sim/w_inter.c`
- `src/sim/w_cam.c` (CAM)
- `src/sim/w_net.c` (NET)
- `src/sim/w_budget.c`
- `src/sim/w_eval.c`
- `src/sim/w_update.c`
- `src/sim/w_util.c`
- `src/sim/w_tool.c`
- `src/sim/w_sound.c`
- `src/sim/s_fileio.c`
- `src/sim/s_gen.c`
- `src/sim/s_msg.c`
- `src/sim/w_stubs.c`
- `src/sim/sim.c`
- `src/sim/headers/view.h`
- `src/sim/headers/sim.h`
- `src/tk/default.h`
- `res/micropolis.tcl`
- `res/wmap.tcl`
- `res/weditor.tcl`
- `res/whead.tcl`
- `res/wbudget.tcl`
- `res/wgraph.tcl`
- `res/weval.tcl`
- `res/wnotice.tcl`
- `res/wscen.tcl`
- `res/wfile.tcl`
- `res/wsplash.tcl`
- `res/wplayer.tcl`
- `res/wfrob.tcl`
