# Athena Crisis Art Package Overview

## Purpose
The `art/` package is the runtime metadata and palette-variant system for sprite assets. It does **not** ship the actual PNGs; instead it:

- Describes which sprite sheets exist and which variants (player colors, biome swaps) are expected.
- Loads or generates per-variant images at runtime using palette swaps.
- Publishes CSS class names (`.Sprite-<name>`) that the renderer (`hera/`) uses to display sprites.
- Falls back to a versioned CDN for prebuilt assets when palette swapping is disabled.

This package is the bridge between deterministic game data (`athena/`) and rendering (`hera/`), providing a consistent naming/variant scheme and a way to resolve those variants to URLs or `HTMLImageElement`s.

## Package structure

- `art/AssetInfo.tsx`
  - Defines the CDN base and version used for fallback assets.
  - `AssetDomain` and `AssetVersion` are composed into URLs: `${AssetDomain}/${AssetVersion}/${name}.png`.

- `art/VariantConfiguration.tsx`
  - The authoritative config of which sprite sheets are variant-aware and how.
  - Exports:
    - `Palette`: `number | Map<HEX, HEX>` (palette swap definitions).
    - `SpriteVariantConfiguration`:
      - `variantNames`: `Set<PlainDynamicPlayerID | Biome>` for naming keys.
      - `asImage?`: preload into `imageMap` for `spriteImage()` usage.
      - `ignoreMissing?`: ignore palette swap misses (useful for shadow/decorator sheets).
      - `waterSwap?`: run a second biome-based swap pass.
  - `variantNames` uses `PlayerIDs` and also supports dynamic players `-1/-2/-3` for portraits.
  - `biomeVariantNames` are derived from `BiomeVariants`.

- `art/Variants.tsx`
  - Declares a `Map<SpriteVariant, SpriteVariantDetail | null>` with an entry for every `SpriteVariant` from `athena/info/SpriteVariants.tsx`.
  - In the OSS repo every entry is `null`. In the full build, a generated module supplies actual sources and palettes.
  - `SpriteVariantDetail` contains:
    - `source`: base image URL for palette swapping.
    - `staticColors?`: colors that should never be swapped.
    - `variants`: `Map<PlainDynamicPlayerID | Biome, Palette>`.

- `art/BiomeVariants.tsx`
  - Builds a `Map<Biome, Map<HEX, HEX>>` by combining `getBiomeStyle(biome).palette` and `.waterSwap` from `athena/`.
  - Used when `waterSwap` is enabled in `VariantConfiguration` to recolor water per biome.

- `art/Sprites.tsx`
  - The runtime engine that materializes variant images, injects CSS, and provides lookup APIs.
  - Key exports:
    - `prepareSprites()` / `preparePortraits()`: async; generate CSS + URLs.
    - `hasSpriteURL(sprite, variant, biome?)`: check availability of biome-specific variants.
    - `spriteURL(sprite, variant)`: get a URL after preparation.
    - `spriteImage(sprite, variant)`: get a preloaded `HTMLImageElement`.
    - `hasPreparedSprites()` / `hasPreparedPortraits()` flags.

- `art/types/athena-crisis-asset-variants.d.ts`
  - Declares the ambient module `athena-crisis:asset-variants` that supplies the real `Variants` map at build/runtime.
  - This module is injected by the asset pipeline (not present in OSS).

## Core data structures and interfaces

### Sprite identity
- `SpriteVariant` (from `athena/info/SpriteVariants.tsx`) is the canonical string union of sprite sheets (units, buildings, effects, UI, etc.).
- Every `SpriteVariant` must be present in **both**:
  - `Variants` map (sprite -> variant metadata or `null`), and
  - `VariantConfiguration` map (sprite -> how to build variants).
- `Sprites.tsx` enforces a strict size match between `Variants` and `VariantConfiguration` to prevent drift.

### Variant naming convention
- Variant keys are **numeric** for players and **enum values** for biomes.
- Final sprite keys are strings:
  - Base: `${sprite}-${variant}`
  - Biome water swap: `${sprite}-${variant}-${biome}`
- These keys are used to generate CSS class names: `.Sprite-${name}`.

### Runtime caches
- `sprites: Map<string, string>` maps sprite keys to URLs (blob or CDN).
- `imageMap: Map<string, [HTMLImageElement, Promise<void>]>` stores preloaded images for `spriteImage()`.
- `imageCache: HTMLImageElement[]` keeps images alive to avoid GC in some browsers.

## Runtime data flow

The key runtime flow is in `Sprites.tsx`:

1. **Configuration and variant metadata**
   - `VariantConfiguration` defines which variants to generate.
   - `Variants` (from `athena-crisis:asset-variants`) provides source images and palettes when available.

2. **Decide swapping strategy**
   - `shouldSwap()` returns `true` in dev/demo/offline; `false` in production online.
   - If `false`, no palette swapping happens locally and all URLs use the CDN fallback.

3. **Load the base image**
   - If swapping and `variantDetails` exist, load `variantDetails.source` as an `HTMLImageElement`.

4. **Palette swap per variant**
   - `@nkzw/palette-swap` produces canvases per variant based on the palette map.
   - `staticColors` can be used to lock colors from replacement.

5. **Optional biome water swap**
   - If `waterSwap` is enabled for the sprite, run a second swap pass using `BiomeVariants`.
   - This yields biome-specific sprite keys like `Units-Lander-2-Desert`.

6. **Convert to URLs and cache**
   - Convert canvases to blob URLs via `canvas.toBlob()` (or custom `canvasToURL`).
   - If no canvas exists (no local swap), use CDN fallback URL from `AssetDomain`/`AssetVersion`.
   - Preload common variants (0/1/2) and any `asImage` sprites into `imageMap`.

7. **Inject CSS**
   - `injectGlobal()` from Emotion creates CSS rules:
     - `.Sprite-<name> { background-image: url('<url>'); }`
   - Renderers use these class names to display sprites.

8. **Lookup usage**
   - `spriteURL()` and `spriteImage()` require `prepareSprites()` to have run; they throw otherwise.
   - `hasSpriteURL()` is used by `hera/lib/sprite.tsx` to decide if a biome-specific variant exists.

## Interactions with other packages

### `athena/` (core data)
- Provides the canonical enums and IDs used for variant naming:
  - `SpriteVariant` list in `athena/info/SpriteVariants.tsx`.
  - `PlayerIDs` and `PlainDynamicPlayerID` in `athena/map/Player.tsx`.
  - `Biome` and `Biomes` in `athena/map/Biome.tsx`.
  - `getBiomeStyle()` in `athena/lib/getBiomeStyle.tsx` supplies palette and water swap maps used by `BiomeVariants`.

### `hera/` (renderer)
- `hera/lib/sprite.tsx` depends on `hasSpriteURL()` to select the correct CSS class:
  - For water-swappable sprites, it appends `-${biome}` when a biome-specific URL exists.
- Multiple UI components (Units, Buildings, Labels, Effects, etc.) rely on `sprite()` which returns the class name expected by `Sprites.tsx`'s injected CSS.
- The `art/` package is therefore the **source of truth** for the CSS naming and variant availability used in rendering.

### External tooling / build pipeline
- The module `athena-crisis:asset-variants` is injected by the asset build process (not present in OSS).
- This pipeline is expected to generate:
  - `source` URLs to base images.
  - `variants` palette maps per player or biome.
  - `staticColors` where needed.
- In the OSS repo, `Variants` is mostly `null`, so runtime relies on CDN fallback assets.

## Behavior knobs and guarantees

- **Consistency checks:** If `Variants.size !== VariantConfiguration.size`, runtime throws to catch missing entries.
- **Offline support:** When `navigator.onLine` is false, `shouldSwap()` forces local palette swapping if variant data is available.
- **Performance:**
  - Local swapping is skipped in production online for CPU savings (use CDN prebuilt assets).
  - `asImage` and common variants are preloaded to reduce latency in the renderer.
- **Error surfaces:** Missing sprite URLs or calling `spriteURL()` before preparation throws with descriptive messages.

## Porting guidance (to another language or engine)

To recreate this package, implement the following conceptual subsystems:

1. **Variant catalog**
   - A registry of sprite sheet names (equivalent to `SpriteVariant`).
   - Per-sprite configuration: which variant keys exist, whether biome swapping is supported, and whether the image should be preloaded.
   - A validation step that ensures the config and runtime metadata are in sync.

2. **Palette swap engine**
   - Input: base image + palette map (color -> color) + optional protected colors.
   - Output: an image per variant (canvas or bitmap).
   - Provide a hook to bypass swapping and use prebuilt assets (CDN or local files).

3. **Biome-based swap layer**
   - Build a biome palette map from game rules (in Athena, `getBiomeStyle`).
   - Apply a second pass for water or environment-specific recolors.

4. **Asset URL resolver**
   - Given a sprite key, return a URL or handle to the image.
   - Fallback to versioned remote assets when local generation is disabled.

5. **Renderer integration contract**
   - Define the naming convention for sprite keys and CSS classes.
   - Provide `hasSpriteURL`-like checks to decide whether to append biome suffixes.
   - Optionally expose `spriteImage` for direct `Image` usage in canvas layers.

## Lessons / architectural takeaways

- **Palette swapping + CDN fallback** allows rapid iteration in dev and predictable performance in production.
- **Strict config syncing** between variant metadata and renderer ensures missing sprites are caught early.
- **Biome-aware variants** are handled as an optional second pass, keeping the primary variant system simple.
- **CSS class injection** decouples sprite generation from React rendering while keeping usage ergonomic (`sprite()` returns a class name).

## File map (quick reference)

- `art/AssetInfo.tsx` - CDN base/version.
- `art/VariantConfiguration.tsx` - which variants exist and how to build them.
- `art/Variants.tsx` - variant metadata (mostly `null` in OSS; generated in full build).
- `art/BiomeVariants.tsx` - biome palette maps derived from `athena`.
- `art/Sprites.tsx` - runtime builder, caches, CSS injection, lookup APIs.
- `art/types/athena-crisis-asset-variants.d.ts` - ambient module typing for generated variants.
