# Zeus Package Overview

## Status in this repo
- `zeus/` is a placeholder in the open-source mirror. Only `zeus/package.json` is present; no `src/` or build files exist here.
- The purpose and architecture below are inferred from its dependency list and from how other packages reference it.

## Purpose (inferred from dependencies + repo context)
Zeus appears to be a **shared utilities package** used by both the client app (`ares/`) and the backend (`artemis/`). Its dependency set suggests two core responsibilities:

1) **Shared game-domain utilities**
- Depends on `@deities/athena`, `@deities/apollo`, and `@deities/hermes`, implying it operates on core game data structures (maps, actions, turn state) that must remain consistent across client and server.
- Likely provides pure helpers that enforce or normalize policy on top of these shared types (for example, validation or normalization of game artifacts before persistence or transport).

2) **User-generated content moderation**
- Depends on `@nkzw/profane`, which strongly implies profanity or forbidden-language filtering.
- This fits a cross-cutting concern that both client and server would need for input validation (usernames, map names, chat, campaign text, etc.).

In short: **Zeus is likely the “rules + moderation glue” package that sits between engine types and app/server policy.**

## Observed structure
- `zeus/package.json`: declares dependencies and module type.
- No other files are present, so there is no concrete module tree to describe in this OSS snapshot.

## Monorepo interactions (observed + inferred)
### Direct dependencies
- `@deities/athena`: deterministic map state and domain models.
- `@deities/apollo`: action/response system and encoding.
- `@deities/hermes`: turn-state encoding/decoding and campaign helpers.
- `@nkzw/core`: shared utility primitives (exact contents unknown in this repo).
- `@nkzw/profane`: profanity filtering utilities.

### Packages that depend on Zeus
- `@deities/ares` (client app)
- `@deities/artemis` (backend server)

This dependency direction is important: **Zeus is positioned to hold logic that must be identical in both the client and the server** (for example, validating text fields, normalizing map names, or enforcing game policy).

## Interfaces and data contracts Zeus likely touches
Because Zeus depends on Athena/Apollo/Hermes, any functions it exposes must respect the shared contracts defined in those packages. If you reimplement Zeus, these are the boundaries to preserve.

### Athena (map data)
- `MapData` / `PlainMap` are the canonical map state containers.
- If Zeus inspects or validates map state, it must treat these as **deterministic and immutable** inputs.

### Apollo (actions and responses)
- `Action` and `ActionResponse` are discriminated unions that encode game moves and outcomes.
- `EncodedAction` / `EncodedActionResponse` are compact wire formats used in networking and persistence.
- If Zeus performs policy checks around actions (e.g., allowed names, limits, or custom rules), those checks should be **pure functions** over these action types.

### Hermes (turn-state/campaign)
- `PreviousGameState` and turn-state encoding helpers define the snapshot formats for campaign play.
- If Zeus adds validation around campaign metadata or turn history, it should operate on the encoded/decoded Hermes forms consistently.

## Inferred systems and data flow
These flows are not proven by code (none is present), but they are the most plausible uses given the dependency shape.

1) **User-generated text moderation (client + server)**
- Input examples: username, map title, campaign title, chat, custom scenario text.
- Flow: Ares calls Zeus to validate/filter → user sees immediate feedback.
- Server enforcement: Artemis calls the same Zeus rules to reject/normalize before persistence or broadcast.
- Key requirement: **deterministic and identical results** across environments.

2) **Policy normalization for game artifacts**
- Input examples: serialized map metadata, custom rules, scenario configs.
- Flow: Ares uses Zeus for preflight validation → Artemis uses Zeus for authoritative validation.
- Key requirement: **shared policy boundaries** to avoid client/server mismatches.

3) **Cross-package glue utilities**
- Possible helpers to bridge `MapData` / `GameState` / `PreviousGameState` representations into safe, persisted forms.
- Potential error/result types (from `@nkzw/core`) to standardize validation outcomes.

## Reimplementation blueprint (language-agnostic)
If you rebuild Zeus in another language or for a different game, preserve the following architectural traits:

- **Pure, deterministic functions**
  - No I/O, no environment dependency; usable on client and server.
- **Shared domain contracts**
  - Accept and return the same domain shapes (or strict equivalents) as the simulation layer.
- **Moderation module**
  - A profanity/filtering subsystem with configurable allowlists/denylists.
  - Provide both boolean validation and “sanitized output” modes.
- **Policy/validation module**
  - Lightweight validation of game artifacts (names, titles, metadata, custom rules).
  - Return structured error types to support UI feedback and server enforcement.
- **Normalization utilities**
  - Canonical formatting (trim, unicode normalization, whitespace folding) so client and server behave identically.

## Gaps / unknowns in OSS
- No Zeus source files are present, so there is no authoritative API surface to document.
- The actual list of validation rules, profanity config, or data structures is unknown.
- Any runtime integration points (e.g., logging, i18n, or error types) are not observable here.

Despite these gaps, the **dependency position of Zeus** strongly indicates a **shared policy and moderation layer** that should stay deterministic and portable across platforms.
