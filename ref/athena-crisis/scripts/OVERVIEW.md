# scripts/ package overview

## Snapshot (what exists in this repo)
- This workspace package is currently a stub. It only contains `scripts/package.json` and no source files or entry points.
- The root `OVERVIEW.md` explicitly calls out `scripts/` as a package stub and notes that several build scripts are missing from this open-core repo (e.g., `scripts/variant-loader.js`, `scripts/build-assets.tsx`).

## Observed interfaces and dependencies
### Package metadata
- Name: `@deities/scripts` (private)
- Type: ESM (`"type": "module"`)
- Version: `0.0.1`
- Description: "Athena Crisis scripts."

### Declared dependencies (workspace)
These indicate the domains the scripts are expected to operate on:
- `@deities/athena`: core deterministic map model, rules, and serialization.
- `@deities/apollo`: action/response system, game-state transitions, effects, objectives.
- `@deities/art`: sprite variant metadata and palette logic.
- `@deities/hermes`: campaign data, turn-state encode/decode, and undo helpers.

### Declared dependencies (third-party)
These indicate the likely mechanics of the scripts:
- `canvas`: image rendering/rasterization in Node (asset or atlas processing).
- `glob`: filesystem discovery (batch processing of assets/data).
- `chalk`: CLI output formatting (task logs/status).

## Missing pieces (explicitly noted in repo)
The root `OVERVIEW.md` mentions missing build scripts that likely lived here:
- `scripts/variant-loader.js`
- `scripts/build-assets.tsx`

No code for these scripts exists in this repo, so their exact inputs/outputs and behavior cannot be confirmed here.

## Inferred purpose and role (based on dependencies and repo context)
**Inference (not present in source):** This package most likely hosts Node-based CLI tooling for build-time or dev-time tasks that are not part of the runtime game/client/server. The dependency set strongly suggests:
- **Asset pipeline tooling**: Use `@deities/art` metadata plus `canvas` to build sprite atlases, palettes, or derived asset manifests.
- **Data compilation/validation**: Validate or compile map/campaign data that uses `@deities/athena` and `@deities/hermes` schemas.
- **Codegen/formatting helpers**: Possibly generate stable IDs or metadata used by `@deities/apollo` action maps or other registries.

Because the scripts are missing, the above is a reconstruction based on the dependency graph and root overview notes.

## Likely data structures and interfaces it would consume
If recreated, the scripts would likely import and operate on:
- **Art metadata** from `@deities/art` (e.g., `Variants.tsx`, `Sprites.tsx`, `AssetInfo.tsx`) to enumerate sprite variants, palettes, and asset dependencies.
- **Map and rules data** from `@deities/athena` (e.g., map serialization, tile/unit/building info) to compile or validate scenario assets.
- **Actions and objectives** from `@deities/apollo` to map action IDs, conditions, and effect definitions into tooling outputs.
- **Campaign/turn data** from `@deities/hermes` for validation, packaging, or migration tasks.

These are the stable cross-package interfaces that scripts would depend on to avoid duplicating game logic.

## Likely data flows (reconstructable from dependency set)
**Inference (not present in source):** A typical script flow would look like:
1. **Discovery**: Use `glob` to collect files (asset sources, map definitions, or campaign data).
2. **Load domain models**: Import metadata/models from `@deities/art`, `@deities/athena`, `@deities/hermes`, `@deities/apollo`.
3. **Transform/validate**: Run deterministic transforms using the same logic the game uses (ensuring fidelity).
4. **Render/compile**: Use `canvas` (if assets) or serializers (if maps/campaigns) to produce derived artifacts.
5. **Write outputs + report**: Emit compiled artifacts and log results via `chalk`.

## How it likely interacts with other packages
**Inference (not present in source):**
- **`art/`**: feeds and receives derived asset manifests or atlases; ensures metadata is consistent.
- **`athena/` + `apollo/`**: uses core game logic to avoid tool/runtime divergence.
- **`hermes/`**: packages or validates campaign/turn structures at build time.
- **`codegen/`**: may be coordinated with code generation (not in this package but could share config).
- **`docs/` or `hera/`**: could consume generated assets or validated data produced by scripts.

## Rebuild blueprint (language-agnostic, based on architecture signals)
If you were to recreate this package in another language, preserve these architectural traits:
- **CLI-first toolset**: A small collection of independent commands (one task per script), each with a clear input/output contract.
- **Use core libraries, not reimplementations**: Import the same game data models and serializers the runtime uses.
- **Deterministic outputs**: Asset/campaign compilation should be deterministic (stable hashes, repeatable output).
- **Explicit file graph**: Discover inputs via glob patterns; store them in a manifest so builds are reproducible.
- **Separable pipelines**: Keep asset rendering, data validation, and codegen in separate commands to allow targeted runs.

## Current limitations in this repo
- There is no executable code to analyze, so interfaces, data structures, and flows can only be inferred.
- Any recreation should start by recovering or re-specifying the missing scripts (named above) and validating their expected outputs against the closed-source build pipeline.

