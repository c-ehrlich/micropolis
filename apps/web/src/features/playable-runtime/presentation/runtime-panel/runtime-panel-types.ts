import type {
  RuntimeFloatingWindowId,
  useFloatingWindowsState,
  useRuntimeSession,
  useRuntimeUiState,
} from '../../behavior/runtime-panel-controller.ts';

/**
 * Shared controller aliases for runtime-panel presentation modules.
 * Mirrors route-level UI/session/window coordination from
 * `ref/micropolis/res/whead.tcl` and `ref/micropolis/src/sim/w_update.c`.
 */
export type RuntimeUiController = ReturnType<typeof useRuntimeUiState>;
export type RuntimeSessionController = ReturnType<typeof useRuntimeSession>;
export type RuntimeFloatingWindowsController = ReturnType<typeof useFloatingWindowsState>;
export type RuntimeBudgetState = RuntimeSessionController['state']['hudState']['budget'];
export type RuntimeOpenFloatingWindow = (windowId: RuntimeFloatingWindowId) => void;
