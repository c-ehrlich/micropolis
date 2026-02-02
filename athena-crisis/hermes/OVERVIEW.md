# Hermes package overview

## Purpose
Hermes is the campaign + turn-state utility layer that sits above `athena/` and `apollo/`.
It provides:

- A campaign graph model (levels, branching via objectives, validation, and serialization).
- Turn-state capture + undo logic built on Apollo action streams.
- Encoding/decoding for turn-state snapshots (MapData + ActionResponses + Effects).
- Narrative helpers for contextual character messages tied to skill activations.
- A small set of map fixtures used for demos/campaign examples.

If you had to rebuild this in another language, Hermes is the module that turns Apollo's action history into
client-friendly turn snapshots (for undo and persistence) and defines the campaign graph format
that binds maps into a progression.

## Core dependencies and interactions

- `@deities/athena` (hard dependency)
  - Map model: `MapData`, `PlainMap`.
  - Player/skill/objective types: `Player`, `Skill`, `ObjectiveID`.
  - Vision + rules helpers: `Vision`, `matchesActiveType`, `updatePlayer`, `hasPlayerChange`.
- `@deities/apollo` (hard dependency)
  - Action system: `ActionResponse`, `executeEffect`, `applyActionResponse`.
  - Effects system: `Effects`, `applyEffects`, `encodeEffects`, `decodeEffects`.
  - Encoded action IO: `EncodedActions.tsx` (generated in full repo).
  - Map metadata and character messages for narrative maps.
- Used by (in full repo)
  - Client/UI code (likely `ares/` or `hera/`) for undo + turn-state snapshots.
  - Server/state storage (`artemis/`) for campaign serialization and turn-state persistence.

## Key data structures

### Campaign graph model
`hermes/Types.tsx`

- `Level<T>`
  - `{ mapId: T, next?: Array<Level<T> | [objectiveId, Level<T>]> }`
  - `next` can branch conditionally: `[objectiveId, Level]` means "go to this level if the
    objective is the one that completed."
- `PlainLevel<T>`
  - JSON-friendly representation: `{ mapId: T, next?: Array<T | [objectiveId, T]> }`.
- `Campaign<T>`
  - `{ name, description, next: Level<T> }` -- `next` is the root level of the campaign graph.
- `PlainCampaign<T>`
  - `{ name, description, next: T, levels: Map<T, PlainLevel<T>> }` -- flattened map-based form.
- `LevelMap<T>`
  - `Map<T, Level<T>>` or `Map<T, PlainLevel<T>>` depending on context.
- `CampaignModule` / `MapModule`
  - Expected shape for dynamic imports: `default` export plus metadata (`tags` for campaigns,
    `MapMetadata` for maps).

Other supporting types:

- `ClientLevelID = string`, `LevelID = number`.
- `ReceivedCrystals<T> = Array<[T, number]>` -- likely a reward ledger keyed by level/map.
- `CharacterNameMap` / `CharacterNameEntry` -- character naming metadata for campaigns.

### Turn-state snapshot (undo)
`hermes/game/getTurnState.tsx`

```
PreviousGameState<M> = [
  state: M,
  lastActionResponse: ActionResponse | EncodedActionResponse | null,
  effects: Effects | EncodedEffects,
  recentActions?: Array<[ActionResponse[], Effects]> | null,
]
```

- `state` is a snapshot at the start of the current turn.
- `recentActions` is a list of action batches applied since turn start. Each batch records the
  action responses and the effects snapshot after that batch.
- Used as the source of truth for undo and turn replay.

## Campaign graph system

### Flattening and expansion
- `toPlainCampaign` (`hermes/toPlainCampaign.tsx`)
  - Converts a graph-shaped `Campaign<T>` into `PlainCampaign<T>`.
  - Uses `unrollCampaign` to list all reachable levels and stores `next` as map IDs.
- `toCampaign` (`hermes/toCampaign.tsx`)
  - Hydrates a `PlainCampaign<T>` into a graph of `Level<T>` objects.
  - Deduplicates `next` links (ignores duplicate map IDs) and resolves them via a map lookup.

### Graph utilities
- `unrollCampaign` (`hermes/unrollCampaign.tsx`)
  - Depth-first traversal of the campaign graph, with cycle protection.
  - Returns a `LevelMap` keyed by `mapId` (root appears early in map order).
- `validateCampaign` (`hermes/validateCampaign.tsx`)
  - Detects cycles via DFS; campaigns must be acyclic.
- `getCampaignLevelDepths` (`hermes/getCampaignLevelDepths.tsx`)
  - Computes a "depth" (distance from root) for each level.
  - When multiple paths reach a level, the max depth wins.
- `levelUsesObjective` (`hermes/levelUsesObjective.tsx`)
  - Checks whether a `PlainLevel`'s branches include a specific `ObjectiveID`.
- `toPlainLevelList` / `toLevelMap`
  - Convenience helpers for converting a list of `Level` objects to IDs and for building
    `Map<T, PlainLevel<T>>` from stored entries.

### Configuration limits
`hermes/Configuration.tsx`

- `CampaignMapLimit = 100`
- `MaxCampaigns = 75`
- `MaxGames = 100`

These are likely server/client guards for storage and UX limits.

## Turn-state + undo system

### Building a client-side snapshot
- `toClientGame` (`hermes/game/toClientGame.tsx`)
  - Inputs: current `ClientGame`, initial map, `GameState`, optional new `Effects`,
    and the latest `ActionResponse`.
  - Computes the active map and last action from `GameState`.
  - Sets `ended` if the last response is `GameEnd`.
  - Calls `getTurnState` to build or extend the per-turn snapshot.

### Maintaining turn state
- `getTurnState` (`hermes/game/getTurnState.tsx`)
  - Resets the snapshot when:
    - The game ends.
    - A new turn starts (`ActionResponse.type === 'Start'`).
    - The active player changes (`hasPlayerChange`).
  - Otherwise appends new action batches to `recentActions`.

### Undo behavior
- `undo` (`hermes/game/undo.tsx`)
  - Requires a human current player and an existing turn-state snapshot.
  - `UndoType = 'Action' | 'Turn'`:
    - Action undo: removes the most recent action batch
      (and strips trailing `CompleteUnit` actions first).
      Replays remaining batches from the turn-start snapshot using
      `applyActionResponse` and a fresh `Vision`.
    - Turn undo: resets to the turn-start snapshot and clears `recentActions`.

### Encoding / decoding turn state
- `encodeTurnState` / `decodeTurnState`
  - Converts `PreviousGameState<MapData>` into `PreviousGameState<PlainMap>` and back.
  - Encodes/decodes action responses and effects via `@deities/apollo/EncodedActions.tsx`.
  - Intended for persistence (save/restore) and network transport.

## Game-end effects handling
`hermes/game/onGameEnd.tsx`

- Ensures that GameEnd-triggered effects are applied and that narrative effects
  are inserted into the `GameState` in a stable order.
- Handles hidden objectives by injecting a `SecretDiscovered` response.
- Temporarily changes the map's `currentPlayer` to evaluate conditions from
  the requested player's perspective.
- Inserts effect-generated actions before any `ReceiveReward` response
  and replays the final `GameEnd` response on the final map snapshot.

## Narrative/message system

- `ActivatePowerMessages` (`hermes/messages/ActivatePowerMessages.tsx`)
  - `Map<Skill | -1, Array<[messageAction, probability, userIds?]>>`.
  - `-1` is the default message list if no specific skill is configured.
- `getActivatePowerMessage` (`hermes/messages/getActivatePowerMessage.tsx`)
  - Filters messages to units that would become active after the skill activation.
  - Optionally filters by specific human user IDs.
  - Picks a weighted random message (`pickItem`) and executes it as an
    effect action (`executeEffect`), returning an action response.

This is a lightweight, data-driven narrative layer tied to skills and unit types.

## Map fixtures
`hermes/map-fixtures/*`

- Example maps (demos + campaign samples) that export:
  - `metadata: MapMetadata` (name, tags, `Effects` hooks).
  - `default` map: a `MapData` instance (often wrapped with `withModifiers`).
- Effects are commonly attached to `GameEnd` and `Start` to show
  character dialog via `CharacterMessage` effects.

## Ratings and play style

- `PlayStyle` (`hermes/PlayStyle.tsx`)
  - Enum-like union of `'Beginner' | 'Intermediate' | 'Hard'`.
- `Rating` (`hermes/Rating.tsx`)
  - `{ mu, sigma }` (TrueSkill-like). Includes helpers for converting
    user records into rating maps.

These are shared types for matchmaking or campaign difficulty tracking.

## Package structure

- `Types.tsx` - Campaign graph types, module shapes.
- `Configuration.tsx` - Campaign/game limits.
- `toCampaign.tsx`, `toPlainCampaign.tsx` - Campaign graph <-> map conversions.
- `unrollCampaign.tsx`, `validateCampaign.tsx`, `getCampaignLevelDepths.tsx` -
  Graph traversal/validation utilities.
- `levelUsesObjective.tsx`, `toPlainLevelList.tsx`, `toLevelMap.tsx` -
  Helpers for objective branching and list/map conversion.
- `game/` - Turn-state snapshotting, encoding, undo, and game-end effect handling.
- `messages/` - Skill activation narrative messages and weighted selection.
- `map-fixtures/` - Demo/campaign maps with metadata/effects.
- `PlayStyle.tsx`, `Rating.tsx` - Misc campaign/matchmaking types.

## Notable invariants and design choices

- Campaigns are DAGs: cycles are explicitly disallowed (`validateCampaign`).
- Branching is objective-driven: `next` entries can be keyed by objective IDs
  to choose the next level.
- Undo relies on action responses: replay is based entirely on authoritative
  `ActionResponse` sequences, not raw player inputs.
- Turn snapshots are stable: a turn boundary is detected via `Start` action
  or player change, which makes the snapshot resilient to inserted effect actions.
- Narrative is data-driven: skill message selection is a weighted lookup with
  minimal logic in code.

## Missing/generated files in OSS snapshot

- `hermes/CampaignMapName.tsx` - imported by `Types.tsx` but not present here.
- `apollo/EncodedActions.tsx` - required by `encodeTurnState`/`decodeTurnState`.

These are likely generated or closed-source in the full repo and are needed
for full builds.
