import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { REQUIRED_GAMEPLAY_SOUND_TOKENS } from './micropolis-required-gameplay-sounds.ts';

const SOUND_ASSET_DIRECTORY = fileURLToPath(new URL('../../../public/sounds/', import.meta.url));

describe('required gameplay sound asset coverage', () => {
  it('keeps required gameplay tokens backed by /sounds/*.wav files', () => {
    // Required tokens come from currently reachable C gameplay callsites:
    // `w_tool.c` (tool), `s_msg.c` (first-display messages), `w_sprite.c` (realtime).
    const missingTokens = REQUIRED_GAMEPLAY_SOUND_TOKENS.filter((token) => {
      return !existsSync(join(SOUND_ASSET_DIRECTORY, `${token}.wav`));
    });

    expect(missingTokens).toEqual([]);
  });
});
