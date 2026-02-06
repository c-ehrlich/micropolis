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

### Terrain op mode (map transforms)

`micropolis-terrain-harness` now supports operation mode:

- `--op <name>`
- `--input-map <path>` (x-major `u16le`, required in op mode)
- `--seed <u32>` (required for RNG-dependent ops)
- `--format u16le|json`
- `--dump-path <path>`
- op-specific args for `--op putOnMap`:
  - `--map-x <i32>`
  - `--map-y <i32>`
  - `--mchar <i32>`
  - `--xoff <i32>`
  - `--yoff <i32>`

Implemented ops:

- `noop`
- `smoothTrees`
- `putOnMap`
