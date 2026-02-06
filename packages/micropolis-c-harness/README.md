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
- batch GenerateMap mode:
  - `--batch-cases <path>`
  - each case-file line:
    - `<seed:u32> <treeLevel:i32> <lakeLevel:i32> <curveLevel:i32> <createIsland:i32> <runSmoothWater:0|1>`
  - writes concatenated `u16le` maps in input order
- op-specific args for `--op putOnMap`:
  - `--map-x <i32>`
  - `--map-y <i32>`
  - `--mchar <i32>`
  - `--xoff <i32>`
  - `--yoff <i32>`
- op-specific args for `--op brivPlop|srivPlop`:
  - `--map-x <i32>`
  - `--map-y <i32>`
- op-specific args for `--op doRivers`:
  - `--x-start <i32>`
  - `--y-start <i32>`
  - optional `--curveLevel <i32>` (defaults to `-1` if omitted)

Implemented ops:

- `noop`
- `smoothTrees`
- `putOnMap`
- `smoothWater`
- `smoothRiver`
- `brivPlop`
- `srivPlop`
- `makeLakes`
- `doRivers`

## Core Oracle (Headless Simulation)

- Source:
  - `packages/micropolis-c-harness/core/core_oracle.c`
  - `ref/micropolis/src/sim/s_traf.c` (compiled directly with a headless shim header)
  - `ref/micropolis/src/sim/s_power.c` (compiled directly with a headless shim header)
- Binary output (generated): `packages/micropolis-c-harness/build/core/micropolis-core-oracle`
- TS wrapper: `@city/micropolis-c-harness/core-parity`

### Build

```sh
pnpm --filter @city/micropolis-c-harness build:core
```

### Commands

`micropolis-core-oracle <command> --state-dir <dir> [options]`

- `init-new-city [--seed <u32>] [--city-time <i64>] [--city-tax <i32>] [--sim-speed <i32>]`
- `step-phase --phase <0..15>`
- `step-tick [--start-phase <0..15>]`
- `make-traf --x <i32> --y <i32> --source <0|1|2>`
- `do-power-scan`
- `snapshot`

State directory files:

- `snapshot.json` (scalar metadata)
- `map.u16le` (`Map[WORLD_X][WORLD_Y]`, x-major)
- `trf-density.u8` (`TrfDensity[HWLDX][HWLDY]`, x-major)
- `rate-og-mem.i16le` (`RateOGMem[SmX][SmY]`, x-major)
- `power.u16le` (`PowerMap[PWRMAPSIZE]`, linear)
- `power-stack-x.u8` (`PowerStackX[PWRSTKSIZE]`, linear)
- `power-stack-y.u8` (`PowerStackY[PWRSTKSIZE]`, linear)

Current snapshot transport is `json+binary` sidecars.
Planned follow-up: migrate to a single binary envelope after schema stabilization.
