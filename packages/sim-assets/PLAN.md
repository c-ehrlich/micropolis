# `@city/sim-assets` Execution Checklist

Use this as an agent runbook: do one unchecked task, verify it, check it off, repeat.

## Strategy Decision
- [x] Keep Micropolis source assets (`ref/micropolis`) as canonical source-of-truth.
- [x] Generate PNG assets as derived build artifacts for runtime/UI ergonomics.
- [x] Do not replace canonical source assets with PNG/BMP as the primary truth.

## Current Package Audit (2026-02-07)

### Already implemented and still makes sense
- [x] Module skeleton exists (`catalog`, `resource-roots`, `resource-loader`, `string-table`, `tiles`, `sprites`, `ui-bitmaps`, `sounds`, `help-docs`, `legacy`).
- [x] Stable package exports exist in `src/index.ts`.
- [x] Core constants/helpers exist for tile counts, sprite frame counts, sound normalization, and bitmap missing-set classification.
- [x] Existing direction is correct: typed metadata-first API with C/Tcl parity JSDoc.

### Implemented but incomplete
- [ ] `resource-loader.ts` currently formats paths and cache keys but does not yet load bytes from disk or cache file contents.
- [ ] `string-table.ts` parsing exists but has no parity tests against `stri.*` fixtures yet.
- [ ] `tiles.ts` header parser exists but has no fixture-based parity tests yet.
- [ ] `help-docs.ts` currently has filename helper types only; no `help.tcl`/`manual` inventory implementation yet.
- [ ] `catalog.ts` composition exists, but currently depends on caller-provided data (no generated manifests yet).

### Missing package infrastructure
- [ ] No `scripts/gen-assets-manifest.mjs` yet.
- [ ] No `scripts/verify-assets-parity.mjs` yet.
- [ ] No `src/generated/` manifests yet.
- [ ] No `sim-assets` test files yet.
- [ ] `TODO.md` still says this package is a stub and must be updated.

## Locked Source References
- [x] `ref/micropolis/spec/resources/SPEC.md`
- [x] `ref/micropolis/src/sim/w_resrc.c`
- [x] `ref/micropolis/src/sim/g_setup.c`
- [x] `ref/micropolis/src/sim/sim.c`
- [x] `ref/micropolis/src/sim/s_fileio.c`
- [x] `ref/micropolis/src/sim/s_msg.c`
- [x] `ref/micropolis/src/sim/w_tool.c`
- [x] `ref/micropolis/res/micropolis.tcl`
- [x] `ref/micropolis/res/help.tcl`
- [x] `ref/micropolis/micropolisactivity.py`

## Invariants To Enforce in Tests
- [ ] `TILE_COUNT === 960`
- [ ] `tiles.xpm` header: `16 15360 14 1`
- [ ] `tilesbw.xpm` header: `16 15360 2 1`
- [ ] `tilessm.xpm` header: `4 2880 14 1`
- [ ] `stri` line counts: 202=20, 219=27, 301=64, 356=19
- [ ] `snro.111..888` each size: 27120 bytes
- [ ] sprite frame counts: 1:5, 2:8, 3:11, 4:8, 5:16, 6:3, 7:6, 8:4
- [ ] known missing Tcl bitmap refs remain explicit: `micropolisl`, `splashscreen`

## Phase 1: Close Skeleton Gaps

### P1.1 Update stale package docs
- [x] Replace `packages/sim-assets/TODO.md` stub text with current package intent and link to this plan.

Verification:
- [x] `pnpm -C /Users/cje/dev/city/packages/sim-assets typecheck`

### P1.2 Add package test harness
- [x] Add `vitest` config for `sim-assets`.
- [x] Add `test` script in `packages/sim-assets/package.json`.
- [x] Add first smoke test for package exports.

Verification:
- [x] `pnpm -C /Users/cje/dev/city/packages/sim-assets test`

## Phase 2: Canonical Manifest Generation

### P2.1 Add generator script
- [x] Create `packages/sim-assets/scripts/gen-assets-manifest.mjs`.
- [ ] Scan canonical inputs under `ref/micropolis/{res,images,manual}`.
- [ ] Emit deterministic generated files under `packages/sim-assets/src/generated/`.

Verification:
- [ ] Generator runs successfully.
- [ ] Re-run generator produces no diff.

### P2.2 Add parity verifier
- [ ] Create `packages/sim-assets/scripts/verify-assets-parity.mjs`.
- [ ] Assert all locked invariants and known-missing sets.

Verification:
- [ ] Verifier exits 0 on current reference assets.

## Phase 3: Complete Runtime Helpers

### P3.1 Implement file-backed resource loader
- [ ] Extend `resource-loader.ts` with filesystem read API (full-file read).
- [ ] Cache payload by `(type,id)` key to mirror C lifetime cache semantics.
- [ ] Return deterministic error shape for missing resource files.

Verification:
- [ ] Add `resource-loader.test.ts` with cache hit/miss and missing-file assertions.

### P3.2 Harden string-table parity
- [ ] Ensure parser/lookup semantics are documented against `GetIndString` behavior.
- [ ] Add `string-table.test.ts` with fixture assertions for `stri.202/.219/.301/.356`.

Verification:
- [ ] String-table tests pass.

### P3.3 Harden tile and sprite parity
- [ ] Add `tiles.test.ts` reading actual XPM headers from canonical assets.
- [ ] Add `sprites.test.ts` verifying frame manifests against discovered `obj*-*.xpm` files.

Verification:
- [ ] Tile and sprite tests pass.

### P3.4 Build help catalog implementation
- [ ] Implement `help-docs` inventory builders (help ids, manual html ids, missing/extra sets).
- [ ] Add `help-docs.test.ts` with deterministic missing/extra assertions.

Verification:
- [ ] Help-doc tests pass.

## Phase 4: Derived PNG Export Pipeline

### P4.1 Define derived-image output contract
- [ ] Add output directory convention (for example `packages/sim-assets/generated-images/`).
- [ ] Define manifest mapping canonical source path -> derived PNG path.

Verification:
- [ ] Contract documented in package README.

### P4.2 Implement conversion script
- [ ] Add `packages/sim-assets/scripts/export-derived-images.mjs`.
- [ ] Convert required XPM assets to PNG.
- [ ] Keep conversion deterministic and idempotent.

Verification:
- [ ] Export script runs cleanly.
- [ ] Second run yields no diff.

### P4.3 Enforce canonical/derived separation
- [ ] Ensure runtime metadata always points to canonical identity keys.
- [ ] Ensure derived PNG paths are optional overlays, not replacements for canonical IDs.

Verification:
- [ ] Add tests proving canonical IDs remain stable regardless of derived export.

## Phase 5: Integration Hooks

### P5.1 `sim-io` integration
- [ ] Export helpers for scenario/resource resolution to avoid duplicate constants in `sim-io`.

Verification:
- [ ] `sim-io` typecheck passes with helper usage.

### P5.2 `sim-ui` integration
- [ ] Export helpers for tool icons, string resources, sound token mapping, and help docs.
- [ ] Support canonical asset key + optional derived PNG path lookup.

Verification:
- [ ] `sim-ui` typecheck passes with helper usage.

## Phase 6: CI Drift Gates

### P6.1 Add manifest drift gate
- [ ] Add script/check that regenerates manifests and fails on diff.

Verification:
- [ ] Intentional stale manifest causes failure.

### P6.2 Add derived-image drift gate
- [ ] Add check for deterministic derived PNG export output.

Verification:
- [ ] Intentional stale PNG set causes failure.

## Completion Criteria
- [ ] All tasks above are checked.
- [ ] Repo gates pass: `pnpm typecheck`, `pnpm lint`, `pnpm format`.
- [ ] `git status` shows only intended changes.

## Execution Log
- [x] 2026-02-07: Audited current `sim-assets` state. Conclusion: existing module skeleton is directionally correct and should be retained; next work is generator/tests/resource-loader completion plus derived PNG export pipeline.
- [x] 2026-02-07: Completed P1.1 by replacing `TODO.md` stub with package intent + `PLAN.md` link; verified with package typecheck.
- [x] 2026-02-07: Completed P1.2 task to add `vitest` config for `sim-assets` by creating `packages/sim-assets/vitest.config.ts`.
- [x] 2026-02-07: Completed P1.2 task to add `test` script in `packages/sim-assets/package.json`.
- [x] 2026-02-07: Completed P1.2 smoke-test task by adding `src/index.test.ts`; verified with `pnpm -C packages/sim-assets test`.
- [x] 2026-02-07: Completed P2.1 task to create `packages/sim-assets/scripts/gen-assets-manifest.mjs`; generator now scans canonical `ref/micropolis/{res,images,manual}` and emits deterministic `src/generated/assets-manifest.ts`.
