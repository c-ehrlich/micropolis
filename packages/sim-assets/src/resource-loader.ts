import { readFile } from 'node:fs/promises';

import type { ResourceRoots } from './resource-roots.ts';

const resourcePayloadCache = new Map<string, Uint8Array>();

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

/**
 * Read an entire Micropolis resource file payload for a `(type,id)` lookup.
 * Mirrors `GetResource` in `ref/micropolis/src/sim/w_resrc.c`, where resources are
 * cached in a process-lifetime linked list keyed by `(name,id)` and loaded once via
 * full-file `fread`.
 * Parity notes: this helper keeps a module-lifetime cache keyed only by `(type,id)`
 * (matching C identity semantics) and returns the same payload object on cache hits.
 * Failed file reads are not cached.
 */
export async function readResourceFile(
  roots: ResourceRoots,
  identifier: ResourceIdentifier,
): Promise<Uint8Array> {
  const cacheKey = toResourceCacheKey(identifier);
  const cachedPayload = resourcePayloadCache.get(cacheKey);

  if (cachedPayload !== undefined) {
    return cachedPayload;
  }

  const payload = await readFile(formatResourcePath(roots, identifier));
  resourcePayloadCache.set(cacheKey, payload);
  return payload;
}
