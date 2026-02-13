# MicropolisCore Tilesets

Source: `resources/tilesets/*` from
<https://github.com/SimHacker/MicropolisCore/tree/main/resources/tilesets>.

Each tileset directory keeps only browser-runtime sprite sheets:

- `tiles.png`

Object sheets also include generated alpha-baked variants:

- `train-alpha.png`
- `chopper-alpha.png`
- `plane-alpha.png`
- `ship-alpha.png`
- `monster-alpha.png`
- `tornado-alpha.png`
- `explode-alpha.png`

These are emitted by
`packages/sim-assets/scripts/export-micropoliscore-object-alpha-images.mjs`
to reconstruct sprite transparency for browser rendering.
