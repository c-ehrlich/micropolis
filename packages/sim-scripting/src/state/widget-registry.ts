/**
 * Registry for script-addressable widget command instances.
 * Mirrors Tcl command registration for custom widgets like `piemenu`/`interval`
 * in `ref/micropolis/src/sim/w_tk.c`.
 * Difference from C: duplicate names throw instead of replacing an existing entry.
 */
export class WidgetRegistry<TWidget> {
  readonly #widgets = new Map<string, TWidget>();

  /**
   * Number of widget entries currently registered.
   * Mirrors the number of known script-addressable widget command names.
   */
  get size(): number {
    return this.#widgets.size;
  }

  /**
   * Adds a named widget reference to the registry.
   * Mirrors insertion of a widget command into the Tcl command table.
   */
  add(name: string, widget: TWidget): void {
    if (this.#widgets.has(name)) {
      throw new Error(`widget already exists: ${name}`);
    }

    this.#widgets.set(name, widget);
  }

  /**
   * Looks up a widget reference by exact command name.
   * Mirrors case-sensitive Tcl command lookup behavior.
   */
  get(name: string): TWidget | undefined {
    return this.#widgets.get(name);
  }

  /**
   * Removes and returns a registered widget reference by name.
   * Mirrors widget command cleanup/removal in the Tk bridge lifecycle.
   */
  remove(name: string): TWidget | undefined {
    const widget = this.#widgets.get(name);
    if (widget === undefined) {
      return undefined;
    }

    this.#widgets.delete(name);
    return widget;
  }
}
