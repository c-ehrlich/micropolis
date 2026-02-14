# `apps/web/src/routes/index.tsx` Refactor Audit

## Findings (Highest Risk First)

1. `Escape` can close the load dialog while loading is in progress.
   - Reference: `apps/web/src/routes/index.tsx:442`
   - The global key handler unconditionally calls `setGameDialog(null)`.
   - Backdrop close is already guarded during load at `apps/web/src/routes/index.tsx:1581`.
   - Recommendation: apply the same `isLoadingCityFile` guard in the global `Escape` handler.

2. Floating-window drag bounds are hardcoded and do not match actual window sizes.
   - References:
   - `apps/web/src/routes/index.tsx:469`
   - `apps/web/src/routes/index.tsx:470`
   - Clamp uses fixed `220x120`, but floating windows are wider (`apps/web/src/routes/index.tsx:1148`, `apps/web/src/routes/index.tsx:1318`, `apps/web/src/routes/index.tsx:1427`).
   - Recommendation: clamp using measured dragged-window dimensions so windows remain reachable.

3. Tests are mostly source-text assertions instead of behavior tests.
   - Reference: `apps/web/src/routes/index.test.tsx:62`
   - Current tests rely heavily on `readFileSync(...).toContain(...)`, which is brittle under refactors.
   - Recommendation: add interaction-level tests for menu/dialog flows, drag/clamp behavior, and budget reset/cancel command behavior.

4. Too many concerns live in one route component.
   - Reference: `apps/web/src/routes/index.tsx`
   - The file is ~1838 lines, with 24 local `useState` declarations and 17 inline `runtime.sendCommand(...)` call sites.
   - Recommendation: split orchestration/state management from JSX sections first, then cleanup.

5. Constant/style duplication across files risks drift.
   - References:
   - Graph/color constants are duplicated in `apps/web/src/routes/index.tsx:124` and `apps/web/src/features/playable-runtime/presentation/runtime-panel-components.tsx:12`.
   - Message-surface chrome classes are duplicated in `apps/web/src/routes/index.tsx:132` and `apps/web/src/features/playable-runtime/presentation/runtime-panel-components.tsx:20`.
   - Recommendation: move shared runtime-panel constants/styles into one module.

## Recommended Refactor Order

1. Extract a runtime orchestration hook (`useRuntimePanelController`).
   - Move host/runtime connection lifecycle, subscription handling, phase flags, command helpers, and dialog/menu state.

2. Extract focused UI sections into components.
   - Candidate split: `TopBar`, `Sidebar`, `FloatingWindows` (budget/evaluation/graph), `GameDialogs`, `BrandDialog`.

3. Add typed command-dispatch helpers.
   - Replace repeated `runtime.sendCommand(nextCommandId(...), ...)` patterns with local helpers (for `sim-control`, `city-io`, `scenario`).

4. Consolidate duplicated constants/styles.
   - Create a shared `runtime-panel.constants.ts` module for graph masks/series and shared chrome class constants.

5. Add behavior tests before/during extraction.
   - Prioritize user-observable flows to lock behavior while internals move.

