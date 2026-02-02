# Deimos Package Overview

## Status (OSS snapshot)
- `deimos/` is a **package stub** in this repo snapshot.
- The only file present is `deimos/package.json` with dependency declarations and metadata.
- The root `OVERVIEW.md` explicitly lists `deimos/` as a stub without source files.

Because there is no implementation in this repo, anything about Deimos behavior, architecture, or runtime is **inferred** from its dependency graph and the established patterns in other packages.

## Intended role (inferred from dependencies)
Deimos appears intended to be a **React-based client UI/app shell** that composes the core game libraries:
- It depends on **rendering/UI** packages (`@deities/hera`, `@deities/ui`, `@deities/art`) and **core simulation** packages (`@deities/athena`, `@deities/apollo`, `@deities/hermes`).
- It also depends on **React/ReactDOM**, `framer-motion`, and `@emotion/css`, suggesting a component-driven UI with animations and CSS-in-JS styling.

In other words, Deimos most likely acts as a top-level UX container that wires together:
- the deterministic simulation model (`athena`),
- the action/response state machine (`apollo`),
- turn-state/campaign helpers (`hermes`),
- and the rendering + interaction engine (`hera`),
- while using `ui` + `art` for visuals and UX.

## Current structure
```
/deimos
  package.json
  OVERVIEW.md
```
There are **no** entry points, source files, tests, configs, or build scripts in this snapshot.

## Dependency map

### Internal (workspace) dependencies
Deimos depends on the following monorepo packages:
- `@deities/athena` - deterministic map model, rules, serialization.
- `@deities/apollo` - action/response system and game-state transitions.
- `@deities/hermes` - turn-state encode/decode, campaign helpers, undo.
- `@deities/hera` - client-side rendering/interaction engine (React).
- `@deities/art` - sprite/palette metadata for rendering.
- `@deities/ui` - design system and shared UI primitives.

### External dependencies (signals about intent)
- `react`, `react-dom` - UI framework runtime.
- `@emotion/css` - CSS-in-JS styling.
- `framer-motion` - animation/transitions.
- `react-error-boundary` - app-level error containment.
- `@nkzw/core`, `@nkzw/stack`, `@nkzw/use-visibility-state`, `fbtee`, `array-shuffle` - utility/tooling libraries (exact usage unknown without source).

## Expected interfaces and data flow (derived from repo patterns)

> This section does **not** describe existing Deimos code (none exists). It describes the **likely interface contracts** Deimos would need to implement given its dependencies and the monorepo architecture.

### Core data structures Deimos would consume
From `@deities/athena`:
- **Map state**: `athena/MapData.tsx` and `athena/map/*` (tiles, units, buildings, players, teams, vectors, etc.).
- **Static data**: `athena/info/*` (unit, tile, building, skills, factions, names).
- **Rules/helpers**: movement radius, pathfinding, vision/fog, economy, etc.

From `@deities/apollo`:
- **Action model**: `apollo/Action.tsx` (discriminated union of game actions).
- **Action responses**: `apollo/ActionResponse.tsx` (results/effects of actions).
- **Game state**: `apollo/GameState.tsx` (wire formats, state encoding).
- **Effects/conditions/objectives**: rules engine for win conditions or scripted effects.

From `@deities/hermes`:
- **Turn-state & undo**: `hermes/game/*` helpers to encode/decode and manage undo.
- **Campaign helpers**: `hermes/toCampaign.tsx`, `hermes/validateCampaign.tsx`.

From `@deities/hera`:
- **Rendering**: `hera/Map.tsx`, `hera/GameMap.tsx`, render helpers.
- **Interaction**: `hera/behavior/*` for handling game actions from UI.
- **Animation/UI hooks**: `hera/animations/*`, `hera/hooks/*`.

From `@deities/ui` and `@deities/art`:
- **UI primitives**: dialogs, menus, inputs, layout, icons.
- **Sprite metadata**: variant/palette info for rendering game assets.

### Likely data flow in a Deimos-based app
1. **Load/construct state**
   - Build or load `MapData` (athena) + metadata (athena/info).
   - Optionally load campaign/turn-state via Hermes.

2. **Render**
   - Pass current map + view state to Hera's rendering components.
   - Use `art` metadata for sprites and `ui` components for overlays.

3. **User input -> action**
   - UI interactions generate Apollo `Action` objects.
   - Hera behaviors likely help translate clicks/gestures into actions.

4. **Validate + apply actions**
   - Apollo's action executor validates and applies actions to map state.
   - Produces `ActionResponse` + updated map/game state.

5. **Update + animate**
   - Render updates in Hera; UI re-renders via React.
   - Use `framer-motion` and Hera animation helpers for transitions.

6. **Persistence / undo / replay**
   - Hermes helpers store/encode turn history and undo stacks.

This is the standard architectural loop in this monorepo; Deimos would likely orchestrate it as a client app.

## Integration boundaries (what Deimos would own vs. consume)

### Deimos-owned (expected)
- Application shell / routing / screens (menu, game, editor, etc.).
- Wiring between UI -> Apollo actions -> Athena state updates -> Hera rendering.
- Styling/theme, animation choreography, and UX flows.
- Error handling and user-session state.

### Consumed from other packages
- **State model + rules**: `athena`.
- **Action system**: `apollo`.
- **Turn/campaign utilities**: `hermes`.
- **Rendering + interactions**: `hera`.
- **Visual primitives + assets**: `ui` and `art`.

## What's missing in this repo
To faithfully re-create Deimos (or port it to another language), you would need the missing source for:
- Entry points (e.g., `src/index.tsx`, routing, app shell).
- Integration glue: how state is loaded, saved, and wired to UI.
- App-level architecture (scene management, navigation, settings).
- Any Deimos-specific systems (analytics, networking, multiplayer, etc.).

If you can obtain the closed-source Deimos code or design docs, this overview can be expanded into an implementation-level spec.

## Recreation guidance (based on repo architecture)
If you want to rebuild a Deimos-like client in another language or for a different game, the core blueprint is:
1. **Deterministic model**: implement Athena-equivalent map state + serialization.
2. **Action engine**: implement Apollo-like action/response validation + application.
3. **Renderer & interaction layer**: implement Hera-like rendering that consumes map state.
4. **Turn-state/campaign utilities**: implement Hermes-like helpers for undo, replay, and campaign shaping.
5. **UI system + art metadata**: implement UI primitives and a sprite/asset description layer.
6. **App orchestration**: create the application shell that wires it all together.

Without Deimos code, this package is best thought of as a **placeholder for the client app that composes the core libraries**.
