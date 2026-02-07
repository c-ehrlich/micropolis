/**
 * Registry for named sprite command instances.
 * Mirrors sprite command creation in `SpriteCmd`/`Tcl_CreateCommand` from
 * `ref/micropolis/src/sim/w_sprite.c`.
 * Difference from C: duplicate names throw instead of replacing an existing entry.
 */
export class SpriteRegistry<TSprite> {
  readonly #sprites = new Map<string, TSprite>();

  /**
   * Number of sprite entries currently registered.
   * Mirrors how many named sprite commands are currently addressable by scripts.
   */
  get size(): number {
    return this.#sprites.size;
  }

  /**
   * Adds a named sprite reference to the registry.
   * Mirrors adding a new script-visible sprite command name.
   */
  add(name: string, sprite: TSprite): void {
    if (this.#sprites.has(name)) {
      throw new Error(`sprite already exists: ${name}`);
    }

    this.#sprites.set(name, sprite);
  }

  /**
   * Looks up a sprite reference by exact command name.
   * Mirrors case-sensitive Tcl command lookup semantics.
   */
  get(name: string): TSprite | undefined {
    return this.#sprites.get(name);
  }

  /**
   * Removes and returns a registered sprite reference by name.
   * Mirrors sprite command teardown/removal from the command table.
   */
  remove(name: string): TSprite | undefined {
    const sprite = this.#sprites.get(name);
    if (sprite === undefined) {
      return undefined;
    }

    this.#sprites.delete(name);
    return sprite;
  }
}
