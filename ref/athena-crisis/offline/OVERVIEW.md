# Offline Package Overview (`offline/`)

## Purpose

`offline/` builds a tiny, self-contained **offline splash page** that is shown when the main Athena Crisis client cannot load (no connectivity, store update required, etc.). It is designed to be embedded into native wrappers (Capacitor/iOS/Android, Electron) and to be able to “retry” by reloading the main app or redirecting to the client URL when connectivity returns.

The package is intentionally minimal:
- **No shared runtime dependencies on game logic.** It does not import `athena`, `apollo`, or any UI code.
- **Single-file output.** Vite is configured to inline assets where possible and minify HTML for a compact offline page.
- **Cross-platform reload strategy.** It attempts a host-provided reload hook first, then a Capacitor plugin, then a URL redirect.

## Package Layout

- `offline/index.html`
  - Static HTML/CSS for the offline page.
  - Includes background art, key art, gradient overlay, and a message box.
  - Registers the JS entrypoint (`/index.js`).
  - References fonts and static assets in `offline/`.
  - References `/manifest.json` (expected to be supplied by the wrapper/build pipeline).
- `offline/index.js`
  - Runtime behavior: retry logic, online/offline events, and native reload hooks.
- `offline/vite.config.ts`
  - Build-time configuration: defines `process.env.CLIENT_URL`, inlines assets, and minifies HTML.
- `offline/package.json`
  - Declares a private package with only build-time dependencies.
- Static assets:
  - `Background.png`, `keyart.jpg`, `apple-touch-icon.png`
  - `fonts/` (e.g., `AthenaNova.woff2` used by the page)

## Build & Output Behavior

The root build script uses this package directly:

- Root script: `pnpm build:offline`
  - Runs Vite against `offline/`.
  - Writes output to `dist/offline/`.
  - Copies the result into `mobile/dist/offline/` and `electron/offline/` (these folders are part of the closed client wrappers).

`offline/vite.config.ts`:
- Uses `vite-plugin-singlefile` to inline JS/CSS (and assets when possible).
- Uses `vite-plugin-minify` to minify HTML.
- Injects `process.env.CLIENT_URL` at build time:
  - Production: `https://app.athenacrisis.com/`.
  - Dev: `http://<local-ip>:3000` (derived via `ifconfig`, falls back to `localhost`).

## Runtime Data Flow (Behavioral Logic)

The page is entirely client-side and event-driven. The primary flow is:

1. **Initial load**
   - If `navigator.onLine` is true, schedule a retry loop (`setTimer`).
2. **Retry loop (`setTimer`)**
   - Every 1s, check `navigator.onLine`.
   - If online, call `reload()` and stop; otherwise keep retrying.
3. **User action**
   - Clicking the message box (`div#box`) triggers `reload()` immediately.
4. **Network events**
   - `offline` event clears the timer.
   - `online` event restarts the timer (if not already running).

### `reload()` decision tree

This is the core interface/contract with the host app:

1. **Host-provided global**: if `window.$__AC__` exists, call `window.$__AC__.reload()`.
2. **Capacitor plugin**: if on iOS/Android and `ReloadWebViewPlugin` is registered, call `ReloadWebViewPlugin.reload()`.
3. **Web fallback**: if `process.env.CLIENT_URL` exists, navigate to it (`location.href = CLIENT_URL`).

Only one path is taken; the first available option wins.

## External Interfaces & Contracts

These are the integration points expected from the surrounding app ecosystem:

- **Global reload hook**: `window.$__AC__.reload()`
  - Optional; gives the host full control of how to restart the app.
  - Used by native wrappers or embedded webviews.
- **Capacitor plugin**: `ReloadWebViewPlugin.reload()`
  - Registered via `registerPlugin('ReloadWebViewPlugin')`.
  - Expected to be implemented by the native layer (outside this repo).
- **Client URL**: `process.env.CLIENT_URL`
  - Injected by Vite at build time.
  - Used as a web fallback when running in a browser.
- **`/manifest.json`**
  - Referenced in `index.html`; expected to be supplied by the hosting environment or build pipeline.

## UI/Rendering Details (Static Content)

- Uses a single background image (`Background.png`) with a pixel-art treatment (`image-rendering: pixelated`) and a subtle 3D transform.
- Key art (`keyart.jpg`) is full-width with a gradient overlay that changes for dark mode.
- The message box (`div#box`) is a clipped polygon with a pulsing animation and a single call-to-action (“Try again”).
- Fonts:
  - `AthenaNova.woff2` is loaded and used for the page.
  - Additional fonts are present in `fonts/` but not currently referenced in `index.html`.

## Dependencies

Runtime dependencies are intentionally minimal:
- `@capacitor/core` (for `registerPlugin` + platform detection).

Build-time dependencies (Vite plugins):
- `vite-plugin-singlefile`
- `vite-plugin-minify`

## Relationship to Other Monorepo Packages

- **No direct code dependencies** on any other package (e.g., `athena`, `apollo`, `hera`).
- **Build integration** happens at the root level via `pnpm build:offline`.
- **Deployment/embedding** happens in proprietary clients (`mobile/`, `electron/`) which are not part of this repo, but the build script copies the offline output into those locations.
- **Shared assets/branding**: the imagery and typography are aligned with the main client, but the offline page is self-contained.

## Porting Notes (If Rebuilding in Another Language/Engine)

To reproduce this package in another environment, keep these core elements:

1. **Static HTML page**
   - Background art, key art, offline message, and a click target.
2. **Event-driven network handling**
   - A retry loop that waits for connectivity and triggers a reload when online.
   - Respond to `online`/`offline` events to manage the loop.
3. **Reload strategy with fallbacks**
   - Host-provided reload hook (most reliable for native wrappers).
   - Native plugin reload (Capacitor or equivalent).
   - Browser redirect fallback to a configured client URL.
4. **Single-file packaging**
   - Prefer a single HTML artifact so it is easy to bundle into native shells.

These behaviors are independent of Athena’s core simulation and should be reusable for any game with a native wrapper or offline-first web client.
