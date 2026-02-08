# Stage 4.6 Performance and Stability Notes

Date: 2026-02-08

## Scope

This pass focused on map-update hot paths used by browser runtime composition:

- `packages/sim-core/src/core/map-store.ts`
- `packages/sim-core/src/core/map-invalidation.ts`

Parity alignment references:

- `ref/micropolis/src/sim/w_map.c` (`DoUpdateMap`, `NewMap` gating)
- `ref/micropolis/src/sim/g_map.c` (`setUpMapProcs`, map mode ordering)

## Measurement Method

Benchmark command (run before and after code changes):

```sh
pnpm exec tsx /tmp/map-store-bench.ts
```

Benchmark profile:

- `noop-tick`: `beginTick()` + `commitTick()` with no layer access.
- `representative-tick`: deterministic writes each tick to `map` + `popDensity` + `trfDensity`.
- Host machine: local development workstation (same environment for pre/post).

## Pre/Post Metrics

| Metric | Pre | Post | Delta |
| --- | ---: | ---: | ---: |
| `noop-tick` avg ms/tick | 0.003956 | 0.000560 | -85.85% |
| `noop-tick` p95 ms/tick | 0.006250 | 0.000375 | -94.00% |
| `representative-tick` avg ms/tick | 0.035640 | 0.034541 | -3.08% |
| `representative-tick` p95 ms/tick | 0.058625 | 0.055792 | -4.83% |

## Stability Soak Outcome

Soak verification command:

```sh
pnpm --filter @city/sim-core test -- src/core/map-store.soak.test.ts
```

Outcome:

- Pass: deterministic 4096-tick sustained-write soak (4 full 10-bit cycle wraps, matching C `& 1023` cycle behavior in `sim.c`/`s_sim.c`).
- Pass: out-of-bounds and non-integer write index guards throw stable errors.

## Resulting Policy Changes

- `DoubleBufferMapStore` now lazily prepares layer work buffers per tick (untouched layers are no longer eagerly copied).
- Map redraw planning now supports deterministic dirty-rectangle generation from authoritative `map` patches, while preserving `NewMap`/`NewMapFlags` full-redraw precedence.
