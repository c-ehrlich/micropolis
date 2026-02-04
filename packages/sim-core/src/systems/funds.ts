import type { SimState } from '../core/sim-state.ts';
import { markFundsDirty } from './date-time.ts';

/**
 * TotalFunds mutation helper.
 * Mirrors `Spend` in `ref/micropolis/src/sim/w_stubs.c` (1:1 behavior).
 *
 * C:
 *   Spend(dollars) { SetFunds(TotalFunds - dollars); }
 *
 * Since `SetFunds` calls `UpdateFunds`, this implies `MustUpdateFunds = 1`
 * (see `UpdateFunds` in `ref/micropolis/src/sim/w_update.c`).
 */
export function spendFunds(state: SimState, dollars: number): void {
  state.TotalFunds = state.TotalFunds - dollars;
  markFundsDirty(state);
}

/**
 * TotalFunds assignment helper.
 * Mirrors `SetFunds` in `ref/micropolis/src/sim/w_stubs.c` (1:1 behavior).
 *
 * C:
 *   SetFunds(dollars) { TotalFunds = dollars; UpdateFunds(); }
 *
 * `UpdateFunds` sets `MustUpdateFunds = 1` before the next `ReallyUpdateFunds`.
 */
export function setFunds(state: SimState, dollars: number): void {
  state.TotalFunds = dollars;
  markFundsDirty(state);
}
