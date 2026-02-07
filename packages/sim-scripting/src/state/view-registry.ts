/**
 * Registry for `editorview`/`mapview` command instances by Tcl command name.
 * Mirrors per-view `Tcl_CreateCommand` registration in
 * `ref/micropolis/src/sim/w_tk.c` and `ref/micropolis/src/sim/w_map.c`.
 * Difference from C: duplicate names throw instead of replacing an existing entry.
 */
export class ViewRegistry<TView> {
  readonly #views = new Map<string, TView>();

  /**
   * Number of view entries currently registered.
   * Mirrors the effective view-command count tracked by Tcl command tables in C.
   */
  get size(): number {
    return this.#views.size;
  }

  /**
   * Adds a named view reference to the registry.
   * Mirrors command-name insertion for views in the Tk bridge.
   */
  add(name: string, view: TView): void {
    if (this.#views.has(name)) {
      throw new Error(`view already exists: ${name}`);
    }

    this.#views.set(name, view);
  }

  /**
   * Looks up a view reference by command name.
   * Mirrors Tcl command lookup by exact, case-sensitive command key.
   */
  get(name: string): TView | undefined {
    return this.#views.get(name);
  }

  /**
   * Removes and returns a registered view reference by name.
   * Mirrors destroying/unregistering a view command in the Tk bridge.
   */
  remove(name: string): TView | undefined {
    const view = this.#views.get(name);
    if (view === undefined) {
      return undefined;
    }

    this.#views.delete(name);
    return view;
  }
}
