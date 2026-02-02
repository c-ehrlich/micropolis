# UI / Rendering / Tools / Sprites Specification

Scope: UI-facing behavior for map/editor views, tool input, overlays, sprites, graphs, date display, HUD updates (funds/demand/options/speed/name), budget/evaluation windows, and sound hooks. This spec focuses on observable behavior and data contracts; it does not require reproducing Tcl/Tk or X11 internals.

## Data Model

### Global UI container (Sim)
- `Sim` holds linked lists of:
  - `SimView *editor` (editor views) and count `editors`.
  - `SimView *map` (map/overview views) and count `maps`.
  - `SimGraph *graph` (graph widgets) and count `graphs`.
  - `SimDate *date` (date widgets) and count `dates`.
  - `SimSprite *sprite` (active sprites) and count `sprites`.
  - `Ink *overlay` (freehand overlay strokes).
- All lists are singly linked via `next` pointers in each struct.

### Ink (freehand overlay)
Fields (from `Ink`):
- `x, y`: starting pixel location (map pixel coords, 1 tile = 16 px).
- `points[]`: array of `XPoint` deltas; `points[0]` is absolute start; subsequent points are deltas from prior point.
- `length`: number of points in `points` (>= 1 when active).
- `maxlength`: capacity of `points` (grows by POINT_BATCH = 32).
- `color`: palette index (for overlay drawing; often COLOR_WHITE).
- `left, top, right, bottom`: bounding box of the stroke in pixel coords.
- `last_x, last_y`: last point in absolute pixel coords.
- `next`: next ink in list.

### XDisplay (shared display resources)
Fields (selected):
- `display`, `tkDisplay`, `dpy`, `screen`, `visual`, `depth`, `color`, `colormap`.
- `pixels[]`: palette index -> pixel values.
- `gc`: main GC.
- `big_tile_image`, `small_tile_image`: backing images.
- `big_tile_pixmap`: 16x16 tile sheet pixmap.
- `objects`: sprite pixmaps (array per sprite type; interleaved picture/mask).
- `overlay_gc`: GC for overlay mask pixmap.
- `gray25_stipple`, `gray50_stipple`, `gray75_stipple`, `vert_stipple`, `horiz_stipple`, `diag_stipple`: stipple pixmaps for monochrome rendering.

### SimView (editor/map view)
Key groups (all fields exist; only UI-relevant noted):
- Graphics buffers:
  - `pixels[]`, `depth`, `pixel_bytes`, `line_bytes`, `data` (primary), `data8` (8-bit), `line_bytes8`.
  - `image` / `other_image` / `other_data` for wire-mode drawing.
  - `pixmap` (back buffer), `pixmap2` (composite buffer), `overlay_pixmap` (1-bit mask for overlays).
  - `tiles` / `other_tiles`: per-tile cache for editor drawing.
- Map state:
  - `map_state` (ALMAP..DYMAP), `show_editors` (draw editor rectangles on map view).
- Tool state:
  - `tool_state` (current tool), `tool_mode` (0 normal edit, -1 pan, 1 alternate cursor), `tool_showing`, `tool_x`, `tool_y`, `tool_x_const`, `tool_y_const`.
  - `tool_state_save` (saved tool when temporarily switching to bulldozer).
  - `super_user`, `show_me` (draw cursor), `dynamic_filter` (see Dynamic Filter).
  - `tool_event_time`, `tool_last_event_time` (motion buffering).
- Scrolling:
  - `pan_x`, `pan_y`: center of view in pixel coords.
  - `w_width`, `w_height`: window size (pixels).
  - `m_width`, `m_height`: backing buffer size (pixels).
  - `i_width`, `i_height`: ideal world size for this view (pixels).
  - `tile_x`, `tile_y`, `tile_width`, `tile_height`: visible tile rect (tile coords).
  - `screen_x`, `screen_y`, `screen_width`, `screen_height`: visible pixel rect aligned to tiles.
- Update/visibility:
  - `visible`, `invalid`, `update`, `skips`, `skip`, `flags` (VIEW_REDRAW_PENDING).
- Tracking/interaction:
  - `last_x`, `last_y`, `last_button`, `track_info`, `message_var`.
- Auto-goto:
  - `auto_goto` (enable), `auto_going` (in progress), `auto_x_goal`, `auto_y_goal`, `auto_speed`, `follow` (sprite follow).
- Overlay:
  - `show_overlay`, `overlay_mode` (state machine), `overlay_time`.
- Sound:
  - `sound` (per-view sound enable/disable).

### SimGraph
- `range`: 10 or 120 (years in display).
- `mask`: bitmask (0..63) enabling histories (see Graphs).
- `visible`, `w_width`, `w_height`, `pixmap`, `pixels[]`, `fontPtr`, `border`, `borderWidth`, `relief`.
- `draw_graph_token`: timer token for deferred redraw.

### SimDate
- `month`, `year`, `lastmonth`, `lastyear`, `reset`.
- `visible`, `w_width`, `w_height`, `pixmap`, `pixels[]`, `fontPtr`, `border`, `borderWidth`, `padX`, `padY`, `width` (char count), `monthTab`, `monthTabX`, `yearTab`, `yearTabX`.
- `draw_date_token`: timer token.

### SimSprite
Fields and meaning:
- `type`: sprite type (TRA, COP, AIR, SHI, GOD, TOR, EXP, BUS).
- `frame`: 0 means inactive; otherwise 1-based frame index.
- `x, y`: sprite position in pixel coords (world coords * 16).
- `width, height`: sprite image size (px).
- `x_offset, y_offset`: draw offset relative to sprite origin.
- `x_hot, y_hot`: collision/anchor offset.
- `orig_x, orig_y`: origin for return trips.
- `dest_x, dest_y`: movement destination (pixel coords).
- `count`: countdown for behavior changes; `sound_count` for sound timing.
- `dir`, `new_dir`: direction state (varies per sprite).
- `step`, `flag`, `control`, `turn`, `accel`, `speed`: behavior controls.

## Coordinate Systems and Sizes
- World map dimensions: `WORLD_X` x `WORLD_Y` tiles.
- Editor view renders tiles at 16x16 pixels. One tile = 16 px.
- Map/overview view renders tiles at 3x3 pixels (MAP_W = WORLD_X * 3, MAP_H = WORLD_Y * 3).
- Pixel coords in tools/sprites refer to editor view world pixel coords (tile * 16).
- View pan (`pan_x`, `pan_y`) is in pixel coords; the visible tile rectangle is derived by `DoAdjustPan`.

### View coordinate conversion
- `ViewToTileCoords(view, x, y)`:
  - Input: window pixel coords relative to view (mouse coordinates).
  - Converts to world tile coords based on view pan and window size, clamps to world bounds and visible tile rectangle.
  - If `tool_x_const/tool_y_const` set, returns constrained values.
- `ViewToPixelCoords(view, x, y)`:
  - Same as above but returns world pixel coords (tile * 16), clamped to visible tile rectangle.
  - If `tool_x_const/tool_y_const` set, returns center of constrained tile (`tile*16 + 8`).

## View Lifecycle and Rendering Pipeline

### Creation
- `editorview` / `mapview` Tcl commands create a `SimView` window:
  - Editor view class: `Editor_Class`.
  - Map view class: `Map_Class`.
- `InitNewView(view, title, class, w, h)`:
  - Initializes view fields with defaults (tool_state = dozeState, tool_mode = 0, show_overlay = 1, map_state = ALMAP, show_editors = 1).
  - Determines rendering type: `X_Mem_View` if shared memory pixmaps are available; else `X_Wire_View`.
  - Sets `pan_x/pan_y` to the center of ideal size, then calls `DoResizeView`.
  - `GetViewTiles` and `GetPixmaps` must be available (resource/spec in resources).
- `DoNewEditor` / `DoNewMap` adds the view to `sim->editor` / `sim->map` lists and marks as invalid.

### Resize
- `DoResizeView(view, w, h)`:
  - Map view: `m_width/m_height` == window size; `pixmap2` created (same size).
  - Editor view: buffers are rounded up to multiples of 16 and cached; `pixmap2` and `overlay_pixmap` sized to `m_width/m_height`.
  - Allocates shared memory buffers when possible; otherwise falls back to wire mode and allocates local images.
  - Calls `AllocTiles` and `DoAdjustPan` for editor views.

### Pan and visible tile rectangle
- `DoPanTo(view, x, y)` clamps `pan_x/pan_y` to `[0..i_width-1]` and `[0..i_height-1]` (pixels).
- `DoAdjustPan(view)`:
  - Computes visible tile rect (`tile_x/y`, `tile_width/height`) and screen alignment (`screen_x/y`, `screen_width/height`) from pan and window size.
  - Resets `overlay_mode` to 0 and marks view invalid.
  - If `show_me` is enabled, triggers `RedrawMaps` so map views update editor rectangles.
  - Shifts tile cache (`tiles`/`other_tiles`) and scrolls `pixmap` to reuse existing rendered area.

### Redraw scheduling
- `EventuallyRedrawView(view)` schedules `DisplayTileView` via idle handler; sets `VIEW_REDRAW_PENDING`.
- `DisplayTileView` calls `DoUpdateEditor` or `DoUpdateMap` when visible.
- `InvalidateEditors` / `InvalidateMaps` set `invalid=1`, `skip=0`, schedule redraw and reset `sim_skip`.
- `RedrawEditors` / `RedrawMaps` just reset skip and schedule redraw.

### Skip logic
- Both editor and map updates skip frames based on `sim_skips` (global) and `view->skips` (per view):
  - If `sim_skips` is set and `sim_skip > 0`, the update returns immediately.
  - Else if `view->skips` is set and `view->skip > 0`, it decrements and returns; otherwise resets `view->skip = view->skips`.
- Skip suppression: tool actions set `sim_skip = 0`, `view->skip = 0` and mark view invalid.

### Shake effect
- `ShakeNow` controls screen shaking (earthquake). When non-zero, a random offset per shake iteration is applied to the final blit.

## Map/Overview View (Map_Class)

### Update
- `DoUpdateMap(view)`:
  - If `invalid` or `NewMap` or `ShakeNow`, redraws the whole map using `MemDrawMap` or `WireDrawMap`.
  - Copies `pixmap` -> `pixmap2`, draws overlay ink (`DrawMapInk`), then blits `pixmap2` to window.
  - If `show_editors`, draws editor view rectangles (scaled) over the map.

### Editor rectangles on map view
- Each editor view with `show_me != 0` is drawn as a 3/16 scaled rectangle.
- The rectangle outlines are drawn with white, black, and yellow borders (3 nested rectangles).

### Map state rendering
- `map_state` selects one of 15 map modes:
  - `ALMAP` (all), `REMAP` (res), `COMAP` (com), `INMAP` (ind), `PRMAP` (power), `RDMAP` (road),
  - `PDMAP` (population density), `RGMAP` (rate of growth), `TDMAP` (traffic density), `PLMAP` (pollution), `CRMAP` (crime), `LVMAP` (land value),
  - `FIMAP` (fire radius), `POMAP` (police radius), `DYMAP` (dynamic filter).
- `MemDrawMap` calls `mapProcs[map_state]` which populate the map view image buffer.

### Small tile rendering (3x3)
- `drawAll`: copies 3x3-pixel tiles for every world tile.
- `drawRes`: shows only residential tiles (tile index <= 422).
- `drawCom`: shows only commercial tiles (tile <= 609 and not 232..422).
- `drawInd`: hides tile ranges (industrial filter) as per `drawInd` conditions.
- `drawLilTransMap`: shows basic transport (hides most tiles >= 240, 207..220, 223).
- `drawPower`:
  - Zones (tile > 63 and ZONEBIT) show powered/unpowered colors (red/light blue).
  - Conductive non-zones (CONDBIT) show light gray.
  - Otherwise uses base tiles.
- `drawDynamic`: for tiles > 63, hides tiles that fail `dynamicFilter`.

### Density overlay rectangles
- Density maps draw colored rectangles over a base map:
  - PopDensity, Traffic, Pollution, Crime, LandValue use half-resolution arrays (`HWLDX`, `HWLDY`) and 6x6 pixel rectangles.
  - Rate of Growth, FireRadius, PoliceRadius use quarter-resolution arrays (`SmX`, `SmY`) and 24x24 pixel rectangles.
- Value mapping uses `GetCI` thresholds:
  - < 50: none, <100: low, <150: medium, <200: high, else very high.
- Color mapping in color mode uses `valMap[]` and in mono uses `valGrayMap[]`.
- Monochrome mode dithers the full map via `ditherMap` after drawing.

### Dynamic filter
- Global `DynamicData[32]` defines 16 (min,max) ranges for:
  - PopDensity, RateOGMem, TrfDensity, PollutionMem, CrimeMem, LandValueMem, PoliceMapEffect, FireRate.
- For each pair: if min > max, the filter for that metric is disabled.
- The point passes if all enabled metrics are within inclusive bounds.
- Rate of Growth uses transformed limits: compare `RateOGMem[c>>2][r>>2]` to `(2*min - 256)` / `(2*max - 256)`.

## Editor View (Editor_Class)

### Update
- `DoUpdateEditor(view)`:
  - Applies skip logic; handles auto-goto; animates tiles once per tick if `DoAnimation && SimSpeed && !heat_steps && !TilesAnimated`.
  - If `invalid`, redraws visible tile region using `MemDrawBeegMapRect` or `WireDrawBeegMapRect`.
  - Copies `pixmap` -> `pixmap2`, draws outside margins, pending tool overlay (if any), sprites, and freehand overlay.
  - Blits `pixmap2` to window (with optional shake offset).
  - Draws tool cursor over the window.

### Big tile rendering (16x16)
- `MemDrawBeegMapRect(view, x, y, w, h)`:
  - Draws only visible region; clamps to visible tile rectangle.
  - Uses per-tile cache (`view->tiles`) to avoid redrawing unchanged tiles.
  - Blink: if `flagBlink <= 0` and tile has `ZONEBIT` but lacks `PWRBIT`, render as `LIGHTNINGBOLT` instead of the tile.
  - Dynamic filter: if `tile > 63` and `view->dynamic_filter != 0` and `dynamicFilter` returns false, render as tile 0.
- `WireDrawBeegMapRect` uses shared `big_tile_pixmap` and only redraws tiles whose cached value changed.

### Outside fill
- `DrawOutside` fills any area outside the world bounds with black (color) or white (mono).

## Overlays and Ink

### Freehand overlay creation
- `ChalkStart` creates a new `Ink`, sets start point, color, and stores in `sim->overlay` list.
- `AddInk` adds a delta point and updates bounding box.
- `ChalkTo` and `EraserTo` operate in view pixel coords.
- `EraserTo` removes any `Ink` whose stroke bounding box intersects a 16x16 box centered at the cursor (x±8, y±8) and whose segment intersects that box.

### Overlay drawing in editor view
Overlay mode state machine in `DrawOverlay`:
- `0`: overlay invalid. Draw directly to `pixmap2`, then set mode `1`.
- `1`: measure time of direct draw (draw to `pixmap2`); store elapsed in `overlay_time`, set mode `2`.
- `2`: draw to `overlay_pixmap` mask (1-bit), then measure time to clip mask to `pixmap2`. If clipping faster -> mode `4`, else mode `3`.
- `3`: always draw lines directly to `pixmap2`.
- `4`: always clip `overlay_pixmap` to `pixmap2`.
- `ClipTheOverlay` uses stipple/mask depending on color vs mono.

### Overlay drawing in map view
- `DrawMapInk` scales ink paths by 3/16 and draws onto `pixmap2` in map view.

## Tools

### Tool state enumeration
- States 0..18:
  - 0 residential, 1 commercial, 2 industrial, 3 fire, 4 query, 5 police, 6 wire, 7 bulldoze,
  - 8 rail, 9 road, 10 chalk, 11 eraser, 12 stadium, 13 park, 14 seaport,
  - 15 power plant, 16 nuclear plant, 17 airport, 18 network.

### Tool sizes and offsets
- `toolSize[]` (tiles):
  - [3,3,3,3,1,3,1,1,1,1,0,0,4,1,4,4,4,6,1]
- `toolOffset[]` (tiles):
  - [1,1,1,1,0,1,0,0,0,0,0,0,1,0,1,1,1,1,0]

### Tool costs
- `CostOf[]` per tool state:
  - [100,100,100,500,0,500,5,1,20,10,0,0,5000,10,3000,3000,5000,10000,100,0]
  - Index aligned with tool states above.

### Tool cursor colors
- `toolColors[]` packs (fg | bg<<8) per tool, using COLOR_* indices. (See w_tool.c for exact mapping.)

### Tool application
- `DoTool(view, tool, x, y)` performs a single tool action at tile coords (x,y):
  - Calls `do_tool` with pixel coords (x<<4, y<<4).
  - If result == -1: "invalid" (out of bounds), show message 34 and sound "UhUh".
  - If result == -2: "no funds", show message 33 and sound "Sorry".
  - Resets skip counters and invalidates editors.
- `ToolDown/ToolDrag/ToolUp` for continuous tool use:
  - Uses `ViewToPixelCoords` to clamp to view.
  - For chalk/eraser, draws continuously with every drag event.
  - For others, interpolates line of tool placements between last and current tile; step size is `0.3 / max(|dx|, |dy|)` to ensure coverage.
  - For single-tile tools (size == 1), fills diagonal corners to avoid gaps.

### Zone placement (3x3, 4x4, 6x6)
- `check3x3/check4x4/check6x6`:
  - Convert center (mapH,mapV) to top-left by subtracting 1.
  - Reject if any part outside bounds.
  - If `autoBulldoze`:
    - For each tile in area, if non-empty and `tally(tile)` true (autobulldoze-eligible), add cost 1 per tile; else reject.
  - Else: reject if any tile non-empty.
  - Total cost = `CostOf[tool] + autoBulldozeCost`.
  - Reject if funds insufficient (return -2).
  - Multiplayer cost check: if `Players > 1`, `OverRide == 0`, `cost >= Expensive`, `view != NULL`, and `view->super_user == 0` => return -3.
  - On success: `Spend(cost)`, `UpdateFunds`, then lay tiles with `BNCNBIT` and center `ZONEBIT`. 4x4 adds `ANIMBIT` at row 2/col 1 when `aniFlag` set.
  - Call `check*border` to reconnect adjacent transport tiles.
- Seaport placement uses `check4x4` with no water-adjacency requirement (only empty tiles, bounds, and funds).

### Bulldozer tool
- If `ZONEBIT` set: spend 1 and replace zone with rubble (3x3, 4x4, or 6x6) with explosions; special sounds for sizes.
- Else if `checkBigZone` identifies large zones/airports, clears rubble accordingly.
- Else: bulldoze single tile via `ConnecTile(x,y, &Map[x][y], 1)`.
  - For water (RIVER/REDGE/CHANNEL): requires >= 6 funds and spends 5 if tile changed.
- Calls `UpdateFunds` and `DidTool` on success.

### Park tool
- If funds >= CostOf[parkState], places:
  - `FOUNTAIN | BURNBIT | BULLBIT | ANIMBIT` with 1/4 chance, else `WOODS2..WOODS5` (random) with `BURNBIT|BULLBIT`.
  - Only on empty tiles; else returns -1.

### Network tool
- If tile is autobulldozable and funds > 0, clears tile and spends 1.
- If tile becomes empty and funds allow, places `TELEBASE | CONDBIT | BURNBIT | BULLBIT | ANIMBIT` and spends CostOf[networkState].

### Query tool
- `doZoneStatus(x,y)`:
  - Normalizes tile for special ranges (e.g., coal smoke -> COALBASE).
  - Finds base label via `idArray` and string table 219.
  - Computes 5 status strings (pop density, land value, crime, pollution, growth) via string table 202 using `getDensityStr`.
  - Calls `UIShowZoneStatus` with label and 5 status strings.

### Tool UI events
- `DidTool(view, name, x, y)` calls Tcl: `UIDidTool<name> <viewPath> x y` on success.
- `DoSetWandState(view, state)` calls Tcl: `UISetToolState <viewPath> state`.
- `DoSetMapState(view, state)` calls Tcl: `UISetMapState <viewPath> state`.

### Pending tool (multiplayer voting)
- Globals: `PendingTool`, `PendingX`, `PendingY`, `BobHeight`, `Players`, `Votes`.
- When pending tool exists, `DrawPending` renders a stippled square (tool size) with a bobbing icon based on `Players - Votes`.

## Auto-pan and Follow
- Auto pan is enabled when `view->auto_goto` is set.
- `HandleAutoGoto(view)`:
  - If `view->follow` is set, pan directly to sprite hot spot.
  - Else if `auto_goto` and `auto_going` and `tool_mode == 0`, move toward (`auto_x_goal`, `auto_y_goal`) at `auto_speed` pixels per tick.
  - Movement slows for the first 4 steps (`sloth = auto_going / 5`).
  - When within `speed * sloth`, pan directly to goal, set `auto_going = 0`, and call `DidStopPan`.

## Sprites

### Types and initialization
- Types: `TRA` (train), `COP` (helicopter), `AIR` (airplane), `SHI` (ship), `GOD` (monster), `TOR` (tornado), `EXP` (explosion), `BUS` (bus).
- `InitSprite` sets defaults and then per-type:
  - `TRA`: 32x32, offset (32,-16), hot (40,-8), frame=1, dir=4.
  - `SHI`: 48x48, offset (32,-16), hot (48,0), frame chosen by edge, dir=10, new_dir=frame, count=1.
  - `GOD`: 48x48, offset (24,0), hot (40,16), frame based on quadrant, count=1000, dest=(PolMaxX,PolMaxY) tiles, origin set.
  - `COP`: 32x32, offset (32,-16), hot (40,-8), frame=5, count=1500, dest=random tile, origin x-30.
  - `AIR`: 48x48, offset (24,0), hot (48,16), frame 7 or 11 depending on edge; dest_x set +/-200.
  - `TOR`: 48x48, offset (24,0), hot (40,36), frame=1, count=200.
  - `EXP`: 48x48, offset (24,0), hot (40,16), frame=1.
  - `BUS`: 32x32, offset (30,-18), hot (40,-8), frame=1, dir=1.

### Rendering
- For each sprite with `frame != 0`, draw:
  - `pict = objects[type][(frame-1)*2]`, `mask = objects[type][(frame-1)*2 + 1]`.
  - Screen position: `x = sprite->x - ((view->tile_x<<4) - view->screen_x) + sprite->x_offset`, similarly for `y`.
  - Apply mask via GC clip and blit to `pixmap2`.

### Common helpers
- `GetDir` returns an 8-direction code (1..8) based on dest minus origin, with `absDist` = |dx|+|dy|.
- `TurnTo(p, d)` rotates direction one step toward target.
- `CheckSpriteCollision` uses Manhattan distance < 30 between hot spots.
- `SpriteNotInBounds` checks hot spot against world bounds.

### Per-sprite behavior
#### Train (TRA)
- Moves 4 px per step along rail tiles.
- Every 4th cycle, picks a new direction based on nearby rails; avoids reversing.
- Turns set frames 3/4 for curves; frame 5 on straight rail base.
- Stops (frame=0) if no valid direction.

#### Helicopter (COP)
- Drifts toward `dest_x/dest_y`, returns to `orig_x/orig_y` when `count` reaches 0.
- If `control >= 0`, moves to dest then returns.
- Every 200 ticks checks traffic density; if high, sends message -41 and plays sound "HeavyTraffic".
- Turns every 4 cycles to face direction of travel.

#### Airplane (AIR)
- Changes frame every 5 cycles; frames >8 are takeoff sequence.
- When near destination (absDist < 50), picks new random dest within world +/-50 px.
- Collides with COP/AIR if disasters enabled; triggers explosions.
- Deactivates when out of bounds.

#### Ship (SHI)
- Moves on water/bridge channels; picks new direction every `count` ticks.
- Plays horn occasionally; special case for scenario 2 (San Francisco) with different speed.
- If stranded (tile not water/bridge), explodes and destroys terrain.

#### Monster (GOD)
- Moves in 2 px steps; uses multiple animation frames per direction.
- AI phases:
  - `control < 0`: normal behavior; turns occasionally toward destination or random turns.
  - `control >= 0`: user-controlled direction.
- If reaches destination, sets return to origin; eventually despawns.
- Destroys tiles under hot spot; collides with vehicles and triggers explosions.

#### Tornado (TOR)
- Alternates frames 1/2/3 for animation.
- Randomly moves using small dx/dy table; may end early with low probability.
- Collides with vehicles and explodes them.

#### Explosion (EXP)
- Advances frame every other cycle; on frame 1 sends message 32 and sound "Explosion-High".
- After frame 6, deactivates and starts fires around center.

#### Bus (BUS)
- Moves on roads at speed based on traffic density (`TrfDensity >> 6`):
  - z=0 => speed 8, z=1 => speed 4, z=2 => speed 1.
- When turning, reduces speed to <=1 and uses frames 3/4 for turn.
- Drifts into the right lane by adjusting dx/dy toward lane center.
- Uses `CanDriveOn` to test upcoming tiles; can bulldoze at high speed if blocked.
- Collides with buses or trains (except frame 5) to explode if disasters enabled.

### Sprite generation
- `GenerateTrain` spawns train when `TotalPop > 20` and no train exists, 1/25 chance.
- `GenerateBus` spawns bus if none exists, 1/25 chance.
- `GenerateShip` spawns from world edges if channel tiles exist (probabilistic checks).
- `GenerateCopter` / `GeneratePlane` spawn if none exists.
- `MakeMonster`, `MakeTornado`, `MakeExplosion` spawn disasters and play messages.

## Graphs
- Graphs show 6 histories (RES, COM, IND, MONEY, CRIME, POLLUTION) with 120 samples each.
- Two ranges:
  - Range 10: last 120 months; Range 120: last 1200 months (scaled by 10).
- `GraphCmdRange` only allows 10 or 120; `GraphCmdMask` is 0..63 bitmask.
- `doAllGraphs` scales history arrays to 0..255 based on max of RES/COM/IND.
- `DoUpdateGraph`:
  - Draws background, then polylines for each enabled history.
  - Uses `HistColor[]` for color; in mono uses stipples based on history type.
  - Optionally draws right-side labels when window is wide enough and top labels for years when tall enough.
  - Draws year gridlines based on current month/year.

## Date Display
- `UISetDate` calls Tcl `dateview Set <month> <year>`, which sets `SimDate.month/year` and schedules redraw.
- `DoUpdateDate`:
  - Draws background and "Date:" label.
  - Draws month/year at positions `monthTabX` and `yearTabX`.
  - If multiple months passed since last update, draws intermediate months in dark gray as a fade trail.
  - If year advances, draws trailing years (up to 10).
  - Uses `dateStr[]` array (Jan..Dec).
- Date widget is redrawn at most every 200 ms via timer.

## Budget UI
- Budget flow computes desired funding based on `firePercent/policePercent/roadPercent`.
- `DoBudgetNow(fromMenu)`:
  - Calculates funding, clamps based on available `TaxFund + TotalFunds`.
  - Updates `fireValue/policeValue/roadValue` and corresponding percents if funds are insufficient.
  - If `autoBudget` is off or invoked from menu, shows budget UI and pauses sim via `UIShowBudgetAndWait`.
- UI output:
  - `UISetBudget {flow} {previous} {current} {collected} {tax}`.
  - `UISetBudgetValues {roadGot} {roadWant} roadPct {policeGot} {policeWant} policePct {fireGot} {fireWant} firePct`.

## Evaluation UI
- `doScoreCard` builds the evaluation strings (population, assessed value, problems, city class, etc.).
- UI output: `UISetEvaluation` with all textual fields and percents.

## HUD / Heads Updates

### Funds
- `ReallyUpdateFunds`:
  - Clamps `TotalFunds` to >= 0.
  - Formats with `$` and comma separators; calls `UISetFunds {Funds: $X}`.

### Date
- `updateDate`:
  - `CityTime` units: 48 ticks per year, 4 ticks per month (month = (CityTime % 48) >> 2).
  - If year reaches >= 1,000,000, resets to `StartingYear` and sends message -40.
  - Calls `UISetDate {"Mon YYYY"} m y` when month/year changes.

### Demand valves
- `drawValve` clamps `RValve/CValve/IValve` to [-1500, 1500] and calls `UISetDemand r c i` with each divided by 100.

### Options
- `updateOptions` sets option bits:
  - 1 autoBudget, 2 autoGo, 4 autoBulldoze, 8 disasters enabled, 16 sound, 32 animation, 64 messages, 128 notices.
  - Calls `UISetOptions` with 8 boolean parameters.

### Speed
- `setSpeed(0..3)` calls `UISetSpeed` (0 when paused).

### City name and game level
- `setCityName` replaces non-alphanumeric characters with `_` and calls `UISetCityName {name}`.
- `UpdateGameLevel` calls `UISetGameLevel`.

## Sound Hooks
- `UIInitializeSound`, `UIShutDownSound`, `UIMakeSound`, `UIMakeSoundOn`, `UIStartSound`, `UIStopSound`, `UISoundOff` are invoked from C.
- Sound is suppressed if `UserSoundOn` is false.

## Keyboard Handling (Editor)
- Secret strings typed (rolling 4-char buffer):
  - `fund`: add $10,000; triggers earthquake every 5 uses.
  - `fart`: plays explosions and triggers multiple disasters.
  - `nuke`: replaces many tiles with rubble/river.
  - `stop`: stops heat simulation.
  - `will`, `bobo`, `boss`, `mack`, `donh`, `patb`, `lucb`: debug heat modes.
  - `olpc`: add $1,000,000.
- Single-key tool shortcuts:
  - `x`/`X`: next tool; `z`/`Z`: previous tool.
  - `b`: temporary bulldozer (restores previous tool on key up).
  - Additional tool keys handled in `doKeyDown`/`doKeyUp`.

## UI <-> Simulation Command Interface (selected)
- C -> UI (Eval command strings):
  - `UISetFunds`, `UISetDate`, `UISetDemand`, `UISetOptions`, `UISetSpeed`, `UISetCityName`, `UISetGameLevel`.
  - `UISetMapState`, `UISetToolState`, `UIShowZoneStatus`, `UIDidTool*`.
  - `UISetEvaluation`, `UISetBudget`, `UISetBudgetValues`, `UIUpdateBudget`, `UIShowBudgetAndWait`.
  - `UINewGame`, `UIPopUpMessage`.
  - `UIMakeSound`, `UIMakeSoundOn`, `UIInitializeSound`, `UIShutDownSound`, `UIStartSound`, `UIStopSound`, `UISoundOff`.
- UI -> C (Tcl commands):
  - `editorview` and `mapview` create views; methods in `EditorCmds` and `MapCmds` mutate view state and invoke tools.
  - `graphview` and `dateview` create graphs/dates; range/mask/set/reset methods update display.
  - `sprite` creates a sprite object and exposes getters/setters for sprite fields.

## Ordering and Timing
- Per simulation tick, `SimFrame -> Simulate` triggers UI update flags (see core spec).
- UI tick order (typical):
  1. `UpdateHeads` (funds, date, demand, options).
  2. `UpdateEditors` / `UpdateMaps` / `UpdateGraphs` / `UpdateEvaluation` set invalidation flags.
  3. `Kick` schedules redraw; idle handlers call `DisplayTileView` / `DisplaySimGraph` / `DisplaySimDate`.
- Graphs and dates use timer handlers (100 ms and 200 ms respectively) for redraw throttling.

## Edge Cases and Limits
- Tool placement fails with -1 when out of bounds or blocked; -2 when funds insufficient; -3 when multiplayer cost override not allowed.
- `updateDate` prevents year from exceeding 1,000,000 (resets to StartingYear).
- Sprite frame 0 means inactive and may free unnamed sprites.
- Editor view pan and tool coordinates are clamped to visible tile rectangle.
- In monochrome mode, map and overlays use stipples/dither patterns.

## Source Map
- `src/sim/headers/view.h`
- `src/sim/headers/sim.h`
- `src/sim/w_tk.c`
- `src/sim/w_x.c`
- `src/sim/w_editor.c`
- `src/sim/w_map.c`
- `src/sim/w_tool.c`
- `src/sim/w_sprite.c`
- `src/sim/g_map.c`
- `src/sim/g_bigmap.c`
- `src/sim/g_smmaps.c`
- `src/sim/g_ani.c`
- `src/sim/w_update.c`
- `src/sim/w_util.c`
- `src/sim/w_graph.c`
- `src/sim/w_date.c`
- `src/sim/w_budget.c`
- `src/sim/w_eval.c`
- `src/sim/w_sound.c`
- `src/sim/w_keys.c`
- `src/sim/w_sim.c`
