import type { RuntimeHudGraphSeriesState } from '../../../../game/runtime/index.ts';
import type { PlayableGameLevel } from '../../../../game/runtime/protocol.ts';

export { default as micropolisRunningIndicatorUrl } from '../../../../../../../packages/sim-assets/generated-images/images/micropolisg.png';
export { default as micropolisPausedIndicatorUrl } from '../../../../../../../packages/sim-assets/generated-images/images/micropoliss.png';

const PLAYABLE_TOOL_ICON_MODULES = import.meta.glob(
  '../../../../../../../packages/sim-assets/generated-images/images/ic*.png',
  {
    eager: true,
    import: 'default',
  },
) as Record<string, string>;

export const PLAYABLE_TOOL_ICON_URL_BY_BASENAME = new Map<string, string>(
  Object.entries(PLAYABLE_TOOL_ICON_MODULES).map(([modulePath, moduleUrl]) => {
    const basenameMatch = /\/(ic[^/]+\.png)$/.exec(modulePath);
    return [basenameMatch?.[1] ?? modulePath, moduleUrl];
  }),
);

export const PLAYABLE_GAME_LEVEL_CHOICES: ReadonlyArray<{
  id: PlayableGameLevel;
  label: 'Easy' | 'Medium' | 'Hard';
  startingFundsLabel: string;
}> = [
  { id: 0, label: 'Easy', startingFundsLabel: '$20,000' },
  { id: 1, label: 'Medium', startingFundsLabel: '$10,000' },
  { id: 2, label: 'Hard', startingFundsLabel: '$5,000' },
];

export const HEAD_GRAPH_MASK_RCI = 0b111;
export const ALL_GRAPH_SERIES_MASK = 0b11_1111;
export const RUNTIME_GRAPH_SERIES = [
  { bit: 1 << 0, color: '#1b8f3a', key: 'res', label: 'Residential', shortLabel: 'Res' },
  { bit: 1 << 1, color: '#1b2fe0', key: 'com', label: 'Commercial', shortLabel: 'Com' },
  { bit: 1 << 2, color: '#ff7a1a', key: 'ind', label: 'Industrial', shortLabel: 'Ind' },
  { bit: 1 << 3, color: '#222222', key: 'money', label: 'Money', shortLabel: 'Money' },
  { bit: 1 << 4, color: '#b00020', key: 'crime', label: 'Crime', shortLabel: 'Crime' },
  {
    bit: 1 << 5,
    color: '#7a4f00',
    key: 'pollution',
    label: 'Pollution',
    shortLabel: 'Pollution',
  },
] as const satisfies ReadonlyArray<{
  bit: number;
  color: string;
  key: keyof RuntimeHudGraphSeriesState;
  label: string;
  shortLabel: string;
}>;
export const GRAPH_SERIES_TOGGLES: ReadonlyArray<{
  bit: number;
  color: string;
  label: string;
}> = RUNTIME_GRAPH_SERIES.map(({ bit, color, label }) => ({ bit, color, label }));

export const CLASSICY_INSET_BEVEL_SHADOW =
  '[box-shadow:inset_calc(var(--window-border-size)*-1)_calc(var(--window-border-size)*-1)_0_0_var(--color-system-05),inset_calc(var(--window-border-size)*1)_calc(var(--window-border-size)*1)_0_0_var(--color-system-07)]';
export const CLASSICY_MESSAGE_SURFACE_CHROME = `text-[var(--color-black)] border-solid [border-width:var(--window-border-size)] [border-color:var(--color-window-border)] [background:color-mix(in_srgb,var(--color-system-03)_90%,transparent)] ${CLASSICY_INSET_BEVEL_SHADOW}`;
export const CLASSICY_MENU_BUTTON_ACTIVE_CLASS =
  '!text-[var(--color-white)] !bg-[var(--color-theme-04)]';
export const CLASSICY_FLOATING_BUDGET_ROW_CLASS = 'flex items-center justify-between gap-2';
export const CLASSICY_WINDOW_LAUNCHER_BUTTON_CLASS =
  '!m-0 w-full max-w-full !min-w-0 box-border !p-0 !border-0 !bg-transparent !shadow-none';

export const MAP_TILE_SIZE = 16;

/**
 * Formats HUD budget amounts with a C-style signed currency prefix.
 * Mirrors the sign behavior in `ReallyDrawBudgetWindow` from
 * `ref/micropolis/src/sim/w_budget.c`.
 */
export function formatSignedBudgetAmount(value: number): string {
  const absValue = Math.abs(Math.trunc(value));
  const signedPrefix = value < 0 ? '-' : '+';
  return `${signedPrefix}$${absValue.toLocaleString('en-US')}`;
}

/**
 * Formats HUD budget amounts using grouped dollars.
 * Mirrors `makeDollarDecimalStr` display intent in
 * `ref/micropolis/src/sim/w_budget.c`.
 */
export function formatBudgetAmount(value: number): string {
  return `$${Math.max(0, Math.trunc(value)).toLocaleString('en-US')}`;
}
