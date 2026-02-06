import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  CITY_HISTORY_LENGTH,
  createClassicMapStore,
  createSimContext,
  createSimState,
} from '../../sim-core/src/index.ts';
import { saveCityAsToFileLikeC, saveCityToFileLikeC, saveFileToPathLikeC } from './node-files.ts';

/**
 * Seed runtime arrays so save wrappers write non-zero deterministic payloads.
 */
function createSeededRuntime() {
  const store = createClassicMapStore();
  const context = createSimContext({ store });
  const state = createSimState();

  for (let i = 0; i < CITY_HISTORY_LENGTH; i += 1) {
    state.ResHis[i] = i;
    state.ComHis[i] = -i;
    state.IndHis[i] = i + 2;
    state.CrimeHis[i] = i + 3;
    state.PollutionHis[i] = i + 4;
    state.MoneyHis[i] = i + 5;
  }

  state.CityTime = 290;
  state.TotalFunds = 20000;
  state.CityTax = 7;
  state.SimSpeed = 3;

  context.store.beginTick();
  try {
    const map = context.store.getLayer('map') as Uint16Array;
    for (let i = 0; i < map.length; i += 1) {
      map[i] = (i * 11) & 0xffff;
    }
  } finally {
    context.store.commitTick();
  }

  return { state, context };
}

describe('node save wrappers', () => {
  it('writes saveFile bytes to disk', () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), 'sim-io-save-file-'));
    try {
      const { state, context } = createSeededRuntime();
      const filePath = path.join(tempDir, 'city.cty');
      const saved = saveFileToPathLikeC(state, context, filePath);
      const onDisk = new Uint8Array(readFileSync(filePath));

      expect(saved.filePath).toBe(filePath);
      expect(Array.from(onDisk)).toEqual(Array.from(saved.cityBytes));

      // Magic number from `_load_file` in `ref/micropolis/src/sim/s_fileio.c`:
      // classic save/load city files are 27120 bytes.
      expect(onDisk.byteLength).toBe(27120);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('mirrors SaveCity no-filename branch without writing a file', () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), 'sim-io-save-city-'));
    try {
      const { state, context } = createSeededRuntime();
      const result = saveCityToFileLikeC(state, context, null);

      expect(result.action).toBe('save-as-required');
      expect(readdirSync(tempDir)).toEqual([]);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('writes SaveCity output when CityFileName is already known', () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), 'sim-io-save-city-known-'));
    try {
      const { state, context } = createSeededRuntime();
      const filePath = path.join(tempDir, 'known-city.cty');
      const result = saveCityToFileLikeC(state, context, filePath);
      const onDisk = new Uint8Array(readFileSync(filePath));

      expect(result.action).toBe('saved');
      if (result.action === 'saved') {
        expect(result.cityFileName).toBe(filePath);
        expect(result.filePath).toBe(filePath);
        expect(Array.from(onDisk)).toEqual(Array.from(result.cityBytes));
      }
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('writes SaveCityAs output and returns the C-style derived city name', () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), 'sim-io-save-as-'));
    try {
      const { state, context } = createSeededRuntime();
      const normalizedPath = path.join(tempDir, 'alpha.beta.cty');
      const result = saveCityAsToFileLikeC(state, context, normalizedPath);
      const onDisk = new Uint8Array(readFileSync(normalizedPath));

      expect(result.filePath).toBe(normalizedPath);
      expect(result.cityFileName).toBe(normalizedPath);
      expect(result.cityName).toBe('alpha.beta');
      expect(Array.from(onDisk)).toEqual(Array.from(result.cityBytes));
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
