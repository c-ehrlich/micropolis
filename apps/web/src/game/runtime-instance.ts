import { createCoreHost } from './host-factory';
import { createGameRuntime } from './runtime';

/**
 * Shared web runtime singleton bound to host factory selection.
 * Mirrors Micropolis single-process bootstrap entrypoint intent in
 * `ref/micropolis/src/sim/w_sim.c`.
 * Parity note: singleton module ownership is a TypeScript app-composition concern.
 * Root-route Runtime note: `/` now owns default gameplay runtime startup, so this singleton
 * remains an explicit import surface for targeted tests/tooling only.
 */
export const gameRuntime = createGameRuntime(createCoreHost({ env: import.meta.env }));
