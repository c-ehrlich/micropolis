# tests/ package overview

## Purpose
The `tests/` package is the integration and visual regression harness for Athena Crisis. It exercises the full game pipeline end-to-end:
- server-side action execution and effects (`apollo` + `athena`)
- AI decision-making (`dionysus`)
- client-facing encoding/decoding of action responses (`apollo` encode/decode + fog/visibility)
- rendering correctness via headless Chromium and image snapshots (`hera` + `ui`)

The goal is to validate gameplay rules and ensure the client can reproduce server state from encoded responses, while also locking in visual output for maps, units, buildings, decorators, and fog behavior.

## How it runs (test harness)
The root `vitest.config.ts` wires the package into the overall test runner:
- **Global setup**: `tests/viteServer.tsx` starts a Vite dev server for rendering, and `tests/playwrightServer.tsx` launches Playwright's Chromium server.
- **Setup file**: `tests/setup.tsx` installs the `toMatchImageSnapshot` matcher with SSIM comparison.
- **Module resolution**: `tests/vite.config.ts` mirrors app bundling (React, Emotion, custom resolver) so tests render the same component tree as the game UI.

## Core data structures and interfaces
These are the primary interfaces that tests build and validate:
- **`MapData`** (`@deities/athena/MapData.tsx`): deterministic game state container for tiles, units, buildings, teams/players, config, and decorators. Most tests create maps via `MapData.createMap(...)` and then apply `withModifiers(...)` to normalize map state (e.g., derived modifiers).
- **`Actions`** (`@deities/apollo/Action.tsx`): a list of action objects. Tests typically construct actions via `@deities/apollo/action-mutators/ActionMutators.tsx` to avoid manually building the union types.
- **`ActionResponse`** (`@deities/apollo/ActionResponse.tsx`): the authoritative response for a single action.
- **`GameState`** (`@deities/apollo/Types.tsx`): ordered list of `[ActionResponse, MapData]` entries. This is the server-side timeline.
- **`Effects`** (`@deities/apollo/Effects.tsx`): map from trigger name to a set of scripted effects that inject actions (used heavily in tests for triggers and chain reactions).
- **`EncodedGameActionResponse`** (`@deities/apollo/Types.tsx`): the client payload containing encoded action responses plus optional per-step visible entities (units/buildings). Tests validate that encoded responses can be decoded and replayed to match server state under fog.

## Key utilities in this package

### `tests/executeGameActions.tsx`
The main server-side test executor. It:
- Iterates through a list of `Actions`.
- Calls `executeGameAction` with the current map, current player's `Vision`, `Effects`, and the `AIRegistry`.
- Builds a `GameState` timeline (`[ActionResponse, MapData]` entries).
- Finalizes end-of-game transitions using `@deities/hermes/game/onGameEnd.tsx`.
- Returns:
  1) `GameState`
  2) an `EncodedGameActionResponse` using `encodeGameActionResponse`
  3) updated `Effects`

This mirrors the production action pipeline and is the backbone of most logic tests.

### `tests/snapshotGameState.tsx`
Formats the server timeline into a human-readable string using `formatActionResponses`. Tests snapshot this text to lock down logic outcomes without rendering.

### `tests/snapshotEncodedActionResponse.tsx`
Decodes the client payload (`EncodedGameActionResponse`) back into action responses, formats them, and snapshots the result. This verifies:
- encoding/decoding stability
- fog/hidden action behavior
- client-visible action filtering

### `tests/screenshot.tsx`
Playwright-powered screenshot pipeline.
- Builds a URL for `display.html` with query params:
  - `map[]` for serialized `MapData`
  - `viewer[]` for current viewer user IDs
  - `gameActionResponse[]` for encoded responses to replay
- Uses a shared Chromium instance and keeps a single `Page` open to avoid repeated navigation.
- Waits for `window.MapHasRendered` when game actions are replayed.
- Returns `Buffer` screenshots for Jest image snapshots.

### `tests/printGameState.tsx`
Debugging helper that prints the formatted `ActionResponse` and a terminal preview image (via `term-img`). Used in tests that fail or when a visual snapshot is inspected.

### `tests/setup.tsx`
Installs `jest-image-snapshot` into Vitest with:
- SSIM comparison
- deterministic snapshot identifiers
- a 1% failure threshold

## Rendering + screenshot pipeline
The visual testing path mirrors the production renderer and is designed to be deterministic:
1. **Vite server** (`tests/viteServer.tsx`) serves `tests/display.html` and `tests/display.tsx`.
2. **Renderer entry** (`tests/display.tsx`) mounts a `GameMap` from `@deities/hera` with:
   - `NullBehavior` to disable user input
   - Instant animation settings (`InstantAnimationConfig`)
   - `LocaleContext` and `VisibilityStateContext` to match runtime
   - audio disabled (`AudioPlayer.pause`) for Playwright stability
3. **Action replay**: `display.tsx` parses query params, decodes action responses via `decodeGameActionResponse`, dispatches `action` events, and waits for `actionsProcessed`.
4. **Playwright** (`tests/screenshot.tsx`) captures each map container (`data-testid="map-${index}"`) and compares against `__image_snapshots__/`.

## Interaction with other packages
The tests package is a cross-package integration point:
- **`@deities/athena`**: source of all map, unit, building, tile, player, and vision data. Tests validate pathfinding, fog rules, stats tracking, map generation, and config modifiers.
- **`@deities/apollo`**: action validation/execution (`executeGameAction`), action/response encoding, hidden/visible response logic, and effects system.
- **`@deities/hera`**: rendering engine (`GameMap`) used for visual tests.
- **`@deities/dionysus`**: AI registry and behaviors used by AI tests (e.g., `AIBehavior`, `AITransportMove`, `HaltingProblem`).
- **`@deities/hermes`**: game-end processing (`onGameEnd`) for full-turn sequences.
- **`@deities/ui`**: CSS setup, vars, audio stubs, and animation sync settings used by the renderer.
- **`infra/`**: Vite server helpers and module resolver used to serve the rendering entry.

## Test suite themes (by system)
The `tests/__tests__/` directory is organized by behavior, not by package. Major themes:
- **Action pipeline & rules**: `Move`, `Attack`, `Capture`, `EndTurn`, `CreateUnit`, `CreateBuilding`, `Swap`, `Unfold`, `Transport`, `Power`, `Reward`, `Rescue`.
- **Effects & objectives**: `Effects`, `Objective`, `CustomObjectives`, `Statistics` validate triggers, win conditions, and state updates.
- **Fog/visibility**: `Fog`, `FogMove`, `CreateUnitFog`, `CreateBuildingFog`, `HiddenAction`, `EntityLabel` ensure correct hidden action encoding and entity visibility.
- **AI behavior**: `AIBehavior`, `AITransportMove`, and `HaltingProblem` verify deterministic AI decisions, action sequences, and replay correctness.
- **Rendering/visual regression**: `Unit`, `Building`, `Decorators`, `Lightning`, `EntityLabel`, `Objective` compare captured images against snapshots.
- **Procedural generation**: `MapGenerator` validates random map generation and AI compatibility.

## Data flow summary (logic tests)
1. Build a `MapData` with `MapData.createMap(...)` and `withModifiers(...)`.
2. Construct a list of `Actions` with action mutators (e.g., `MoveAction`, `EndTurnAction`).
3. Execute with `executeGameActions(...)` to get `GameState` + `EncodedGameActionResponse`.
4. Snapshot formatted server responses (`snapshotGameState`) and client-visible responses (`snapshotEncodedActionResponse`).
5. Optionally validate client replay by decoding and applying responses under fog (see `HaltingProblem.test.tsx`).

## Data flow summary (visual tests)
1. Build or derive a `MapData`.
2. Capture with `captureOne`, `captureGameState`, or `captureGameActionResponse`.
3. Compare resulting screenshots to the `__image_snapshots__/` baseline using `toMatchImageSnapshot`.

## Recreating this package in another language
To port this package, preserve these key ideas:
- A **deterministic map model** (`MapData`) with explicit serialization.
- A **single action execution function** that returns `(ActionResponse, MapData, GameState)` and can be composed into timelines.
- A **client payload** format (`EncodedGameActionResponse`) that is derived from server responses and vision rules, and a **replay decoder** that can rebuild client state.
- A **headless renderer** that accepts serialized maps and action responses, plus a **browser automation layer** for screenshot comparison.
- A consistent **snapshot strategy**: text snapshots for logic, image snapshots for rendering.
