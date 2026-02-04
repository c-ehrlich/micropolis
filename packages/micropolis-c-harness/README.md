# `@city/micropolis-c-harness`

Tiny standalone C harnesses that embed Micropolis reference code from `ref/micropolis/` to generate golden fixtures and run parity checks against sim-core TypeScript ports.

## Terrain

- Source: `packages/micropolis-c-harness/terrain/terrain_harness.c`
- Binary output (generated): `packages/micropolis-c-harness/build/terrain/micropolis-terrain-harness`

### Build

```sh
pnpm --filter @city/micropolis-c-harness build:terrain
```

### Generate terrain fixtures (writes into sim-core)

```sh
pnpm --filter @city/micropolis-c-harness gen:terrain-fixtures
```

