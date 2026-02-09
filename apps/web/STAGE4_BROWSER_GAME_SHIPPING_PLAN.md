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
- [x] Keep existing sequencing/resync policy from `packages/core-bridge/src/sequencing.ts` (no re-evaluation unless blocker).
- [x] Snapshot/patch map rule: patch deltas use `{ x, y, tile }`; snapshot tile order is explicit x-major (`x * WORLD_Y + y`).
- [x] Funds rule: `SimState.TotalFunds` is canonical; `ToolContext.funds` is synchronized derived state.
- [x] Save/load room rule: `load-city` replaces current authoritative room state and emits fresh snapshot.
- [x] Multiplayer/presence is out of scope for playable shipping.

### Required References

- [x] `STAGE_0_ALIGNMENT_NOTES.md`
- [x] `packages/core-bridge/src/core-host.ts`
- [x] `packages/core-bridge/src/types.ts`
- [x] `packages/core-bridge/src/sequencing.ts`
- [x] `packages/sim-integration/INTEGRATION-CONTRACT.md`
- [ ] `apps/web/src/game/core-host.ts`
- [ ] `apps/web/src/game/runtime/protocol.ts`
- [ ] `ref/micropolis/spec/integration/SPEC.md`
- [ ] `ref/micropolis/src/sim/sim.c`
- [ ] `ref/micropolis/src/sim/s_sim.c`
- [ ] `ref/micropolis/src/sim/w_tool.c`
- [ ] `ref/micropolis/src/sim/s_fileio.c`

### Atomic Steps (Do + Check)

- [ ] 0.1 Add a Stage 0 decision map to this file from old web contracts to canonical bridge contracts.
- [ ] 0.1 Check: mapping explicitly lists `apps/web/src/game/core-host.ts` -> `packages/core-bridge/src/core-host.ts`.
- [ ] 0.1 Check: mapping explicitly lists `apps/web/src/game/runtime/protocol.ts` -> `packages/core-bridge/src/types.ts`.

- [ ] 0.2 Freeze handshake/version ownership at bridge layer.
- [ ] 0.2 Check: Stage 0 docs name `@city/core-bridge` as the only handshake/version owner.
- [ ] 0.2 Check: no Stage 0 step asks for new web-local handshake constants.

- [ ] 0.3 Freeze playable command inventory for single-player shipping.
- [ ] 0.3 Check: inventory includes tool apply, sim pause/resume/set speed, city new/load/save, scenario start.
- [ ] 0.3 Check: command inventory references bridge payload types, not web-local unions.

- [ ] 0.4 Freeze host/client authority boundary.
- [ ] 0.4 Check: host owns authoritative simulation state and progression.
- [ ] 0.4 Check: client is projection-only (pending visuals only, no speculative authoritative mutation).

- [ ] 0.5 Freeze snapshot/patch data conventions.
- [ ] 0.5 Check: patch deltas are `{ x, y, tile }` (no ambiguous linear index deltas).
- [ ] 0.5 Check: snapshot tile ordering is documented as x-major with explicit formula.

- [ ] 0.6 Freeze resync behavior by adopting existing bridge sequencing semantics unchanged.
- [ ] 0.6 Check: stale drop and gap => resync rules match `packages/core-bridge/src/sequencing.ts`.
- [ ] 0.6 Check: no alternative sequencing policy is introduced in Stage 0 docs.

- [ ] 0.7 Freeze funds coupling semantics.
- [ ] 0.7 Check: `SimState.TotalFunds` is explicitly documented as canonical.
- [ ] 0.7 Check: all tool-flow docs require `ToolContext.funds` synchronization from canonical funds state.

- [ ] 0.8 Freeze save/load room semantics for local and DO-backed hosts.
- [ ] 0.8 Check: `load-city` semantics are explicitly “replace state in current room/session + emit snapshot”.
- [ ] 0.8 Check: “create new room/session” is documented as separate lifecycle behavior.

- [ ] 0.9 Create explicit delete plan for duplicate frontend protocol surfaces.
- [ ] 0.9 Check: plan names exact modules to delete once port is complete.
- [ ] 0.9 Check: plan states one surviving `/` gameplay route after convergence.

- [ ] 0.10 Record Stage 0 sign-off, then unblock Stage 1 implementation.
- [ ] 0.10 Check: all Stage 0 decisions are marked locked and referenced by later stages.
- [ ] 0.10 Check: no unresolved Stage 0 architecture questions remain.

### Stage 0 Decision Map

- [ ] Web runtime interface source:
- [ ] From `apps/web/src/game/core-host.ts`
- [ ] To `packages/core-bridge/src/core-host.ts`
- [ ] Web envelope type source:
- [ ] From `apps/web/src/game/runtime/protocol.ts`
- [ ] To `packages/core-bridge/src/types.ts`
- [ ] Web sequencing source:
- [ ] From local reducer-specific behavior
- [ ] To `packages/core-bridge/src/sequencing.ts` rules

### Stage 0 Exit Criteria

- [ ] Canonical bridge contract is selected and documented as the only runtime contract for upcoming web work.
- [ ] Single surviving UI surface (`/`) is selected and duplicate protocol surface deletion is planned.
- [ ] Snapshot/patch, resync, funds, and save/load semantics are fully locked.
- [ ] Stage 1+ can proceed without additional architecture decisions.

---

## Stage 1: Real sim-core Authority Host Skeleton

### Goal

- [ ] Replace Stage 4 deterministic command authority with a real sim-core-backed authority loop that owns `SimState`, `SimContext`, `ToolContext`, and ticking.

### C references to review

- [ ] `ref/micropolis/src/sim/w_sim.c` (command routing/bootstrap intent)
- [ ] `ref/micropolis/src/sim/s_sim.c` (`SimFrame`, `Simulate`, `DoSimInit`)
- [ ] `ref/micropolis/src/sim/s_init.c` (initialization/reset expectations)
- [ ] `ref/micropolis/src/sim/w_util.c` (speed/pause semantics)

### TS references to review

- [ ] `apps/web/src/game/host-factory.ts`
- [ ] `apps/web/src/game/local-host.ts`
- [ ] `apps/web/src/game/do-host.ts`
- [ ] `apps/web/src/game/runtime.ts`
- [ ] `packages/sim-core/src/core/sim-state.ts`
- [ ] `packages/sim-core/src/core/sim-context.ts`
- [ ] `packages/sim-core/src/sim/simulate.ts`
- [ ] `packages/sim-core/src/systems/init.ts`

### Implementation checklist

- [ ] Add a new Stage 4 authority module that creates and owns `MapStore + SimState + SimContext + ToolContext`.
- [ ] Implement host lifecycle (`connect`, `disconnect`, periodic tick loop, snapshot request support).
- [ ] Keep deterministic authority available only for isolated tests/fallback.
- [ ] Add host-factory flag/wiring to opt into the real authority path in web dev/runtime.
- [ ] Ensure handshake behavior remains compatible with existing runtime bootstrapping.

### Verification checklist

- [ ] `apps/web/src/game/host-factory.test.ts` still passes.
- [ ] `apps/web/src/game/runtime.test.ts` still passes.
- [ ] Stage 4 route boots successfully using the new authority path (not `DeterministicCommandAuthority`).

---

## Stage 2: Protocol + Runtime State Expansion (Authoritative Data Plane)

### Goal

- [ ] Move Stage 4 from placement-event projection to authoritative snapshot/patch game-state projection.

### C references to review

- [ ] `ref/micropolis/src/sim/s_scan.c` (`NewMap`, `NewMapFlags` semantics)
- [ ] `ref/micropolis/src/sim/sim.c` (`sim_update_maps` invalidation/clear cycle)
- [ ] `ref/micropolis/src/sim/w_update.c` (heads/date/funds/options)
- [ ] `ref/micropolis/src/sim/s_msg.c` (message port/dispatch semantics)

### TS references to review

- [ ] `apps/web/src/game/core-host.ts`
- [ ] `apps/web/src/game/runtime/protocol.ts`
- [ ] `apps/web/src/game/runtime/reducer.ts`
- [ ] `apps/web/src/game/runtime/map-state.ts`
- [ ] `apps/web/src/game/runtime/hud-state.ts`
- [ ] `apps/web/src/game/runtime/runtime.ts`

### Implementation checklist

- [ ] Extend host events/payloads to carry authoritative map snapshot/patch tile words.
- [ ] Extend payloads for HUD heads (funds/date/demand/speed/options) and message deltas.
- [ ] Add optional realtime object payload field now (can be empty until Stage 7).
- [ ] Keep strict ordering behavior (`serverSeq`, `tick`) and gap handling.
- [ ] Ensure snapshot replay can reconstruct map + HUD + messages deterministically.

### Verification checklist

- [ ] `apps/web/src/game/runtime/map-state.test.ts` covers snapshot+patch reconstruction.
- [ ] `apps/web/src/game/runtime/hud-state.test.ts` covers heads/message projection.
- [ ] `apps/web/src/game/runtime/reducer.test.ts` covers sequence drops/gap behavior.
- [ ] `apps/web/src/game/runtime.ordering-resync.test.ts` covers resync recovery with expanded payloads.

---

## Stage 3: Real Tool Semantics + Funds Coupling

### Goal

- [ ] Route Stage 4 tool commands through real sim-core tool application logic with Micropolis-like costs/rejects/map mutation.

### C references to review

- [ ] `ref/micropolis/src/sim/w_tool.c` (tool entrypoints, costs, size/offset)
- [ ] `ref/micropolis/src/sim/w_con.c` (lay road/rail/wire/bulldoze specifics)
- [ ] `ref/micropolis/src/sim/w_stubs.c` (`Spend`, `SetFunds` update behavior)
- [ ] `ref/micropolis/src/sim/s_zone.c` (zone mutation side effects)

### TS references to review

- [ ] `packages/sim-core/src/actions/tool-actions.ts`
- [ ] `packages/sim-core/src/systems/funds.ts`
- [ ] `packages/sim-core/src/systems/date-time.ts`
- [ ] `apps/web/src/game/runtime.command-lifecycle.test.ts`
- [ ] `apps/web/src/game/runtime.ts`

### Implementation checklist

- [ ] Replace occupancy-only acceptance/reject logic with `applyToolAction`-backed outcomes.
- [ ] Translate tool outcomes into stable host ack/reject codes/messages.
- [ ] Sync `ToolContext.funds` and `SimState.TotalFunds` in both success and failure paths.
- [ ] Ensure reject reasons include out-of-bounds/no-funds/invalid placement cases.
- [ ] Ensure tool footprint behavior (1x1 vs 3x3) aligns with C tool tables.

### Verification checklist

- [ ] `packages/sim-core/src/actions/tool-actions.test.ts` remains green.
- [ ] `packages/sim-core/src/actions/tool-actions.c-oracle.test.ts` remains green.
- [ ] `apps/web/src/game/runtime.command-lifecycle.test.ts` validates tool success+reject against authoritative state.
- [ ] Manual: road/rail/wire/bulldoze/R/C/I cost and placement behavior match expected Micropolis semantics.

---

## Stage 4: Stage 4 Map Rendering from Authoritative Tile Words

### Goal

- [ ] Replace Stage 4 placement-dot canvas with authoritative tile-map rendering.

### C references to review

- [ ] `ref/micropolis/src/sim/g_bigmap.c` (tile draw loops, `LOMASK` usage)
- [ ] `ref/micropolis/src/sim/g_map.c` (map-state draw modes)
- [ ] `ref/micropolis/src/sim/w_map.c` (map update ownership)
- [ ] `ref/micropolis/src/sim/g_ani.c` (tile animation masking)

### TS references to review

- [ ] `apps/web/src/routes/index.tsx`
- [ ] `apps/web/src/game/map/map-canvas.tsx`
- [ ] `apps/web/src/game/runtime/map-state.ts`
- [ ] `packages/sim-core/src/core/constants.ts`

### Implementation checklist

- [ ] Stage 4 panel reads and renders authoritative `RuntimeMapState`.
- [ ] Tile lookup masks map words with `TileMask.LOMASK` before sprite/debug lookup.
- [ ] Full redraw occurs on snapshot; patch redraw occurs only on dirty tiles/rects.
- [ ] Remove Stage 4 placement-only canvas from primary UI path.

### Verification checklist

- [ ] `apps/web/src/game/runtime/map-state.test.ts` verifies snapshot and patch draw modes.
- [ ] Manual: Stage 4 shows full map immediately after snapshot.
- [ ] Manual: patch updates no longer appear as random debug noise paint.

---

## Stage 5: HUD, Messages, and Sim Controls from Authoritative Hooks

### Goal

- [ ] Drive Stage 4 HUD/messages/speed from real sim-core hook outputs (`uiSet`, `sendMes`, `sendMesAt`, `tickCount`).

### C references to review

- [ ] `ref/micropolis/src/sim/w_update.c` (`DoUpdateHeads`, date/funds/options)
- [ ] `ref/micropolis/src/sim/s_msg.c` (`SendMes`, `SendMesAt`, `doMessage`)
- [ ] `ref/micropolis/src/sim/w_util.c` (`Pause`, `Resume`, `setSpeed`)

### TS references to review

- [ ] `packages/sim-core/src/core/sim-context.ts`
- [ ] `packages/sim-core/src/systems/date-time.ts`
- [ ] `packages/sim-core/src/systems/messages.ts`
- [ ] `apps/web/src/game/runtime/hud-state.ts`
- [ ] `apps/web/src/routes/index.tsx`
- [ ] `packages/sim-ui/IMPORTANT.md`

### Implementation checklist

- [ ] Wire `SimContext` hooks to host payload builders for HUD/message updates.
- [ ] Feed Stage 4 UI labels from authoritative HUD state only.
- [ ] Wire Stage 4 play/pause/speed controls to real sim speed state.
- [ ] Preserve message timing/expiry/requeue behavior expected by C message flow.

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
