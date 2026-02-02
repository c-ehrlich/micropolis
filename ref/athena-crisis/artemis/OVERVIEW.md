# Artemis Package Overview

## Status in this open-source repo

- `artemis/` is a placeholder in the OSS snapshot. The folder contains only `artemis/package.json` and no source files.
- The root docs explicitly call out `artemis` as a non-open-source backend package. See `README.md` and the root `OVERVIEW.md`.

Because the implementation is not present, the sections below are a **faithful, evidence-based reconstruction** from the dependency list in `artemis/package.json` and the shared interfaces that *are* present in other packages. Where something is inferred, it is labeled clearly.

## Purpose (inferred from dependencies + repo context)

**Artemis is the backend server for Athena Crisis**, responsible for player accounts, game persistence, matchmaking/realtime play, and external integrations (payments, email, notifications, etc.). In the full monorepo it likely:

- Hosts **HTTP + GraphQL APIs** (Express + GraphQL Yoga + Pothos).
- Owns **data persistence** (Prisma + Postgres adapter, session store).
- Runs **realtime game transport** (Socket.IO, Redis for scaling/presence).
- Integrates **payments** (Stripe), **email** (Resend), **push notifications**, and **auth** (passport/local, Google OAuth).
- Coordinates **game simulation** by calling into shared game logic (`@deities/athena`, `@deities/apollo`, `@deities/hermes`, `@deities/dionysus`).

## Observed structure in this repo

The package currently contains only:

- `artemis/package.json`: Declares dependencies, module type, and metadata. No entrypoints or source folders are included in OSS.

There is therefore **no local module tree to describe**, and the architecture below is reconstructed from shared contracts and dependencies.

## Interfaces & data contracts (shared, authoritative)

Even without the server code, a large part of Artemis’s interface is **defined by shared packages**. These are the contracts you must preserve if you rebuild the server in another language.

### Realtime socket contract (Apollo)

From `apollo/socket/Types.tsx` and `apollo/socket/Room.tsx`:

- Room naming helpers:
  - `gameRoom(gameId: number)` → `/game/<id>`
  - `pendingGameRoom(pendingGameId: number)` → `/pending-game/<id>`
- Client → Server events:
  - `/campaign-state/reset` (campaignStateID: string)
  - `/campaign-state/spectate` (campaignStateID: string)
  - `/game/action` (currentGameID: string, action: EncodedAction, emit: (EncodedGameActionResponseWithError) => void)
  - `/game/spectate` (gameID: string, spectatorCodes: string[])
- Server → Client events:
  - `/campaign-state/update` (campaignStateID: string)
  - `/game/action` (gameID: string, response: EncodedGameActionResponseWithError)
  - `/pending-game/update` (pendingGameID: string)
  - `/restart-server` ()

The server must speak these exact event names and payload shapes so the client (`hera`/`ares`) can interoperate.

### Game action/response wire format (Apollo)

From `apollo/Types.tsx` (and generated `apollo/EncodedActions.tsx` in the full repo):

- **EncodedAction**: compact, generated wire form of game actions.
- **EncodedActionResponse** / **EncodedGameActionResponse**: compact wire responses.
- **EncodedGameActionResponseWithError** is a discriminated union covering:
  - Normal game action responses
  - Error/passthrough/refresh markers (`{ n: 'x' | 'p' | 'r' | 'q' }`)
  - Map message payloads (`{ n: 'm', message: EncodedClientMapMessage }`)

This is the core network payload for `/game/action` and for broadcasting game state changes.

### Game state & map data (Athena + Apollo)

From `@deities/athena` and `apollo/Types.tsx`:

- `MapData` / `PlainMap` are the canonical, deterministic map state containers.
- `GameState` is a list of `[ActionResponse, MapData]` entries.
- `EncodedGameState` is the JSON/wire form (`[EncodedActionResponse, PlainMap]`).

If Artemis persists or serves game states, it should store and transmit the **encoded** form, then decode/encode at the edges.

### Campaign/turn-state encoding (Hermes)

From `hermes/game/*`:

- `PreviousGameState` is the turn-state structure:
  - `[state, lastActionResponse, effects, recentActions?]`
- `encodeTurnState` / `decodeTurnState` translate between `MapData` and `PlainMap` forms.
- `toClientGame` constructs the client-facing game shape (current map, last action, effects, turn state, ended flag).

If Artemis provides campaign or turn-state endpoints, it should use these encoding helpers to keep wire formats consistent.

### Routes and URL helpers (Apollo)

From `apollo/routes/*`:

- `getCampaignRoute`, `getMapRoute`, `getUserRoute` build stable URL slugs for user-facing routes.

Even if the backend generates routes, it should follow these same path patterns for consistency with the client.

## Interactions with other packages (what Artemis likely calls)

Based on dependencies and the repo architecture:

- `@deities/athena` (core deterministic model)
  - Used to load, validate, and serialize map state.
- `@deities/apollo` (actions + rules)
  - Used to validate/apply actions, compute `ActionResponse`, `Effects`, and encode/decode action wire formats.
- `@deities/hermes` (campaign + turn state)
  - Used to compute campaign progression, turn history, undo, and client-facing game summaries.
- `@deities/dionysus` (AI)
  - Used to generate AI turns and evaluate moves for CPU opponents.
- `@deities/i18n`
  - Used to localize server-generated messages, emails, or notifications.
- `@deities/zeus`
  - Not present in OSS; based on its own dependencies (e.g. profanity checks), it likely hosts shared server utilities such as moderation/filters.

The **client package** (`ares`, not open-source) would call Artemis for auth, persistence, matchmaking, and realtime updates. `hera` consumes the same wire formats and socket event names defined in `apollo`.

## External systems & services (inferred from dependencies)

The following integrations are strongly implied by the dependency list in `artemis/package.json`:

- **Database**: Prisma (`@prisma/client`, `@prisma/adapter-pg`) → Postgres.
- **Sessions**: `express-session` + `@quixo3/prisma-session-store`.
- **Cache/Presence/Queues**: `ioredis`.
- **File/Object Storage**: AWS S3 (`@aws-sdk/client-s3`, `s3-request-presigner`).
- **Realtime**: `socket.io` (likely with Redis adapter in full repo).
- **GraphQL**: `graphql`, `graphql-yoga`, Pothos (+ Prisma/Relay/Directives/Scope Auth/Complexity plugins).
- **Auth**: `passport`, `passport-local`, `google-auth-library`.
- **Payments**: `stripe`.
- **Email**: `resend`.
- **Push Notifications**: `node-pushnotifications` (and related typings).
- **Telemetry**: `@sentry/node`.
- **Discord**: `discord.js` (likely for community/bot or moderation tooling).
- **Ratings/Matchmaking**: `openskill`.
- **Utilities**: `@nkzw/immutable-map`, `@nkzw/safe-word-list`, `@nkzw/define-env`, `@nkzw/histogram`, `ua-parser-js`, `json-stable-stringify`.

These dependencies define the **system boundaries** Artemis must manage even if the internal code is missing here.

## Inferred data flow (end-to-end)

This is the most plausible request/response loop, grounded in the shared contracts:

1. **Client sends action** via Socket.IO `/game/action` with `EncodedAction` (Apollo).
2. **Server decodes + validates** using Apollo action validators and Athena map state.
3. **Server applies action** to produce `ActionResponse`, updated `MapData`, and `Effects`.
4. **Server encodes response** to `EncodedGameActionResponseWithError` and emits it to `/game/action` and appropriate rooms (`/game/<id>`).
5. **Server persists** the new game state in encoded form (`PlainMap` + `EncodedActionResponse`), likely using Prisma models.
6. **Campaign/turn state** is updated using Hermes (encode/decode + `toClientGame`).
7. **Optional AI turns** are computed using Dionysus and fed back into the same action pipeline.

This pipeline is consistent with the socket types and state/encoding helpers that are present in OSS.

## Reimplementation blueprint (language-agnostic)

If you rebuild Artemis in another language, **preserve these architectural seams**:

- **Core simulation as a pure library**
  - Keep Athena/Apollo/Hermes logic isolated and deterministic.
  - Treat the backend as an orchestrator that decodes inputs, calls simulation, and encodes outputs.
- **Canonical wire formats**
  - Preserve EncodedAction/EncodedActionResponse formats (or provide compatibility shims).
  - Preserve Socket.IO event names and payload shapes.
- **Persistence layer**
  - Store game state in encoded form (PlainMap + EncodedActionResponse).
  - Store turn state (Hermes `PreviousGameState`) and campaign data in encoded form.
- **Auth + sessions**
  - Maintain session-based auth (or token auth) with account linking (Google/local).
- **Realtime + matchmaking**
  - Keep a room-based broadcast model (`/game/<id>`, `/pending-game/<id>`).
- **External integrations**
  - Provide equivalents for payments (Stripe), email (Resend), and notifications.

## Gaps / unknowns in OSS

- No Prisma schema, GraphQL schema, resolvers, REST routes, or job workers are present in the OSS snapshot.
- `apollo/EncodedActions.tsx` and `apollo/Routes.tsx` are generated in the full repo and absent here.
- The exact DB schema, auth flows, and data models (users, games, purchases, etc.) are therefore unknown.

Despite these gaps, the **shared game-engine contracts** (Athena/Apollo/Hermes) and the **socket event interfaces** provide a stable, language-agnostic blueprint for recreating Artemis.
