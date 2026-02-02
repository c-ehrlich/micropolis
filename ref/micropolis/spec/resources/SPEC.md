# Resources and Assets

This spec covers non-code assets and the resource loading system used by the C and Tcl/Tk front end.

## Resource roots and paths

- `SIMHOME` environment variable defines the installation root. If unset, `.` is used.
- `HomeDir = SIMHOME`.
- `ResourceDir = SIMHOME/res/` (note trailing slash in `sim.c`).
- C code loads:
  - Resource files (`stri.*`, `hexa.*`, `snro.*`) from `ResourceDir`.
  - XPM images from `HomeDir/images`.
- Tcl code loads:
  - Scripts from `ResourceDir` (e.g., `micropolis.tcl`, `whead.tcl`, etc.).
  - Bitmaps using `@images/...` (Tk bitmap file syntax). These paths are resolved relative to the process working directory; the intended working directory is `HomeDir` so `images/` is found at `SIMHOME/images`.
  - Help HTML at `ResourceDir/doc/<HelpId>.html` (see Help/Manual below). Repository stores these under `manual/` and they must be staged to `res/doc/` at runtime.

## C resource file system (mac.h, w_resrc.c)

### Data model

`struct Resource` (from `src/sim/headers/mac.h`):
- `char *buf`: raw file bytes.
- `QUAD size`: file size in bytes.
- `char name[4]`: 4-character resource type, not null-terminated.
- `QUAD id`: decimal resource id.
- `struct Resource *next`: singly linked list cache.

`struct StringTable` (from `w_resrc.c`):
- `QUAD id`: resource id.
- `int lines`: number of strings.
- `char **strings`: array of pointers into the resource buffer.
- `struct StringTable *next`: cache list.

### File naming and lookup

`GetResource(name, id)`:
- `name` is a 4-character string (only first 4 chars used).
- Path format (Unix): `"%s/%c%c%c%c.%d"` where `%s` is `ResourceDir`.
- Path format (MSDOS): `"%s\\%c%c%c%c.%d"`.
- Example: `GetResource("stri", 301)` loads `res/stri.301`.
- The file is read entirely into memory and cached by `(name,id)`; repeated calls return the cached buffer pointer.
- On failure, prints an error and returns `NULL`. Resource cache is not freed during runtime.

### String table loading

`GetIndString(char *str, int id, short num)`:
- Loads resource `stri.<id>` once and caches it.
- Parsing:
  - Counts lines by scanning the full buffer and treating each `\n` as a line terminator.
  - Each `\n` is replaced with `\0` to split into C strings.
  - `strings[i]` points into the original buffer at the start of the i-th line.
- Indexing:
  - `num` is 1-based. `num=1` returns first line.
  - If `num < 1` or `num > lines`, prints error and returns string `"Well I'll be a monkey's uncle!"`.

### Resource types used by C

- `stri.<id>`: string tables (see below).
- `hexa.<id>`: raw graphics data (map tiles; see below).
- `snro.<id>`: scenario city files (format covered in `spec/persistence/SPEC.md`), loaded by `s_fileio` via `ResourceDir`.

## String tables (res/stri.*)

All string tables are plain text, newline-delimited. Indices are 1-based via `GetIndString`.

### stri.202 (20 lines)
Used for zone status values in `w_tool.c` (density/condition labels). Index => text:
1 Low
2 Medium
3 High
4 Very High
5 Slum
6 Lower Class
7 Middle Class
8 High
9 Safe
10 Light
11 Moderate
12 Dangerous
13 None
14 Moderate
15 Heavy
16 Very Heavy
17 Declining
18 Stable
19 Slow Growth
20 Fast Growth

### stri.219 (27 lines)
Used for zone type names in `w_tool.c` (tile category labels). Index => text:
1 Clear
2 Water
3 Trees
4 Rubble
5 Flood
6 Radioactive Waste
7 Fire
8 Road
9 Power
10 Rail
11 Residential
12 Commercial
13 Industrial
14 Seaport
15 Airport
16 Coal Power
17 Fire Department
18 Police Department
19 Stadium
20 Nuclear Power
21 Draw Bridge
22 Radar Dish
23 Fountain
24 Industrial
25 Steelers 38  Bears 3
26 Draw Bridge
27 Ur 238

### stri.301 (64 lines)
Used for message text in `s_msg.c` (`MesNum` values). Index => text:
1 More residential zones needed.
2 More commercial zones needed.
3 More industrial zones needed.
4 More roads required.
5 Inadequate rail system.
6 Build a Power Plant.
7 Residents demand a Stadium.
8 Industry requires a Sea Port.
9 Commerce requires an Airport.
10 Pollution very high.
11 Crime very high.
12 Frequent traffic jams reported.
13 Citizens demand a Fire Department.
14 Citizens demand a Police Department.
15 Blackouts reported. Check power map.
16 Citizens upset. The tax rate is too high.
17 Roads deteriorating, due to lack of funds.
18 Fire departments need funding.
19 Police departments need funding.
20 Fire reported !
21 A Monster has been sighted !!
22 Tornado reported !!
23 Major earthquake reported !!!
24 A plane has crashed !
25 Shipwreck reported !
26 A train crashed !
27 A helicopter crashed !
28 Unemployment rate is high.
29 YOUR CITY HAS GONE BROKE!
30 Firebombing reported !
31 Need more parks.
32 Explosion detected !
33 Insufficient funds to build that.
34 Area must be bulldozed first.
35 Population has reached 2,000.
36 Population has reached 10,000.
37 Population has reached 50,000.
38 Population has reached 100,000.
39 Population has reached 500,000.
40 Brownouts, build another Power Plant.
41 Heavy Traffic reported.
42 Flooding reported !!
43 A Nuclear Meltdown has occurred !!!
44 They're rioting in the streets !!
45 End of Demo !!
46 No Sound Server!
47 No Multi Player License !!
48 Started a New City.
49 Restored a Saved City.
50 x
51 x
52 x
53 x
54 x
55 x
56 x
57 x
58 x
59 x
60 x
61 x
62 x
63 x
64 x

### stri.356 (19 lines)
Tool names (used by UI tool palette):
1 Residential Zone
2 Commercial Zone
3 Industrial Zone
4 Fire Station
5 Query
6 Police Station
7 Wire Power
8 Bulldozer
9 Rail
10 Road
11 Chalk
12 Eraser
13 Stadium
14 Park
15 Seaport
16 Coal Power
17 Nuclear Power
18 Airport
19 (empty string)

## Map tile graphics

### Tile counts and sizes

- `Tile.TILE_COUNT` = 960 (`sim.h`).
- Editor view tiles are 16x16 pixels.
- Map view tiles are 3x3 pixels, expanded to 4x4 with padding for internal buffers.

### Editor view (big tiles)

Loaded by `GetViewTiles` in `g_setup.c`.

- `images/tiles.xpm` (color):
  - XPM image with width 16, height 16 * Tile.TILE_COUNT (15360), 14 colors, 1 char per pixel.
  - Tile index `t` (0-based) occupies pixels:
    - x = 0..15
    - y = (t * 16) .. (t * 16 + 15)
- `images/tilesbw.xpm` (monochrome):
  - XPM image with width 16, height 15360, 2 colors, 1 char per pixel.
  - Same tile indexing as `tiles.xpm`.

### Map view (small tiles)

Loaded by `GetViewTiles` in `g_setup.c`.

- `images/tilessm.xpm` (color):
  - XPM image with width 4, height 3 * Tile.TILE_COUNT (2880), 14 colors, 1 char per pixel.
  - Tile index `t` occupies pixels:
    - x = 0..3
    - y = (t * 3) .. (t * 3 + 2)
  - The 4th column is padding; the logical tile is 3x3.
- `res/hexa.388` (monochrome):
  - Loaded via `GetResource("hexa", 388)` and passed directly to `XCreateImage` with:
    - depth 8, format ZPixmap, width 4, height 3 * Tile.TILE_COUNT, bytes_per_line 4.
  - The image data is interpreted as 8-bit pixels (one byte per pixel) in the display’s colormap.
  - Only the first `4 * 3 * Tile.TILE_COUNT` bytes are used; any extra bytes are ignored.

### Legacy/unused hexa resources

`hexa.<id>` files are raw binary map-graphics resources. Only id 388 is used by current XPM-based rendering. Other files exist but are not referenced by the X11/Tk build paths in this repo:

- `hexa.112` (36864 bytes)
- `hexa.232` (25344 bytes)
- `hexa.384` (8192 bytes)
- `hexa.385` (8000 bytes)  [SIM_SMTILE]
- `hexa.386` (31000 bytes) [SIM_BWTILE]
- `hexa.387` (4096 bytes)
- `hexa.388` (12000 bytes) [SIM_GSMTILE, used]
- `hexa.456` (18432 bytes)
- `hexa.544` (122880 bytes) [SIM_LGTILE]
- `hexa.563` (13824 bytes)
- `hexa.999` (25344 bytes)

These should be treated as opaque binary blobs unless a port explicitly reimplements the legacy hexa renderer.

### Additional tile sheets

`images/tiles-<n>.xpm` where `n = 0..156` (157 files) are present but not referenced by current code. Treat as legacy or tooling assets.

## Sprite graphics (moving objects)

Sprites are loaded from `HomeDir/images/obj<ID>-<frame>.xpm` via `GetObjectXpms` in `g_setup.c`.

- File naming: `obj<ID>-<frame>.xpm`, 0-based frame index.
- Each XPM uses `None` for transparency; `XpmReadFileToPixmap` produces both the pixmap and mask.
- `GetObjectXpms` returns an array of `2 * frames` Pixmaps: image at index `2*i`, mask at `2*i+1`.

Sprite ID mapping (from `sim.h` and `w_sprite.c`):

- ID 1 `TRA` (train)    : frames 0..4 (5 files), 32x32.
- ID 2 `COP` (helicopter): frames 0..7 (8 files), 32x32.
- ID 3 `AIR` (airplane) : frames 0..10 (11 files), 48x48.
- ID 4 `SHI` (ship)     : frames 0..7 (8 files), 48x48.
- ID 5 `GOD` (monster)  : frames 0..15 (16 files), 48x48.
- ID 6 `TOR` (tornado)  : frames 0..2 (3 files), 48x48.
- ID 7 `EXP` (explosion): frames 0..5 (6 files), 48x48.
- ID 8 `BUS` (bus)      : frames 0..3 (4 files), 32x32.

## UI bitmaps (Tk)

Tcl/Tk UI scripts reference XPM images using `-bitmap "@images/<name>.xpm"`. The following image base names are referenced by scripts under `res/`:

- Start/splash/controls: `background-micropolis`, `button1hilite`, `button2hilite`, `button3hilite`, `button4hilite`, `checkbox1hilite`, `checkbox1checked`, `checkbox1hilitechecked`, `checkbox2hilite`, `checkbox2checked`, `checkbox2hilitechecked`, `checkbox3hilite`, `checkbox3checked`, `checkbox3hilitechecked`, `lefthilite`, `leftdisabled`, `righthilite`, `rightdisabled`, `playhilite`, `scenario1hilite`..`scenario8hilite`, `maphilite` (currently commented out), `micropolisg`, `micropoliss`, `splashscreen`.
- Tool palette icons (normal + highlight variants):
  - Base names: `icres`, `iccom`, `icind`, `icfire`, `icqry`, `icpol`, `icwire`, `icdozr`, `icrail`, `icroad`, `icchlk`, `icersr`, `icstad`, `icpark`, `icseap`, `iccoal`, `icnuc`, `icairp`.
  - Highlight variants: `...hi` for each base name above.
- Graph window: `grres`, `grcom`, `grind`, `grmony`, `grcrim`, `grpoll`, `gr10`, `gr120` (and `...hi` variants exist in assets though not referenced by default scripts).
- Demand gauge and legends: `demandg`, `legendmm`, `legendpm`, `legendn`.
- Scenario thumbnails (legacy scripts): `scdull`, `scsfo`, `scham`, `scbern`, `sctkyo`, `scrio`, `scbos`, `scdet`, `scncty`, `sclcty` (+ `...hi` variants). These are referenced by `wscen_old.tcl` / `wscen_older.tcl`, not by the currently loaded `wscen.tcl`.
- Misc: `key2city`.

Other XPMs in `images/` (e.g., `airport.xpm`, `coal.xpm`, `nuclear.xpm`, `spacer.xpm`, `key.xpm`, `micropolism.xpm`, `tiles-*.xpm`) are present but not referenced by current scripts or C loaders.

## Sound assets

### Runtime sound path (OLPC Sugar version)

- C code calls `MakeSound(channel, id)` which Tcl routes to `EchoPlaySound`.
- `EchoPlaySound` prints `PlaySound <soundName>` to stdout where `<soundName>` is the first list element of the sound spec (i.e., token before whitespace).
- `micropolisactivity.py` reads stdout, then loads audio file:
  - Path: `res/sounds/<soundName>.wav`.
  - `soundName` is lowercased before constructing the filename.
- Any extra options in the sound spec (e.g., `"Monster -speed 120"`) are ignored by the Python player.

### Sound IDs used by code

Common IDs referenced in C and Tcl (case-sensitive in scripts, lowercased for filenames):

- `Siren`, `Explosion-High`, `Explosion-Low`
- `HonkHonk-Low`, `HonkHonk-Med`, `HonkHonk-High`
- `Monster`, `HeavyTraffic`
- Tool/utility sounds (from `EditorPalletSounds` in `micropolis.tcl`):
  - `Res`, `Com`, `Ind`, `Fire`, `Query`, `Police`, `Wire`, `Bulldozer`, `Rail`, `Road`, `Chalk`, `Eraser`, `Stadium`, `Park`, `Seaport`, `Coal`, `Nuclear`, `Airport`

### Sound files (res/sounds/*.wav)

The directory contains WAV files matching lowercased sound IDs. Notable pairs/aliases:

- `explosion-high.wav` and `explosion-hi.wav`
- `honkhonk-high.wav`, `honkhonk-hi.wav`
- `quack.wav` and `quackquack.wav`

### Legacy sound server (unused in Sugar build)

`res/sound.tcl` defines a standalone sound server and maps sound IDs to `.au` files (e.g., `siren.au`, `expl-hi.au`). The current repository ships `.wav` files only; the `.au` mapping is legacy and not used by the Sugar Python path.

## Fonts

Tcl UI fonts are defined in `micropolis.tcl` via `FontInfo` using X11 XLFD names:

- Big, Large, Medium, Small, Narrow, Tiny, Text, Message, Alert all map to `-*-dejavu lgc sans-medium-r-normal-*-<size>-*`.

The repository ships TrueType fonts in `res/dejavu-lgc/` along with `fonts.dir`, `fonts.alias`, and `fonts.scale` for X11 font discovery. The runtime assumes these fonts are available in the X server font path.

## Help/manual HTML

Help text combines Tcl messages with optional HTML snippets. `UIShowHelpOn` calls:

```
FormatHTML $ResourceDir/doc/$id.html
```

`FormatHTML` behavior:
- Opens the file, reads and discards the first two lines.
- Reads subsequent lines until `</body>`.
- Skips blank lines and lines starting with `#`.
- Inserts the remaining lines verbatim into the help text widget.

Repository HTML files live under `manual/` with base names that match help IDs (e.g., `Head.html`, `Budget.html`, `Scenario.Bern.html`, etc.). For the Tcl runtime, these files must be installed to `res/doc/` with the same filenames.

## Tcl/Tk library bundles

ResourceDir (`res/`) contains a bundled Tcl/Tk script library:

- `*.tcl` scripts: standard Tk/Tcl utility scripts (e.g., `button.tcl`, `menu.tcl`, `weditor.tcl`).
- `tclindex`: auto-load index for `.tcl` files (generated by `auto_mkindex`). Format: one proc name and file name per line after a 3-line header.
- `tcl.tlb` and `tk.tlb`: concatenated script libraries with package markers of the form:
  - `#@package: <packageName> <autoproc1> <autoproc2> ...`
- `tcl.tdx` and `tk.tdx`: index files with one line per package:
  - `<packageName> <offset> <length> <autoproc...>`
  - Offsets and lengths are byte positions within the corresponding `.tlb` file.
- `buildidx.tcl` contains the reference implementation for building `.tdx` indexes (searches `#@package:` lines and writes offsets/lengths).

## Source map

- Resource loader and types: `src/sim/w_resrc.c`, `src/sim/headers/mac.h`
- Resource roots: `src/sim/sim.c`, `src/sim/w_tk.c`
- Tile/sprite loading: `src/sim/g_setup.c`, `src/sim/headers/sim.h`, `src/sim/w_sprite.c`
- Strings usage: `src/sim/s_msg.c`, `src/sim/w_tool.c`
- Sound routing: `src/sim/w_sound.c`, `src/sim/w_keys.c`, `res/micropolis.tcl`, `res/sound.tcl`, `micropolisactivity.py`
- UI assets usage: `res/micropolis.tcl`, `res/weditor.tcl`, `res/wgraph.tcl`, `res/whead.tcl`, `res/wmap.tcl`, `res/wscen.tcl`, `res/wscen_old.tcl`, `res/wscen_older.tcl`
- Help/manual: `res/help.tcl`, `manual/*`
- Asset inventories: `README`, `src/ASSETS.txt`, `images/*`, `res/stri.*`, `res/hexa.*`, `res/sounds/*`, `res/dejavu-lgc/*`, `res/tclindex`, `res/tcl.tlb`, `res/tcl.tdx`, `res/tk.tlb`, `res/tk.tdx`
