# Apollo package overview

## Purpose
Apollo is the **game-state/action layer** that sits on top of `athena/`'s deterministic map model. It defines:

- The **action vocabulary** (player actions + scripted effects) and **action responses**.
- Deterministic **state transitions** (validate -> apply action -> update map).
- **Effects** and **objective** systems that react to actions to drive scenarios, rewards, and game-end logic.
- **Fog-of-war visibility shaping** and **network/replay encodings** for action streams.
- Integration points for **AI turns**, timeouts, and campaign/game routing.

If you had to rebuild this in another language, Apollo is the module that translates input actions into authoritative game-state transitions and turns that into a stream of visible, serializable responses.

## Core dependencies and interactions

- **`@deities/athena` (hard dependency)**
  - Map model: `MapData`, `Vector`, `Unit`, `Building`, `Player`, `Team`.
  - Rules & mechanics: movement, combat, capture, skills, visibility, economy, serialization, etc.
- **Used by**
  - `dionysus/`: AI consumes Apollo to execute actions (`executeGameAction`) and reason over `ActionResponse`/`GameState`.
  - `hera/`: UI uses `ActionResponse`, visibility helpers, vectors, and encoded responses for rendering/animations.
  - `hermes/`: campaign and undo/turn state are built on top of Apollo's action streams and map updates.
- **Codegen**
  - `ActionMap.json` and `ConditionMap.json` drive code generation of `EncodedActions.tsx` (missing in OSS).
  - `Routes.tsx` is also generated in the full repo and is referenced by `routes/`.

## Key data structures

### Action (input)
`apollo/Action.tsx`

- `Action` is a **discriminated union** (`type` field) with two categories:
  - **Player actions**: Move, Attack, Capture, Supply, CreateUnit/Building, EndTurn, etc.
  - **Effect actions** (scripted/scenario): SpawnEffect, CharacterMessageEffect, IncreaseCharge/Funds, ActivateCrystal (effect mode), etc.
- `execute()` and `executeEffect()` accept `Action` + `MapData` + `VisionT` and return `[ActionResponse, MapData]`.
- The input is validated *implicitly* by each action's domain rules inside `Action.tsx` (movement, ammo, range, funds, etc.).

### ActionResponse (output)
`apollo/ActionResponse.tsx`

- `ActionResponse` is the **authoritative output** of action resolution.
- Contains the minimum information required to reproduce the updated map state.
- Includes **hidden/fog-of-war responses** and **objective/game-end responses** via unions:
  - `HiddenActionResponse` (see `HiddenAction.tsx`)
  - `ObjectiveActionResponse` (see `Objective.tsx`)

### GameState + Encodings
`apollo/Types.tsx`, `apollo/GameState.tsx`

- `GameState` is an ordered list of `[ActionResponse, MapData]` entries.
- `EncodedGameState` serializes responses + `PlainMap` for persistence/replay.
- `GameActionResponse` / `EncodedGameActionResponse` model network responses, including **per-viewer entity deltas**.

### Effects system
`apollo/Effects.tsx`, `apollo/Condition.tsx`

- `Effect` = `{ actions, conditions?, occurrence?, players? }`
- `Effects` = `Map<ActionResponseType, Set<Effect>>`
- `Conditions` are small predicates evaluated against **previous map**, **current map**, and **last action response**:
  - `UnitEquals`, `GameEnd`, `OptionalObjective`.
- `Effect` actions are replayed as **effect actions** using `executeEffect` (ignores turn ownership rules).
- `occurrence: 'once'` removes the effect after it triggers.

### Objectives + game-end system
`apollo/Objective.tsx`, `apollo/lib/checkObjective.tsx`

- Reads objectives from `athena/Objectives.tsx` on the map config.
- Emits `ObjectiveActionResponse` entries such as `GameEnd`, `CaptureGameOver`, `AttackUnitGameOver`, etc.
- Optional objectives can be marked complete and can trigger **rewards**.
- `processRewards` applies rewards by issuing `ReceiveReward` action responses.

### Hidden actions (fog-of-war)
`apollo/HiddenAction.tsx`

- When a viewer cannot see the full action, Apollo emits hidden variants:
  - `HiddenMove`, `HiddenSource/TargetAttackUnit`, `HiddenSource/TargetAttackBuilding`, etc.
- These apply to the client map state without leaking hidden information.

### AI + timers
- `executeGameAction` (in `actions/executeGameAction.tsx`) can auto-advance AI turns via an `AIRegistry`.
- `lib/timeoutActionResponseMutator.tsx` mutates end-turn responses for timeout rules.
- `lib/GameTimerValue.tsx` and `lib/hasTimer.tsx` define timer modes.

### Miscellaneous
- `MapMetadata` carries map name, rating, tags, teamPlay, and optional effects.
- `replay/Types.tsx` defines replay streams with encoded actions and effects.
- `socket/Types.tsx` defines client/server socket payloads.

## Core execution flow (authoritative gameplay)

### 1) Action validation + response
`Action.tsx`

- `applyAction()` computes an `ActionResponse` by checking:
  - Unit/building presence
  - Current player ownership
  - Range/path validity
  - Funds/charge availability
  - Skill/ability requirements
- `execute()` returns `[actionResponse, newMap]` where `newMap` is produced by `applyActionResponse`.
- `executeEffect()` runs the same logic but allows effect-level actions (e.g., `SpawnEffect`).

### 2) Apply action to map
`actions/applyActionResponse.tsx`

- **Single source of truth** for mutating `MapData` based on `ActionResponse`.
- Updates units/buildings, player funds/charge, stats, status effects, AI behaviors, conversions, etc.
- Delegates to specialized helpers:
  - `applyEndTurnActionResponse` (turn transitions, supply, status effects).
  - `applyPower` (skill power effects).
  - `applyPartialActivateCrystalActionResponse` (biome/HQ transformations).
  - `applyHiddenActionResponse` / `applyObjectiveActionResponse`.

### 3) Effects + objectives + chain reactions
`lib/applyConditions.tsx`

- **Queue-based loop** that applies:
  1. The original action response
  2. Triggered **effects** (`Effects.tsx`)
  3. Triggered **objectives** (`Objective.tsx`)
- Handles special cases such as High Tide (map resize) and resurrecting lost players via Spawn effects.
- Returns `(gameState, updatedEffects)`; `gameState` is appended with all triggered responses.

### 4) Full action execution
`actions/executeGameAction.tsx`

- Orchestrates a full action:
  - `execute()` -> `applyConditions()` -> optional `onEndTurn` hook -> optional AI loop.
- AI loop repeatedly calls `AI.act(map)` until AI yields no map change; game states are appended.
- Guard against AI stalemate with a max iteration limit.

## Visibility, fog-of-war, and networking

### Visibility shaping
`lib/computeVisibleActions.tsx`

- Converts the full `GameState` into a **viewer-specific action stream**.
- For each action response it chooses among:
  - Full response (viewer sees everything)
  - Hidden response (partial info)
  - Null (viewer sees nothing)
- Generates additional hidden variants for moves/attacks when only one side is visible.
- Drops unit/building labels where objectives should hide them.

### Entity deltas
`actions/encodeGameActionResponse.tsx`

- Computes **diffs** of visible buildings/units between maps using the viewer's vision.
- Packs encoded action response + optional `PlainEntitiesList` deltas.
- `lib/getVisibleEntities.tsx` performs the diff and label filtering.
- `lib/updateVisibleEntities.tsx` merges deltas into the client-side visible map.

### Encoding/decoding
- `EncodedActions.tsx` (generated) provides `encode/decode` for:
  - Actions
  - ActionResponses
  - Conditions
- `ActionMap.json` and `ConditionMap.json` define stable numeric IDs and field orderings.
- `lib/decodeGameActionResponse.tsx` handles server responses, including error/passthrough payloads.

## Systems worth reusing in another language

- **Action/response model**: deterministic state changes with explicit responses; replayable and network-friendly.
- **Effects engine**: action-triggered rules with conditions and one-shot behaviors.
- **Objective/game end pipeline**: objective evaluation based on action responses + map diff.
- **Fog-of-war visibility shaping**: "hidden action responses" + entity deltas.
- **Replay format**: encoded actions + map snapshots + metadata.
- **Turn transition logic**: end-turn accounting, supply, status effects, and timeouts.

## Package structure

- `Action.tsx` / `ActionResponse.tsx` - primary action + response unions and execution helpers.
- `actions/` - execution pipeline and map mutation (`applyActionResponse`, `executeGameAction`, etc.).
- `Effects.tsx` / `Condition.tsx` - effect triggers, conditions, and encoding.
- `Objective.tsx` - objective evaluation and game-end actions.
- `HiddenAction.tsx` - fog-of-war response variants and application.
- `lib/` - visibility helpers, objective checking, effects helpers, timers, map resize, etc.
- `replay/` - replay payload formats.
- `routes/` - typed route helpers (require generated `Routes.tsx`).
- `socket/` - socket event schemas and room helpers.
- `ActionMap.json`, `ConditionMap.json` - encoding schema for codegen.
- `action-mutators/` - small constructors for actions (useful in tests and AI).
- `invasions/` - invasion-specific helpers (crystal logic, chaos stars).

## Notable invariants and design choices

- **Immutability**: `MapData` and entity collections are treated as immutable; `copy` produces new versions.
- **Determinism**: Action responses contain enough info to deterministically apply them in order.
- **Visibility isolation**: Clients never receive information that their vision should not reveal.
- **Effects as actions**: Effects are executed using the same machinery as player actions, preserving consistency.
- **Objective evaluation after every action**: The objective system is tightly coupled to action responses.

## Missing/generated files in OSS snapshot

- `apollo/EncodedActions.tsx` - generated from `ActionMap.json` + `ConditionMap.json` by `codegen/`.
- `apollo/Routes.tsx` - generated route types used by `routes/` helpers.

These are required for full builds but are intentionally omitted in this repo snapshot.
