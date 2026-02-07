import { mkdtempSync, rmSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  formatResourcePath,
  readResourceFile,
  ResourceLoaderErrorCode,
} from './resource-loader.ts';
import { resolveResourceRoots } from './resource-roots.ts';

describe('resource loader', () => {
  it('caches payloads by (type,id) after first disk read', async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), 'sim-assets-resource-cache-'));
    try {
      const roots = resolveResourceRoots({ simHome: tempDir });
      const identifier = { type: 'stri', id: 62001 } as const;
      const resourcePath = formatResourcePath(roots, identifier);

      await mkdir(roots.resourceDir, { recursive: true });
      await writeFile(resourcePath, new Uint8Array([1, 2, 3]));

      const first = await readResourceFile(roots, identifier);
      await writeFile(resourcePath, new Uint8Array([9, 9, 9]));
      const second = await readResourceFile(roots, identifier);

      expect(Array.from(first)).toEqual([1, 2, 3]);
      expect(second).toBe(first);
      expect(Array.from(second)).toEqual([1, 2, 3]);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('throws deterministic missing-file errors and allows later successful retry', async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), 'sim-assets-resource-missing-'));
    try {
      const roots = resolveResourceRoots({ simHome: tempDir });
      const identifier = { type: 'stri', id: 62002 } as const;
      const resourcePath = formatResourcePath(roots, identifier);

      await mkdir(roots.resourceDir, { recursive: true });

      await expect(readResourceFile(roots, identifier)).rejects.toMatchObject({
        name: 'ResourceFileNotFoundError',
        code: ResourceLoaderErrorCode.MissingResourceFile,
        type: identifier.type,
        id: identifier.id,
        resourcePath,
        message: `Missing Micropolis resource file: ${identifier.type}.${identifier.id} (${resourcePath})`,
      });

      await writeFile(resourcePath, new Uint8Array([7, 8]));
      const recovered = await readResourceFile(roots, identifier);

      expect(Array.from(recovered)).toEqual([7, 8]);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
