/**
 * Repository-relative output directory for optional derived PNG exports.
 * Micropolis C/Tcl loads canonical XPM/resource assets directly from
 * `ref/micropolis` (for example `ref/micropolis/src/sim/g_setup.c` and
 * `ref/micropolis/res/micropolis.tcl`), so this path is TypeScript-only build
 * output and does not replace canonical Micropolis asset identities.
 */
export const DERIVED_IMAGES_OUTPUT_DIR = 'packages/sim-assets/generated-images';
