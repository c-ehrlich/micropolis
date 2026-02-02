# Fixtures Package Overview

## Snapshot (current state)
- This package is a stub: it only contains `fixtures/package.json` and no source files, exports, or build scripts.
- It is marked `private` and `type: "module"`, with devDependencies on `@deities/athena`, `@deities/apollo`, and `@deities/hermes`.
- There are no references to `@deities/fixtures` elsewhere in the monorepo, and no fixtures are actually defined here today.

## Intended purpose (inferred from name + deps)
`fixtures/` is set up to host shared, typed test/demo data for the Athena Crisis ecosystem. The dependency trio strongly implies it would contain:
- **Athena core state fixtures**: maps, units, buildings, tiles, objectives.
- **Apollo scenario fixtures**: action sequences, effects, objective conditions, and encoded/decoded action responses.
- **Hermes campaign fixtures**: level graphs, map modules, and turn-state encodings for campaign/game progression.

The repository already contains example maps in `hermes/map-fixtures/*`. That content aligns with what would naturally live in a central fixtures package, suggesting `fixtures/` was intended to aggregate or re-export those kinds of fixtures for tests, docs, and tooling.

## Current structure
- `fixtures/package.json`: package metadata only; no code, no entrypoints.

## Key data structures a fixtures package would need (based on actual core types)
Even though there is no implementation here yet, the packages it depends on define the data model a fixtures library would need to encode and reuse.

### Map fixtures (Athena)
Canonical map data is represented by `MapData` and its plain JSON form (`PlainMap`).
- **Core shape** (see `athena/MapData.tsx`):
  - `map`: flat array of tile IDs (`TileField`) describing terrain.
  - `modifiers`: flat array of per-tile modifiers (movement, effects).
  - `decorators`: decorative overlays (per-tile).
  - `size`: `{ width, height }`.
  - `config`: `MapConfig` with biome, fog, objectives, blocklists, seed capital, etc.
  - `teams`, `buildings`, `units`: encoded entities with positions and per-entity stats.
  - `currentPlayer`, `round`, `active`: turn-order and state.
- **Typical usage**: fixtures would likely construct `MapData` via `MapData.createMap(...)` with a `PlainMap`-like payload, as seen in `hermes/map-fixtures/demo-*.tsx`.

### Map metadata fixtures (Apollo)
Maps can be paired with `MapMetadata` (`apollo/MapMetadata.tsx`), which includes:
- `name`, `teamPlay`, optional `tags`, `rating`, and `effects`.
- **Effects** are a `Map<EffectTrigger, Set<Effect>>` (`apollo/Effects.tsx`), where each `Effect` bundles:
  - `actions`: a sequence of Apollo actions.
  - optional `conditions` and `players`.
  - optional `occurrence: "once"` to remove after firing.
Fixtures that model scenarios would need to include both `MapData` and `MapMetadata` so scripted effects can be tested deterministically.

### Campaign / level fixtures (Hermes)
Hermes defines campaign and level graph structures (`hermes/Types.tsx`):
- `Campaign<T>`: `{ name, description, next: Level<T> }`.
- `Level<T>`: `{ mapId: T, next?: Array<Level<T> | [weight, Level<T>]> }`.
- `MapModule`: `{ default: MapData, metadata: Partial<MapMetadata> }`.
Fixtures intended for campaign tests or content previews would need:
- Stable `mapId` identifiers.
- A `Level` graph referencing those map IDs.
- `MapModule` bundles to connect `MapData` with metadata.

### Turn-state / replay fixtures (Hermes + Apollo)
Hermes encodes per-turn game state via `PreviousGameState` (`hermes/game/getTurnState.tsx`) and `encodeTurnState`:
- Tuple form: `[state, lastActionResponse, effects, recentActions?]`.
- Encoded form uses `PlainMap` + `EncodedActionResponse` + `EncodedEffects`.
Fixtures for replay/undo/testing would store:
- Initial map state (`PlainMap`).
- Action response sequences (encoded) and effects snapshots.
This is a key boundary where fixtures can stay language-agnostic (plain JSON arrays) while still matching the game’s internal behavior.

## Interaction model (how fixtures would be consumed)
If implemented, the data flow for fixtures would likely be:
1. **Author or generate fixture data** (Plain JSON for maps, effects, campaigns).
2. **Hydrate into core types**:
   - `MapData.fromObject(...)` or `MapData.createMap(...)`.
   - `decodeEffects(...)` or direct `Effects` construction.
3. **Use across packages**:
   - `athena`: pathfinding/vision/unit rules validation on fixture maps.
   - `apollo`: simulate action application, effect triggers, objectives.
   - `hermes`: campaign routing, turn-state encoding/decoding, undo/replay.
   - `hera`/`docs` (indirect): render maps or demos for UI validation.

## Re-implementation guidance (if porting this package)
Because the fixtures package is currently empty, the most useful design guidance comes from the core packages it would bridge:
- **Use a plain, stable encoding** for fixtures (array-based, numeric IDs), mirroring `PlainMap` and `EncodedActionResponse`. This keeps fixture data language-neutral and easy to serialize.
- **Keep fixtures deterministic**: avoid randomness at load time; bake in seeds or explicit data.
- **Bundle metadata with maps** so scenarios (effects, objectives) can be replayed without external lookups.
- **Separate “raw” fixtures from hydrated forms**: store JSON-friendly types and hydrate to in-memory structures in each language.
- **Version your fixtures** if you expect schema changes; `MapConfig` and action encodings can evolve.

## Gaps and open questions (current repo)
- There are no fixture definitions or exports in `fixtures/`.
- Existing map fixtures live under `hermes/map-fixtures/` rather than this package.
- Some Hermes campaign-related types (e.g., `CampaignMapName`) are referenced but not present in the OSS repo, so cross-package fixtures cannot be fully reconstructed here.
