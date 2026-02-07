# @city/sim-assets

`@city/sim-assets` centralizes Micropolis asset metadata and lookup helpers with
explicit C/Tcl parity goals.

Current package direction:

- Keep `ref/micropolis` assets as canonical source-of-truth.
- Expose typed helpers for tiles, sprites, strings, sounds, UI bitmaps, and help docs.
- Generate deterministic manifests under `src/generated/` from canonical assets.
- Support optional derived-image exports (for runtime ergonomics) without replacing canonical IDs.

Execution is tracked in:

- [PLAN.md](./PLAN.md)
