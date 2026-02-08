import { readdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { ASSETS_MANIFEST } from './generated/assets-manifest.ts';
import { createSpriteManifest } from './sprites.ts';

const FIXTURE_IMAGE_ROOT = new URL('../../../ref/micropolis/images/', import.meta.url);

interface SpriteFrameManifestRow {
  readonly spriteId: number;
  readonly frame: number;
  readonly path: string;
  readonly size: number;
}

/**
 * Discovers canonical object-sprite frame files from `ref/micropolis/images`.
 * Mirrors `GetObjectXpms` filename traversal in `ref/micropolis/src/sim/g_setup.c`
 * (`obj<ID>-<frame>.xpm`, 1:1 basename parity; this helper also records byte size
 * so generated manifest rows can be verified exactly).
 */
async function discoverCanonicalSpriteFrames(): Promise<readonly SpriteFrameManifestRow[]> {
  const imageRootPath = fileURLToPath(FIXTURE_IMAGE_ROOT);
  const names = await readdir(imageRootPath);
  const rows: SpriteFrameManifestRow[] = [];

  for (const name of names) {
    const match = /^obj(\d+)-(\d+)\.xpm$/.exec(name);
    if (match === null) {
      continue;
    }

    const spriteIdToken = match[1];
    const frameToken = match[2];
    if (spriteIdToken === undefined || frameToken === undefined) {
      throw new Error(`Unexpected sprite frame filename match groups for ${name}`);
    }

    const filePath = fileURLToPath(new URL(name, FIXTURE_IMAGE_ROOT));
    const size = (await stat(filePath)).size;
    rows.push({
      spriteId: Number(spriteIdToken),
      frame: Number(frameToken),
      path: name,
      size,
    });
  }

  rows.sort((left, right) => {
    if (left.spriteId !== right.spriteId) {
      return left.spriteId - right.spriteId;
    }
    return left.frame - right.frame;
  });

  return rows;
}

describe('sprite frame manifest parity', () => {
  it('matches generated locked sprite frame rows to discovered obj*-*.xpm files', async () => {
    const discoveredFrames = await discoverCanonicalSpriteFrames();

    expect(discoveredFrames).toEqual(ASSETS_MANIFEST.parity.spriteFrames);
  });

  it('keeps C-derived frame counts and contiguous frame indexes per sprite id', async () => {
    const discoveredFrames = await discoverCanonicalSpriteFrames();
    const framesBySprite = new Map<number, number[]>();

    for (const frame of discoveredFrames) {
      const frames = framesBySprite.get(frame.spriteId) ?? [];
      frames.push(frame.frame);
      framesBySprite.set(frame.spriteId, frames);
    }

    const discoveredManifest = [...framesBySprite.entries()]
      .map(([spriteId, frames]) => {
        const sortedFrames = [...frames].sort((left, right) => left - right);

        // `GetObjectXpms` loads sequential frames for each hard-coded object ID
        // in `ref/micropolis/src/sim/g_setup.c`, so frame indexes stay 0..N-1.
        for (let index = 0; index < sortedFrames.length; index += 1) {
          expect(sortedFrames[index]).toBe(index);
        }

        return { spriteId, frameCount: sortedFrames.length };
      })
      .sort((left, right) => left.spriteId - right.spriteId);

    // These frame-count "magic numbers" are the `GetObjectXpms` loop bounds in
    // `ref/micropolis/src/sim/g_setup.c`, carried into `createSpriteManifest`.
    expect(createSpriteManifest()).toEqual(discoveredManifest);
  });
});
