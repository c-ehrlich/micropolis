# UI Package Overview

## Purpose
`ui/` is Athena Crisis’s shared design system and input abstraction layer. It provides:
- A consistent visual language (pixel borders, typography, spacing, colors, light/dark theme variables).
- Cross-input navigation primitives (keyboard, gamepad, Steam Deck) via a unified event bus.
- Shared UI widgets (buttons, dialogs, menus, select/dropdown, tags, typeahead, etc.).
- Platform adapters (native app bridge, routing wrappers, fullscreen helpers).
- Audio UX affordances (UI sounds, volume state, placeholder asset mapping).

The package is used by `hera/` (the in-game client renderer/UX), `docs/`, and the closed app (`ares/`). It is built for React + Emotion CSS-in-JS, but the architecture is portable to other runtimes.

## Key External Dependencies
- **@deities/athena**: map sizing (`TileSize`, `DoubleSize`), player IDs and colors, sound/music name enums.
- **@deities/apollo**: typed `Route` values and date helpers.
- **React + react-router-dom**: components + routing.
- **Emotion**: CSS-in-JS; `injectGlobal` for base styles.
- **howler**: audio playback.
- **@nkzw/stack / @nkzw/joymap / @nkzw/create-context-hook**: layout, gamepad polling, context helpers.

## Package Structure (high-level)
- `App.tsx`: Native app bridge, clipboard integration, fullscreen, Steam helpers, and a remote navigation interface.
- `Browser.tsx`: platform/user-agent detection (iOS, Android, Safari, Firefox, etc.).
- `CSS.tsx`, `cssVar.tsx`, `Breakpoints.tsx`: global styling, theme variables, media breakpoints.
- `controls/`: input system (event bus, keyboard/gamepad setup, navigation hooks, throttling).
- `hooks/`: UI-specific hooks (alerts, prompts, routing adapters, scaling, scroll restore, long-press).
- `lib/`: reusable utilities (lazy import error handling, animation sync, prevent dragging, etc.).
- `icons/`: inline SVG icon modules.
- `assets/`: shared visuals (e.g., `Background.png`).
- `components`: buttons, menus, dialogs, dropdown/select, tags, typeahead, spinner, etc.
- `Audio.tsx`, `AudioPlayer.tsx`: sound/music mapping + playback.
- `Empty.aac`, `Empty.ogg`: placeholder audio for OSS builds.
- `types/athena-crisis-audio.d.ts`: virtual module type for audio assets.

## Core Systems and Interfaces

### 1) Styling & Theming System
**Files:** `CSS.tsx`, `cssVar.tsx`, `Breakpoints.tsx`, `getColor.tsx`, `pixelBorder.tsx`, `clipBorder.tsx`, `gradient.tsx`, `PulseStyle.tsx`

- **CSSVariables class (`cssVar.tsx`)**
  - Generates stable, compact CSS variable names with a prefix (e.g., `--a0`, `--a1`).
  - In dev, includes readable suffixes for debugging; in prod, keeps names short.
  - Exposes `cssVar(name, value)` to define variables and `applyVar(name)` to read them.

- **Global CSS bootstrap (`CSS.tsx`)**
  - `initializeCSS()` injects global styles and initializes CSS variables once.
  - Defines fonts by locale (Japanese, Korean, Russian/Ukrainian) and a global base style for buttons/inputs.
  - Adds safe-area handling, background image styles, and scrollbar suppression.
  - Exposes `getScopedCSSDefinitions()` to reuse the scoped baseline styles outside global injection if needed.

- **Light/Dark theme variables (`cssVar.tsx`)**
  - Defines full light and dark palettes (backgrounds, border colors, text colors, highlight color).
  - Uses `prefers-color-scheme` and `html.dark` to switch themes.
  - Uses Athena player color variables (`color-*`) to keep UI aligned with game player colors.

- **Shared visual motifs**
  - `pixelBorder` uses box-shadow to create crisp pixel outlines.
  - `clipBorder` uses polygon clip-path to cut pixel corners.
  - `PulseStyle` and rainbow styles are driven by Athena player colors.

**Porting note:** the UI relies heavily on CSS variables and a “pixel border” aesthetic; in another language/runtime, mirror this via a theme system with computed variables and a single global injection phase.

### 2) Input Abstraction & Navigation
**Files:** `controls/Input.tsx`, `controls/setupKeyboard.tsx`, `controls/setupGamePad.tsx`, `controls/setupSteamDeck.tsx`, `controls/setupHidePointer.tsx`, `controls/useInput.tsx`, `controls/useMenuNavigation.tsx`, `controls/useHorizontalMenuNavigation.tsx`, `controls/useDirectionalNavigation.tsx`, `controls/useAcceptNavigation.tsx`

- **Input event bus (`controls/Input.tsx`)**
  - Defines a typed event map (`Events`) for actions like `accept`, `cancel`, `navigate`, `menu`, `detail`, etc.
  - Uses layered `EventTarget`s: `top`, `dialog`, `menu`, `base`.
  - `Input.fire()` dispatches events from `top` down until prevented or blocked. This powers modal behavior and input priority.
  - `Input.block(layer)` stops dispatch below a layer (used by modals/menus).

- **Keyboard setup (`setupKeyboard.tsx`)**
  - Converts key presses into Input events with throttled navigation.
  - Prevents default scrolling and browser shortcuts where needed.
  - Supports meta modifiers (e.g., save/secondary), and dedicated action keys.

- **Gamepad setup (`setupGamePad.tsx`)**
  - Uses `@nkzw/joymap` to poll controllers.
  - Maps sticks/D-pad to `navigate` events, buttons to `accept/cancel/menu/etc.`
  - Handles rumble (`rumbleEffect`) and gamepad type detection (`getGamepadType`).
  - Integrates with `ScrollContainer` to allow right-stick scrolling.

- **Steam Deck text input (`setupSteamDeck.tsx`)**
  - Uses `App.showFloatingGamepadTextInput` to bring up the on-screen keyboard.

- **Navigation hooks**
  - `useInput`: register event listeners with a layer.
  - `useDirectionalNavigation` / `useHorizontalNavigation`: implement generic selection changes with audio feedback.
  - `useMenuNavigation` / `useHorizontalMenuNavigation`: track selected/active indices and wrap-around.
  - `useAcceptNavigation`: transient “active” state to drive pressed animations.

**Porting note:** the input system is a central architectural piece. Recreate it as a layered event bus, then implement per-device adapters (keyboard/gamepad/touch) that publish into it.

### 3) Routing & Platform Adapters
**Files:** `App.tsx`, `Link.tsx`, `ActiveLink.tsx`, `Navigate.tsx`, `hooks/useNavigate.tsx`, `hooks/useLocation.tsx`

- **Native app bridge (`App.tsx`)**
  - Wraps a global native interface (`window.$__AC__`) when running inside the native shell.
  - Exposes app-level capabilities (fullscreen, Steam user info, clipboard, versioning, reload/quit).
  - Provides a remote call interface (`window.$__AC__R`) that accepts `pushState` from native layers.

- **Typed routing**
  - `Route` types are pulled from `@deities/apollo` so navigation is strongly typed.
  - `Link`/`ActiveLink`/`Navigate` wrappers respect `IS_LANDING_PAGE` mode by opening the hosted app instead of using react-router.
  - `useNavigate` and `useLocation` are environment-aware to support landing pages without router state.

### 4) Audio System
**Files:** `Audio.tsx`, `AudioPlayer.tsx`, `types/athena-crisis-audio.d.ts`

- **Audio asset mapping**
  - `Audio.tsx` exports `Sounds` and `Music` maps. In OSS, they point to placeholder `Empty.aac/.ogg`.
  - The virtual module `athena-crisis:audio` (typed in `types/`) allows the build to swap in real assets.

- **Audio player (`AudioPlayer.tsx`)**
  - Wraps Howler with caching per sound/music instance.
  - Separates `master`, `music`, and `sound` volumes; persists them in localStorage.
  - Handles pause/resume behavior and fade transitions on music changes.

**Porting note:** treat audio assets as a data map keyed by `SoundName`/`SongName`, so UI can refer to sound IDs without file-system knowledge.

### 5) UI Components & Layout Primitives
**Core primitives:**
- `Box`, `Container`, `AdaptiveStack` – layout primitives with pixel borders and responsive widths.
- `Button`, `InlineLink`, `Tag` – interactive components that integrate audio, input focus, and selection states.
- `Menu`, `Dialog`, `MenuButton`, `ExpandableMenuButton` – overlay systems with animation and input blocking.
- `ScrollContainer`, `ScrollContainerWithNavigation` – controlled scrolling with gamepad support.
- `Select`, `Dropdown`, `Slider`, `ClearableInput`, `Form`, `NumberInput` – form controls.
- `Spinner`, `InfoBox`, `ErrorText`, `Reload` – feedback and helper components.

**Animation/transition helpers:**
- `PageTransition` for route/page transitions.
- `PulseStyle` and rainbow styles for attention cues.

### 6) Data Structures for Search & Tags
**Files:** `Typeahead.tsx`, `TagInput.tsx`, `TagList.tsx`

- **TypeaheadDataSource**
  - Maintains an indexed bucket map keyed by first token character.
  - Supports async query augmentation via `queryHandler` for remote/slow data.
  - Uses token matching (prefix match across tokens) with a capped result list.

- **TypeaheadDataSourceEntry**
  - Stores `text`, `value`, `data`, and precomputed token list.

- **TagInput / TagList**
  - `TagInput` composes `Typeahead` + `TagListInternal` to manage editable tag sets.
  - `getTagColor` hashes tag text to a player color ID for consistent colors.

### 7) Hooks & Utilities
- `useAlert` / `AlertContext`: modal alerts with input capture and navigation handling.
- `usePrompt`: integrates react-router navigation blocking with alerts.
- `usePress`: long-press vs click handling for touch input.
- `useScale`: computes a UI scale based on `TileSize` and screen size; updates CSS var `scale`.
- `useBackgroundAnimation`: optional background animation gated by device capability.
- `useScrollRestore`: scroll-to-top or hash-target logic after route transitions.
- `useMedia`, `useFullScreen`, `useNavigate`, `useLocation`: environment-aware platform and routing helpers.
- Utility helpers: `lazy` (safe dynamic import with reload fallback), `syncAnimation`, `scrollToCenter`, `preventDragging`, `Storage` (namespaced localStorage).

## Data Flow Examples

### A) Input → UI Selection
1. `setupKeyboard()` or `setupGamePad()` maps device input to `Input.fire()` events.
2. Events are dispatched through layers (`top` → `dialog` → `menu` → `base`).
3. Hooks like `useMenuNavigation` or `useDirectionalNavigation` consume events to update selection state.
4. Components (e.g., `Button`, `Tag`, `InlineLink`) render selected/active styles and play UI sounds.

### B) Menu / Dialog Overlay
1. Menu or Dialog opens → `useBlockInput('top')` blocks lower layers.
2. Menu adjusts CSS variables (`ui-scale`, `ui-is-scaled`, `transform-origin`) to scale the UI.
3. Portal renders overlay; close events consume `cancel` input before it reaches base handlers.

### C) Audio Playback
1. Components call `AudioPlayer.playSound('UI/Accept')` on interaction.
2. `AudioPlayer` reads volume from localStorage and plays/fades with Howler.
3. Assets are resolved via the `athena-crisis:audio` map (placeholder in OSS).

## Interactions with Other Packages
- **athena/** provides sizing (`TileSize`, `DoubleSize`), player colors/IDs, and audio name enums used by UI.
- **apollo/** provides typed routes and date utilities for navigation and lazy-import recovery.
- **hera/** consumes UI components for in-game menus, dialogs, HUD elements, and input hooks.
- **docs/** uses UI components for consistent styling in documentation/playground.

## Porting & Reuse Takeaways
- Treat UI theming as a data-driven system (CSS variables or equivalent) instead of hard-coded colors.
- Build a layered input event bus that decouples device-specific input from UI behavior.
- Keep audio IDs and routing types in shared packages to avoid stringly-typed UI logic.
- Use composable primitives (Box, Stack, InlineLink) to reduce duplication in higher-level UI.
