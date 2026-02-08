# Stage 2 LocalHost Operation Notes

## Purpose

This runbook documents how to run, play, and test the Stage 2 Simple UI in `apps/web` using the in-process `LocalHost` path (`DemoMapHost`).

Stage 2 behavior mirrors Micropolis editor/update intent in:

- `ref/micropolis/src/sim/w_editor.c`
- `ref/micropolis/src/sim/w_tool.c`
- `ref/micropolis/src/sim/w_update.c`
- `ref/micropolis/src/sim/s_fileio.c`

Differences are listed in [Known limitations before DoHost](#known-limitations-before-dohost).

## Prerequisites

- Node.js `>=24`
- pnpm `>=10.28.0`
- workspace dependencies installed (`pnpm install`)

## Run LocalHost Stage 2 UI

1. Start the web app:
   ```bash
   pnpm --filter @city/web dev
   ```
2. Open the printed Vite URL (for example `http://127.0.0.1:4173/`).
3. Confirm the status row shows:
   - `phase=ready`
   - increasing `seq` and `tick` over time

## Playable Smoke Flow (Manual)

1. Click `New City` and confirm HUD funds reset to `$20,000`.
2. Select `Road`, click a tile on the map, and verify:
   - tile color changes
   - funds decrease (`$19,990` after one road placement in Stage 2 demo path)
3. Use `Pause`, `Play`, and `x1/x2/x3` controls and verify HUD speed updates.
4. Click `Save .cty` and confirm the browser downloads a city file.
5. Click `Load .cty`, select the saved file, and verify map/HUD state restores.
6. Choose a scenario and click `Start Scenario` to confirm scenario snapshot bootstrap.
7. Click `Reconnect` and `Resync Snapshot` to validate reconnect/resync UX paths.

## Automated Checks

Run web-scope checks only:

```bash
pnpm --filter @city/web test
pnpm --filter @city/web typecheck
```

## Troubleshooting

- Symptom: controls stay disabled.
  Check the phase banner. Controls are enabled only when `phase=ready`.

- Symptom: `phase=failed` after startup.
  This indicates hello negotiation rejection (room/client/protocol mismatch path). Re-run and confirm defaults are unchanged (`roomId=local-room`, `clientId=local-client`).

- Symptom: UI enters `resyncing`.
  This is expected when ordered envelope continuity is broken or when `Resync Snapshot` is clicked. Wait for the next authoritative `snapshot`; pending tool overlays are cleared intentionally during resync.

- Symptom: `Load .cty` appears to do nothing.
  Confirm a file was selected and readable by the browser. The UI shows `Failed to read selected city file.` for local file-read failures.

- Symptom: save download does not appear.
  Check browser download permissions/pop-up restrictions for the current site and retry `Save .cty`.

## Known Limitations Before DoHost

- Stage 2 uses scripted `DemoMapHost` authority, not full `sim-core` orchestration; map/HUD updates are deterministic but simplified for UI integration.
- Tool interaction is click-to-place only. Micropolis editor surfaces in `w_editor.c` include richer pointer lifecycle commands (`ToolDown`/`ToolDrag`/`ToolUp`) that are not fully reproduced in Stage 2.
- Map rendering is debug-tile color output (synthetic tile IDs), not final Micropolis visual/art parity.
- Local mode is single-process, single-room deterministic defaults (`local-room`, `local-client`); multi-client presence and remote transport behavior are deferred to DoHost stages.
- City save/load in Stage 2 browser flow uses in-memory byte payload transfer plus browser download/upload, instead of direct filesystem calls from C runtime paths.

## Command Verification Record (2026-02-08)

The following commands were executed in this workspace and succeeded:

- `pnpm --filter @city/web dev --host 127.0.0.1 --port 4173` (server reached Vite "ready" state)
- `pnpm --filter @city/web test`
- `pnpm --filter @city/web typecheck`
