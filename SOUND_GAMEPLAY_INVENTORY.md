# Gameplay Sound Inventory (Micropolis Traceability)

This table inventories gameplay-triggered sound specs currently used by the sound parity pathway.

Normalization/parity boundary for all rows:
- `MakeSound` / `MakeSoundOn`: `ref/micropolis/src/sim/w_sound.c:93`, `ref/micropolis/src/sim/w_sound.c:105`
- Tcl entry points for C dispatch: `ref/micropolis/res/micropolis.tcl:948`, `ref/micropolis/res/micropolis.tcl:969`
- Tcl forwards first token only: `ref/micropolis/res/micropolis.tcl:939`, `ref/micropolis/res/micropolis.tcl:943`
- Activity loads lowercase `<token>.wav`: `ref/micropolis/micropolisactivity.py:193`

| Pathway | token/spec | wav file name | C/Tcl source location | gameplay usage note |
| --- | --- | --- | --- | --- |
| Tool reject | `UhUh` | `uhuh.wav` | `ref/micropolis/src/sim/w_tool.c:1553`, `ref/micropolis/src/sim/w_tool.c:1579`, `ref/micropolis/res/micropolis.tcl:948` | Invalid placement / out-of-bounds reject (`-1`) in `DoTool` and `ToolDown`. |
| Tool reject | `Sorry` | `sorry.wav` | `ref/micropolis/src/sim/w_tool.c:1557`, `ref/micropolis/src/sim/w_tool.c:1583`, `ref/micropolis/res/micropolis.tcl:948` | Insufficient funds reject (`-2`) in `DoTool` and `ToolDown`. |
| Tool success | `O -speed 140` | `o.wav` | `ref/micropolis/src/sim/w_tool.c:885`, `ref/micropolis/res/micropolis.tcl:2733` | `DidTool("Res")` -> `UIDidToolRes`. |
| Tool success | `A -speed 140` | `a.wav` | `ref/micropolis/src/sim/w_tool.c:885`, `ref/micropolis/res/micropolis.tcl:2738` | `DidTool("Com")` -> `UIDidToolCom`. |
| Tool success | `E -speed 140` | `e.wav` | `ref/micropolis/src/sim/w_tool.c:885`, `ref/micropolis/res/micropolis.tcl:2743` | `DidTool("Ind")` -> `UIDidToolInd`. |
| Tool success | `O -speed 130` | `o.wav` | `ref/micropolis/src/sim/w_tool.c:885`, `ref/micropolis/res/micropolis.tcl:2748` | `DidTool("Fire")` -> `UIDidToolFire`. |
| Tool success | `E -speed 200` | `e.wav` | `ref/micropolis/src/sim/w_tool.c:885`, `ref/micropolis/res/micropolis.tcl:2753` | `DidTool("Qry")` -> `UIDidToolQry`. |
| Tool success | `E -speed 130` | `e.wav` | `ref/micropolis/src/sim/w_tool.c:885`, `ref/micropolis/res/micropolis.tcl:2758` | `DidTool("Pol")` -> `UIDidToolPol`. |
| Tool success | `O -speed 120` | `o.wav` | `ref/micropolis/src/sim/w_tool.c:885`, `ref/micropolis/res/micropolis.tcl:2763` | `DidTool("Wire")` -> `UIDidToolWire`. |
| Tool success | `Rumble` | `rumble.wav` | `ref/micropolis/src/sim/w_tool.c:885`, `ref/micropolis/res/micropolis.tcl:2768` | `DidTool("Dozr")` -> `UIDidToolDozr`. |
| Tool success | `O -speed 100` | `o.wav` | `ref/micropolis/src/sim/w_tool.c:885`, `ref/micropolis/res/micropolis.tcl:2773` | `DidTool("Rail")` -> `UIDidToolRail`. |
| Tool success | `E -speed 100` | `e.wav` | `ref/micropolis/src/sim/w_tool.c:885`, `ref/micropolis/res/micropolis.tcl:2778` | `DidTool("Road")` -> `UIDidToolRoad`. |
| Tool success | `O -speed 90` | `o.wav` | `ref/micropolis/src/sim/w_tool.c:885`, `ref/micropolis/res/micropolis.tcl:2791` | `DidTool("Stad")` -> `UIDidToolStad`. |
| Tool success | `A -speed 130` | `a.wav` | `ref/micropolis/src/sim/w_tool.c:885`, `ref/micropolis/res/micropolis.tcl:2796` | `DidTool("Park")` -> `UIDidToolPark`. |
| Tool success | `E -speed 90` | `e.wav` | `ref/micropolis/src/sim/w_tool.c:885`, `ref/micropolis/res/micropolis.tcl:2801` | `DidTool("Seap")` -> `UIDidToolSeap`. |
| Tool success | `O -speed 75` | `o.wav` | `ref/micropolis/src/sim/w_tool.c:885`, `ref/micropolis/res/micropolis.tcl:2806` | `DidTool("Coal")` -> `UIDidToolCoal`. |
| Tool success | `E -speed 75` | `e.wav` | `ref/micropolis/src/sim/w_tool.c:885`, `ref/micropolis/res/micropolis.tcl:2811` | `DidTool("Nuc")` -> `UIDidToolNuc`. |
| Tool success | `A -speed 50` | `a.wav` | `ref/micropolis/src/sim/w_tool.c:885`, `ref/micropolis/res/micropolis.tcl:2816` | `DidTool("Airp")` -> `UIDidToolAirp`. |
| Message first-display | `HonkHonk-Med` | `honkhonk-med.wav` | `ref/micropolis/src/sim/s_msg.c:323`, `ref/micropolis/src/sim/s_msg.c:325`, `ref/micropolis/res/micropolis.tcl:969` | Message id `12` random honk variant. |
| Message first-display | `HonkHonk-Low` | `honkhonk-low.wav` | `ref/micropolis/src/sim/s_msg.c:323`, `ref/micropolis/src/sim/s_msg.c:327`, `ref/micropolis/res/micropolis.tcl:969` | Message id `12` random honk variant. |
| Message first-display | `HonkHonk-High` | `honkhonk-high.wav` | `ref/micropolis/src/sim/s_msg.c:323`, `ref/micropolis/src/sim/s_msg.c:329`, `ref/micropolis/res/micropolis.tcl:969` | Message id `12` random honk variant. |
| Message first-display | `Siren` | `siren.wav` | `ref/micropolis/src/sim/s_msg.c:332`, `ref/micropolis/src/sim/s_msg.c:340`, `ref/micropolis/src/sim/s_msg.c:354`, `ref/micropolis/src/sim/s_msg.c:355`, `ref/micropolis/res/micropolis.tcl:969` | Message ids `11,20,22,23,24,25,26,27,44` and as follow-up in ids `30`/`43`. |
| Message first-display | `Monster -speed [MonsterSpeed]` | `monster.wav` | `ref/micropolis/src/sim/s_msg.c:342`, `ref/micropolis/src/sim/s_msg.c:343`, `ref/micropolis/res/micropolis.tcl:969` | Message id `21` monster report. |
| Message first-display | `Explosion-Low` | `explosion-low.wav` | `ref/micropolis/src/sim/s_msg.c:345`, `ref/micropolis/src/sim/s_msg.c:346`, `ref/micropolis/src/sim/s_msg.c:349`, `ref/micropolis/src/sim/s_msg.c:351`, `ref/micropolis/res/micropolis.tcl:969` | Message ids `30` and `43`. |
| Message first-display | `Explosion-High` | `explosion-high.wav` | `ref/micropolis/src/sim/s_msg.c:349`, `ref/micropolis/src/sim/s_msg.c:350`, `ref/micropolis/res/micropolis.tcl:969` | Message id `43` disaster report. |
| Realtime/sprite | `HeavyTraffic` | `heavytraffic.wav` | `ref/micropolis/src/sim/w_sprite.c:768`, `ref/micropolis/res/micropolis.tcl:969` | Helicopter traffic report sound. |
| Realtime/sprite | `HonkHonk-Low -speed 80` | `honkhonk-low.wav` | `ref/micropolis/src/sim/w_sprite.c:852`, `ref/micropolis/res/micropolis.tcl:969` | Ship horn variant (scenario-conditioned). |
| Realtime/sprite | `HonkHonk-Low` | `honkhonk-low.wav` | `ref/micropolis/src/sim/w_sprite.c:854`, `ref/micropolis/res/micropolis.tcl:969` | Ship horn default variant. |
| Realtime/sprite | `Monster -speed [MonsterSpeed]` | `monster.wav` | `ref/micropolis/src/sim/w_sprite.c:986`, `ref/micropolis/res/micropolis.tcl:969` | Monster movement/turn sound. |
| Realtime/sprite | `Explosion-High` | `explosion-high.wav` | `ref/micropolis/src/sim/w_sprite.c:1104`, `ref/micropolis/src/sim/w_sprite.c:1391`, `ref/micropolis/res/micropolis.tcl:969` | Explosion sprite and crash/explode pathways. |
