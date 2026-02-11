# Gameplay Sound Inventory (Micropolis Traceability)

This table inventories gameplay-triggered sound specs currently used by the sound parity pathway.
Each `C/Tcl source location` cell includes both a C trigger callsite and the Tcl dispatch path used to deliver the sound.

Normalization/parity boundary for all rows:
- `MakeSound` / `MakeSoundOn`: `ref/micropolis/src/sim/w_sound.c:93`, `ref/micropolis/src/sim/w_sound.c:105`
- Tcl entry points for C dispatch: `ref/micropolis/res/micropolis.tcl:948`, `ref/micropolis/res/micropolis.tcl:969`
- Tcl forwards first token only: `ref/micropolis/res/micropolis.tcl:939`, `ref/micropolis/res/micropolis.tcl:943`
- Activity loads lowercase `<token>.wav`: `ref/micropolis/micropolisactivity.py:193`

## Human-Readable Gameplay Usage Notes

- Placement feedback: failed placement plays `uhuh.wav` (invalid target) or `sorry.wav` (not enough funds), while successful placement plays each tool's confirmation tone.
- City alert messages: first-time message popups trigger siren, honk, monster, and explosion sounds depending on the warning/disaster type.
- Realtime simulation: moving sprites and live events (helicopter traffic reports, ship horns, monster movement, and explosions) emit gameplay ambience/alert sounds.

| Pathway | token/spec | wav file name | C/Tcl source location | gameplay usage note |
| --- | --- | --- | --- | --- |
| Tool reject | `UhUh` | `uhuh.wav` | `ref/micropolis/src/sim/w_tool.c:1553`, `ref/micropolis/src/sim/w_tool.c:1579`, `ref/micropolis/res/micropolis.tcl:948` | Invalid placement / out-of-bounds reject (`-1`) in `DoTool` and `ToolDown`. |
| Tool reject | `Sorry` | `sorry.wav` | `ref/micropolis/src/sim/w_tool.c:1557`, `ref/micropolis/src/sim/w_tool.c:1583`, `ref/micropolis/res/micropolis.tcl:948` | Insufficient funds reject (`-2`) in `DoTool` and `ToolDown`. |
| Tool success | `O -speed 140` | `o.wav` | `ref/micropolis/src/sim/w_tool.c:885`, `ref/micropolis/res/micropolis.tcl:2733` | Successful Residential zoning placement. |
| Tool success | `A -speed 140` | `a.wav` | `ref/micropolis/src/sim/w_tool.c:885`, `ref/micropolis/res/micropolis.tcl:2738` | Successful Commercial zoning placement. |
| Tool success | `E -speed 140` | `e.wav` | `ref/micropolis/src/sim/w_tool.c:885`, `ref/micropolis/res/micropolis.tcl:2743` | Successful Industrial zoning placement. |
| Tool success | `O -speed 130` | `o.wav` | `ref/micropolis/src/sim/w_tool.c:885`, `ref/micropolis/res/micropolis.tcl:2748` | Successful Fire Station placement. |
| Tool success | `E -speed 200` | `e.wav` | `ref/micropolis/src/sim/w_tool.c:885`, `ref/micropolis/res/micropolis.tcl:2753` | Query tool interaction feedback. |
| Tool success | `E -speed 130` | `e.wav` | `ref/micropolis/src/sim/w_tool.c:885`, `ref/micropolis/res/micropolis.tcl:2758` | Successful Police Station placement. |
| Tool success | `O -speed 120` | `o.wav` | `ref/micropolis/src/sim/w_tool.c:885`, `ref/micropolis/res/micropolis.tcl:2763` | Successful Power Line placement. |
| Tool success | `Rumble` | `rumble.wav` | `ref/micropolis/src/sim/w_tool.c:885`, `ref/micropolis/res/micropolis.tcl:2768` | Bulldozer clears tiles successfully. |
| Tool success | `O -speed 100` | `o.wav` | `ref/micropolis/src/sim/w_tool.c:885`, `ref/micropolis/res/micropolis.tcl:2773` | Successful Rail placement. |
| Tool success | `E -speed 100` | `e.wav` | `ref/micropolis/src/sim/w_tool.c:885`, `ref/micropolis/res/micropolis.tcl:2778` | Successful Road placement. |
| Tool success | `O -speed 90` | `o.wav` | `ref/micropolis/src/sim/w_tool.c:885`, `ref/micropolis/res/micropolis.tcl:2791` | Successful Stadium placement. |
| Tool success | `A -speed 130` | `a.wav` | `ref/micropolis/src/sim/w_tool.c:885`, `ref/micropolis/res/micropolis.tcl:2796` | Successful Park placement. |
| Tool success | `E -speed 90` | `e.wav` | `ref/micropolis/src/sim/w_tool.c:885`, `ref/micropolis/res/micropolis.tcl:2801` | Successful Seaport placement. |
| Tool success | `O -speed 75` | `o.wav` | `ref/micropolis/src/sim/w_tool.c:885`, `ref/micropolis/res/micropolis.tcl:2806` | Successful Coal Power Plant placement. |
| Tool success | `E -speed 75` | `e.wav` | `ref/micropolis/src/sim/w_tool.c:885`, `ref/micropolis/res/micropolis.tcl:2811` | Successful Nuclear Power Plant placement. |
| Tool success | `A -speed 50` | `a.wav` | `ref/micropolis/src/sim/w_tool.c:885`, `ref/micropolis/res/micropolis.tcl:2816` | Successful Airport placement. |
| Message first-display | `HonkHonk-Med` | `honkhonk-med.wav` | `ref/micropolis/src/sim/s_msg.c:323`, `ref/micropolis/src/sim/s_msg.c:325`, `ref/micropolis/res/micropolis.tcl:969` | First-time traffic complaint popup chooses this honk variant randomly. |
| Message first-display | `HonkHonk-Low` | `honkhonk-low.wav` | `ref/micropolis/src/sim/s_msg.c:323`, `ref/micropolis/src/sim/s_msg.c:327`, `ref/micropolis/res/micropolis.tcl:969` | First-time traffic complaint popup chooses this honk variant randomly. |
| Message first-display | `HonkHonk-High` | `honkhonk-high.wav` | `ref/micropolis/src/sim/s_msg.c:323`, `ref/micropolis/src/sim/s_msg.c:329`, `ref/micropolis/res/micropolis.tcl:969` | First-time traffic complaint popup chooses this honk variant randomly. |
| Message first-display | `Siren` | `siren.wav` | `ref/micropolis/src/sim/s_msg.c:332`, `ref/micropolis/src/sim/s_msg.c:340`, `ref/micropolis/src/sim/s_msg.c:354`, `ref/micropolis/src/sim/s_msg.c:355`, `ref/micropolis/res/micropolis.tcl:969` | First-time emergency/disaster warning popups and some disaster follow-up messages. |
| Message first-display | `Monster -speed [MonsterSpeed]` | `monster.wav` | `ref/micropolis/src/sim/s_msg.c:342`, `ref/micropolis/src/sim/s_msg.c:343`, `ref/micropolis/res/micropolis.tcl:969` | First-time monster attack report popup. |
| Message first-display | `Explosion-Low` | `explosion-low.wav` | `ref/micropolis/src/sim/s_msg.c:345`, `ref/micropolis/src/sim/s_msg.c:346`, `ref/micropolis/src/sim/s_msg.c:349`, `ref/micropolis/src/sim/s_msg.c:351`, `ref/micropolis/res/micropolis.tcl:969` | First-time fire/nuclear disaster report popups. |
| Message first-display | `Explosion-High` | `explosion-high.wav` | `ref/micropolis/src/sim/s_msg.c:349`, `ref/micropolis/src/sim/s_msg.c:350`, `ref/micropolis/res/micropolis.tcl:969` | First-time severe disaster report popup. |
| Realtime/sprite | `HeavyTraffic` | `heavytraffic.wav` | `ref/micropolis/src/sim/w_sprite.c:768`, `ref/micropolis/res/micropolis.tcl:969` | Helicopter traffic report sound. |
| Realtime/sprite | `HonkHonk-Low -speed 80` | `honkhonk-low.wav` | `ref/micropolis/src/sim/w_sprite.c:852`, `ref/micropolis/res/micropolis.tcl:969` | Ship horn variant (scenario-conditioned). |
| Realtime/sprite | `HonkHonk-Low` | `honkhonk-low.wav` | `ref/micropolis/src/sim/w_sprite.c:854`, `ref/micropolis/res/micropolis.tcl:969` | Ship horn default variant. |
| Realtime/sprite | `Monster -speed [MonsterSpeed]` | `monster.wav` | `ref/micropolis/src/sim/w_sprite.c:986`, `ref/micropolis/res/micropolis.tcl:969` | Monster movement/turn sound. |
| Realtime/sprite | `Explosion-High` | `explosion-high.wav` | `ref/micropolis/src/sim/w_sprite.c:1104`, `ref/micropolis/src/sim/w_sprite.c:1391`, `ref/micropolis/res/micropolis.tcl:969` | Explosion sprite and crash/explode pathways. |
