# Stage 4 Playable Sign-Off and Release Checklist

Date: 2026-02-08
Stage: 4.7 (Glue and Playable)

## Final Acceptance Report

Release decision: Go for the playable milestone, with one accepted medium-severity limitation.

Scope of this sign-off:
- Protocol/handshake lockstep.
- LocalHost vs DoHost parity at runtime boundaries.
- Core playable gameplay command flows.
- Save/load/scenario behavior in integrated runtime.
- Test and stability evidence readiness.

Micropolis parity anchors used for this sign-off:
- `ref/micropolis/spec/integration/SPEC.md`
- `ref/micropolis/src/sim/w_sim.c`
- `ref/micropolis/src/sim/w_tool.c`
- `ref/micropolis/src/sim/s_fileio.c`
- `ref/micropolis/src/sim/w_map.c`
- `ref/micropolis/src/sim/g_map.c`

## Go/No-Go Criteria

Go requires all of the following:
- Protocol handshake/version mismatch behavior is deterministic and host-mode equivalent.
- Host switchability preserves command lifecycle and ordering/resync invariants.
- Core gameplay command flows (success/reject/idempotent retry) are playable and deterministic.
- Persistence flows (save/load/scenario) remain stable across host modes.
- No open Severity 1 or Severity 2 defects for Stage 4 playable scope.

No-Go if any of the following occur:
- A handshake or ordering invariant fails in either host mode.
- Authoritative state diverges between LocalHost and DoHost for the same command stream.
- Persistence round-trip or scenario bootstrap breaks for integrated runtime paths.
- Any unowned Severity 1 or Severity 2 issue is discovered in playable scope.

## Exit Criteria Evidence Matrix

| Area | Status | Evidence |
| --- | --- | --- |
| Host switching works without UI architecture changes | Pass | `apps/web/src/game/host-factory.test.ts` (mode resolution and runtime lifecycle parity), `STAGE_4_GLUE_AND_PLAYABLE_PLAN.md` execution log entries for 4.1/4.2/4.3 |
| Core playable flows pass in LocalHost and validated DoHost paths | Pass | `apps/web/src/game/runtime.command-lifecycle.test.ts` (success/reject/idempotent retry matrix), `apps/web/src/game/runtime.test.ts` (host-mode handshake-ready path) |
| Handshake, ordering, idempotency, and resync invariants are validated | Pass | `apps/web/src/game/runtime.test.ts` (hello mismatch diagnostics), `apps/web/src/game/runtime.ordering-resync.test.ts` (same-tick ordering, stale-drop, gap-resync, reconnect replay) |
| Save/load/scenario behavior remains stable in integrated product | Pass with limitation | `apps/web/src/game/runtime.persistence.test.ts` (local/do matrix for save-load and scenario flow), `STAGE_4_GLUE_AND_PLAYABLE_PLAN.md` execution log entry for 4.5 |
| Performance/stability for practical play sessions | Pass | `STAGE_4_PERFORMANCE_AND_STABILITY_NOTES.md` (pre/post metrics and 4096-tick soak outcome) |
| Stage task completion/test evidence tracking | Pass | `STAGE_4_GLUE_AND_PLAYABLE_PLAN.md` execution log entries for 4.1 through 4.7 |

## Known Issues

| ID | Issue | Severity | Owner | Blocking for Playable Sign-Off |
| --- | --- | --- | --- | --- |
| S4-001 | Host shims do not yet persist authoritative event history across sessions; persistence validation currently runs through shared `sim-io` orchestration while host mode is connected. | S3 (Medium) | Runtime/Host integration (`apps/web` runtime + `packages/sim-integration` persistence track) | No |

Evidence for S4-001:
- `apps/web/src/game/runtime.persistence.test.ts`
- `STAGE_4_GLUE_AND_PLAYABLE_PLAN.md` execution log entry for task 4.5

## Sign-Off Result

Result: Go.

Rationale:
- Stage 4 exit criteria have linked evidence across protocol, parity, gameplay, persistence, and stability.
- Remaining issue S4-001 is medium severity, has an owner, and does not block the playable milestone definition.
