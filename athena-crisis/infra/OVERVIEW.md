# Infra Package Overview

## Purpose and scope
The `infra/` package is a small build-and-test infrastructure layer for the monorepo. It does not contain game logic. Instead, it provides:
- Stable module aliases for assets (audio, sprite variants, image URLs) that can be swapped between open-source placeholders and internal/proprietary data.
- A shared Babel preset configuration for FBT/FBTee translations, with optional enum-manifest support.
- A small Vite dev-server helper used by tests.
- A repo-root helper and open-source detection.

This layer is intentionally thin but centralizes the "environment glue" needed by Vite/Vitest, tests, and (in the full repo) internal build pipelines.

## Structure
- `infra/createResolver.tsx`
  - Defines stable module IDs and resolves them to concrete files.
  - Handles open-source vs internal asset overrides.
- `infra/babelPresets.tsx`
  - Exports a shared Babel preset list wired to `@nkzw/babel-preset-fbtee` and translation enums.
- `infra/isOpenSource.tsx`
  - Detects whether internal files are present (open-source vs internal repo).
- `infra/root.ts`
  - Computes repo root path from the current file location.
- `infra/startServer.tsx`
  - Thin wrapper around Vite's dev server for test setups.
- `infra/assets/`
  - Static SVGs (sponsor/branding style assets). Not referenced in this open-source snapshot but kept with infra utilities.

## Core systems and data flows

### 1) Module aliasing + asset overrides (`createResolver`)
**Intent:** Decouple asset imports from their physical location and allow per-repo overrides.

**Key data structure:**
```ts
const mappings = new Map([
  ['athena-crisis:audio', join(root, 'ui/Audio')],
  ['athena-crisis:asset-variants', join(root, 'art/Variants')],
  ['athena-crisis:images', join(root, 'hera/render/Images')],
]);
```

**Resolution algorithm (data flow):**
1. Source code imports a stable logical module ID, e.g. `athena-crisis:audio`.
2. Vite/Vitest uses `resolve.alias` with the object returned by `createResolver()`.
3. `customResolver(id)` checks if the import ID is one of the three stable aliases.
4. It chooses the resolved file:
   - If `forceRemoteAudio` is true and `id === 'athena-crisis:audio'`, use the default `.tsx` file even if an internal override exists.
   - Otherwise, prefer a sibling `*.nkzw.tsx` file if it exists (internal/proprietary assets), else fall back to `*.tsx` (open-source placeholders or remote URLs).

**Why it matters:**
- Packages like `ui/`, `art/`, and `hera/` can import a stable logical module without knowing whether the build is open-source or internal.
- The `.nkzw.tsx` convention creates a clean override layer while keeping open-source files intact.

### 2) Open-source detection (`isOpenSource`)
**Intent:** Gate internal-only dependencies (like enum manifests) without breaking open-source builds.

**Algorithm:**
- Uses `process.cwd()` and checks for `art/Variants.nkzw.tsx`.
- If the file exists, it assumes an internal build (returns `false` for "open source").
- If the file is missing, it assumes open-source mode.

This is deliberately minimal: it only answers "internal assets present or not" and is used to decide whether missing build artifacts should be treated as an error.

### 3) Translation preset configuration (`babelPresets`)
**Intent:** Centralize Babel presets for FBT/FBTee translation tooling and optionally wire enum manifests.

**Data flow:**
1. `babelPresets.tsx` imports `fbtCommon` from `i18n/Common.ts`.
2. It attempts to load `ares/.enum_manifest.json` via dynamic ESM JSON import.
3. If the manifest is missing:
   - In open-source mode, it silently falls back to `{}`.
   - In internal mode, it throws an error (manifest is required for full builds).
4. The module exports a single preset entry: `[@nkzw/babel-preset-fbtee, options]`.

**Why it matters:**
- Ensures consistent translation tooling across test and app builds.
- Allows open-source builds to work without internal translation artifacts.

### 4) Repo root resolution (`root`)
**Intent:** Provide an absolute repo root that is stable regardless of the caller's current working directory.

**Mechanism:**
- Uses `import.meta.url` and `fileURLToPath` to get the file path, then walks up two directories.
- This is used by `createResolver` so aliases point at absolute files.

### 5) Dev-server helper (`startServer`)
**Intent:** Simplify starting and stopping a Vite dev server in tests and tooling.

**Data flow:**
1. Caller passes `{ name, port, root, silent }`.
2. `startServer` calls `createServer({ configFile, root, server: { port } })`.
3. The server is started via `server.listen()`.
4. Optionally logs the server name and URLs.
5. Returns the `ViteDevServer` instance so tests can `close()` it.

Used by `tests/viteServer.tsx` to host `tests/display.html` during Vitest/Playwright runs.

## Interfaces (public surface)
These functions are used by config and test harnesses; treat them as the "API" of the infra package.

- `createResolver(options?: { forceRemoteAudio?: boolean })`
  - Returns a Vite/Vitest alias object with `find`, `replacement`, and a `customResolver` function.
  - Expected to be passed into `resolve.alias` in Vite/Vitest configs.

- `babelPresets` (default export)
  - An async-resolved array of Babel preset entries: `[[preset, options]]`.
  - Designed to be consumed by `@vitejs/plugin-react` and other Babel pipelines.

- `isOpenSource()`
  - Returns `true` when internal override files are not present.
  - Used to decide whether missing manifests should error.

- `root` (default export)
  - Absolute filesystem path to repo root (string).

- `startServer({ name, port, root, silent? })`
  - Returns a `Promise<ViteDevServer>`.
  - Used by tests to manage a disposable Vite server.

## Interactions with other packages
- `tests/`:
  - `tests/vite.config.ts` consumes `infra/babelPresets` and `infra/createResolver` to build test UI bundles.
  - `tests/viteServer.tsx` uses `infra/startServer` to spin up a Vite dev server during Vitest global setup.
- Root `vitest.config.ts`:
  - Uses `infra/createResolver` so tests can import stable asset aliases.
- `ui/`, `art/`, `hera/`:
  - `createResolver` maps `athena-crisis:audio`, `athena-crisis:asset-variants`, and `athena-crisis:images` to these packages.
  - In open-source, these resolve to placeholder or remote-URL modules.
  - In internal builds, `.nkzw.tsx` overrides can supply proprietary assets without changing import sites.

## Porting and reuse notes
If re-implementing this package in another language or build system:
- Preserve the stable logical module IDs (e.g., `athena-crisis:audio`) and treat them as a public interface. This keeps feature packages decoupled from asset storage.
- Keep the override convention (`*.nkzw.*`) or equivalent. The key is a predictable "if override exists, use it" rule with a fallback to open-source defaults.
- Make the "open-source vs internal" detection explicit and cheap; it controls whether missing build artifacts are fatal or tolerated.
- The Babel preset module is effectively a configuration factory. Whatever build system you use should allow:
  - Injecting translation common data (`fbtCommon`).
  - Supplying an optional enum manifest with a clear error path for internal builds.
- The dev-server helper can be minimal: accept `root`, `port`, and a config file path; return a handle that tests can shut down cleanly.

In short, `infra/` is a thin compatibility layer that keeps the repo's build, test, and asset-resolution story consistent across open-source and internal builds.
