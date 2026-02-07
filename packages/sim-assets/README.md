# `@city/sim-assets`

`@city/sim-assets` centralizes Micropolis asset metadata and lookup helpers with
explicit C/Tcl parity goals.

## Derived Image Output Contract

- Canonical source assets remain under `ref/micropolis/{res,images,manual}`.
- Optional derived PNG exports must write under
  `packages/sim-assets/generated-images/`.
- Canonical image paths map via
  `DERIVED_IMAGE_PATH_MANIFEST` (`ref/micropolis/images/*.xpm` ->
  `packages/sim-assets/generated-images/images/*.png`).
- Derived PNG output is an overlay for runtime ergonomics and must not replace
  canonical Micropolis identity keys.
