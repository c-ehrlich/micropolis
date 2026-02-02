# Athena Crisis Repository Overview

## Snapshot
- Open-core, TypeScript/React monorepo (pnpm workspaces). Core game logic, rendering, AI, and tools are here; game content (art, music, campaign) and some production apps/services are not.
- Primary stack: TypeScript (ESM), React 19, Vite, Vitest/Playwright, pnpm. Node >= 23 is required by `package.json`.
- The open-source core is organized as libraries (Athena, Apollo, Hera, etc.) that can be reused outside the full game app.

## Architecture at a glance

Core data flow (simplified):

- `athena/` defines the deterministic map model (tiles, units, buildings, players), rules, pathfinding, vision/fog, and serialization.
- `apollo/` defines the action/response system and game-state transitions on top of `athena/` (validate/apply actions, encode/decode, effects, objectives).
- `dionysus/` provides AI that reasons over `athena/` and `apollo/` data.
- `hermes/` layers in campaign data, turn-state encode/decode, and undo on top of `apollo/`/`athena/`.
- `hera/` is the client-side rendering/interaction engine (React) that visualizes `athena/` map state, consumes `apollo/` action responses, and drives UI/UX.
- `ui/` is a design system used by `hera/`, `docs/`, and (in the closed app) `ares/`.
- `art/` supplies sprite variant metadata and palette logic; actual art assets are not included.
- `docs/` is a documentation + playground site for exploring the above.

Dependency shape (high level):

- `athena` <- used by `apollo`, `dionysus`, `hermes`, `hera`, `art`, `ui`, `docs`.
- `apollo` <- used by `dionysus`, `hermes`, `hera`, `docs`.
- `hera` <- uses `ui`, `art`, `i18n` and consumes `apollo`/`athena`.
- `dionysus` <- uses `apollo`/`athena` for AI decision making.
- `hermes` <- uses `apollo`/`athena` for campaign and turn-state logic.

## Folder-by-folder inventory

Top-level configs and tooling
- `package.json`: root scripts, dev/test/build, Node/pnpm versions.
- `pnpm-workspace.yaml`: workspace layout and dependency overrides.
- `tsconfig.json`: TS config (ESM, strict, no emit).
- `eslint.config.js`, `prettier.config.js`: linting/formatting.
- `vitest.config.ts`: test setup; uses `infra/startServer` and Playwright.
- `pnpm-lock.yaml`: lockfile.

Open-source core packages
- `athena/`: core deterministic map model and rules.
  - `MapData.tsx`: main map state container and serialization.
  - `map/`: data types (Vector, Unit, Building, Player, Team), config, serialization.
  - `info/`: static game data (units, tiles, buildings, skills, factions, names).
  - `lib/`: algorithms/rules (pathfinding, damage, movement, economy, visibility).
  - `Radius.tsx`, `Vision.tsx`: movement radius/vision-fog logic.
  - `Objectives.tsx`: objective definitions/encoding.
  - `generator/`: procedural map generation.
  - `mutation/`: targeted mutation helpers (tile edits, lightning).
  - `message/`: map message types.
  - `invasions/`: invasion-related domain objects (e.g., crystals).
  - `__tests__/`: unit tests and benches.

- `apollo/`: game-state layer and action system on top of `athena/`.
  - `Action.tsx`, `ActionResponse.tsx`: discriminated unions for actions and their results.
  - `actions/`: apply/execute/validate actions and responses.
  - `Effects.tsx`, `Condition.tsx`, `Objective.tsx`: rules engine for effects and win conditions.
  - `GameState.tsx`, `Types.tsx`: game-state encoding and wire formats.
  - `lib/`: helpers for visibility, objectives, map resizing, hashing, etc.
  - `replay/`: replay encoding types.
  - `routes/`, `socket/`: typed route helpers and socket room IDs.
  - `action-mutators/`: small response mutators (e.g., rotate players for testing).
  - `ActionMap.json`, `ConditionMap.json`: stable IDs for codegen.

- `hera/`: client-side renderer/engine (React) and interaction system.
  - `Map.tsx`, `GameMap.tsx`, `Tiles.tsx`, `Unit.tsx`, `Building.tsx`: map rendering.
  - `render/`: sprite + tile rendering helpers.
  - `animations/`, `MapAnimations.tsx`: animation pipeline.
  - `behavior/`: user interaction behaviors (move, attack, build, heal, etc.).
  - `hooks/`: game-state and UI hooks.
  - `audio/`: music/sfx controls (wired to placeholder assets here).
  - `editor/`: map editor UI + resize tools.
  - `replay/`: replay viewer UI.
  - `workers/`: web worker for action execution (keeps UI responsive).
  - `i18n/`: client translation helpers.
  - `ui/`: game-specific UI widgets (action bars, dialogs, overlays).

- `ui/`: design system and shared UI primitives (buttons, dialogs, inputs, layout, icons).
  - Includes `Audio.tsx` with placeholder audio maps and UI styling helpers.

- `dionysus/`: AI engine and heuristics.
  - `BaseAI.tsx`, `AIRegistry.tsx`, `DionysusAlpha.tsx`: AI strategy scaffolding.
  - `lib/`: heuristics (path to target, attack eval, objective scoring).

- `hermes/`: campaign and turn-state helpers.
  - `game/`: turn-state encode/decode, undo, and client shaping.
  - `map-fixtures/`: example maps.
  - `messages/`: message templating utilities.
  - `toCampaign.tsx`, `validateCampaign.tsx`: campaign conversion and validation.

- `art/`: asset metadata and sprite variants.
  - `Variants.tsx`, `Sprites.tsx`, `AssetInfo.tsx`: sprite/palette metadata.
  - Note: actual art assets are not included in this repo.

- `i18n/`: language list + shared translation file stubs.

- `docs/`: documentation + playground site using `vocs`.
  - `content/pages/**`: MDX docs.
  - `content/examples/**`: interactive examples.
  - `content/playground/**`: demo components.

Supporting tooling
- `codegen/`: code generation for actions, GraphQL, translations, routes.
  - Generates files like `apollo/EncodedActions.tsx` and `apollo/Routes.tsx` in full repo.
- `tests/`: Vitest + Playwright integration tests, snapshot tools, test harness server.
- `infra/`: Vite helper utilities and module resolvers.
- `offline/`: offline splash page (single-page Vite build) and placeholder assets.
- `eslint-plugin/`: custom lint rules.
- `patches/`: dependency patches (howler, cordova-plugin-purchase, etc.).
- `git-hooks/`: pre-commit formatting hook.
- `@types/`: local type overrides (Vitest).

Open-core placeholders (present but mostly empty in OSS repo)
- `ares/`: main client app (React/Relay/Capacitor/PWA/Stripe/Sentry/socket.io), but source is not present.
- `artemis/`: backend server (Express/GraphQL/Prisma/Redis/S3/etc.), but source is not present.
- `deimos/`, `zeus/`, `fixtures/`, `scripts/`: package stubs without source files.

## Reusable components/patterns for a city builder

High-value reuse candidates (with file entry points):
- Deterministic map state + serialization: `athena/MapData.tsx`, `athena/map/PlainMap.tsx`, `athena/map/Serialization.tsx`.
- Immutable/persistent data patterns: extensive use of `ImmutableMap` (fast diffing, undo, replay).
- Tile-based pathfinding and radius queries: `athena/Radius.tsx`, `athena/lib/getMovementPath.tsx`, `athena/lib/getVectorRadius.tsx`.
- Visibility/fog-of-war mechanics (if you want exploration mechanics): `athena/Vision.tsx`.
- Action/response modeling for simulations and undo/replay: `apollo/Action.tsx`, `apollo/ActionResponse.tsx`, `apollo/actions/executeGameAction.tsx`, `apollo/GameState.tsx`.
- Rule-triggered effects system (scenario scripting): `apollo/Effects.tsx`, `apollo/Condition.tsx`.
- Objectives/goal system that can map to city builder milestones: `athena/Objectives.tsx`, `apollo/Objective.tsx`.
- Procedural map generation seed: `athena/generator/MapGenerator.tsx` (useful patterns even if you replace content).
- Map editor UI and resize tools: `hera/editor/MapEditor.tsx`, `hera/editor/ResizeHandle.tsx`.
- Web-worker offloading for simulation steps: `hera/workers/gameAction.tsx`.
- Replay/undo architecture: `apollo/replay/`, `hera/replay/`, `hermes/game/undo.tsx`.
- UI primitives and layout: `ui/` components (dialogs, menus, form controls, layout).
- AI heuristics (path selection, attack evaluation): `dionysus/` (adapt to city agent behaviors).
- Testing harness for map-based state and UI snapshots: `tests/`.

Where adaptation is likely needed:
- The core logic assumes a turn-based, discrete action model. A real-time city sim would likely need a continuous tick loop or event queue (you could still reuse the action/response pattern for discrete build actions).
- Units/buildings/tiles are wargame-specific; you would replace `athena/info/**` with city sim data.

## Open-core gaps and missing/generated files

Expected but missing in this repo (by design):
- App/server sources for `ares/` and `artemis/`.
- Many build scripts (e.g., `scripts/variant-loader.js`, `scripts/build-assets.tsx`).
- Generated files like `apollo/EncodedActions.tsx`, `apollo/FormatActions.tsx`, and `apollo/Routes.tsx` (produced by `pnpm codegen` in the full repo).
- Art/audio assets are referenced but replaced with placeholders (see `art/Variants.tsx`, `ui/Audio.tsx`).

## Suggested exploration path (if you are onboarding quickly)

1. `athena/MapData.tsx` and `athena/map/*` to understand the core state model.
2. `apollo/Action.tsx` + `apollo/actions/executeGameAction.tsx` to see how state transitions happen.
3. `hera/Map.tsx`, `hera/GameMap.tsx`, `hera/render/*` for rendering pipeline.
4. `hera/editor/*` for map editor patterns.
5. `dionysus/*` for AI patterns and heuristics.
