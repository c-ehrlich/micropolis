# MicropolisCore Tilesets

Source: `resources/tilesets/*` from
<https://github.com/SimHacker/MicropolisCore/tree/main/resources/tilesets>.

Each tileset directory contains direct BMP copies and PNG conversions for browser
loading:

- `tiles.{bmp,png}`
- `train.{bmp,png}`
- `chopper.{bmp,png}`
- `plane.{bmp,png}`
- `ship.{bmp,png}`
- `monster.{bmp,png}`
- `tornado.{bmp,png}`
- `explode.{bmp,png}`

The PNG files are direct BMP -> PNG conversions used by the web runtime atlas
adapters.

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
