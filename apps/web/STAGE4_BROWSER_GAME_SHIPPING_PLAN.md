# Stage 4 Browser Game Shipping Plan (Executable Checklist)

## Mission

Ship one Stage 4 browser route that behaves like a playable Micropolis game:

- New city starts with a real map and sim-core state.
- Play/Pause/Speed affect simulation cadence.
- Tools (road/rail/wire/bulldoze/R/C/I) use real Micropolis-like semantics, costs, and rejects.
- HUD/date/demand/funds/messages are authoritative.
- Save/load `.cty` works and scenarios start correctly.
- Realtime objects/events are visible.
- Map/sprites/invalidation are performant enough for normal play sessions.
- Stage 4 is the default path, with tests and smoke checks proving the full loop.

## Non-Negotiable Parity Guardrails

- For each behavior change, read the referenced C source before coding TypeScript behavior.
- Keep C integer behavior in mind (`/`, `%`, truncation, bounds, signed values). Use explicit truncation where needed.
- Keep `ToolContext.funds` and `SimState.TotalFunds` synchronized in all tool paths.
- Preserve authoritative ordering (`serverSeq`, `tick`) and snapshot/resync guarantees.
- Any intentional divergence from C is documented inline in JSDoc/comments.

## Stage 0: Contract and Surface Convergence (Decision Lock)

### Stage 0 Scope

- [x] Stage 0 is architecture/convergence work only.
- [x] No new gameplay features land before Stage 0 exit criteria pass.

### Locked Decisions (Already Chosen)

- [x] Canonical runtime contract is `@city/core-bridge` (`packages/core-bridge/src/core-host.ts`, `packages/core-bridge/src/types.ts`).
- [x] One surviving frontend surface at `/`; current Stage 2/Stage 4 split UI is temporary migration scaffolding.
- [x] New work lands only on the surviving gameplay surface.
- [x] Web-local protocol forks are deleted after bridge-contract port:
- [x] `apps/web/src/game/core-host.ts`
- [x] `apps/web/src/game/runtime/protocol.ts`
- [x] Handshake/version defaults are bridge-owned in `@city/core-bridge` (`packages/core-bridge/src/local-host.ts`, `packages/core-bridge/src/types.ts`).
- [x] Web surfaces (`apps/web/src/game/handshake.ts`, `apps/web/src/game/runtime/protocol.ts`) consume handshake/version defaults from `@city/core-bridge` and do not define new web-local handshake/version constants.
- [x] Keep existing sequencing/resync policy from `packages/core-bridge/src/sequencing.ts` (no re-evaluation unless blocker).
- [x] Snapshot/patch map rule: patch deltas use `{ x, y, tile }`; snapshot tile order is explicit x-major (`x * WORLD_Y + y`).
- [x] Funds rule: `SimState.TotalFunds` is canonical authoritative funds state; `ToolContext.funds` is synchronized derived state and must be refreshed from canonical funds before tool evaluation and resynchronized after every tool outcome (success or reject).
- [x] Save/load room rule: `load-city` replaces current authoritative room/session state in-place and emits fresh snapshot.
- [x] Room/session lifecycle rule: creating/selecting a new room/session is separate host lifecycle behavior (connect/binding), not a `load-city` side effect.
- [x] Single-player playable command inventory is frozen to the bridge-owned `CityCommandPayloadV1` subset (`tool_apply`, `sim_pause`, `sim_resume`, `sim_set_speed`, `city_new`, `city_load`, `city_save`, `scenario_start`).
- [x] Host/client authority rule: host owns authoritative simulation state progression; web client is projection-only except non-authoritative pending tool visuals.
- [x] Multiplayer/presence is out of scope for playable shipping.

### Required References

- [x] `STAGE_0_ALIGNMENT_NOTES.md`
- [x] `packages/core-bridge/src/core-host.ts`
- [x] `packages/core-bridge/src/types.ts`
- [x] `packages/core-bridge/src/sequencing.ts`
- [x] `packages/sim-integration/INTEGRATION-CONTRACT.md`
- [x] `apps/web/src/game/core-host.ts`
- [x] `apps/web/src/game/runtime/protocol.ts`
- [x] `ref/micropolis/spec/integration/SPEC.md`
- [x] `ref/micropolis/src/sim/sim.c`
- [x] `ref/micropolis/src/sim/s_sim.c`
- [x] `ref/micropolis/src/sim/w_tool.c`
- [x] `ref/micropolis/src/sim/s_fileio.c`

### Atomic Steps (Do + Check)

- [x] 0.1 Add a Stage 0 decision map to this file from old web contracts to canonical bridge contracts.
- [x] 0.1 Check: mapping explicitly lists `apps/web/src/game/core-host.ts` -> `packages/core-bridge/src/core-host.ts`.
- [x] 0.1 Check: mapping explicitly lists `apps/web/src/game/runtime/protocol.ts` -> `packages/core-bridge/src/types.ts`.

- [x] 0.2 Freeze handshake/version ownership at bridge layer.
- [x] 0.2 Check: Stage 0 docs name `@city/core-bridge` as the only handshake/version owner.
- [x] 0.2 Check: no Stage 0 step asks for new web-local handshake constants.

- [x] 0.3 Freeze playable command inventory for single-player shipping.
- [x] 0.3 Check: inventory includes tool apply, sim pause/resume/set speed, city new/load/save, scenario start.
- [x] 0.3 Check: command inventory references bridge payload types, not web-local unions (`Stage0PlayableBridgeCommandPayload`, `STAGE0_PLAYABLE_BRIDGE_COMMAND_TYPES`, and `isStage0PlayableBridgeCommandType` in `apps/web/src/game/runtime/protocol.ts`).

- [x] 0.4 Freeze host/client authority boundary.
- [x] 0.4 Check: host owns authoritative simulation state and progression.
- [x] 0.4 Check: client is projection-only (pending visuals only, no speculative authoritative mutation).

- [x] 0.5 Freeze snapshot/patch data conventions.
- [x] 0.5 Check: patch deltas are `{ x, y, tile }` (no ambiguous linear index deltas).
- [x] 0.5 Check: snapshot tile ordering is documented as x-major with explicit formula.

- [x] 0.6 Freeze resync behavior by adopting existing bridge sequencing semantics unchanged.
- [x] 0.6 Check: stale drop and gap => resync rules match `packages/core-bridge/src/sequencing.ts`.
- [x] 0.6 Check: no alternative sequencing policy is introduced in Stage 0 docs.

- [x] 0.7 Freeze funds coupling semantics.
- [x] 0.7 Check: `SimState.TotalFunds` is explicitly documented as canonical.
- [x] 0.7 Check: all tool-flow docs require `ToolContext.funds` synchronization from canonical funds state.

- [x] 0.8 Freeze save/load room semantics for local and DO-backed hosts.
- [x] 0.8 Check: `load-city` semantics are explicitly “replace state in current room/session + emit snapshot”.
- [x] 0.8 Check: “create new room/session” is documented as separate lifecycle behavior.

- [x] 0.9 Create explicit delete plan for duplicate frontend protocol surfaces.
- [x] 0.9 Check: plan names exact modules to delete once port is complete.
- [x] 0.9 Check: plan states one surviving `/` gameplay route after convergence.

- [x] 0.10 Record Stage 0 sign-off, then unblock Stage 1 implementation.
- [x] 0.10 Check: all Stage 0 decisions are marked locked and referenced by later stages.
- [x] 0.10 Check: no unresolved Stage 0 architecture questions remain.

### Stage 0 Sign-off (0.10)

Stage 0 is signed off as of 2026-02-09.

- All Stage 0 decision locks above are frozen and remain the contract baseline for implementation stages.
- Later stages explicitly inherit these locks via their referenced bridge/sim sources, with no re-opening of Stage 0 architecture decisions:
  - Stage 1-3 consume bridge contract ownership, authority boundaries, sequencing/resync, and funds coupling locks.
  - Stage 4-10 consume authoritative map/HUD/message/persistence payload ownership and snapshot/patch conventions locked in Stage 0.
- Stage 1 implementation is unblocked; remaining Stage 1 items are implementation sequencing tasks, not architecture decision tasks.

### Stage 0 Decision Map

| Decision surface | Old web contract source | Canonical bridge contract source | Stage 0 lock |
| --- | --- | --- | --- |
| Web runtime interface ownership | `apps/web/src/game/core-host.ts` | `packages/core-bridge/src/core-host.ts` | All Stage 1+ host/runtime work imports contract ownership from `@city/core-bridge`. |
| Web envelope type ownership | `apps/web/src/game/runtime/protocol.ts` | `packages/core-bridge/src/types.ts` | Envelope definitions and command payload unions are bridge-owned only. |
| Web handshake/version ownership | `apps/web/src/game/handshake.ts`, `apps/web/src/game/runtime/protocol.ts` | `packages/core-bridge/src/local-host.ts`, `packages/core-bridge/src/types.ts` | Handshake/version defaults are owned by `@city/core-bridge`; web modules only re-export or consume bridge-owned values. |
| Web sequencing/resync ownership | local reducer-specific ordering behavior | `packages/core-bridge/src/sequencing.ts` | Stale drop, server-seq gap resync, and tick-regression resync stay bridge-defined. |
| Funds coupling ownership | ad-hoc funds mirroring in early web tool flows | `SimState.TotalFunds` in `packages/sim-core/src/core/sim-state.ts` with mutation helpers in `packages/sim-core/src/systems/funds.ts` and tool mirror state in `packages/sim-core/src/actions/tool-actions.ts` | `SimState.TotalFunds` is canonical for all tool flows. `ToolContext.funds` is derived-only and must synchronize from canonical funds before tool evaluation and after each accept/reject result, matching Micropolis `TotalFunds` + `Spend`/`SetFunds` semantics in `ref/micropolis/src/sim/w_tool.c` and `ref/micropolis/src/sim/w_stubs.c`. |
| Save/load room semantics ownership | ad-hoc interpretation of `load-city` as either state import or room reset | `city_load` command + host lifecycle boundaries in `packages/core-bridge/src/types.ts`, `packages/core-bridge/src/core-host.ts`, and DO/local host conformance coverage in `packages/sim-do-adapter/src/host-conformance.test.ts` | `load-city` replaces authoritative state within the current room/session and emits a fresh snapshot; creating/selecting a new room/session is a separate host lifecycle operation. |
| Single-player playable command inventory ownership | Stage 2-local command unions in `apps/web/src/game/runtime/protocol.ts` | `CityCommandPayloadV1` in `packages/core-bridge/src/types.ts` (using Stage 0 subset extraction in `apps/web/src/game/runtime/protocol.ts`) | Stage 0 playable inventory is exactly `tool_apply`, `sim_pause`, `sim_resume`, `sim_set_speed`, `city_new`, `city_load`, `city_save`, `scenario_start`; no web-local payload union may redefine these bridge payload shapes. |
| Host/client authority boundary ownership | client runtime pending-visual UX state in `apps/web/src/game/runtime/reducer.ts` | host-ordered authority events in `packages/core-bridge/src/core-host.ts` + `packages/core-bridge/src/types.ts` | Host remains authoritative for simulation/map/HUD progression; client runtime is projection-only and may track pending visuals only until host `ack`/`reject` or resync. |

### Stage 0 Duplicate Frontend Protocol Surface Delete Plan (0.9)

Delete only after the Stage 1+ bridge-contract port is complete and all web call sites consume bridge-owned contracts directly.

| Delete phase | Exact module(s) to delete | Replacement source | Deletion gate |
| --- | --- | --- | --- |
| Protocol contract convergence | `apps/web/src/game/core-host.ts` | `packages/core-bridge/src/core-host.ts` | All web runtime/host modules import host contracts from `@city/core-bridge`; no remaining app-local type imports from `apps/web/src/game/core-host.ts`. |
| Envelope + command contract convergence | `apps/web/src/game/runtime/protocol.ts` | `packages/core-bridge/src/types.ts` | Envelope and command payload typing is bridge-owned; web runtime adapters only translate UI state and do not redefine bridge payload unions. |
| Route convergence to one playable surface | Stage 2 panel/render path in `apps/web/src/routes/index.tsx` (including Stage 2 map/HUD projection branch) | Single Stage 4 gameplay panel at `/` backed by bridge contracts | Default and only gameplay surface is `/`; Stage 2/Stage 4 split toggle is removed from user-visible route UI. |

Deletion execution notes:

- Remove now-obsolete tests that only validate deleted web-local protocol surfaces (for example, bridge-ownership assertions tied to removed modules), and keep coverage on bridge contract behavior through runtime integration tests.
- Keep handshake/version defaults bridge-owned (`@city/core-bridge`) during and after deletions; web code may consume/re-export but must not redefine protocol/core version constants.

### Stage 0 Exit Criteria

- [x] Canonical bridge contract is selected and documented as the only runtime contract for upcoming web work.
- [x] Single surviving UI surface (`/`) is selected and duplicate protocol surface deletion is planned.
- Implementation trace (2026-02-09): `apps/web/src/routes/index.tsx` now carries an explicit Stage 0 lock marker for surviving route `/` and names the duplicate protocol modules scheduled for deletion (`apps/web/src/game/core-host.ts`, `apps/web/src/game/runtime/protocol.ts`) after bridge-contract convergence.
- [x] Snapshot/patch, resync, funds, and save/load semantics are fully locked.
- Implementation trace (2026-02-09): lock sources are frozen in `packages/core-bridge/src/types.ts` (patch `{ x, y, tile }` + x-major snapshot indexing), `packages/core-bridge/src/sequencing.ts` (stale drop + gap/tick-regression => resync), `STAGE_0_ALIGNMENT_NOTES.md` (funds + save/load room rules), and parity/conformance checks in `packages/core-bridge/src/types.test.ts`, `packages/core-bridge/src/snapshot-index.test.ts`, `packages/core-bridge/src/sequencing.test.ts`, and `packages/sim-do-adapter/src/host-conformance.test.ts` (`city_load` in-room replacement + fresh snapshot).
- [x] Stage 1+ can proceed without additional architecture decisions.
- Implementation trace (2026-02-09): Stage 0 decision locks and sign-off in this document fully define bridge contract ownership, authority boundaries, sequencing/resync, funds coupling, and save/load room semantics required by Stage 1+, so remaining work is implementation-only sequencing.

---

## Stage 1: Real sim-core Authority Host Skeleton

### Goal

- [x] Replace Stage 4 deterministic command authority with a real sim-core-backed authority loop that owns `SimState`, `SimContext`, `ToolContext`, and ticking.

### C references to review

- [x] `ref/micropolis/src/sim/w_sim.c` (command routing/bootstrap intent)
- [x] `ref/micropolis/src/sim/s_sim.c` (`SimFrame`, `Simulate`, `DoSimInit`)
- [x] `ref/micropolis/src/sim/s_init.c` (initialization/reset expectations)
- [x] `ref/micropolis/src/sim/w_util.c` (speed/pause semantics)

### TS references to review

- [x] `apps/web/src/game/host-factory.ts`
- [x] `apps/web/src/game/local-host.ts`
- [x] `apps/web/src/game/do-host.ts`
- [x] `apps/web/src/game/runtime.ts`
- [x] `packages/sim-core/src/core/sim-state.ts`
- [x] `packages/sim-core/src/core/sim-context.ts`
- [x] `packages/sim-core/src/sim/simulate.ts`
- [x] `packages/sim-core/src/systems/init.ts`

### Implementation checklist

- [x] Add a new Stage 4 authority module that creates and owns `MapStore + SimState + SimContext + ToolContext`.
- [x] Implement host lifecycle (`connect`, `disconnect`, periodic tick loop, snapshot request support).
- [x] Keep deterministic authority available only for isolated tests/fallback.
- [x] Add host-factory flag/wiring to opt into the real authority path in web dev/runtime.
- [x] Ensure handshake behavior remains compatible with existing runtime bootstrapping.

### Verification checklist

- [x] `apps/web/src/game/host-factory.test.ts` still passes.
- [x] `apps/web/src/game/runtime.test.ts` still passes.
- [x] Stage 4 route boots successfully using the new authority path (not `DeterministicCommandAuthority`).

---

## Stage 2: Protocol + Runtime State Expansion (Authoritative Data Plane)

### Goal

- [x] Move Stage 4 from placement-event projection to authoritative snapshot/patch game-state projection.

### C references to review

- [x] `ref/micropolis/src/sim/s_scan.c` (`NewMap`, `NewMapFlags` semantics)
- [x] `ref/micropolis/src/sim/sim.c` (`sim_update_maps` invalidation/clear cycle)
- [x] `ref/micropolis/src/sim/w_update.c` (heads/date/funds/options)
- [x] `ref/micropolis/src/sim/s_msg.c` (message port/dispatch semantics)

### TS references to review

- [x] `apps/web/src/game/core-host.ts`
- [x] `apps/web/src/game/runtime/protocol.ts`
- [x] `apps/web/src/game/runtime/reducer.ts`
- [x] `apps/web/src/game/runtime/map-state.ts`
- [x] `apps/web/src/game/runtime/hud-state.ts`
- [x] `apps/web/src/game/runtime/runtime.ts`

### Implementation checklist

- [x] Extend host events/payloads to carry authoritative map snapshot/patch tile words.
- [x] Extend payloads for HUD heads (funds/date/demand/speed/options) and message deltas.
- [x] Add optional realtime object payload field now (can be empty until Stage 7).
- [x] Keep strict ordering behavior (`serverSeq`, `tick`) and gap handling.
- [x] Ensure snapshot replay can reconstruct map + HUD + messages deterministically.

### Verification checklist

- [x] `apps/web/src/game/runtime/map-state.test.ts` covers snapshot+patch reconstruction.
- [x] `apps/web/src/game/runtime/hud-state.test.ts` covers heads/message projection (snapshot hydration, patch deltas, dispatch parity, replay metadata).
- [x] `apps/web/src/game/runtime/reducer.test.ts` covers sequence drops/gap behavior.
- [x] `apps/web/src/game/runtime.ordering-resync.test.ts` covers resync recovery with expanded payloads.

---

## Stage 3: Real Tool Semantics + Funds Coupling

### Goal

- [x] Route Stage 4 tool commands through real sim-core tool application logic with Micropolis-like costs/rejects/map mutation.

### C references to review

- [x] `ref/micropolis/src/sim/w_tool.c` (tool entrypoints, costs, size/offset)
- [x] `ref/micropolis/src/sim/w_con.c` (lay road/rail/wire/bulldoze specifics)
- [x] `ref/micropolis/src/sim/w_stubs.c` (`Spend`, `SetFunds` update behavior)
- [x] `ref/micropolis/src/sim/s_zone.c` (zone mutation side effects)

### TS references to review

- [x] `packages/sim-core/src/actions/tool-actions.ts`
- [x] `packages/sim-core/src/systems/funds.ts`
- [x] `packages/sim-core/src/systems/date-time.ts`
- [x] `apps/web/src/game/runtime.command-lifecycle.test.ts`
- [x] `apps/web/src/game/runtime.ts`

### Implementation checklist

- [x] Replace occupancy-only acceptance/reject logic with `applyToolAction`-backed outcomes.
- [x] Translate tool outcomes into stable host ack/reject codes/messages.
- [x] Sync `ToolContext.funds` and `SimState.TotalFunds` in both success and failure paths.
- [x] Ensure reject reasons include out-of-bounds/no-funds/invalid placement cases.
- [x] Ensure tool footprint behavior (1x1 vs 3x3) aligns with C tool tables.

### Verification checklist

- [x] `packages/sim-core/src/actions/tool-actions.test.ts` remains green.
- [x] `packages/sim-core/src/actions/tool-actions.c-oracle.test.ts` remains green.
- [x] `apps/web/src/game/runtime.command-lifecycle.test.ts` validates tool success+reject against authoritative state.
- [x] Manual: road/rail/wire/bulldoze/R/C/I cost and placement behavior match expected Micropolis semantics.

---

## Stage 4: Stage 4 Map Rendering from Authoritative Tile Words

### Goal

- [x] Replace Stage 4 placement-dot canvas with authoritative tile-map rendering.

### C references to review

- [x] `ref/micropolis/src/sim/g_bigmap.c` (tile draw loops, `LOMASK` usage)
- [x] `ref/micropolis/src/sim/g_map.c` (map-state draw modes)
- [x] `ref/micropolis/src/sim/w_map.c` (map update ownership)
- [x] `ref/micropolis/src/sim/g_ani.c` (tile animation masking)

### TS references to review

- [x] `apps/web/src/routes/index.tsx`
- [x] `apps/web/src/game/map/map-canvas.tsx`
- [x] `apps/web/src/game/runtime/map-state.ts`
- [x] `packages/sim-core/src/core/constants.ts`

### Implementation checklist

- [x] Stage 4 panel reads and renders authoritative `RuntimeMapState`.
- [x] Tile lookup masks map words with `TileMask.LOMASK` before sprite/debug lookup.
- [x] Full redraw occurs on snapshot; patch redraw occurs only on dirty tiles/rects.
- [x] Remove Stage 4 placement-only canvas from primary UI path.

### Verification checklist

- [x] `apps/web/src/game/runtime/map-state.test.ts` verifies snapshot and patch draw modes.
- [x] Manual: Stage 4 shows full map immediately after snapshot.
- [x] Manual: patch updates no longer appear as random debug noise paint.

---

## Stage 5: HUD, Messages, and Sim Controls from Authoritative Hooks

### Goal

- [x] Drive Stage 4 HUD/messages/speed from real sim-core hook outputs (`uiSet`, `sendMes`, `sendMesAt`, `tickCount`).

### C references to review

- [x] `ref/micropolis/src/sim/w_update.c` (`DoUpdateHeads`, date/funds/options)
- [x] `ref/micropolis/src/sim/s_msg.c` (`SendMes`, `SendMesAt`, `doMessage`)
- [x] `ref/micropolis/src/sim/w_util.c` (`Pause`, `Resume`, `setSpeed`)

### TS references to review

- [x] `packages/sim-core/src/core/sim-context.ts`
- [x] `packages/sim-core/src/systems/date-time.ts`
- [x] `packages/sim-core/src/systems/messages.ts`
- [x] `apps/web/src/game/runtime/hud-state.ts`
- [x] `apps/web/src/routes/index.tsx`
- [x] `packages/sim-ui/IMPORTANT.md`

### Implementation checklist

- [x] Wire `SimContext` hooks to host payload builders for HUD/message updates.
- [x] Feed Stage 4 UI labels from authoritative HUD state only.
- [x] Wire Stage 4 play/pause/speed controls to real sim speed state.
- [x] Preserve message timing/expiry/requeue behavior expected by C message flow.

### Verification checklist

- [ ] `apps/web/src/game/runtime/hud-state.test.ts` validates heads/message projection behavior.
- [ ] `packages/sim-core/src/systems/messages.test.ts` and `packages/sim-core/src/systems/date-time.test.ts` remain green.
- [ ] Manual: funds/date/demand/speed visibly update during simulation.
- [ ] Manual: messages appear/expire correctly and coordinate messages carry x/y.

---

## Stage 6: New City + Save/Load + Scenario on Stage 4 Path

### Goal

- [ ] Make lifecycle and persistence fully functional from Stage 4 controls.

### C references to review

- [ ] `ref/micropolis/src/sim/s_init.c` (new-city/reset lifecycle)
- [ ] `ref/micropolis/src/sim/s_gen.c` (map generation/reset behaviors)
- [ ] `ref/micropolis/src/sim/s_fileio.c` (`loadFile`, `saveFile`, `LoadCity`, `LoadScenario`)
- [ ] `ref/micropolis/src/sim/w_sim.c` (command routing for lifecycle/io)

### TS references to review

- [ ] `packages/sim-io/src/load.ts`
- [ ] `packages/sim-io/src/save.ts`
- [ ] `packages/sim-io/src/scenarios.ts`
- [ ] `apps/web/src/game/runtime.persistence.test.ts`
- [ ] `apps/web/src/routes/index.tsx`

### Implementation checklist

- [ ] Implement Stage 4 `new-city` command path using real sim init + terrain reset flow.
- [ ] Implement Stage 4 save command path using `sim-io` C-style save packing.
- [ ] Implement Stage 4 load command path using `sim-io` C-style load orchestration.
- [ ] Implement scenario start path using `snro.*` data and scenario metadata constants.
- [ ] Ensure save/load round-trip restores map and scalar game state.

### Verification checklist

- [ ] `apps/web/src/game/runtime.persistence.test.ts` passes with Stage 4 authority.
- [ ] `packages/sim-io/src/load.test.ts` and `packages/sim-io/src/save.test.ts` pass.
- [ ] `packages/sim-io/src/scenarios.test.ts` passes.
- [ ] Manual: save city, mutate state, load city, confirm restored state.
- [ ] Manual: each scenario starts with expected year/funds/speed.

---

## Stage 7: Realtime Objects + Overlay Layer

### Goal

- [ ] Render moving realtime objects/events on top of authoritative base map.

### C references to review

- [ ] `ref/micropolis/src/sim/w_sprite.c` (sprite model/fields/types)
- [ ] `ref/micropolis/src/sim/s_disast.c` (disaster/event triggers)
- [ ] `ref/micropolis/src/sim/s_msg.c` (`SendMesAt` event coupling)
- [ ] `ref/micropolis/src/sim/g_ani.c` (animated tile/object timing context)

### TS references to review

- [ ] `packages/sim-core/src/sim/realtime.ts`
- [ ] `packages/sim-core/src/sim/realtime.test.ts`
- [ ] `apps/web/src/game/map/map-canvas.tsx`
- [ ] `apps/web/src/routes/index.tsx`

### Implementation checklist

- [ ] Extend authority payloads with realtime object snapshots/deltas per tick.
- [ ] Add overlay renderer for trains/ships/planes/copter/monster/tornado/explosion.
- [ ] Ensure overlay updates are deterministic and compatible with map patch redraw cadence.
- [ ] Hook realtime event messages to message feed when applicable.

### Verification checklist

- [ ] `packages/sim-core/src/sim/realtime.test.ts` remains green.
- [ ] Add/extend web runtime tests for overlay payload projection.
- [ ] Manual: realtime entities appear and move while sim runs.
- [ ] Manual: disasters/events produce coherent overlay + message behavior.

---

## Stage 8: Sprite Art Pass (Micropolis-Like Visuals)

### Goal

- [ ] Replace debug color tiles with Micropolis-derived sprite rendering while keeping deterministic fallback.

### C references to review

- [ ] `ref/micropolis/src/sim/g_setup.c` (image asset identity/loading)
- [ ] `ref/micropolis/src/sim/g_bigmap.c` (tile-to-graphic draw relationship)
- [ ] `ref/micropolis/src/sim/headers/sim.h` (tile id/layout constants context)
- [ ] `ref/micropolis/images/*.xpm` (canonical art sources)

### TS references to review

- [ ] `packages/sim-assets/src/derived-images.ts`
- [ ] `packages/sim-assets/generated-images/images/*`
- [ ] `apps/web/src/game/map/map-canvas.tsx`
- [ ] `packages/sim-core/src/core/constants.ts`

### Implementation checklist

- [ ] Build/consume deterministic atlas mapping from canonical Micropolis image identity keys.
- [ ] Implement tile-id to sprite-rect lookup with `LOMASK` masking.
- [ ] Keep debug renderer behind explicit feature flag for diagnostics.
- [ ] Ensure overlay sprites layer correctly with map sprites.

### Verification checklist

- [ ] Add deterministic sprite lookup tests (tile id -> atlas rect).
- [ ] Manual: map looks Micropolis-like (not HSL noise).
- [ ] Manual: snapshot and patch redraw produce identical tile visuals.

---

## Stage 9: Invalidation, Camera, and UX Performance Floor

### Goal

- [ ] Make Stage 4 responsive and stable during extended play.

### C references to review

- [ ] `ref/micropolis/src/sim/sim.c` (`sim_update_maps`, flag clearing)
- [ ] `ref/micropolis/src/sim/s_scan.c` (`NewMap`, `NewMapFlags` producers)
- [ ] `ref/micropolis/src/sim/w_map.c` (pan/map interaction behaviors)
- [ ] `ref/micropolis/src/sim/g_map.c` (map-state draw mode table)

### TS references to review

- [ ] `packages/sim-core/src/core/map-invalidation.ts`
- [ ] `packages/sim-core/src/core/map-invalidation.test.ts`
- [ ] `apps/web/src/game/map/map-canvas.tsx`
- [ ] `apps/web/src/routes/index.tsx`
- [ ] `packages/sim-ui/IMPORTANT.md`

### Implementation checklist

- [ ] Use `planMapRedraw` + `consumeMapRedrawPlan` end-to-end from authority output to renderer.
- [ ] Add pan/zoom controls suitable for desktop and laptop touchpads.
- [ ] Ensure base tiles + overlays + HUD remain responsive under continuous ticks.
- [ ] Prevent full-canvas flashing when patch/dirty redraw is sufficient.

### Verification checklist

- [ ] `packages/sim-core/src/core/map-invalidation.test.ts` passes.
- [ ] Add web-level tests for redraw-plan consumption on patch vs full redraw paths.
- [ ] Manual: 10+ minute session without runaway latency or redraw artifacts.

---

## Stage 10: Consolidation, Cleanup, and Default Path Flip

### Goal

- [ ] Make Stage 4 the primary playable route and retire user-visible dependence on legacy demo/placement paths.

### C references to review

- [ ] `ref/micropolis/src/sim/w_sim.c` (single command surface concept)
- [ ] `ref/micropolis/spec/integration/SPEC.md` (ordering/recovery contracts)

### TS references to review

- [ ] `apps/web/src/routes/index.tsx`
- [ ] `apps/web/src/game/runtime-instance.ts`
- [ ] `apps/web/src/game/runtime.ts`
- [ ] `apps/web/src/game/runtime/runtime.ts`
- [ ] `apps/web/src/__tests__/basic.test.ts`
- [ ] `apps/web/src/game/runtime.ordering-resync.test.ts`
- [ ] `apps/web/src/game/runtime.command-lifecycle.test.ts`

### Implementation checklist

- [ ] Remove or hide placement-only Stage 4 visual path from default gameplay flow.
- [ ] Keep deterministic shim only where it materially helps isolated tests.
- [ ] Add/update Stage 4 smoke coverage for boot, tools+funds, save/load, scenario, resync.
- [ ] Update docs so contributors know Stage 4 is authoritative shipping path.

### Verification checklist

- [ ] Stage 4 is the default route users land on for gameplay.
- [ ] No user-visible dependency on debug map renderer remains.
- [ ] Smoke tests are stable/repeatable across runs.

---

## Stage 11: Playable Full-Game Certification (Release Gate)

### Goal

- [ ] Prove the shipped Stage 4 route is actually playable end-to-end.

### Certification checklist (manual)

- [ ] Start a new city and confirm map + HUD load correctly.
- [ ] Place road/rail/wire/bulldoze/R/C/I and confirm costs/rejects/funds behavior.
- [ ] Run sim at speed 1/2/3, pause/resume, and confirm cadence changes.
- [ ] Observe heads + message feed update during normal simulation.
- [ ] Save `.cty`, mutate city, reload `.cty`, confirm full restoration.
- [ ] Start at least one scenario and confirm expected start year/funds.
- [ ] Observe at least one realtime/disaster visual event in-map.
- [ ] Run a continuous play session for at least 15 minutes with acceptable responsiveness.

### Certification checklist (automated)

- [ ] `pnpm test` passes.
- [ ] `pnpm typecheck` passes.
- [ ] `pnpm lint` passes.
- [ ] `pnpm format` passes.

---

## Cross-Stage Testing Matrix

- [ ] Runtime bootstrap/handshake: `apps/web/src/game/runtime.test.ts`, `apps/web/src/game/host-factory.test.ts`
- [ ] Ordering/resync: `apps/web/src/game/runtime.ordering-resync.test.ts`, `apps/web/src/game/runtime/reducer.test.ts`
- [ ] Tool lifecycle: `apps/web/src/game/runtime.command-lifecycle.test.ts`, `packages/sim-core/src/actions/tool-actions*.test.ts`
- [ ] Map projection/redraw: `apps/web/src/game/runtime/map-state.test.ts`, `packages/sim-core/src/core/map-invalidation.test.ts`
- [ ] HUD/messages: `apps/web/src/game/runtime/hud-state.test.ts`, `packages/sim-core/src/systems/messages.test.ts`
- [ ] Persistence/scenarios: `apps/web/src/game/runtime.persistence.test.ts`, `packages/sim-io/src/load.test.ts`, `packages/sim-io/src/save.test.ts`, `packages/sim-io/src/scenarios.test.ts`
- [ ] Realtime: `packages/sim-core/src/sim/realtime.test.ts` plus new web overlay tests

## Definition of Done (Shipping)

- [ ] Stage 4 route provides full playable Micropolis loop (build, simulate, manage, persist, reload, scenario, realtime).
- [ ] All high-priority parity behaviors are traced back to C references in code/JSDoc.
- [ ] Tests and manual certification steps are complete and reproducible.
- [ ] Legacy/demo-only paths are no longer blocking or masking real gameplay behavior.



