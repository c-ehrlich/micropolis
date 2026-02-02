# Hera Package Overview

## Purpose
`hera/` is the client-side rendering and interaction engine for Athena Crisis. It turns deterministic game state (`athena/MapData`, `apollo/ActionResponse`s) into a playable, animated, localized UI. Hera owns:

- The map rendering pipeline (tiles, buildings, units, decorators, fog).
- The interaction model (input, selection, behaviors/state machine).
- Client-side action processing (optimistic updates, animations, remote action replay).
- Game UI overlays (action bars, dialogs, info panels, messages).
- Map editor + replay tooling for the open-core build.
- Audio + i18n integration for the client.

From an architecture standpoint, Hera is the “presentation + interaction layer” on top of the deterministic simulation in `athena/` + `apollo/`, with additional glue for campaign data in `hermes/` and AI execution in `dionysus/`.

## Key Cross-Package Dependencies

- **Athena** (`@deities/athena`): Core map data (`MapData`), unit/building/tile types, rules (movement, vision), configuration constants. Hera treats Athena as source-of-truth state and queries it for visibility, pathing, and entity info.
- **Apollo** (`@deities/apollo`): Action/response modeling, game-state encoding, effects, and action execution. Hera calls `execute(...)` locally for optimistic updates and uses Apollo’s helpers to apply action responses and compute visibility deltas.
- **Hermes** (`@deities/hermes`): Campaign metadata, client game state shaping, and undo/replay support.
- **Dionysus** (`@deities/dionysus`): AI registry used inside Hera’s web worker to resolve actions that require AI evaluation.
- **Art** (`@deities/art`): Sprite metadata and loader utilities (`prepareSprites`, `spriteImage`). Hera maps gameplay entities to sprite-sheet positions and handles preloading.
- **UI** (`@deities/ui`): Shared component library, input/controls, audio player, CSS variables, etc.
- **i18n** (`@deities/i18n` + `fbtee`): Translation dictionaries and locale handling; Hera injects translated strings into Athena info objects.

## High-Level Data Flow

1. **State source**: `MapData` (Athena) + `Effects` (Apollo) + optional external action responses (server/replay).
2. **Renderer**: `GameMap.tsx` drives rendering; `Map.tsx` draws the map and entities; overlay UI consumes `GameMap` state.
3. **User input**: Pointer/keyboard/gamepad input enters via `Mask.tsx`/`MaskWithSubtiles.tsx` + `@deities/ui/controls` and is interpreted by `behavior/` state machines.
4. **Action execution**:
   - Local optimistic path: `GameMap._action()` calls `apollo/execute(...)`, updates local map state immediately, then waits for remote confirmation.
   - Worker path (client-only game): `useClientGameAction` posts a request to `workers/gameAction.tsx`, which calls `apollo/executeGameAction(...)` off-thread and returns encoded results.
5. **Action response playback**: `action-response/processActionResponse.tsx` turns `ActionResponse` values into animations + state updates, applying visibility and side effects.
6. **Animation + UI updates**: Animations update `state.animations`, which `MapAnimations.tsx` renders; UI overlays react to updated `GameMap` state.

## Package Structure (by concern)

### Core rendering + interaction
- `hera/GameMap.tsx`: Main stateful controller. Owns the map interaction loop, action dispatch, animation scheduling, replay handling, and input event wiring.
- `hera/Map.tsx`: Visual map renderer. Composes `Tiles`, `Decorators`, `Unit`, `Building`, `MessageTile`, `Fog`, etc.
- `hera/Tiles.tsx`: Canvas-based tile rendering with animation tick loop.
- `hera/Building.tsx`, `hera/Unit.tsx`: React sprite renderers for entities.
- `hera/Radius.tsx`: Radius overlay drawing (movement/attack/defense/etc).
- `hera/Mask.tsx`, `hera/MaskWithSubtiles.tsx`: Hit-test layers for pointer input; compute selection offsets and handle long-press info.
- `hera/Cursor.tsx`: Animated in-map cursor.

### Behavior system (interaction state machine)
- `hera/behavior/Behavior.tsx`: Behavior registry + reset helpers.
- `hera/behavior/Base.tsx`: Default selection behavior (move, menu, radar, etc).
- `hera/behavior/*`: Specialized behaviors and action handlers (move, attack, heal, build, transport, sabotage, etc).
- `hera/behavior/*/client*.tsx`: Client-side animation + state updates for specific action responses.

### Action response processing
- `hera/action-response/processActionResponse.tsx`: Central switch that converts an `ActionResponse` into animations and map changes.
- `hera/action-response/ActionResponseError.tsx`: Error wrapper for response processing issues.

### Animations
- `hera/MapAnimations.tsx`: Animation types + renderer for animation overlays.
- `hera/animations/*`: Animation components + helpers (explosions, attacks, fireworks, upgrades, etc).
- `hera/Tick.tsx`, `hera/lib/tick.tsx`: Shared animation tick sources for CSS and canvas rendering.

### Worker + client game state
- `hera/hooks/useClientGame.tsx`: In-memory game state + undo (Hermes).
- `hera/hooks/useClientGameAction.tsx`: Worker-backed action execution; handles encode/decode + game state updates.
- `hera/workers/gameAction.tsx`: Web worker that runs Apollo game actions and AI.
- `hera/workers/Types.tsx`: Worker message types for action execution.

### Editor + campaign tooling
- `hera/editor/*`: Map editor UI, drawing modes, resizing, and effect/objective editing.
- `hera/campaign/*`: Campaign editor views + integration with map editor.

### Replay tooling
- `hera/replay/*`: Replay UI using `GameMap` in read-only mode.

### UI overlays + cards
- `hera/ui/*`: HUD, dialogs, action bars, map info, etc. Built on top of `@deities/ui` primitives.
- `hera/card/*`, `hera/character/*`, `hera/invasions/*`, `hera/objectives/*`: Domain-specific UI components.

### Audio + i18n
- `hera/audio/*`: Music + volume controls; integrates with `@deities/ui/AudioPlayer`.
- `hera/i18n/*`: Locale setup, translation injection for game entities, message translation.

### Rendering helpers + assets
- `hera/render/*`: Canvas tile rendering helpers.
- `hera/render/Images.tsx`: Sprite URLs (remote assets) used by animations.
- `hera/lib/*`: Misc helpers (animation speed, translated names, sprite lookup, etc).

## Core Interfaces and Data Structures

### `hera/Types.tsx` (central interface layer)

- **`Props`**: Input contract for `GameMap`. Includes the map state, UI preferences, action handlers, and optional editor/replay parameters.
- **`State`**: Runtime UI + interaction state (selected unit/building/position, animations, radius overlays, messages, replay flags, etc).
- **`Actions`**: Methods exposed to behaviors and UI overlays for:
  - `action(...)` / `optimisticAction(...)` (issue game actions)
  - `processGameActionResponse(...)` (apply remote action results)
  - `update(...)`, `requestFrame(...)`, `scheduleTimer(...)` (state/animation scheduling)
  - `scrollIntoView(...)`, `showGameInfo(...)`, etc.
- **`MapBehavior`**: Interface for behavior state machines (`select`, `enter`, `activate`, `deactivate`, etc).
- **`Animations`**: `ImmutableMap<Vector, Animation>` keyed by map location.
- **`MessageMap`**: `ReadonlyMap<Vector, ClientMapMessage>` for per-tile messages.
- **`PlayerDetails`**: `ReadonlyMap<PlayerID, PlayerDetail>` for player UI metadata (name, faction, unit customizations).

### Animation types (`hera/MapAnimations.tsx`)

`Animation` is a discriminated union with all animation types (move, attack, explosion, heal, banners, etc). Some animation types are drawn by `MapAnimations`, others (e.g. unit move, unfold) are handled inside `Unit.tsx`/`Building.tsx` for performance and layering.

### Editor state (`hera/editor/Types.tsx`)

- **`EditorState`**: Current editor mode, selection, drawing mode, and effect scenario.
- **`EditorHistory`**: Undo stack of `(key, MapData, Effects)` snapshots.
- **`MapObject`**: Storage shape for serialized map + effects.

### Worker protocol (`hera/workers/Types.tsx`)

- **`ClientGameActionRequest`**: `[PlainMap, EncodedEffects, EncodedAction, mutateFn]`.
- **`ClientGameActionResponse`**: `[EncodedActionResponse, PlainMap, EncodedGameState, EncodedEffects?]`.

## Rendering System Details

### Layering
`GameMap` defines consistent layer z-indices via `getLayer(y, type)`:

- `building`, `radius`, `decorator`, `message`, `unit`, `animation`, `top`.
- Z-index scales with `y` so lower tiles appear “behind” higher ones.

### Tiles (canvas)
- `Tiles.tsx` draws base map layers to a canvas using `render/renderTile.tsx` and updates animated tiles via `lib/tick.tsx`.
- Supports `style: 'floating' | 'clip' | 'none'` for different map edge treatments.
- Handles layer 0 + layer 1 tiles (e.g., overlays like storm clouds).

### Entities (React sprites)
- `Unit.tsx` and `Building.tsx` render CSS-sprite elements with animation frames driven by `Tick.tsx` CSS variables.
- Unit sprites support status overlays (fuel/ammo, transported units, leader medals, etc).
- Building sprites can “grow” during creation animations.

### Decorators + tile decorators
- `Decorators.tsx` draws foliage/props on a canvas.
- `TileDecorators.tsx` + `TileDecorator.tsx` render tile-specific overlay sprites in React.

### Fog of war
- `Fog.tsx` renders a visibility mask based on `VisionT`. Uses canvas for smooth edges.

### Assets
- Sprites are loaded via `@deities/art` helpers and the `athena-crisis:images` Vite virtual module.
- `Map.tsx` lazily preloads images and falls back to an error overlay if assets fail to load.

## Interaction + Behavior System

Hera uses explicit behavior objects rather than a single monolithic UI state machine:

- Each `MapBehavior` implementation handles a subset of interactions (move, attack, build, heal, radar, etc).
- `GameMap` delegates `enter/select/activate` to the current behavior and merges state changes.
- `resetBehavior(...)` resets radius overlays and selection, optionally swapping in a new behavior.

Common flow:

1. **Pointer enters tile** → `behavior.enter(...)` (highlight, show info, etc).
2. **Pointer selects tile** → `behavior.select(...)` (choose unit/building, open menu, etc).
3. **Action chosen** → behavior triggers `actions.action(...)` or `actions.optimisticAction(...)`.

Editor-specific behaviors (design/entity/vector modes) use `MaskWithSubtiles` and handle painting sub-tiles for decorators.

## Action/Response Pipeline

### Local optimistic execution (`GameMap._action`)

- Calls `apollo/execute(map, vision, action)` to generate `(ActionResponse, newMap)`.
- Updates local state immediately (optimistic).
- Dispatches remote action via `props.onAction` if provided.

### Remote and replay processing

- `GameMap.processGameActionResponse` handles:
  - Message updates
  - Special cases (Start, EndTurn, Capture)
  - Fog visibility updates
  - Queuing `others` action responses
- `action-response/processActionResponse.tsx` sequences action responses and drives animations.

### Animation scheduling

- Action handlers often return `StateLike` changes that add animations to `state.animations`.
- `MapAnimations` renders and signals completion, which triggers `onComplete` handlers to finalize map state.

### Replay state

- `replayState` tracks live vs replay vs paused state.
- While replaying, user input is gated and actions are queued until animations finish.

## Worker-Based Action Execution

`useClientGameAction` uses `workers/gameAction.tsx` to offload deterministic action resolution:

1. Serialize map → `PlainMap`.
2. Encode effects and action via Apollo encoders.
3. Worker runs `executeGameAction(...)` (Apollo) with `AIRegistry` (Dionysus).
4. Decode action response + game state on the main thread and update `ClientGame` via Hermes `toClientGame`.

This lets Hera run full client-side simulations without blocking the UI thread.

## Editor + Campaign Tools

### Map Editor (`hera/editor/MapEditor.tsx`)

- Wraps `GameMap` in a specialized editing UI with custom behaviors.
- Supports map generation, resizing, and scenario effects editing.
- Maintains an `EditorHistory` stack for undo.
- Uses Apollo `Effects` and `Scenario` to preview scripted behavior.

### Campaign Editor (`hera/campaign/*`)

- Provides campaign-level UI and ties map editing to Hermes campaign metadata.
- Exposes save/update flows for campaign objects.

## Replay Tooling

- `hera/replay/ReplayMap.tsx` renders a game state with `InfoBehavior` (read-only).
- Uses `GameMap` in `dangerouslyApplyExternalState` mode to allow pause/seek.

## Messaging System

- `MessageMap` stores map-tied messages keyed by tile vector.
- Action responses can carry new messages; `GameMap` inserts them and triggers a `new-message` animation.
- `MapMessage`/`CreateMapMessage` overlays are rendered in portals aligned to the tile hitbox.

## i18n and Localization

- `hera/i18n/LocaleContext.tsx` wires `fbtee` locale handling and font selection.
- `Map.tsx` uses `injectTranslation` to bind translated strings into Athena info classes (tiles, units, buildings, weapons, decorators).
- Several translation maps (e.g. `EntityMap.tsx`) are expected to be generated in the full repo.

## Audio Integration

- `hera/audio/Music.tsx` provides a music context and uses biome tags to select tracks.
- `AudioPlayer` (from `@deities/ui`) handles actual playback.

## Notes on Porting / Reuse

If you wanted to recreate Hera in another language or engine, key abstractions to preserve:

- **Deterministic map state + query API**: Hera assumes `MapData` exposes tile/units/buildings plus vision queries. The renderer depends on a fast `getTileInfo`, `map.forEachField`, and `vision.isVisible` API.
- **Action-response model**: The UI assumes actions resolve into discrete `ActionResponse` objects. The animation layer is largely driven by action responses (with `onComplete` callbacks to finalize state).
- **Behavior state machines**: Input is handled by a set of behavior classes implementing a common interface rather than a single UI reducer. This makes new interactions modular.
- **Animation scheduling**: Animations are time-based but state-driven; `MapAnimations` and `Tick` bridge time and state changes. Moving this to a different engine would likely map to a timeline system with callbacks.
- **Layered rendering**: Tiles are drawn in a fast path (canvas) while units/buildings/overlays are composited in a higher-level UI layer. This split keeps large maps fast.
- **Worker execution**: For responsiveness, heavy game action resolution runs in a worker thread. The protocol (encoded map/effects/action) is simple to re-implement.

## Open-Core / Generated Gaps

The OSS tree expects a few generated or external pieces:

- `hera/i18n/EntityMap.tsx` is referenced but not present in OSS; likely generated by the translation pipeline.
- `athena-crisis:images` is a Vite virtual module; real assets are hosted remotely or generated at build time.
- Audio/sprite assets are referenced but not included directly in this repo.

## Key Entry Points (quick reference)

- `hera/GameMap.tsx`: Core map controller and action pipeline.
- `hera/Map.tsx`: Map renderer (tiles, entities, fog).
- `hera/behavior/*`: Interaction state machines.
- `hera/action-response/processActionResponse.tsx`: Action response → animations + state updates.
- `hera/workers/gameAction.tsx`: Worker-based simulation.
- `hera/editor/MapEditor.tsx`: Full map editor UX.
- `hera/replay/ReplayMap.tsx`: Replay viewer.
