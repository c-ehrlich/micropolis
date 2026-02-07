import { registerDateViewCommand } from '../commands/dateview-command.ts';
import { registerEditorViewCommand } from '../commands/editorview-command.ts';
import { registerGraphViewCommand } from '../commands/graphview-command.ts';
import { registerIntervalCommand } from '../commands/interval-command.ts';
import { registerMapViewCommand } from '../commands/mapview-command.ts';
import { registerPieMenuCommand } from '../commands/piemenu-command.ts';
import {
  createSimDefaultSubcommandEntries,
  createSimSubcommandTable,
  registerSimCommand,
  type SimSubcommandEntry,
} from '../commands/sim-command.ts';
import { registerSpriteCommand } from '../commands/sprite-command.ts';
import {
  resolveSimScriptingFeatureFlags,
  type SimScriptingFeatureFlags,
} from '../feature-flags.ts';
import type { ScriptingCallbackReference } from '../state/scripting-state.ts';
import type {
  RegisterBaseCommandsHook,
  SimScriptingRuntimeBundle,
} from './create-sim-scripting-runtime.ts';

/**
 * Provider signature for optional `sim` subcommand slices.
 * Mirrors optional `HASHED_CMD(Sim, ...)` blocks in `sim_command_init`
 * (`ref/micropolis/src/sim/w_sim.c`).
 */
export type OptionalSimSubcommandEntryProvider<
  TSim = unknown,
  TView = unknown,
  TSprite = unknown,
  TWidget = unknown,
  TCallback extends ScriptingCallbackReference = ScriptingCallbackReference,
> = (
  bundle: SimScriptingRuntimeBundle<TSim, TView, TSprite, TWidget, TCallback>,
) => readonly SimSubcommandEntry[];

/**
 * Constructor options for `createDefaultSimScriptingBaseCommandRegistrar`.
 * Mirrors `tk_main` command-init flow in `ref/micropolis/src/sim/w_tk.c` plus
 * optional `sim_command_init` slices from `ref/micropolis/src/sim/w_sim.c`.
 * Difference from C: compile-time `CAM`/`NET` gates are runtime flags.
 */
export interface CreateDefaultSimScriptingBaseCommandRegistrarOptions<
  TSim = unknown,
  TView = unknown,
  TSprite = unknown,
  TWidget = unknown,
  TCallback extends ScriptingCallbackReference = ScriptingCallbackReference,
> {
  featureFlags?: SimScriptingFeatureFlags;
  createCamSimSubcommandEntries?: OptionalSimSubcommandEntryProvider<
    TSim,
    TView,
    TSprite,
    TWidget,
    TCallback
  >;
  createNetSimSubcommandEntries?: OptionalSimSubcommandEntryProvider<
    TSim,
    TView,
    TSprite,
    TWidget,
    TCallback
  >;
  createLegacyExtraSimSubcommandEntries?: OptionalSimSubcommandEntryProvider<
    TSim,
    TView,
    TSprite,
    TWidget,
    TCallback
  >;
  registerCamCommand?: RegisterBaseCommandsHook<TSim, TView, TSprite, TWidget, TCallback>;
}

/**
 * Creates a default base-command registrar with flag-gated optional features.
 * Mirrors `tk_main` command registration order from
 * `ref/micropolis/src/sim/w_tk.c` (`sim`, map/editor, graph/date, sprite,
 * optional `camview`, `piemenu`, `interval`) and `sim_command_init` optional
 * `CAM`/`NET` blocks in `ref/micropolis/src/sim/w_sim.c`.
 * Difference from C: optional command slices are injected via callbacks and
 * enabled by runtime flags (`CAM`, `NET`, `legacyExtras`).
 */
export function createDefaultSimScriptingBaseCommandRegistrar<
  TSim = unknown,
  TView = unknown,
  TSprite = unknown,
  TWidget = unknown,
  TCallback extends ScriptingCallbackReference = ScriptingCallbackReference,
>(
  options: CreateDefaultSimScriptingBaseCommandRegistrarOptions<
    TSim,
    TView,
    TSprite,
    TWidget,
    TCallback
  > = {},
): RegisterBaseCommandsHook<TSim, TView, TSprite, TWidget, TCallback> {
  const featureFlags = resolveSimScriptingFeatureFlags(options.featureFlags);

  return (bundle: SimScriptingRuntimeBundle<TSim, TView, TSprite, TWidget, TCallback>): void => {
    registerSimCommand(
      bundle.runtime,
      createSimSubcommandTable(
        createSimDefaultSubcommandEntries({
          featureFlags,
          camSubcommandEntries: featureFlags.CAM
            ? options.createCamSimSubcommandEntries?.(bundle)
            : undefined,
          netSubcommandEntries: featureFlags.NET
            ? options.createNetSimSubcommandEntries?.(bundle)
            : undefined,
          legacyExtraSubcommandEntries: featureFlags.legacyExtras
            ? options.createLegacyExtraSimSubcommandEntries?.(bundle)
            : undefined,
        }),
      ),
    );

    registerMapViewCommand(bundle.runtime);
    registerEditorViewCommand(bundle.runtime);
    registerGraphViewCommand(bundle.runtime);
    registerDateViewCommand(bundle.runtime);
    registerSpriteCommand(bundle.runtime);

    if (featureFlags.CAM) {
      options.registerCamCommand?.(bundle);
    }

    registerPieMenuCommand(bundle.runtime);
    registerIntervalCommand(bundle.runtime);
  };
}
