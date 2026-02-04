# Terrain C Harness Plan (Micropolis Parity)

This document describes how to build a tiny standalone C harness around Micropolis terrain generation so we can:

1) generate **golden fixtures** (byte-for-byte map dumps), and  
2) optionally run **property-style parity tests** (many randomized inputs) comparing TS output to C output.

Primary references:
- Spec: `ref/micropolis/spec/terrain/SPEC.md`
- Canonical C: `ref/micropolis/src/sim/s_gen.c` (+ `ref/micropolis/src/sim/headers/macros.h` for `TestBounds`)

---

## Why a harness (and why now)

The terrain generator is deterministic but full of “parity traps”:
- masked vs raw tile comparisons,
- inclusive `Rand(range)` semantics,
- overwrite rules (`PutOnMap`),
- early-return random-island behavior,
- C integer division vs JS floating division.

Unit tests can verify local invariants, but **the most reliable test is full-map equality** against the actual C implementation.

---

## Target artifact: `micropolis-terrain-harness`

### Inputs (CLI flags)
The harness should accept the same knobs as C globals in `s_gen.c`:
- `--seed <u32>` (maps to `GenerateMap(int r)` argument)
- `--treeLevel <i32>` (maps to `TreeLevel`)
- `--lakeLevel <i32>` (maps to `LakeLevel`)
- `--curveLevel <i32>` (maps to `CurveLevel`)
- `--createIsland <i32>` (maps to `CreateIsland`)

Optional quality-of-life:
- `--format u16le` (default) | `--format json` (for debugging)
- `--dump-path <path>` (writes to file) OR default to stdout

### Output
Default output should be a **raw `uint16_t` dump in little-endian**, column-major order, length `WORLD_X * WORLD_Y`.

Rationale:
- TS can read it into a `Uint16Array` and compare directly.
- LE encoding avoids “host-endian” fixture instability.

---

## Implementation strategy (C)

### Goal: compile without Tk/X11/UI deps
We do **not** want to build the whole Micropolis app. We only want enough C to run terrain.

Recommended approach:

1) Create a new harness package/directory (reusable for other C parity work):
   - `packages/micropolis-c-harness/`
2) Add a standalone C translation unit for terrain, e.g.:
   - `packages/micropolis-c-harness/terrain/terrain_harness.c`
   that contains:
   - a minimal `Map` storage equivalent to `Map[x][y]` from C (column-major in memory is fine, since we control output),
   - the Micropolis RNG functions used by terrain (`sim_srand`, `sim_rand`, `SeedRand`, `Rand16`, `Rand(range)`, `ERand`),
   - the terrain routines from `ref/micropolis/src/sim/s_gen.c` required by `GenerateMap`:
     - `GenerateMap`, `ClearMap`, `MakeNakedIsland`, `MakeIsland`,
     - `GetRandStart`, `DoRivers` (`DoBRiv`, `DoSRiv`, `MoveMap`, plops),
     - `MakeLakes`, `DoTrees`, `SmoothRiver`, `SmoothTrees`, `SmoothWater`,
     - plus `PutOnMap`, `TestBounds` macro, and any needed helpers/constants.

This is effectively “copy the terrain subset into a tiny executable”, keeping the original logic intact.

Notes:
- Keep the function bodies **as close to the original C as possible** (1:1).
- Keep C integer semantics (especially divisions and truncations).
- Don’t try to “port it again” inside the harness; the harness should be the reference implementation.

### Constants and types
The harness needs the classic world dimensions and tile constants:
- `WORLD_X = 120`, `WORLD_Y = 100` (as used by classic Micropolis / sim-core `World`)
- Tile IDs and masks/flags used by terrain (`DIRT`, `RIVER`, `REDGE`, `CHANNEL`, `LOMASK`, `BULLBIT`, `BURNBIT`, etc.)

Prefer copying these from the Micropolis C headers used by `s_gen.c`, or duplicating them verbatim in the harness with a comment that cites their source file.

---

## Build integration

### Deterministic local build
Add a build script (shell or node) that compiles the harness with the system C compiler.

Example commands (macOS/Linux):
```sh
cc -O2 -std=c99 -Wall -Wextra \
  -o packages/micropolis-c-harness/build/terrain/micropolis-terrain-harness \
  packages/micropolis-c-harness/terrain/terrain_harness.c
```

### CI considerations
Options:
- Build the harness in CI before tests run (preferred).
- Or check in a prebuilt binary (not preferred: OS/arch portability).

---

## Fixture workflow (recommended “first win”)

1) Build the harness binary.
2) Generate a fixture:
   - choose a seed and knobs,
   - run the harness to produce `*.u16le`,
   - commit the fixture under `packages/sim-core/fixtures/terrain/`.
3) Write a Vitest test that:
   - loads the fixture file,
   - runs `generateMap(...)` with the same parameters and `reseedAfter: false`,
   - compares `Uint16Array` equality for **every cell**.

Fixture naming suggestion:
```
packages/sim-core/fixtures/terrain/
  gen_seed-123_tree--1_lake--1_curve--1_island--1.u16le
```

Include a small adjacent JSON “manifest” if helpful:
- the exact CLI used,
- and citations to `s_gen.c` / spec for interpretation.

---

## Property-style parity tests (after fixtures)

Once the harness exists, we can add a second test file that compares TS vs C for many random inputs.

Key points:
- Use a deterministic PRNG for choosing test cases (fast-check already exists in this repo).
- Gate the test behind a parity test command (so CI stays fast), e.g. `pnpm test-parity`.
- Keep sample counts modest (e.g. 20–200 cases) and focus on branch coverage:
  - many seeds with `createIsland=-1` to naturally hit the 10% island branch,
  - edge knob values: `-1`, `0`, small positives.

---

## TypeScript test integration examples

### 1) Running the harness and parsing stdout (`u16le`)
```ts
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const harnessPath =
  'packages/micropolis-c-harness/build/terrain/micropolis-terrain-harness';

function runHarness(args: string[]): Uint16Array {
  const out = execFileSync(harnessPath, args);
  // `out` is a Buffer containing u16 little-endian words.
  // Convert to Uint16Array in a way that respects LE encoding.
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  const words = new Uint16Array(out.byteLength / 2);
  for (let i = 0; i < words.length; i += 1) {
    words[i] = view.getUint16(i * 2, true);
  }
  return words;
}

it('parity: seed=123 defaults', () => {
  const expected = runHarness([
    '--seed=123',
    '--treeLevel=-1',
    '--lakeLevel=-1',
    '--curveLevel=-1',
    '--createIsland=-1',
    '--format=u16le',
  ]);

  // ...run TS generateMap(...) to produce actual...
  // expect(actual).toEqual(expected);
});
```

### 2) Loading a committed fixture file (`*.u16le`)
```ts
import { readFileSync } from 'node:fs';

function loadU16LE(path: string): Uint16Array {
  const buf = readFileSync(path);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const words = new Uint16Array(buf.byteLength / 2);
  for (let i = 0; i < words.length; i += 1) {
    words[i] = view.getUint16(i * 2, true);
  }
  return words;
}
```

### 3) Optional “property parity” sketch (gated)
```ts
import fc from 'fast-check';

if (process.env.CITY_TEST_PARITY === '1') {
  it('parity: many random seeds/knobs', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 50_000 }),
        fc.constantFrom(-1, 0, 1, 5, 10),
        fc.constantFrom(-1, 0, 1, 6, 12),
        fc.constantFrom(-1, 0, 1, 20, 50),
        fc.constantFrom(-1, 0, 1),
        (seed, treeLevel, lakeLevel, curveLevel, createIsland) => {
          const expected = runHarness([
            `--seed=${seed}`,
            `--treeLevel=${treeLevel}`,
            `--lakeLevel=${lakeLevel}`,
            `--curveLevel=${curveLevel}`,
            `--createIsland=${createIsland}`,
            '--format=u16le',
          ]);

          // ...generate TS map...
          // return arraysEqual(actual, expected);
        },
      ),
      { numRuns: 50 },
    );
  });
}
```

---

## What this enables next

Once we have fixtures and parity tests:
- We can safely refactor TS terrain code without fear (full-map byte equality).
- We can confidently implement the remaining plan items (especially the reseed behavior and city reset helper).
- We can narrow down any mismatches to a specific stage by adding “stage checkpoints” (optional harness feature: dump map after each pipeline step).
