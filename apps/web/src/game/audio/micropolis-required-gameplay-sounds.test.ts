import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { REQUIRED_GAMEPLAY_SOUND_TOKENS } from './micropolis-required-gameplay-sounds.ts';

const SOUND_ASSET_DIRECTORY = fileURLToPath(new URL('../../../public/sounds/', import.meta.url));
const SOUND_GAMEPLAY_INVENTORY_PATH = fileURLToPath(
  new URL('../../../../../SOUND_GAMEPLAY_INVENTORY.md', import.meta.url),
);

const INVENTORY_GAMEPLAY_TABLE_HEADER =
  '| Pathway | token/spec | wav file name | C/Tcl source location | gameplay usage note |';
const INVENTORY_GAMEPLAY_TABLE_END_HEADING = '## Unreachable Original Gameplay Sound Pathways';
const INVENTORY_DEFERRED_TABLE_HEADING = '## Explicitly Deferred Menu/Non-Gameplay Sound Stems';

function listShippedWavAssetFileNames(): string[] {
  return readdirSync(SOUND_ASSET_DIRECTORY)
    .filter((name) => name.toLowerCase().endsWith('.wav'))
    .map((name) => name.toLowerCase())
    .sort();
}

function extractInventoryGameplayWavFileNames(markdown: string): string[] {
  const tableStartIndex = markdown.indexOf(INVENTORY_GAMEPLAY_TABLE_HEADER);
  expect(tableStartIndex).toBeGreaterThanOrEqual(0);

  const sectionFromTable = markdown.slice(tableStartIndex);
  const tableEndIndex = sectionFromTable.indexOf(INVENTORY_GAMEPLAY_TABLE_END_HEADING);
  expect(tableEndIndex).toBeGreaterThan(0);

  const gameplayTableSection = sectionFromTable.slice(0, tableEndIndex);
  const wavNames = new Set<string>();

  for (const row of gameplayTableSection.split('\n')) {
    if (!row.startsWith('| ')) {
      continue;
    }
    if (row.includes('| --- |')) {
      continue;
    }

    const columns = row
      .split('|')
      .slice(1, -1)
      .map((column) => column.trim());
    if (columns.length < 3) {
      continue;
    }

    const wavCell = columns[2];
    if (wavCell === undefined) {
      continue;
    }

    const wavCellMatch = wavCell.match(/`([a-z0-9-]+\.wav)`/i);
    const wavFileName = wavCellMatch?.[1];
    if (wavFileName !== undefined) {
      wavNames.add(wavFileName.toLowerCase());
    }
  }

  return [...wavNames].sort();
}

function extractInventoryDeferredStemNames(markdown: string): string[] {
  const deferredSectionStartIndex = markdown.indexOf(INVENTORY_DEFERRED_TABLE_HEADING);
  expect(deferredSectionStartIndex).toBeGreaterThanOrEqual(0);

  const deferredSection = markdown.slice(deferredSectionStartIndex);
  const stemNames = new Set<string>();

  for (const row of deferredSection.split('\n')) {
    if (!row.startsWith('| ')) {
      continue;
    }
    if (row.includes('| --- |')) {
      continue;
    }

    const columns = row
      .split('|')
      .slice(1, -1)
      .map((column) => column.trim());
    if (columns.length < 1) {
      continue;
    }

    const deferredStemCell = columns[0];
    if (deferredStemCell === undefined) {
      continue;
    }

    const deferredStemMatches = deferredStemCell.matchAll(/`([a-z0-9-]+)`/gi);
    for (const match of deferredStemMatches) {
      const deferredStem = match[1];
      if (deferredStem === undefined) {
        continue;
      }

      stemNames.add(deferredStem.toLowerCase());
    }
  }

  return [...stemNames].sort();
}

function toTokenStem(wavFileName: string): string {
  return wavFileName.slice(0, -'.wav'.length);
}

describe('required gameplay sound asset coverage', () => {
  it('keeps required gameplay tokens backed by /sounds/*.wav files', () => {
    // Required tokens come from currently reachable C gameplay callsites:
    // `w_tool.c` (tool), `s_msg.c` (first-display messages), `w_sprite.c` (realtime).
    const missingTokens = REQUIRED_GAMEPLAY_SOUND_TOKENS.filter((token) => {
      return !existsSync(join(SOUND_ASSET_DIRECTORY, `${token}.wav`));
    });

    expect(missingTokens).toEqual([]);
  });

  it('keeps gameplay inventory wav rows aligned with shipped /sounds assets', () => {
    // Inventory rows map authoritative C gameplay callsites (`w_tool.c`, `s_msg.c`,
    // `w_sprite.c`) to shipped runtime wav stems for MakeSound/MakeSoundOn parity.
    const inventoryMarkdown = readFileSync(SOUND_GAMEPLAY_INVENTORY_PATH, 'utf8');
    const shippedWavFiles = listShippedWavAssetFileNames();
    const documentedGameplayWavFiles = extractInventoryGameplayWavFileNames(inventoryMarkdown);
    const documentedDeferredStems = extractInventoryDeferredStemNames(inventoryMarkdown);
    const documentedStemSet = new Set<string>([
      ...documentedGameplayWavFiles.map(toTokenStem),
      ...documentedDeferredStems,
    ]);
    const undocumentedShippedStems = shippedWavFiles
      .map(toTokenStem)
      .filter((stem) => !documentedStemSet.has(stem));
    const missingGameplayWavFiles = documentedGameplayWavFiles.filter(
      (wavFileName) => !shippedWavFiles.includes(wavFileName),
    );

    expect(undocumentedShippedStems).toEqual([]);
    expect(missingGameplayWavFiles).toEqual([]);
  });
});
