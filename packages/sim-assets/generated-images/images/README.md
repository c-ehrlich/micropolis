# Stage 8 Derived Sprite PNGs

This directory stores checked-in PNG exports derived from canonical Micropolis
`*.xpm` artwork in `ref/micropolis/images`.

These files are generated for deterministic runtime loading in the Stage 8
Sprite Art Pass and are referenced by TypeScript metadata in
`packages/sim-assets/src/derived-images.ts`.

Primary generation command:

```sh
pnpm -C packages/sim-assets export-derived-images
```

Primary drift/parity gate:

```sh
pnpm -C packages/sim-assets check-derived-image-drift
```
