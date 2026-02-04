import type { SimState } from '../core/sim-state.ts';
import { setFunds } from '../systems/funds.ts';
import type { CityMeta } from './cty.ts';
import { applyLoadNormalization } from './cty.ts';

/**
 * Convert the current `SimState` into `.cty` metadata fields.
 * Mirrors the values persisted in `saveFile` in `ref/micropolis/src/sim/s_fileio.c` (1:1 mapping).
 *
 * Note: `.cty` does not persist the UI/runtime-only options (`DoAnimation`, `DoMessages`, `DoNotices`).
 */
export function cityMetaFromState(state: SimState): CityMeta {
  return {
    cityTime: state.CityTime,
    totalFunds: state.TotalFunds,
    autoBulldoze: state.autoBulldoze,
    autoBudget: state.autoBudget,
    autoGo: state.autoGo,
    userSoundOn: state.userSoundOn,
    cityTax: state.CityTax,
    simSpeed: state.SimSpeed,
    policePercent: state.policePercent,
    firePercent: state.firePercent,
    roadPercent: state.roadPercent,
  };
}

/**
 * Apply loaded `.cty` metadata fields to `SimState`.
 * Mirrors the `.cty` load behavior in `loadFile` in `ref/micropolis/src/sim/s_fileio.c`.
 *
 * Notes on intentional/required parity:
 * - C clamps `CityTime`, `CityTax`, and `SimSpeed` during load (see `s_fileio.c loadFile`).
 * - C calls `InitFundingLevel()` at the end of the load path, which resets all funding percents to `1`.
 *   sim-core mirrors this by applying `applyLoadNormalization()` before writing fields into state.
 * - C sets `MustUpdateOptions=1` so the next `DoUpdateHeads()` run emits options (w_update.c updateOptions).
 */
export function applyLoadedCityMetaToState(state: SimState, meta: CityMeta): void {
  const normalized = applyLoadNormalization(meta);

  state.CityTime = normalized.cityTime;
  setFunds(state, normalized.totalFunds);

  state.autoBulldoze = normalized.autoBulldoze;
  state.autoBudget = normalized.autoBudget;
  state.autoGo = normalized.autoGo;
  state.userSoundOn = normalized.userSoundOn;

  state.CityTax = normalized.cityTax;
  state.SimSpeed = normalized.simSpeed;

  state.policePercent = normalized.policePercent;
  state.firePercent = normalized.firePercent;
  state.roadPercent = normalized.roadPercent;

  state.MustUpdateOptions = 1;
}
