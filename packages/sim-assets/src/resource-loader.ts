import type { ResourceRoots } from './resource-roots.ts';

/**
 * Four-character resource type token consumed by Micropolis resource loaders.
 * Mirrors `char *name` usage in `GetResource` from `ref/micropolis/src/sim/w_resrc.c`
 * (1:1 width requirement modeled as a template-literal type).
 */
export type ResourceTypeCode = `${string}${string}${string}${string}`;

/**
 * Typed key for Micropolis resources.
 * Mirrors `(name, id)` lookup arguments in `GetResource` from
 * `ref/micropolis/src/sim/w_resrc.c` (1:1 identity fields).
 */
export interface ResourceIdentifier {
  readonly type: ResourceTypeCode;
  readonly id: number;
}

/**
 * Compute the canonical cache key for a Micropolis resource lookup.
 * Mirrors `(name,id)` identity in `GetResource` from `ref/micropolis/src/sim/w_resrc.c`
 * (TypeScript adapts this to a deterministic string key).
 */
export function toResourceCacheKey(identifier: ResourceIdentifier): string {
  return `${identifier.type}:${identifier.id}`;
}

/**
 * Build a Micropolis resource path as `%s/%c%c%c%c.%d`.
 * Mirrors filename construction in `GetResource` from `ref/micropolis/src/sim/w_resrc.c`
 * (1:1 format, with explicit validation for type width).
 */
export function formatResourcePath(roots: ResourceRoots, identifier: ResourceIdentifier): string {
  if (identifier.type.length !== 4) {
    throw new Error(`Resource type must be exactly 4 characters: "${identifier.type}"`);
  }

  return `${roots.resourceDir}${identifier.type[0]}${identifier.type[1]}${identifier.type[2]}${identifier.type[3]}.${identifier.id}`;
}
