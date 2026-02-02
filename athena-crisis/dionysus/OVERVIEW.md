# Dionysus Package Overview

## Purpose and role
Dionysus is the AI package for Athena Crisis. It implements turn-based decision making for bot players by selecting and executing actions against the deterministic game model. It sits on top of the core rules and simulation layers:

- Reads game state from `athena` (MapData, units, buildings, objectives, movement, damage, vision).
- Executes actions through `apollo` (Action/ActionResponse, execute, Effects, GameState, applyConditions).
- Uses `hermes` message helpers to turn certain actions (power activation) into effectful message responses.

The result is a repeatable, deterministic AI that drives bot turns by emitting a `GameState` sequence of action responses and their resulting maps.

## Package structure

Top-level:
- `AIRegistry.tsx`: Registry of AI implementations exposed to the rest of the game.
- `BaseAI.tsx`: Abstract AI runtime that manages action execution, effects, and game-state accumulation.
- `DionysusAlpha.tsx`: Main concrete AI implementation (aggressive heuristic AI).
- `lib/`: Heuristic helpers for targeting, attacks, movement, captures, and power usage.
- `lib/__tests__/estimateClosestTarget.test.tsx`: Unit test for movement target estimation.

## Core data types and contracts

Key external types used:
- `MapData` (athena): immutable game map snapshot with tiles, units, buildings, players, objectives, configuration, and helpers.
- `Vector` (athena): grid coordinate type with distance/adjacency helpers.
- `Unit`, `Building`, `Player` (athena): entity types with abilities, behavior flags, and rules.
- `VisionT` (athena): fog-of-war and visibility view for a player.
- `Action`, `ActionResponse` (apollo): actions and their resulting responses.
- `Effects`, `GameState` (apollo): rules/effects state and the action-response timeline.

Key internal types:
- `PossibleAttack` (`lib/getPossibleAttacks.tsx`):
  - `from`: unit origin vector
  - `parent`: move parent vector (where unit should stand to attack)
  - `vector`: target vector
  - `unitA` / `entityB`: attacker and target
  - `attackable`: precomputed attack radius map (`Map<Vector, RadiusItem>`)
  - `sabotage`: whether attack is a sabotage action
  - `getWeight()`: score used for attack ordering

## Turn execution flow

Dionysus integrates with `apollo/actions/executeGameAction.tsx` via `AIRegistryT`:

1. `executeGameAction` finishes a human action, applies conditions, then checks if the current player is a bot.
2. If it is, `executeAIAction` instantiates the AI class from `AIRegistry` (default ID 0) and calls `ai.act(map)` repeatedly until it returns `null`.
3. Each AI action produces `ActionResponse` entries and updated `MapData` states appended to `GameState`.

`BaseAI` is responsible for the AI runtime mechanics:
- Caches `VisionT` per turn (`getVision` / `applyVision`).
- Executes actions via `apollo.execute` (`execute` method).
- Appends responses to `gameState`, then runs `applyConditions` to update `Effects`.
- Special-cases `ActivatePower` by using `hermes/getActivatePowerMessage` to inject power messages as effect responses.
- Throws an internal `AIInterruptException` when a turn ends (`EndTurn`) or the game ends, which stops the AI loop cleanly.
- Tracks an `attacksDone` flag to avoid repeated attack searches in a single decision loop.
- Provides `executeMove`, a helper that detects movement blocking or unit swaps by inspecting the resulting `GameState`. It returns `(map, blocked)` so higher-level logic can stop or replan when a move is invalidated.

## Decision pipeline (DionysusAlpha)

`DionysusAlpha` is a priority-ordered decision tree. It attempts each step until one succeeds (returns a new map), then starts over:

1. `activatePower`
2. `finishCapture`
3. `finishRescue`
4. `toggleLightning`
5. `rescue`
6. `attack`
7. `capture`
8. `fold`
9. `createBuilding`
10. `move`
11. `unfold`
12. `buySkills`
13. `createUnit`
14. `endTurn`

This makes the AI aggressive but still capable of economic play (buildings, units, skills) and utility actions (supply, rescue, power use).

## Key systems and heuristics

### Attack selection
Files: `lib/getPossibleAttacks.tsx`, `lib/sortPossibleAttacks.tsx`, `lib/shouldAttack.tsx`

- Builds attack options by scanning each eligible unit's attackable radius (`athena/Radius.attackable`).
- Filters out invalid attacks (not visible, invalid weapon, neutral capturable buildings, cannot move into range).
- Estimates likely damage using `athena` damage calculators and status effects.
- Applies weights:
  - Strongly boosts kill shots.
  - Penalizes risky melee trades (bad counter-attack outcomes).
  - De-prioritizes buildings unless they are high-value (HQ, production, or capturing units).
  - Prioritizes targets with rescue labels or strategic value.
  - Includes sabotage attacks when allowed and valuable.
- Sorting prefers higher-weight options; long-range attacks are sorted later so they get selected first when popping from the end of the sorted list.
- After executing an attack, it recalculates affected ("dirty") units and merges in fresh attack options.

### Movement and targeting
Files: `lib/getInterestingVectors.tsx`, `lib/estimateClosestTarget.tsx`, `lib/findPathToTarget.tsx`, `lib/getObjectiveVectors.tsx`, `lib/getAttackableArea.tsx`

Target selection combines several data sources:
- Objectives and objective vectors.
- Enemy units/buildings.
- Capture opportunities.
- Supply needs and rescue targets.
- Buildable tiles for builder units.
- Defensive fallback targets when in danger.
- Transport logic (targets for payload units or pickup candidates).

Movement logic:
- `estimateClosestTarget` computes a movement radius (using `athena/Radius.moveable`) and chooses a reachable target by cost.
  - Handles "obstructed" cases by recomputing movement ignoring blocking units.
  - Optimizes capture targets by building weight and capture eligibility.
  - Adds special handling for naval transports to select drop points for transported units.
- `findPathToTarget` chooses the immediate move step:
  - Respects minimum range for ranged units.
  - Avoids enemy attackable areas for defensive/passive behavior.
  - Prefers hidden tiles in fog (ambush/stealth behavior) when close enough.
  - Chooses drop-capable tiles for naval transports that should disembark.

### Capture and rescue
Files: `lib/shouldCaptureBuilding.tsx`, `DionysusAlpha.finishCapture`, `DionysusAlpha.capture`, `DionysusAlpha.finishRescue`, `DionysusAlpha.rescue`

- Capture logic prioritizes enemy or neutral non-structure buildings that are safe to capture.
- Uses building weights (`lib/getBuildingWeight.tsx`) and movement cost to pick targets.
- Rescue logic searches for neutral units, moves a rescuer into range, and prioritizes units being rescued by the AI player.

### Building construction
Files: `DionysusAlpha.createBuilding`, `lib/getBuildingWeight.tsx`

- Builder units search for buildable tiles and select buildings by a weight formula.
- Uses a 3:1 heuristic to balance fund-generating buildings vs production buildings.
- Special-case radar buildings when lightning tiles exist.
- Caches whether any fund-generating buildings are buildable (`_canBuildFundsBuildings`) to avoid repeated expensive checks.

### Unit production
Files: `DionysusAlpha.createUnit`, `lib/getInterestingVectorsByAbilities.tsx`, `lib/sortByDamage.tsx`, `lib/getUnitInfosWithMaxVision.tsx`

- Finds production buildings that can build units and are not blocked by enemy units.
- Uses `determineUnitsToCreate` plus per-building ability analysis to select candidate unit types.
- Computes "interesting" clusters (via `calculateClusters`) that reflect objectives, enemy positions, supply points, and build needs.
- Weights candidate unit types by expected damage against nearby enemy units (`sortByDamage`).
- In fog rounds, biases toward units with max vision.
- Avoids overproducing one unit type and avoids naval overcommitment based on current ratios.
- Picks a (building, deploy vector, unit type) combination by estimated cost to reach the closest target cluster.

### Powers and skills
Files: `DionysusAlpha.activatePower`, `lib/shouldActivatePower.tsx`

- Checks available skills and charge, then selects a skill to activate.
- `shouldActivatePower` uses unit completion ratios for skill types that affect active units; it avoids activation when the ratio is unfavorable.
- Power activation uses `getActivatePowerTargetCluster` to select a target cluster when required.
- `BaseAI` converts power activations into effect responses via `hermes/getActivatePowerMessage`.

### Special abilities and tactical actions
- Supply: After moving, units with supply ability will refill nearby units if needed.
- Transport/drop: Transport units will drop cargo when a target is reachable and a valid drop tile exists.
- Fold/unfold: Units with unfold ability will unfold to attack if a visible target is in range; otherwise they fold to reposition.
- Lightning: Radar buildings can toggle lightning tiles as a strategic action when charge allows.

## Interactions with other packages

- `@deities/athena` (core game model)
  - Provides all data structures (MapData, Unit, Building, Player, Vector) and domain rules.
  - Supplies key algorithms: movement radius (`moveable`), attack radius (`attackable`), damage estimation, capture eligibility, skills/abilities, objectives, and map generation helpers.
  - Dionysus reads these systems but does not mutate state directly; it relies on action execution.

- `@deities/apollo` (action system and rules engine)
  - Dionysus constructs actions (`MoveAction`, `AttackUnitAction`, `CreateUnitAction`, etc.) and executes them through `apollo.execute`.
  - `BaseAI` handles `ActionResponse` sequences, applies conditions, and updates `Effects`.
  - `AIRegistryT` in `apollo/actions/executeGameAction.tsx` defines the runtime contract for AI registration and invocation.

- `@deities/hermes` (message/effect helpers)
  - Only used for `getActivatePowerMessage`, which turns skill activation into effect messages and extra state changes.

No other packages depend on Dionysus directly in the open-source tree; integration occurs through `apollo` by passing `AIRegistry` to `executeGameAction` in the app layer.

## Tests

- `dionysus/lib/__tests__/estimateClosestTarget.test.tsx` verifies that `estimateClosestTarget` works even when the unit's player is not present on the map, protecting a common edge case in AI target evaluation.
