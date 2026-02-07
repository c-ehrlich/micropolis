import { SpriteRegistry } from './sprite-registry.ts';
import { ViewRegistry } from './view-registry.ts';
import { WidgetRegistry } from './widget-registry.ts';

/**
 * Scripting callback reference value stored in state.
 * Mirrors Tcl procedure names/functions called through `Eval(...)` in
 * `ref/micropolis/src/sim/w_tk.c` for `UI*` bridge callbacks.
 * Difference from C: callbacks are modeled as typed references in a map.
 */
export type ScriptingCallbackReference = string;

/**
 * Mutable scripting bridge state shared by command handlers and callback bridge code.
 * Mirrors the globally reachable simulation/view/sprite/widget structures in the C bridge
 * across `ref/micropolis/src/sim/w_tk.c`, `w_map.c`, `w_editor.c`, and `w_sprite.c`.
 * Difference from C: references are grouped into a single explicit typed object.
 */
export interface ScriptingState<
  TSim = unknown,
  TView = unknown,
  TSprite = unknown,
  TWidget = unknown,
  TCallback extends ScriptingCallbackReference = ScriptingCallbackReference,
> {
  sim: TSim | null;
  views: ViewRegistry<TView>;
  sprites: SpriteRegistry<TSprite>;
  widgets: WidgetRegistry<TWidget>;
  callbacks: Map<string, TCallback>;
}

/**
 * Constructor options for `createScriptingState`.
 * Mirrors boot-time bridge wiring performed before Tcl scripts dispatch commands.
 */
export interface CreateScriptingStateOptions<
  TSim = unknown,
  TCallback extends ScriptingCallbackReference = ScriptingCallbackReference,
> {
  sim?: TSim | null;
  callbackEntries?: Iterable<readonly [string, TCallback]>;
}

/**
 * Creates the baseline scripting bridge state and empty object registries.
 * Mirrors bootstrap allocation in `tk_main`/`sim_init` setup flow from
 * `ref/micropolis/src/sim/w_tk.c`.
 * Difference from C: state assembly is explicit and side-effect free.
 */
export function createScriptingState<
  TSim = unknown,
  TView = unknown,
  TSprite = unknown,
  TWidget = unknown,
  TCallback extends ScriptingCallbackReference = ScriptingCallbackReference,
>(
  options: CreateScriptingStateOptions<TSim, TCallback> = {},
): ScriptingState<TSim, TView, TSprite, TWidget, TCallback> {
  return {
    sim: options.sim ?? null,
    views: new ViewRegistry<TView>(),
    sprites: new SpriteRegistry<TSprite>(),
    widgets: new WidgetRegistry<TWidget>(),
    callbacks: new Map(options.callbackEntries),
  };
}
