# Athena Package Overview

## Purpose and scope
Athena is the deterministic data-model and rules package for Athena Crisis. It defines the canonical map state (tiles, units, buildings, players, teams), static game data (units/tiles/buildings/skills), and the core algorithms that operate on that state (movement, combat, objectives, vision, economy, validation, map generation). It is intentionally platform-agnostic: no rendering, networking, or UI. Other packages treat Athena as the single source of truth for rules and state transitions.

## Design principles and invariants
- Deterministic state and pure transformations: most functions return new instances instead of mutating in place.
- Data is split into "dense" arrays for tiles/modifiers/decorators and "sparse" immutable maps for units/buildings.
- Compact serialization: JSON payloads use numeric enums and short tuple/field encodings to minimize size.
- 1-based coordinates: vectors are `(x, y)` with `x,y >= 1` and a `getTileIndex` mapping to 0-based array indices.
- Identity-stable vectors: vectors are pooled (`map/vec.tsx`) and hashable via Szudzik pairing for fast Map/Set operations.
- Visibility is a view transformation: fog of war doesn't mutate map data; it returns a viewer-specific copy.

## Core data model (`map/`, `MapData.tsx`)

### Coordinates and indexing
- `Vector` is the base coordinate type (adjacency helpers, distances, hashing, encoding).
- `vec(x, y)` pools `Vector` instances for reuse; `Vector.hashCode()` is used for immutable map keys.
- `SpriteVector` is a `Vector` variant for sprite sheet coordinates (used by tile/unit/building art metadata).
- Tile indices use: `(y - 1) * width + (x - 1)`.

### Map state container (`MapData`)
`MapData` is the canonical in-memory game state:
- `map: TileMap`: array of tile IDs or `[layer0, layer1]` pairs (`TileField`).
- `modifiers: ModifierMap`: per-tile modifier (number) or `[layer0, layer1]` modifiers.
- `decorators: DecoratorMap`: packed decorator IDs in a sub-grid (see `DecoratorsPerSide`).
- `config: MapConfig`: biome, fog, objective set, blocklists, performance expectations, economy multipliers, etc.
- `size: SizeVector`: width/height and helper conversions for decorators.
- `currentPlayer`, `round`, `active`: turn order and round tracking.
- `teams: Teams`: `ImmutableMap<PlayerID, Team>` holding players.
- `buildings`, `units`: `ImmutableMap<Vector, Building | Unit>`.

Important helpers:
- `MapData.copy(...)` creates a new map with selective overrides.
- `MapData.toJSON()` emits a `PlainMap` (portable encoded form).
- `MapData.fromObject/fromJSON` reconstruct a map from `PlainMap`.
- `MapData.refill`, `MapData.recover` implement start-of-turn maintenance.
- `MapData.createVisionObject(viewer)` chooses `Vision` or `Fog`.
- Iteration helpers (`mapFields`, `reduceEachTile`, `reduceEachDecorator`) abstract the dense arrays.

### Map configuration (`MapConfig`, `SizeVector`)
`MapConfig` carries immutable configuration:
- Economy: `multiplier`, `seedCapital`.
- Content gating: `blocklistedBuildings`, `blocklistedUnits`, `blocklistedSkills`.
- Scenario: `fog`, `biome`, `objectives`, `performance`, `initialCharge`.
`SizeVector` expresses grid dimensions and decorator grid conversion.

### Entities
All entities extend `map/Entity.tsx`:
- Shared fields: `id`, `health`, `player`, `completed`, `label`.
- `EntityType` determines combat/cover behavior and grouping (`land`, `air`, `naval`, `building`).

**Units (`map/Unit.tsx`)**
- State: fuel, ammo (per weapon), transports, moved/capturing/unfolded flags, rescue state, AI behavior, status effects, shield.
- Supports nested transported units (`TransportedUnit`), plus `DryUnit` for lightweight snapshots.
- Methods cover core mechanics: movement flags, capture/rescue, attackability, transport, refuel/refill, status effect handling, and conversion.
- Serialized as `PlainUnit` with compressed keys (`a` ammo, `g` fuel, `m` moved, `c` capturing, `u` unfolded, etc.).

**Buildings (`map/Building.tsx`)**
- State: behaviors, skills, completion state, neutralization/ownership rules.
- Behaviors influence AI and building actions (heal/radar/skill selling).
- Serialized as `PlainBuilding` (compressed keys `b` behaviors, `s` skills).

### Players and teams
- `Player` is an abstract base class with three concrete types:
  - `HumanPlayer` (userId, time, crystal),
  - `Bot`,
  - `PlaceholderPlayer`.
- Player state includes funds, skills, active skills, charge meter, misses, and statistics.
- `Team` groups players and is itself immutable via `copy`.
- Player statistics are packed into a tuple (`PlainPlayerStatistics`) for serialization.

### Serialization and portable formats
- `PlainMap` is the wire/storage format; all entities are encoded as `[x, y, entity]` lists.
- `map/Serialization.tsx` provides `encode*`/`decode*` for teams, units, buildings, decorators.
- Objectives, rewards, and player performance are similarly encoded as compact tuples.
- This compact format is used by Apollo/Hermes for networking, persistence, and replays.

## Static game data (`info/`)
Athena uses a large static "data registry" for content:
- `UnitInfo`: abilities, movement type, attack/weapon definitions, costs, ranges, sprites, transport rules, and create-unit factory methods.
- `BuildingInfo`: placement rules, funds generation, buildable units, behaviors, defense, sprite metadata.
- `TileInfo`: movement/vision cost, cover, sprite modifiers, layer/transition rules, and rendering metadata.
- `Skill`: enumerated skills, costs, charges, and activation rules.
- `MovementType`, `AttackSprite`, `SpriteVariants`, `UnitNames`, `UnitCustomizations`, `FactionNames`, `Music`, `Decorators`.

These registries are accessed via helpers like `getUnitInfo`, `getBuildingInfo`, `getTileInfo` and are used by all rule/algorithm code.

## Core systems and algorithms

### Movement, pathfinding, and range (`Radius.tsx`, `lib/getMovementPath.tsx`)
- Movement and range calculations use a Dijkstra-style flood with `fastpriorityqueue`.
- `moveable()` returns a map of reachable tiles with cost and parent pointer.
- `getMovementPath()` reconstructs a path and can detect fog-hidden blockers.
- `getPathCost()` validates movement sequences against fuel/radius limits and terrain.
- Transition costs are aware of tile groups (bridges, rivers, etc).

### Vision / fog of war (`Vision.tsx`)
- `Vision` is a "no-fog" view; `Fog` is a viewer-specific transformation.
- Fog computes visibility using `Radius.visible()` from unit and building positions.
- `Fog.apply(map)` returns a copy with hidden units filtered and hidden buildings neutralized.

### Combat and status effects (`lib/calculateDamage.tsx`, `lib/calculateLikelyDamage.tsx`)
- Damage considers unit health, weapon damage, status effects, cover, and luck.
- Status effects and shield checks are centralized to keep combat deterministic.

### Economy, production, and supply
- Funds are computed per-turn from owned buildings (`calculateFunds`).
- Building/unit creation and placement constraints live in `canBuild`, `canDeploy`, `canPlaceTile`, `canPlaceDecorator`, `canPlaceRailTrack`.
- Supply/refill logic: `getUnitsToRefill`, `refillUnits`, `applyBeginTurnStatusEffects`.

### Objectives, rewards, and performance
- `Objectives.tsx` defines criteria types (capture/defeat/escort/survival/etc).
- Encoded objectives are tuples with optional rewards, completion tracking, and vector sets.
- `map/Reward.tsx` encodes rewards as compact tuples and validates them.
- `map/PlayerPerformance.tsx` evaluates pace/power/style metrics and bonus objectives.

### Validation and consistency
- `validateMap` checks config, tiles, entities, skills, teams, and objectives.
- `validateTeams`, `validateSkills`, `verifyTiles` are specialized validators.
- `dropInactivePlayers`, `updateActivePlayers`, `reorderActive` manage turn lists.

### Map generation and mutation
- `generator/MapGenerator.tsx` creates random maps with roads/rivers/HQs using movement heuristics and validation.
- `mutation/` contains targeted tile edits used by editor tooling (`writeTile`, `toggleLightningTile`).

### Messaging and misc systems
- `message/Message.tsx` defines structured map messages with tagged vocabulary and templates.
- `invasions/Crystal.tsx` defines invasion/crystal mechanics used by campaigns/skills.

## Interfaces and data flows

### Creation and serialization
1. `PlainMap` (JSON) -> `MapData.fromObject/fromJSON` builds runtime state.
2. State evolves via pure functions (`startGame`, `refill`, `canDeploy`, etc.) and `MapData.copy`.
3. `MapData.toJSON()` emits a stable, compact format for storage/network.

### Turn lifecycle (common pattern)
1. `startGame()` initializes funds, charge, and resets stats.
2. At turn start: `subtractFuel`, `applyBeginTurnStatusEffects`, `getAllUnitsToRefill`, `refillUnits`, `shouldRemoveUnit`.
3. Player actions (Apollo) call Athena validators/utilities, then produce new `MapData`.

### Viewer-specific map transforms
- `MapData.createVisionObject(viewer)` picks `Vision` or `Fog`, then `vision.apply(map)` yields the perspective copy used by clients/AI.

## Interactions with other packages in the monorepo
- **apollo/**: Builds action/response and game-state transitions on top of `MapData`. Uses Athena's validators, serializers, objectives, and combat/movement utilities.
- **hera/**: Renders `MapData` and consumes `info/` metadata for sprites, animation, and UI decisions. Uses `Vision` for fog and `Configuration` for animation timing constants.
- **dionysus/**: AI reasoning is driven by Athena's map state, unit/building info, and radius/pathfinding helpers.
- **hermes/**: Campaign/turn-state utilities rely on Athena's serialization and core map data types; fixtures are built with `MapData`.
- **art/** and **ui/**: Use `info/` metadata (sprite variants, decorators, audio) but do not change core rules.

## Porting and reuse notes
- Preserve 1-based coordinates and the tile index math to keep algorithms consistent.
- Keep vector pooling or an equivalent identity/caching strategy; many maps are keyed by `Vector`.
- Maintain compact serialization layouts; they are baked into external tooling and replay formats.
- Separate static "data registries" (units/buildings/tiles/skills) from runtime state.
- Favor functional updates and persistent maps to simplify undo/replay and AI search.
- Treat fog of war as a pure view transform instead of mutating the canonical state.
