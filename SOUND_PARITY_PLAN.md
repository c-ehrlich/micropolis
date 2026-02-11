# Sound Parity Plan (Micropolis C Alignment)

## Goal

Implement gameplay sound as an authoritative runtime pathway that mirrors Micropolis C behavior, instead of route-side heuristics.

Target outcome:

- Sound events are produced by authority/host logic at the same points C triggers `MakeSound` / `MakeSoundOn`.
- Web client plays host-emitted sound events only.
- Index page "Sound Test" remains a manual test harness, not gameplay plumbing.

## Source-Of-Truth C Pathways (must mirror)

### 1. Tool success/error pathways

- `DidTool(...)` emits `UIDidTool*` callback names in `ref/micropolis/src/sim/w_tool.c`.
  - Reference: `ref/micropolis/src/sim/w_tool.c:890`
- Tool failures emit message + sound directly in `DoTool` / `ToolDown`:
  - out-of-bounds (`-1`) -> `SendMes(34)` + `MakeSoundOn(..., "UhUh")`
  - no-funds (`-2`) -> `SendMes(33)` + `MakeSoundOn(..., "Sorry")`
  - Reference: `ref/micropolis/src/sim/w_tool.c:1544`
- Tool-specific success sounds are defined by `UIDidTool*` Tcl callbacks.
  - Reference: `ref/micropolis/res/micropolis.tcl:2733`

### 2. Message first-display sounds

- `doMessage` plays first-time sound effects for specific message IDs.
  - Reference: `ref/micropolis/src/sim/s_msg.c:320`

### 3. Realtime/sprite sounds

- Realtime systems call `MakeSound("city", ...)` for traffic, monster, explosions, etc.
  - Reference: `ref/micropolis/src/sim/w_sprite.c:768`

### 4. Sound dispatch boundary

- All sound intent funnels through `MakeSound` / `MakeSoundOn` in C.
  - Reference: `ref/micropolis/src/sim/w_sound.c:93`
- Tcl forwards `EchoPlaySound` to the activity process as `PlaySound <token>`.
  - Reference: `ref/micropolis/res/micropolis.tcl:939`
- Activity wrapper lowercases token and loads `<name>.wav`.
  - Reference: `ref/micropolis/micropolisactivity.py:194`

## Current Divergence (to remove)

1. `apps/web` gameplay route currently derives sound from reject/message state locally.
2. `SimCoreEnvelopeHost` does not emit authoritative sound payloads.
3. Runtime protocol has no sound delta payload.
4. Sound test helper module is being used by gameplay path as a convenience layer.

## Parity Constraints

- Maintain deterministic envelope ordering (`tick` + `serverSeq`) for sound events.
- Keep sound ownership in host authority, not route heuristics.
- Respect C-style sound gating (`UserSoundOn`) as closely as possible.
- Preserve Sugar token normalization semantics (`first token` + lowercase for wav lookup).
- Preserve sound data through replay/resync envelope streams even if client playback policy differs.
- Allow authoritative sound deltas on any sequenced host envelope (`ack`/`reject`/`patch`/`snapshot`/`resync`).

## Decisions Locked (from discussion)

- [x] Sound transport is generalized: sound play requests may be attached to any sequenced host event type, not patch-only.
- [x] Replay/resync streams must include sound deltas in the data model.
- [x] Sound payload shape will be:
  - [x] `channel: string`
  - [x] `soundSpec: string` (full Micropolis spec string, non-normalized)
  - [x] `scope?: { kind: 'view' | 'global'; target?: string }` for `MakeSoundOn` parity metadata
- [x] `MakeSoundOn` scope metadata will be included.
- [x] Tool success parity covers all playable tools (`UIDidTool*` mapping), not a subset.
- [x] Message sound authority comes from host-side `SimHooks.makeSound` capture, replacing route message-id inference.
- [x] Asset coverage target is full gameplay parity: every original gameplay sound callsite should resolve in web runtime.
- [x] Missing wav handling in runtime consumer: log warning + skip playback.
- [x] Client playback default: only play sounds from envelopes accepted as reducer outcome `applied`.
- [x] `userSoundOn` policy: host gates emission by sim state; client also gates playback defensively.

## Implementation Plan

## Phase 0: Contract And Semantics Lock

- [x] Add protocol payload types for sound deltas in `apps/web/src/game/runtime/protocol.ts`.
- [x] Add a shared sound delta schema usable by any sequenced envelope.
- [x] Lock parity payload shape:
  - [x] `channel` (e.g., `city`, `edit`, `warning`, etc.)
  - [x] `soundSpec` (full Micropolis spec string, not pre-normalized)
  - [x] `scope` metadata (`view`/`global` + optional target)
- [x] Lock replay semantics:
  - [x] Preserve sound deltas through replay tail/resync payload data.
  - [x] Keep client playback policy independent from transport inclusion.

Deliverable: protocol/test updates that compile and document sound envelope semantics.

## Phase 1: Authoritative Host Sound Emission

- [ ] Extend `SimCoreEnvelopeHost` to capture and queue pending sound events per tick.
- [ ] Wire `SimHooks.makeSound` in host constructor (currently only `uiSet/sendMes/sendMesAt` are wired).
- [ ] Wire realtime `onSound` callback from `createRealtimeContext(...)` into host sound queue.
- [ ] Emit queued sounds on authoritative sequenced envelopes in the same command/tick cycle.
- [ ] Gate host sound emission by `simState.userSoundOn` parity with `w_sound.c` `UserSoundOn` check.

### Tool parity sub-phase

- [ ] Mirror C tool error sounds in host command handling (not route):
  - [ ] reject `out-of-bounds` -> `UhUh`
  - [ ] reject `no-funds` -> `Sorry`
- [ ] Mirror C tool success `DidTool` sound intent at host level:
  - [ ] map every playable tool -> `UIDidTool*` sound token/spec from `micropolis.tcl`
  - [ ] prefer `packages/sim-assets` helpers where possible, extending as needed for full tool parity

### Message parity sub-phase

- [ ] Replace route-side message-id sound mapping with host-emitted sound deltas only.
- [ ] Use sim-core `SimHooks.makeSound` capture as message sound source-of-truth (`doMessage` parity).
- [ ] Keep mapping source-traceable to `s_msg.c` first-display switch.

Deliverable: host emits authoritative sound deltas for tool/message/realtime sources.

## Phase 2: Web Runtime Audio Engine (Consumer)

- [ ] Add dedicated gameplay audio consumer module (separate from manual sound-test module).
- [ ] Consume sound deltas from sequenced runtime envelopes and play them via `Audio` API.
- [ ] Keep token normalization + wav path behavior equivalent to Sugar (`first token`, lowercase).
- [ ] Handle browser autoplay restrictions gracefully (best-effort playback, no state corruption).
- [ ] Respect runtime HUD sound option state (`userSoundOn`) when applying deltas (defensive client gate).
- [ ] Only attempt playback for envelopes with reducer outcome `applied`.
- [ ] On missing wav assets: `console.warn` with token/spec context, then skip.
- [ ] Keep replay transport/playback split explicit (sound data always present; playback policy configurable).

Deliverable: route plays only host-provided sound deltas.

## Phase 3: Remove Route Heuristics

- [ ] Remove gameplay sound derivation from route reject/message inspection.
- [ ] Keep `/` Sound Test section as manual verification only.
- [ ] Ensure no gameplay path imports mapping helpers intended only for sound preview UI.

Deliverable: single authoritative sound path from host envelopes.

## Phase 4: Asset Coverage Parity

- [ ] Audit `apps/web/public/sounds` vs Micropolis required tokens (`ref/micropolis/res/sounds`).
- [ ] Add missing wav assets for all C-triggered gameplay sounds (tool/message/realtime/disaster pathways).
- [ ] Produce a traceable sound inventory doc/table:
  - [ ] token/spec
  - [ ] wav file name
  - [ ] C/Tcl source location
  - [ ] human-readable gameplay usage note
- [ ] If any original gameplay sound is unreachable in current runtime, document why and create follow-up tasks.
- [ ] Menu-only/non-gameplay sounds may be deferred, but must be explicitly marked as such.

Deliverable: gameplay-triggered C sound tokens resolve to available browser assets.

## Test Plan

## Host-level parity tests

- [ ] `sim-core-envelope-host.test.ts`:
  - [ ] tool no-funds/out-of-bounds emits expected sound token in same settlement cycle.
  - [ ] message first-time IDs emit C-matching sound specs.
  - [ ] realtime events emit expected sound specs.
  - [ ] `userSoundOn=false` suppresses sound deltas.

## Protocol/runtime tests

- [ ] `protocol.test.ts` / reducer tests validate sound payload shape and ordering behavior.
- [ ] tests validate sound transport on any sequenced envelope type (not patch-only coupling).
- [ ] replay/resync tests confirm sound deltas are preserved in replay payload data.
- [ ] runtime tests confirm playback is suppressed for non-`applied` envelope outcomes.

## UI audio tests

- [ ] route/runtime audio tests assert playback is driven by host sound deltas only.
- [ ] route/runtime audio tests assert missing-asset warn+skip behavior.
- [ ] route/runtime audio tests assert `userSoundOn=false` suppresses playback even if deltas arrive.
- [ ] verify Sound Test remains independent/manual.

## Asset parity tests

- [ ] add coverage that the required gameplay token set has corresponding `/sounds/*.wav` files.
- [ ] add coverage that the token inventory doc remains in sync with shipped assets.

## Acceptance Criteria

- [ ] Building with insufficient funds plays `Sorry` via host-emitted sound delta.
- [ ] Invalid placement plays `UhUh` via host-emitted sound delta.
- [ ] All playable tool success sounds come from authoritative host sound deltas.
- [ ] Message-driven siren/monster/explosion/honk sounds come from authoritative host sound deltas.
- [ ] Route no longer infers gameplay sounds from reject/message state.
- [ ] Missing assets warn and skip without corrupting runtime state.
- [ ] Replay/resync preserves sound deltas in transport data.
- [ ] Behavior is traceable to C sources listed in this document.

## Execution Commands (final gate)

- `pnpm typecheck`
- `pnpm lint`
- `pnpm format`
