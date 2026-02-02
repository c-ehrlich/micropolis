# Porting guidance and web-technology opinions (from simcity_system_port_notes)

This document lists recommendations, architectural guidance, and port-specific assumptions from `building/simcity_system_port_notes.md` that are not present in the Micropolis specs and are not verified from the C source. These are design choices for a future web/TypeScript port.

## Architecture and determinism guidance (port design)
- Separate engine from UI with a strict boundary; engine is a pure state machine emitting patches/events.
- Represent maps as typed arrays (Uint16Array/Uint8Array) for data-oriented performance.
- Keep `noUncheckedIndexedAccess` enabled; use explicit `assertDefined`/`getOrThrow` helpers for array reads to document invariants.
- Introduce a `Ruleset` object to hold constants, tile classification tables, and quirk toggles.
- Provide format adapters (`CityFormatAdapter`) to allow multiple save formats (cty/json/zip/extended).
- Use a deterministic PRNG (xorshift/splitmix/pcg) and store seeds in saves/replays.
- Guard determinism by avoiding floats in sim logic, unstable sorts, and wall-clock-dependent rules.
- Fast-forward should advance by a fixed number of sim ticks/weeks, not wall-time.
- Add golden test harness and replay log format for cross-browser determinism checks.

## Scheduling and speed modeling (port design)
- Model sim speed via a data-driven `SpeedProfile` with per-subsystem cadence overrides.
- Record speed profile in saves/replays to preserve determinism across runs.
- Use "advance X weeks" fast-forward that queues deterministic ticks.

## Worker and transport recommendations (web-specific)
- Prefer running the engine in a Web Worker; UI/render on the main thread.
- Use an async message-based transport even in local (non-worker) mode to avoid refactors.
- Consider `SharedArrayBuffer` for map sharing to avoid full-copy transfers (with COOP/COEP).

## Rendering recommendations (web-specific)
- Use a canvas tile renderer (pixel art first); WebGL tilemap shader optional later.
- Render overlay maps by upscaling low-res fields with palette lookup and optional alpha blend.
- Keep "chunkiness" by preserving lower-resolution field maps in overlays.

## Extensibility planning (port design)
- Keep engine tile IDs stable; map tileset layers to sprite rects/animation frames.
- Parameterize map size but preserve default 120x100; derived maps scale by w/2, w/4, w/8.
- Anticipate hidden assumptions in spawn points, smoothing windows, and slice logic when resizing.

## Unverified behavioral assumptions used for porting
- "Two-clock" model with explicit real-time rates (~60 Hz UI, ~12 Hz objects/animations, ~2 Hz power blink).
- Animation processing only the visible tiles (rather than the full map).

These items are design guidance for the port and are not part of the validated Micropolis behavioral spec.
