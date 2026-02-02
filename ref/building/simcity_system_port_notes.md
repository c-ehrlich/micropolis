# simcity (classic) simulation systems & dataflow — porting notes (v1)

this is a **faithful-first** architecture + dataflow spec for a typescript/react port of classic simcity/micropolis, based on the attached “how simcity works” reverse-engineering writeup and its figures. fileciteturn0file0

it’s written to be:
- **behavior-faithful** to the original pacing + quirks (for now)
- **performance-aware** in a browser
- **extensible** (rulesets, tilesets, even map sizes) without rewriting the core

> TODO markers in this doc are intentional: they denote “known quirk / unclear detail / verify against source”.

---

## 1) port goals & constraints (locked in)

**faithful now**
- reproduce the original **two-clock** feel and the **16-step weekly scheduler** (`Simulate`).
- keep quirks, but mark them as TODO and isolate them behind a “ruleset”.

**browser-only**
- react ui; canvas tile renderer (pixel art first).
- classic **maps overlays** (crime/pollution/land value/etc), like simcity.

**save/load**
- support **the existing city file format** (same as the open-source version you’re targeting).  
  TODO: confirm exact format details + what is persisted beyond the primary map.

**performance**
- optimize aggressively *without changing gameplay*.
- prefer data-oriented ts (typed arrays, minimal allocations).

**deterministic**
- seedable prng and fixed-step simulation loop (replay/test friendly).

**map size**
- start **120×100**, but keep infrastructure to parameterize it later.

---

## 2) “what is a turn?”: clocks, ticks, and the 16-step week

simcity’s “turn” is not “do everything once.” it’s **time-sliced**.

### 2.1 two clocks (key to the feel)
**real-time clock** (fixed) drives:
- ui input handling (~60 hz)
- object updates (~12 hz): monster/ship/helicopter/etc
- tile animations (~12 hz): fire/traffic/smoke/etc
- power-outage blink (~2 hz)

**simulation clock** (player-adjustable) drives:
- growth/decay, fire spread, taxes, pollution, crime, land value, etc
- via master scheduler `Simulate` fileciteturn0file0

### 2.2 `Simulate`: 16-step round robin = 1 simulated week
each simulation tick runs **one** substep, then increments `simStep = (simStep+1) mod 16`. fileciteturn0file0

- 16 steps = 1 week
- 4 weeks = 1 month
- 48 weeks = 1 year
- taxes collected yearly (every 48th revolution)

**important texture:** map scan runs across steps **1–8** (one-eighth per step). many other analyses run once per week. fileciteturn0file0

### 2.3 canonical step schedule (from the doc’s scheduler figure)
| step | name (conceptual) | main side-effects | consumes | produces |
|---:|---|---|---|---|
| 0 | set valves | advance time; compute demand; clear census | census totals | demand “valves” |
| 1–8 | map scan (slice i) | evolve tiles; collect census; record infra | primary map + derived maps | updated primary + station/plant locs + traffic density + census |
| 9 | taxes | budget/tax events; logs | census + budget | treasury changes; policy effects |
| 10 | decay maps + messages | decay traffic/rog; coaching | traffic density; rate-of-growth; stats | decayed maps; messages |
| 11 | power scan | power propagation across grid | map + plants + conductors | power map |
| 12 | land value | land value + env stats | pollution + terrain + crime + ??? | land value, pollution aggregates |
| 13 | crime scan | compute crime field | police effect + pop density + lv + ??? | crime map |
| 14 | pop density | pop density + city center/com rate | map + ??? | pop density, com rate |
| 15 | fire analysis + disasters | fire coverage/effect; disasters | fire stations + ??? | fire rate map; disaster events |

> TODO: confirm exact ordering and any “skip at high speed” logic from code; the doc notes some steps run less often at higher sim speeds to keep responsiveness. fileciteturn0file0

---


### 2.4 gearing (speed profiles) as data
the writeup notes that at higher sim speeds, some processes run less often to keep the computer responsive. fileciteturn0file0

to make gearing easy to change later **without breaking determinism**, model it as a pure data table:

- the engine’s canonical time is `simWeek` (integer)
- each subsystem has a cadence in weeks
- a `SpeedProfile` defines:
  - how many sim weeks to attempt per real second (target)
  - per-subsystem cadence overrides (run every N weeks)

example:

```ts
type SubsystemId =
  | "mapScanSlice" | "setValves" | "taxes" | "powerScan"
  | "crimeScan" | "pollutionScan" | "fireAnalysis" | "messages";

type SpeedProfile = {
  id: "slow" | "medium" | "fast" | "cheetah";
  simWeeksPerSecond: number; // if device can’t keep up, wall time stretches (state stays correct)
  cadence: Partial<Record<SubsystemId, number>>; // default 1
};
```

rules:
- cadence decisions depend only on `(simWeek, profile)` — never wall time
- record `profile.id` in save/replay for exact reproducibility

fast-forward:
- implement “advance X weeks” as: enqueue `tick(simulate, X)` and run until done
- slower cpu takes longer but produces identical end state

## 3) core state: primary tiles + derived layers + objects + globals

### 3.1 primary map: the hub
- **120×100** tiles (start)
- each tile is a **16-bit packed value**:
  - 10-bit **character id** (0..1023, ~956 used)
  - 6 **status bits** (bookkeeping + some player-visible affordances) fileciteturn0file0

primary map is both:
- **render state** (which sprite to draw)
- **simulation state** (what exists + what rules apply)

### 3.2 status bits (semantics)
the writeup describes 6 bits corresponding to:
- `zone` (center tile of a multi-tile zone/building)
- `anim` (eligible for flipbook animation)
- `bulldoze` (player can bulldoze)
- `burnable` (can burn)
- `conduct` (conducts electricity)
- `powered` (currently powered) fileciteturn0file0

**port rule:** keep this packing intact in the engine (a `Uint16Array`) to:
- match original behavior
- make save/load and diffing cheap
- keep cache-friendly memory access

### 3.3 derived maps: 18-map stack
simcity keeps **18 maps**; only primary is saved; the other 17 are regenerated. fileciteturn0file0

**resolutions** (doc figure; “1:2” means half resolution each axis):
- primary: `Map` (120×100)
- 1:1: `Power`
- 1:2: `LandValue`, `Pollution`, `Crime`, `TrafficDensity`, `PopDensity`, plus temps `Temp`, `Temp2`
- 1:4: `Terrain`, plus `QTemp`
- 1:8: `Police`, `PoliceEffect`, `FireStation`, `FireRate`, `RateOfGrowth`, `ComRate`, plus `STemp`

> note: “Police” and “FireStation” maps are often just “location bookkeeping”; “Effect/Rate” maps are smoothed influence fields. fileciteturn0file0

### 3.4 non-map state
- **census totals** (accumulated by map scan; consumed by set valves and taxes)
- **macro demand** (“valves” for r/c/i + hospital/church demand)
- **budget/treasury** + policy sliders
- **messages** (event + coach)
- **objects** (agents): train, ship, helicopter, airplane, monster, tornado, explosion… updated by real-time clock fileciteturn0file0
- **rng** (seeded)

---

## 4) dataflow graph (the short mental model)

### 4.1 the central loop
**map scan → census → set valves → demand → map scan**
- map scan reads the world and counts it (census)
- set valves uses census to compute demand
- demand feeds back into growth/decay decisions inside map scan fileciteturn0file0

### 4.2 key feedback loops (fields ↔ tiles)
- traffic trips → `TrafficDensity` → road tile rewrite + pollution → land value → growth odds
- police stations → `PoliceEffect` → crime → land value → crime (mutual coupling) fileciteturn0file0
- fire stations → `FireRate` → fire spread/extinguish
- power plants + conductors → `Power` → powered bit on zones → growth constraints

the doc’s dataflow diagram shows `Map Scan` at center, feeding and consuming most layers. fileciteturn0file0

---

## 5) “how does the simulator decide what happens on tiles?”

two main mechanisms update tiles:

### 5.1 animate tiles (real-time, shallow)
runs about **12 times/second**, iterates over **visible** tiles:
- if `anim=1`, may swap to next character id frame
- different tile types have different animation rhythms (fire vs traffic vs fountains etc) fileciteturn0file0

this is mostly “presentation aliveness”, though it still mutates tile ids (so treat it as state changes).

### 5.2 map scan (simulation-time, heavy)
map scan:
- processes **1/8 of the map per call** (a 15×100 slice), taking 8 sim frames to cover 120×100 fileciteturn0file0
- does two jobs:
  1) **evolve** the map (growth/decay, fires, floods, road states, etc.)
  2) **tally** census totals (population, infra counts, etc.) fileciteturn0file0

#### 5.2.1 slice scheduling
assume a vertical striping:
- slice `k` covers x ∈ [k*15, k*15+14], y ∈ [0..99]
- called on sim steps 1..8

> TODO: verify scanning order (x-major vs y-major) and whether it wraps edges in a specific way. this matters because the original relies on update order in places (classic cellular automaton “in-place update” artifacts).

#### 5.2.2 map scan dispatch: tile-type specific logic
the doc’s map scan figure lists the following tile categories and behaviors. fileciteturn0file0

**zones / zonebit**
- map scan identifies zones/buildings via `zonebit` (center tiles)
- r/c/i zones run growth/decay logic
- non-r/c/i zone centers call a “repair” routine (e.g., fix zone shape) (named `RepairZone` in the figure)

**powered status maintenance**
- if tile is a conductor (`conduct=1`) and the power map changed, map scan updates the `powered` bit (`pwrbit`).  
  (this implies “tile bits are partly derived from the power map but updated lazily”.)

**radioactive**
- very low random chance (1 in 4096) to turn into rubble

**fire**
- stochastic update: spreads/extinguishes/holds
- consults proximity to fire departments (via derived maps)

**flood**
- like fire: spreads to burnable tiles while `floodCnt > 0`
- otherwise randomly turns to rubble

**explosion**
- last frames of explosion animation convert into rubble

**roads**
- updated to reflect `TrafficDensity`
- drawbridges open/close when ship is near
- random deterioration if underfunded
- roads tally upkeep costs

**rail**
- generates trains
- random deterioration if underfunded
- rails tally upkeep costs

**power plants**
- plant locations recorded for power scan
- nuclear may randomly melt down (TODO: exact condition/probability)
- coal smoke animation toggles on

**police and fire stations**
- station locations recorded into station maps
- effectiveness modulated by funding, road access, and power (per figure text)

**stadium**
- randomly switches between empty and full
- power required for “full” state

**seaport**
- spawns ship if powered
- proximity to water “not required” (quirk explicitly noted)

**airport**
- when powered: radar animation on; spawns airplane + helicopter

**hospital/church**
- may revert to empty residential if too many per capita

this dispatch list is the backbone of “what happens on tiles.” in practice, each category is implemented by comparing tile character ids and/or flags, then applying a handler.

---

## 6) zone development (r/c/i): global valve + local valve + chance

zone development is a **stochastic** process shaped by:
- **global demand** (“valves” from macro model)
- **local conditions** (power, transit, pollution, land value, centrality, etc.)
- random dice roll fileciteturn0file0

### 6.1 global valves (macro demand)
the “r/c/i bar chart” in the UI reflects these values:
- positive → city wants more of that zone type
- negative → city wants less fileciteturn0file0

computed in **set valves** (sim step 0), using census inputs collected during map scan.

### 6.2 local valve factors
the doc’s zone-development figure shows local influences roughly as:
- power (r/c/i)
- transit connectivity (r/c/i)
- pollution (strongly affects r; also impacts others)
- land value (strongly affects r; also building class)
- centrality / distance to city center (strongly affects c) fileciteturn0file0

### 6.3 mechanics of growth/decay
if a zone changes:
- the tile characters that form the building are swapped to a different set
- that new character set encodes the new population and (for r/c) wealth class
- buildings can “lag” behind land value until redevelopment happens fileciteturn0file0

### 6.4 special “institution” demands: hospital + church
example mechanism:
- simulator targets ~1 hospital per 128 citizens
- map scan counts population + hospitals
- set valves computes “hospital demand”
- demand affects probability that an empty residential zone turns into hospital (or hospital reverts) fileciteturn0file0

same pattern for churches.

### 6.5 growth gating by capital requests (stadium/airport/seaport)
send-messages can request major infra; if unmet, it signals set-valves to restrict growth (“commerce requires an airport”, etc.). fileciteturn0file0

---

## 7) traffic model: invisible probes → density field → road retiling → visible cars

traffic is a two-layer illusion:

### 7.1 trip probes (simulation)
- zones periodically attempt trips via road/rail to complementary zone types
- more populous zones emit more trips
- each trip makes semi-random turns toward a goal
- success/failure affects zone growth/decay odds fileciteturn0file0

### 7.2 recording into `TrafficDensity`
successful trips:
- write their path into the 1:2 traffic density field
- the field is later decayed (step 10) so jams fade

### 7.3 road tile rewrite
map scan uses `TrafficDensity` to rewrite road character ids into:
- low / medium / high traffic variants
- plus bridge/drawbridge variants where relevant (ships can trigger bridge opening) fileciteturn0file0

### 7.4 visible traffic (real-time)
after road tiles encode “traffic state,” animate-tiles plays the little car animations. fileciteturn0file0

---

## 8) power model: grid propagation + a famous quirk

### 8.1 power scan (step 11)
`DoPowerScan` (named in the doc’s figure) propagates power across a conductive network:
- sources: power plants
- conductors: tiles with `conduct=1` (power lines, some road/rail? TODO)
- output: 1:1 power map (powered/unpowered) fileciteturn0file0

map scan then updates `powered` bits on conductors/zones based on the power map (possibly only when it changes).

### 8.2 quirk: plant connectivity mismatch
doc notes a divergence between mechanism and player belief:
- only one plant needs to be connected, but all plants supply electricity. fileciteturn0file0  
**port stance:** keep it for fidelity; wrap it in a TODO + ruleset flag so it can be “fixed” later.

---

## 9) land value, pollution, crime, population density (fields)

these are computed as **map layers** that smooth local events into spatial “fields,” then feed back into growth decisions.

### 9.1 land value (step 12)
land value is highly central in the dataflow web. fileciteturn0file0

inputs include (from the writeup and diagrams):
- pollution field
- crime field
- terrain/nature field
- centrality/commercial rate (distance to city center) (implied by coupling)

also computes some global aggregates (seen in the figure): land value average, pollution max/avg. fileciteturn0file0

### 9.2 pollution
pollution is derived from activity and smoothed (temp buffers exist explicitly for smoothing pollution and pop density). fileciteturn0file0

pollution feeds into:
- land value
- residential desirability
- monster spawning (average pollution threshold) fileciteturn0file0

### 9.3 crime (step 13) and police effect
police system:
- map scan records station locations to a coarse `Police` map
- a smoothed influence field `PoliceEffect` is derived (smoothing shown as “smooth ×3”) fileciteturn0file0
- crime scan consumes `PoliceEffect` plus other fields (pop density/land value) to produce crime

crime and land value are mutually coupled (feedback loop). fileciteturn0file0

### 9.4 population density (step 14) + com rate
pop density is computed and smoothed (diagram indicates “smooth ×3”).
a “city center” / commercial centrality field `ComRate` is also produced and used by commercial desirability. fileciteturn0file0

---

## 10) fire analysis + disasters

### 10.1 tile-level fire (inside map scan)
map scan updates fire tiles stochastically:
- spreads / extinguishes / persists
- consults distance/proximity to fire stations via derived maps fileciteturn0file0

### 10.2 fire analysis (step 15)
fire analysis:
- map scan records `FireStation` locations (coarse)
- fire analysis transforms that into `FireRate` (coverage/effect), with smoothing (“smooth ×3”) fileciteturn0file0

### 10.3 disasters
disasters can:
- modify tiles directly (rubble, fire)
- spawn objects (monster, tornado)
- create explosions
and interact with the object system (collisions, destruction). fileciteturn0file0

---

## 11) objects (agents): real-time sprites with simple ai

objects update on the **real-time** cadence (video-game style), not on sim weeks. fileciteturn0file0

described objects and hooks:
- train (spawned by rail)
- helicopter + airplane (spawned by airport; helicopter seeks congestion and comments)
- ship (spawned by seaport; triggers drawbridges; can run aground)
- monster (spawns when average pollution high; seeks most polluted tile; returns)
- tornado (wanders; destroys; collides)
- explosion (causes nearby fires, rubble) fileciteturn0file0

collisions are handled via destruction (robustness strategy).

---

## 12) messages: event narration + the “coach” system

messages come from:
1) direct simulation events (“insufficient funds”, “plane crash”, “brownouts”…)
2) `SendMessages`: periodic observer/coach called by simulate fileciteturn0file0

send-messages:
- monitors stats (growth, roads ratio, taxes, etc.)
- emits advice and escalating infra requests
- uses scheduling + prioritization to avoid spam/flicker fileciteturn0file0

---

## 13) save/load: what must be persisted

the writeup emphasizes:
- only primary map is saved; other maps are derived and rebuilt on load fileciteturn0file0

### 13.1 legacy city format you should support first: `.cty`
for “original simcity / micropolis classic lineage”, the most pragmatic compatibility target is the legacy **city file** format commonly called `.cty`.

the java micropolis readme documents this layout as fixed offsets: histories first, then a small “misc” block, then the map data. citeturn1view1

#### 13.1.1 binary layout (byte-accurate)
all multi-byte integers are **big-endian** (critical for `DataView.getInt16(offset, /*littleEndian=*/false)`). citeturn5view0

offsets: citeturn1view1
- `0x0000` – residential history: **240 × int16**  (480 bytes)
- `0x01E0` – commercial history: **240 × int16**
- `0x03C0` – industrial history: **240 × int16**
- `0x05A0` – crime history: **240 × int16**
- `0x0780` – pollution history: **240 × int16**
- `0x0960` – cash-flow history: **240 × int16**
- `0x0B40` – miscellaneous values: **240 bytes** (= **120 × int16**)
- `0x0C30` – map data: int16 tiles, stored **by columns (west→east)** citeturn1view1

#### 13.1.2 map dimensions & file length sniffing
in the mac 1.4c analysis writeup, the primary map is **120 × 100** tiles. fileciteturn0file0

however, forks/ports exist. don’t hardcode the height; sniff using file length:

- `expectedOffset = 0x0C30`
- remaining bytes = `len - expectedOffset`
- remaining must be divisible by `2` (int16)
- tileCount = `remaining / 2`
- then infer `{w,h}` from known candidates (start with 120×100 and 120×120)

examples:
- `0x0C30 + (120*100*2) = 27120` bytes → treat as 120×100
- `0x0C30 + (120*120*2) = 31920` bytes → treat as 120×120

> TODO: verify which size(s) your chosen upstream uses by loading known-good `.cty` samples. keep the loader “length-driven” so we don’t bake in the wrong Y.

#### 13.1.3 “misc” block strategy (unknown field names)
the format doesn’t label fields; it’s just an array of 120 int16 values. some values are known in the community (e.g., funds as a signed 32-bit composed from two 16-bit words), but treat any mapping as **verify-against-source**. citeturn5view0

recommended:
- decode into `Int16Array(120)` (big-endian)
- expose `miscRaw: Int16Array` (for perfect round-tripping)
- separately maintain `CityScalars` with named views into `miscRaw` (index-based)
- lock indices down with golden tests once verified

### 13.2 faithful load behavior (derived maps rebuilt)
for the port:
- **load**
  1) read histories + misc + primary map
  2) set engine scalars from `miscRaw` (TODO: verify which ones are authoritative)
  3) rebuild all derived maps by running the same “init passes” you use after new-map generation:
     - recompute power connectivity
     - recompute land value seeds, services coverage, etc.
     - rebuild any caches that the original derives (do not persist them)
- **save**
  - write histories + misc + primary map back out in the exact legacy layout and endian

### 13.3 adapter pattern (so formats stay swappable)
define:
- `CityFormatAdapter` = `{ sniff(bytes): boolean; load(bytes): CityState; save(state): Uint8Array }`

start:
- `CtyAdapter` (legacy, length-driven)

later:
- `JsonAdapter` (debug/dev)
- `ZipAdapter` (wrapper)
- `ExtendedBinaryAdapter` (supports arbitrary map sizes without legacy constraints)

this gives you “support og” *and* “easy future adapters”.

## 14) engine methodology for a faithful + flexible browser port

this section is “implementation method,” not historical description.

### 14.1 separate engine from ui (hard boundary)
- engine is a pure, side-effect controlled state machine:
  - inputs: tool actions, UI commands, sim tick, real-time tick
  - outputs: tile deltas, layer deltas, messages, stats, object states
- ui is purely a view/controller:
  - renders snapshots/deltas
  - sends tool actions and time controls

### 14.2 represent maps as typed arrays (data-oriented)
- primary: `Uint16Array` length = w*h
- derived: mostly `Uint8Array` (0–255) unless code needs signed
- object lists in packed arrays where possible (struct-of-arrays for perf)
- keep `noUncheckedIndexedAccess` enabled; use explicit helpers (`assertDefined`/`getOrThrow`) for indexed reads.

### 14.3 rulesets (your “future customization” hook)
create a `Ruleset` object that holds:
- constants (thresholds, smoothing radii, probabilities)
- tile id ranges and classification tables
- toggles for quirks (e.g., “power-plant connectivity quirk”)
- optionally: difficulty presets (easy/med/hard)

engine code should take `rules: Ruleset` everywhere it matters.
default ruleset = “classic”.

### 14.4 deterministic prng (mandatory for tests/replays)
- implement a simple fast prng (xorshift32 / splitmix32 / pcg32)
- store seed + step counters in save/replay
- never call `Math.random()`


### 14.4.1 what’s hard to keep deterministic across browsers (logic, not css)
css/layout differences are fine (ui only). the real risk is simulation divergence across engines (v8 vs spider monkey vs jsc) or builds.

main offenders + guardrails:

**floats**
- js numbers are float64; tiny rounding deltas can cascade if you do a lot of float math.
- guardrail: keep simulation math integer/fixed-point; only use floats for rendering transforms.

**random**
- `Math.random()` differs and isn’t seedable.
- guardrail: single in-engine prng with explicit seed stored in save/replay; never call `Math.random()` in sim.

**unstable sorts / iteration order**
- if you rely on unspecified tie-breaking (`Array.sort`) or object key enumeration, you can drift.
- guardrail:
  - use arrays with stable iteration
  - when sorting, always add a deterministic tie-break (id)

**time-based stepping**
- if sim rules depend on `dt` from `requestAnimationFrame` or `performance.now()`, different machines take different branches.
- guardrail: fixed-step simulation (integer ticks). wall-clock time only decides *how many ticks to attempt*, not the content of a tick.

**concurrency**
- worker message timing can vary.
- guardrail: worker owns authoritative sim time; process commands in strict queue order; main thread never “runs” sim.

**numeric overflow semantics**
- js numbers don’t overflow like int32; bitwise ops do.
- guardrail: be explicit about wrap/clamp using typed arrays, `|0`, `>>>0`, `Math.imul`, etc.

### 14.4.2 fast-forward must be cpu-independent
your requirement (“fast-forward same on any cpu”) implies:
- fast-forward advances by **a target number of sim ticks/weeks**, not “as much as possible in 1 second”
- slower devices just take longer wall time; the end state matches

if you want “real seconds” to correspond to “sim weeks” even on slow devices, the only options are:
- accept sim slowdown (preferred: preserve correctness), or
- change gearing/adaptively skip work (breaks faithfulness and can change outcomes)

### 14.4.3 minimal determinism test harness (do this early)
- golden city test:
  - load a fixed `.cty`
  - run N weeks
  - hash primary map + key scalars
  - compare to a committed snapshot
- run it in chromium + firefox in CI
- add a replay log format (“command stream”), then hash after replay

### 14.5 golden test harness (strongly recommended)
build a runner that can:
- load a city
- run N sim weeks with fixed inputs + seed
- produce:
  - hash of primary map
  - hashes of key derived maps
  - key stats (population, demand, treasury)
- compare against “known-good” outputs (from the original codebase)

this is the fastest way to prevent “close but wrong” drift.

---

## 15) web worker: pros/cons for your case (and my recommendation)


### 15.0 make workers optional later without refactors
yes — as long as you treat the engine boundary as **async message passing from day 1**, even when the engine runs in the same thread.

the trap:
- start with `engine.step()` called directly from react (sync return)
- later move to worker → everything becomes async and you refactor half the app

the safer pattern:
- define a tiny transport interface and keep it **event-based**:

```ts
type EngineCommand =
  | { type: "tool"; tool: ToolId; at: XY; size: number }
  | { type: "setSpeed"; speed: SpeedSetting }
  | { type: "tick"; kind: "realtime" | "simulate"; n: number };

type EngineEvent =
  | { type: "patch"; patch: CityPatch }          // tile + layer deltas
  | { type: "message"; msg: UiMessage }
  | { type: "stats"; stats: CityStatsSnapshot }
  | { type: "perf"; ms: number; steps: number };

interface EngineTransport {
  send(cmd: EngineCommand): void;
  onEvent(cb: (ev: EngineEvent) => void): () => void; // unsubscribe
  dispose(): void;
}
```

implement:
- `LocalTransport` (no worker): processes the command queue in-process, but emits events **async** (microtask / `MessageChannel`) so callers never rely on sync behavior
- `WorkerTransport`: same protocol, `postMessage` + transferable typed arrays

if you do this, “turn on workers later” is mostly a constructor swap.

you asked if you should use a worker. here’s the real trade space.

### 15.1 pros
**responsiveness**
- simulation spikes (map scan, power scan, smoothing passes) won’t jank the main thread.
- react + canvas stays responsive under load.

**simpler perf reasoning**
- worker owns the engine state; main thread only renders.
- less risk of accidental allocations / renders impacting sim timing.

**determinism friendliness**
- fixed-step loop in worker; main thread can render at variable frame rate.
- replay/test mode can run “headless” without UI.

**future mobile**
- workers help when single-thread perf is weak; main thread stays smooth for touch + scrolling.

### 15.2 cons
**messaging overhead**
- you must ship data across the worker boundary.
- sending full maps every tick is a non-starter; you need deltas or shared memory.

**more complex debugging**
- devtools are better now, but stepping through multi-thread message flows is still slower.

**no direct dom access**
- worker can’t touch canvas/dom; it must tell main thread what to draw.

### 15.3 recommended approach (best of both)
use:
- engine in worker
- renderer + ui on main thread
- communication:
  - **tile deltas** (index + old/new `uint16`) and occasional full snapshots (for resync)
  - derived overlay deltas when that overlay is open
  - messages/stats as small structs

if you want to go further:
- use `SharedArrayBuffer` for primary map + selected derived maps to eliminate copies  
  (requires proper COOP/COEP headers; still doable in modern deployments).  
  TODO: decide if you want that complexity early or later.

**bottom line:** for your “perf without gameplay compromise” goal, a worker is usually a win.

---

## 16) rendering + overlays (classic behavior, modern implementation)

### 16.1 base view
- pixel-art tileset atlas
- draw primary map via:
  - canvas2d blitting (fine at 120×100, especially if you only redraw dirty rects)
  - or webgl tilemap shader (overkill early, nice later)

### 16.2 “maps window” overlays
render each overlay map (crime/pollution/land value/traffic/pop density/etc) as:
- nearest-neighbor upscale to primary resolution
- palette lookup (classic “blob” look)
- optional alpha blend over the base tiles (or show alone like classic)

note: the original uses different resolutions; preserve that “chunkiness”.

---

## 17) extensibility plan (without breaking fidelity)

### 17.1 tilesets
- keep engine tile ids stable (classic)
- build a tileset layer that maps:
  - tile id → sprite rect + animation frames
- future:
  - different art can reuse engine rules
  - isometric later: renderer changes, engine mostly doesn’t (except neighbor topology visuals)

### 17.2 map size
architect now so `w,h` are parameters, but:
- keep default 120×100
- make derived maps compute `w/2`, `w/4`, `w/8` via integer division
- define clear border behavior (clamp vs wrap) and match original

> TODO: when you actually change map size, you will discover hidden assumptions: spawn points, object bounds, smoothing windows, and some “slice” logic assume 120×100. keep these isolated.

---

## 18) concrete engine skeleton (ts)

```ts
// packed tile
export type Tile16 = number;

export const CHAR_MASK = 0x03ff;

export enum TileFlag {
  ZONE     = 1 << 10,
  ANIM     = 1 << 11,
  BULLDOZE = 1 << 12,
  BURN     = 1 << 13,
  CONDUCT  = 1 << 14,
  POWERED  = 1 << 15,
}

export interface MapLayer<T extends ArrayBufferView> {
  w: number; h: number;
  scale: 1 | 2 | 4 | 8;     // relative to primary
  data: T;
}

export interface Ruleset {
  // TODO: fill with constants + tile classification tables + quirk toggles
  quirks: {
    powerPlantConnectivityBug: boolean;
    seaportDoesNotNeedWater: boolean;
    // ...
  };
}

export interface SimState {
  w: number; h: number;

  // time
  simStep: number;         // 0..15
  weeks: number;           // total simulated weeks

  // maps
  map: Uint16Array;        // w*h
  power: Uint8Array;       // w*h (0/1)
  landValue: Uint8Array;   // (w/2)*(h/2)
  pollution: Uint8Array;   // (w/2)*(h/2)
  crime: Uint8Array;       // (w/2)*(h/2)
  traffic: Uint8Array;     // (w/2)*(h/2)
  popDensity: Uint8Array;  // (w/2)*(h/2)
  // + station maps + temps...

  // macro
  census: Census;
  demand: Demand;

  // objects/messages
  objects: ObjectsSoA;
  messages: MessageQueue;

  // rng
  rng: PRNG;
  rules: Ruleset;
}

export function simulateOneStep(s: SimState): void {
  switch (s.simStep) {
    case 0: setValves(s); break;
    case 1: case 2: case 3: case 4: case 5: case 6: case 7: case 8:
      mapScanSlice(s, s.simStep - 1);
      break;
    case 9: doTaxes(s); break;
    case 10: decayMapsAndMessages(s); break;
    case 11: doPowerScan(s); break;
    case 12: doLandValue(s); break;
    case 13: doCrimeScan(s); break;
    case 14: doPopDensity(s); break;
    case 15: doFireAnalysisAndDisasters(s); break;
  }
  s.simStep = (s.simStep + 1) & 15;
}
```

---

## 19) next questions (to steer v2 of this doc + your build order)

1) do you want **bit-for-bit deterministic** across browsers (hard mode), or “deterministic per browser” is fine?  
   (floating point + typed array corner cases can matter; pure-int math helps.)

2) what is your preferred **source of truth** for fidelity: the open-source code’s behavior, or the doc’s behavior?  
   (i assume code.)

3) do you want to start by implementing **save/load first** (so everything can be regression tested on real cities), or do you want a toy sandbox city generator first?

4) are you planning to reproduce the original **tool costs/budget** model exactly, or just “close enough” for v1?

---

end of v1.
