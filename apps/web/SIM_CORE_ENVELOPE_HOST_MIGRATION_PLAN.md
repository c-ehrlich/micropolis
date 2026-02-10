# Sim-Core Envelope Host Migration Plan

## Goal

Remove `DemoMapHost` from gameplay entirely and replace it with a sim-core-authoritative envelope host for route `/`, preserving Micropolis C behavior.

## Important

Use sim-core functionality where possible, we should not reimplement anything as this leads to drift / bugs.

## Migration Note

`DemoMapHost` is migration-frozen and must not receive new gameplay logic. Route `/` gameplay changes must be implemented in the sim-core envelope host path.

## Decision Locks (from 2026-02-10 clarification)

- Prioritize correctness over contract politics: eliminate demo-only behavior first.
- Fix stale path references: `SimCoreRuntimeState` lives at `apps/web/src/game/sim-core-runtime-state.ts`.
- Keep `createPlayableRuntimeHost(...)` options compatible during migration.
- Make manual disaster triggering host-agnostic (no `instanceof DemoMapHost`).
- Match C behavior for realtime seeding: do not force-seed copters if C does not.
- Keep realtime snapshot + deltas payload support for future server-hosted runtime.
- Scenario/tick/sequence decisions are implementation-owned in this plan.
- Update or remove tests that conflict with C parity.
- Retire demo-host tests progressively.
- End state: delete `DemoMapHost` and its gameplay-path dependencies.

## Scope

- In scope: route runtime host wiring, command handling, tool parity, map/HUD/realtime payload emission, save/load/scenario flows, migration tests, and `DemoMapHost` deletion.
- Out of scope: UI redesign, multiplayer transport redesign, breaking envelope contract changes that are not needed for parity.
- Out of scope: event-contract host runtime work in `apps/web/src/game/core-host.ts`; route `/` cutover is envelope-host-only for this migration.

## Execution Checklist

### Phase 0: Freeze Migration Boundaries

- [x] Add a migration note in this file that `DemoMapHost` must not receive new gameplay logic.
- [x] Confirm route `/` remains on envelope runtime contract (`apps/web/src/game/runtime/protocol.ts`) for this migration.
- [x] Record that event-contract host runtime (`apps/web/src/game/core-host.ts`) is not part of route `/` cutover scope.
- [x] Update stale path references from `apps/web/src/game/runtime/sim-core-runtime-state.ts` to `apps/web/src/game/sim-core-runtime-state.ts`.

Canonical `/` gameplay host path (migration lock):

- Route entrypoint: `apps/web/src/routes/index.tsx` (`createFileRoute('/')`).
- Host factory used by `/`: `createPlayableRuntimeHost(...)` from `apps/web/src/game/runtime/playable-runtime-host.ts`.
- Current concrete host returned by that factory during migration: `DemoMapHost`.
- Migration constraint: gameplay host changes for `/` must be implemented behind `createPlayableRuntimeHost(...)` and this plan's sim-core envelope-host cutover tasks, not through alternate route-specific host wiring.

Acceptance checks:

- [x] One canonical gameplay host path for `/` is documented.
- [x] No new gameplay behavior is added to `DemoMapHost`. (Migration-freeze lock reaffirmed on 2026-02-10.)

### Phase 1: Introduce Sim-Core Envelope Host (New Class)

- [x] Create `apps/web/src/game/runtime/sim-core-envelope-host.ts` implementing `CoreHost` from `apps/web/src/game/runtime/protocol.ts`.
- [x] Back it with authoritative state from `SimCoreRuntimeState`.
- [ ] Route `hello`, `command`, `request_snapshot`, and `disconnect` through one deterministic host lifecycle.
- [ ] Keep compatibility options currently exposed by `createPlayableRuntimeHost(...)` while migrating call sites/tests.
- [ ] Ensure no synthetic tile bootstrap path exists in the new host.

Acceptance checks:

- [ ] New host can serve valid `hello`, `ack`/`reject`, `patch`, and `snapshot` envelopes.
- [ ] New host has no dependency on `buildInitialDemoMapTiles` or demo custom placement functions.

### Phase 2: Command Semantics with C-Parity Decisions

- [ ] Implement tool commands via sim-core `applyToolAction` (no demo tile stamping).
- [ ] Support the full playable tool set currently exposed by route `/`.
- [ ] Keep canonical funds coupling: `SimState.TotalFunds` authoritative, `ToolContext.funds` synchronized before/after tool evaluation.
- [ ] Implement sim-control commands (`pause`, `play`, `set-speed`) with C-equivalent `setSpeed`/pause/resume behavior.
- [ ] Implement city lifecycle + IO commands (`new-city`, `save-city`, `load-city`) through `sim-io` helpers.
- [ ] Implement scenario loading via `loadScenarioLikeC` with async resource loading.

Scenario command settlement decision:

- [ ] Emit `ack` only after scenario bytes are loaded and applied successfully.
- [ ] Emit `reject` with `invalid-scenario-file` on load/decode failure.
- [ ] Emit fresh authoritative `snapshot` immediately after scenario `ack`.

Sequence/tick decision:

- [ ] Keep strictly monotonic `serverSeq` for every sequenced envelope.
- [ ] Keep non-regressing `tick` progression.
- [ ] On `request_snapshot`, clamp replay cursor to valid range and emit deterministic baseline + tail replay behavior expected by current runtime reducers.

Acceptance checks:

- [ ] Tool placement/reject semantics align with C parity references (`w_tool.c`, `w_con.c`).
- [ ] Save/load/scenario command flows round-trip deterministically.
- [ ] Command settlement ordering remains reducer-compatible and deterministic.

### Phase 3: Payload Semantics Port (Map/HUD/Messages/Realtime)

- [ ] Port authoritative snapshot map payload generation from sim-core map storage (x-major ordering using bridge index math).
- [ ] Port map patch deltas + redraw plan emission using sim-core invalidation planning (`planMapRedraw` / `consumeMapRedrawPlan`).
- [ ] Port HUD heads emission using sim-core hooks (`uiSet`) and `runUiUpdate`.
- [ ] Port message flow using hook-driven `sendMes`/`sendMesAt` capture with deterministic replay metadata.
- [ ] Port realtime payloads using sim-core realtime sprite hooks and include:
- [ ] `realtime.snapshot` (baseline stream).
- [ ] `realtime.deltas` (incremental stream).
- [ ] `realtime.objects` (compatibility full-object stream).
- [ ] Remove demo-only forced copter seeding behavior unless directly justified by C behavior.

Acceptance checks:

- [ ] Runtime reducers in `apps/web/src/game/runtime` consume new host payloads without schema regressions.
- [ ] Snapshot + replay reconstruct map/HUD/messages/realtime deterministically.
- [ ] Realtime overlays remain functional with snapshot + delta transport.

### Phase 4: Host-Agnostic Manual Disaster Interface

- [ ] Replace `triggerPlayableRuntimeDisaster` `instanceof DemoMapHost` coupling with a host capability interface/adapter.
- [ ] Implement manual disaster command path in new host using sim-core disaster/realtime systems.
- [ ] Keep `PLAYABLE_DISASTER_CHOICES` UI contract stable unless parity requires changes.

Acceptance checks:

- [ ] Manual disaster controls continue working on route `/` without `DemoMapHost`.
- [ ] Disaster-triggered message/realtime payload behavior remains C-parity-aligned.

### Phase 5: Route Cutover + Demo Host Deletion

- [ ] Change `createPlayableRuntimeHost()` to return the new sim-core envelope host.
- [ ] Remove `DemoMapHost` imports from gameplay-path modules.
- [ ] Migrate or delete tests that validate demo-only, non-parity behavior.
- [ ] Delete `apps/web/src/game/runtime/demo-map-host.ts`.
- [ ] Delete `apps/web/src/game/runtime/demo-map-host.test.ts` after equivalent/new parity coverage exists.
- [ ] Remove dead helpers tied to synthetic map bootstrap and demo custom tool logic.

Acceptance checks:

- [ ] No gameplay route imports `DemoMapHost`.
- [ ] Codebase no longer contains synthetic gameplay map bootstrap logic.
- [ ] Coverage remains for all gameplay-critical parity behaviors.

### Phase 6: Test and Verification Hardening

- [ ] Add/keep route-level tests proving initial map is authoritative sim-core output (not synthetic tiles).
- [ ] Add targeted crossing parity tests grounded in C behavior:
- [ ] Wire over valid straight roads succeeds (`w_con.c` `_LayWire` rules).
- [ ] Wire over unsupported road shapes rejects according to C paths.
- [ ] Verify save/load/scenario parity tests reference C constants where assertions use fixed values.
- [ ] Ensure any remaining runtime certification tests align to C behavior and delete non-parity expectations.

Required automated gates before handoff:

- [ ] `pnpm typecheck`
- [ ] `pnpm lint`
- [ ] `pnpm format`
- [ ] `pnpm --filter @city/web test -- src/game/runtime/playable-runtime-host.test.ts`
- [ ] Route runtime sequencing/persistence suites relevant to `/` gameplay path

## Risks and Mitigations

- [ ] Risk: dual host contracts can still drift during migration.
  Mitigation: keep route `/` migration isolated to envelope host path; avoid mixing event-contract logic into route host behavior.
- [ ] Risk: payload drift breaks runtime reducers.
  Mitigation: keep payload schema compatibility fields during migration and validate via existing reducer/runtime tests.
- [ ] Risk: scenario/save/load async ordering regressions.
  Mitigation: lock command settlement ordering in tests (ack/reject/snapshot sequence).

## Exit Criteria

- [ ] Route `/` uses only sim-core-authoritative envelope host logic.
- [ ] `DemoMapHost` is fully removed from repository gameplay code.
- [ ] Tool/map/HUD/message/realtime behavior is covered by parity-oriented tests.
- [ ] Required checks and route runtime tests pass.
