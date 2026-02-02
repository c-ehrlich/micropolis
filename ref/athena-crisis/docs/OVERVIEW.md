# Docs Package Overview

## Purpose

`docs/` is the documentation and playground site for Athena Crisis. It is a
Vocs-powered static site with React-based interactive demos that exercise the
core game libraries. The package serves two goals:

- Explain architecture and data structures via MDX content.
- Provide live, client-side playgrounds for MapData, actions, rendering, and the
  map editor without needing the full closed-source app.

In other words, it is both a **documentation site** and a **thin integration
layer** that composes `athena`, `apollo`, `hera`, `hermes`, `art`, and `ui` into
interactive examples.

## Package Entry Points

- `docs/package.json`
  - Scripts:
    - `pnpm --filter @deities/docs dev` runs `vocs dev --port 3003`.
    - `pnpm --filter @deities/docs build` runs `vocs build`.
    - `pnpm --filter @deities/docs preview` runs `vocs preview`.
  - Direct workspace dependencies: `@deities/athena`, `@deities/apollo`,
    `@deities/hera`, `@deities/hermes`, `@deities/art`, `@deities/ui`.

- `docs/vocs.config.tsx`
  - Defines site metadata, sidebar, top nav, base path (`/open-source`), and
    Vite/React build configuration.
  - Uses the monorepo Vite resolver from `infra/createResolver.tsx` and shared
    babel presets from `infra/babelPresets.tsx` to align build settings with the
    rest of the repo.
  - Loads Licht/Dunkel theme JSON for code blocks and configures the site font.

## Content Structure

`docs/content/` is the Vocs root directory (see `rootDir` in
`docs/vocs.config.tsx`).

- `docs/content/pages/` - MDX pages that make up the documentation site.
  - `index.mdx` is the landing page layout and embeds the demo game.
  - `getting-started.mdx` contains repository setup instructions.
  - `core-concepts/*` cover `MapData`, actions, immutability, and AI.
  - `ui/game-components.mdx` highlights the renderer architecture.
  - `playground/*` provides pages that embed the interactive demos.

- `docs/content/examples/` - Small React demo modules imported by MDX.
  - `map-data-examples.tsx` demonstrates creating and mutating `MapData`.
  - `map-editor.tsx` embeds the full `hera` map editor without a backend.
  - `entities-example.tsx` and `portraits-example.tsx` showcase rendering assets.

- `docs/content/playground/` - Client-only wrappers and live demo plumbing.
  - `ClientComponent.tsx` defers rendering to the client (no SSR) and shows a
    loading spinner while dynamically importing game UI.
  - `ClientScope.tsx` boots shared UI contexts, CSS variables, controls, and
    portals used by the game UI.
  - `PlaygroundGame.tsx` runs a fully interactive `GameMap` instance.
  - `PlaygroundDemoGame.tsx` picks a demo map/biome and renders it via
    `PlaygroundGame`.
  - `Image.tsx` supports light/dark themed images for docs content.

- `docs/content/public/` - Static assets (favicon, logo, fonts, screenshots).
- `docs/content/styles.css` - Global styles that tweak the Vocs layout and
  provide custom fonts for the landing page.

## Core Systems and Data Flow

### 1) Client-only rendering boundary

Vocs renders MDX pages, but interactive game components rely on browser-only
APIs (canvas, input handlers, portals). The docs package isolates those pieces:

- `ClientComponent.tsx`
  - `useEffect` dynamically imports `ClientScope.tsx` to avoid SSR.
  - Wraps demos in `Suspense` with a UI spinner from `@deities/ui`.

- `ClientScope.tsx`
  - Initializes CSS variables (`initializeCSSVariables`) and scoped UI styles.
  - Sets up input systems (`setupKeyboard`, `setupGamePad`, `setupHidePointer`).
  - Creates a `portal` root and `background` div in the document body.
  - Provides React context providers used by `hera` and `ui`:
    - `LocaleContext`, `ScaleContext`, `VisibilityStateContext`, `HideContext`,
      `AlertContext`.

This is the *bridge* that makes `hera` components renderable inside a static
site, and it is the template to reuse if this docs package were recreated in
another language/framework.

### 2) Interactive demo game flow

`PlaygroundGame.tsx` is the core sample game loop used by the landing page and
some examples:

1. **Sprites prepared:** `prepareSprites()` from `@deities/art` ensures the
   rendering pipeline has sprite metadata ready.
2. **Game state initialized:** `useClientGame(map, DemoViewer.id, effects, startAction)`
   from `@deities/hera` creates a local, client-side game state based on
   `MapData` and `MapMetadata` from `apollo`.
3. **Action dispatch:** `useClientGameAction(game, setGame)` produces an action
   dispatcher; it is passed into `GameMap` as `onAction`.
4. **Rendering:** `GameMap` (from `hera`) renders the map, and `GameActions` and
   `MapInfo` overlay UI for actions and status.
5. **Undo behavior:** `undo(type)` from `@deities/hermes` is wired into the demo
   UI; the demo forces a re-render key to reset animation state after undo.
6. **Visibility + pause:** `useInView` pauses updates when the demo is offscreen
   to keep docs lightweight.

This flow demonstrates the minimal integration required to host a playable map
in a documentation site.

### 3) Demo map selection + biome conversion

`PlaygroundDemoGame.tsx` illustrates how to adapt map fixtures for display:

- Uses `hermes/map-fixtures/demo-1` and `demo-2` as source maps and metadata.
- Randomizes a `Biome` and optional fog, then calls `convertBiome` from `athena`
  to re-skin the same `MapData` for visual variety.

The important interface is that `convertBiome` operates purely on `MapData`
without needing any server context, which is why it fits inside a docs site.

### 4) Map editor without a backend

`docs/content/examples/map-editor.tsx` embeds `hera/editor/MapEditor` and
implements a mock persistence layer in the URL:

- **Inputs/Outputs:** `MapEditor` expects and emits `MapCreateVariables` and
  `MapUpdateVariables` as well as a `MapObject` model.
- **Serialization:** `encodeEffects` from `apollo` and `map.toJSON()` from
  `MapData` produce serialized strings suitable for URL storage.
- **URL persistence:** The example writes the `MapObject` to `?map=...` and can
  rehydrate it on load via `decodeMapObject`.

This demonstrates how to host the full editor without any API surface, which is
useful for portability and for implementing offline tooling.

### 5) MapData example rendering

`map-data-examples.tsx` is a mini pipeline for the map data architecture:

- Creates a `MapData` via `MapData.createMap`.
- Applies tile modifiers with `withModifiers` to match renderer expectations.
- Uses `vec` to place `Unit` instances (from `athena/info/Unit.tsx`) onto the
  map.
- Renders the result through `PlaygroundGame`.

The example shows how the immutable map model flows directly into rendering
without additional adapters.

## Interfaces and Data Structures Used

The docs package is intentionally thin, but it exposes important interfaces from
other packages:

- `MapData` (`@deities/athena/MapData.tsx`)
  - Immutable, persistent map state used throughout all demos.

- `MapMetadata` (`@deities/apollo/MapMetadata.tsx`)
  - Holds metadata such as effects applied to a map; passed into the demo game
    loop.

- `MapObject`, `MapCreateVariables`, `MapUpdateVariables`
  (`@deities/hera/editor/Types.tsx`)
  - Defines the input/output contract for the editor demo, including map state,
    tags, slug, creator info, and effects.

- `UndoType` (`@deities/hermes/game/undo.tsx`)
  - Demonstrates undo integration for local games.

- `DemoViewer` (`@deities/hera/ui/lib/DemoViewer.tsx`)
  - A mock user profile used by playgrounds to supply player identity.

- `Biome` + `convertBiome` (`@deities/athena/map/Biome.tsx` and
  `@deities/athena/lib/convertBiome.tsx`)
  - The documented path for changing map visuals without changing gameplay.

## Interaction With Other Monorepo Packages

`docs/` is the primary integration surface for the open-core packages:

- **`athena`**
  - Supplies all immutable map state (`MapData`, `vec`, tile/unit info).
  - Provides visual transformations like `convertBiome` and map modifiers.

- **`apollo`**
  - Supplies map metadata and effects encoding used by demos and editor.
  - Used to demonstrate action architecture in MDX content.

- **`hera`**
  - Provides the renderer (`GameMap`, `MapInfo`, `GameActions`).
  - Provides editor UI and types (`MapEditor`, `MapObject`, etc.).
  - Provides shared UI contexts (`LocaleContext`) and demo user fixtures.

- **`hermes`**
  - Provides demo map fixtures used for the landing page demo.
  - Provides undo mechanics for the playground game.

- **`art`**
  - Provides sprite/portrait metadata; demos call `prepareSprites()` and
    `preparePortraits()` before rendering.

- **`ui`**
  - Provides UI primitives, CSS variables, input setup, and the portal system
    used by `ClientScope`.

This package does **not** depend on `ares` or `artemis` (closed app/server). It
is intentionally minimal and self-contained.

## Recreating the Docs Package in Another Language

The architecture can be ported if you preserve these concepts:

1. **Static MDX/markdown site** with a React (or equivalent) runtime for
   interactive demos.
2. **Client-only boundary** that initializes all input systems, CSS vars, and
   global contexts before rendering game UI.
3. **Game demo loop** that composes `MapData` + `MapMetadata` + `GameMap` and
   connects action dispatch/undo to a local game state hook.
4. **Editor demo** that adapts editor inputs/outputs to a simple persistence
   layer (URL, local storage, or file) without server dependencies.
5. **Asset bootstrap** (sprites/portraits) that runs once before any rendering.

The docs package is essentially a reference implementation of how to embed the
core engine packages in a non-game host application.

## Files to Start With

- `docs/vocs.config.tsx`
- `docs/content/pages/index.mdx`
- `docs/content/playground/ClientComponent.tsx`
- `docs/content/playground/ClientScope.tsx`
- `docs/content/playground/PlaygroundGame.tsx`
- `docs/content/examples/map-editor.tsx`
- `docs/content/examples/map-data-examples.tsx`
