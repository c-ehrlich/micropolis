import { describe, expect, it, vi } from 'vitest';

import {
  createMicropolisGameplayAudioConsumer,
  normalizeMicropolisGameplaySoundToken,
  toMicropolisGameplaySoundWavPath,
} from './micropolis-gameplay-audio-consumer.ts';

/**
 * Small deterministic fake for gameplay audio-consumer tests.
 * Mirrors the subset of browser `Audio` behavior used by runtime playback.
 */
class FakeAudioElement {
  public currentTime = 0;
  public preload = '';
  public src: string;
  public pauseCalls = 0;
  public playCalls = 0;
  public playFailures: unknown[] = [];

  public constructor(src: string) {
    this.src = src;
  }

  public pause(): void {
    this.pauseCalls += 1;
  }

  public async play(): Promise<void> {
    this.playCalls += 1;
    const nextFailure = this.playFailures.shift();
    if (nextFailure !== undefined) {
      throw nextFailure;
    }
  }
}

describe('micropolis gameplay audio consumer', () => {
  it('uses first-token lowercase normalization for wav lookup parity', () => {
    // Mirrors Tcl `EchoPlaySound` first-token forwarding and Sugar lowercase
    // `<name>.wav` lookup (`ref/micropolis/res/micropolis.tcl`,
    // `ref/micropolis/micropolisactivity.py`).
    expect(normalizeMicropolisGameplaySoundToken('Monster -speed 120')).toBe('monster');
    expect(normalizeMicropolisGameplaySoundToken('  HonkHonk-Low   -speed 80 ')).toBe(
      'honkhonk-low',
    );
    expect(
      normalizeMicropolisGameplaySoundToken(
        ' Explosion-High -speed [expr 100 * $sound_high_quality]',
      ),
    ).toBe('explosion-high');
    expect(normalizeMicropolisGameplaySoundToken('\tSIREN\n-speed 90')).toBe('siren');
  });

  it('builds gameplay wav path from normalized token stem', () => {
    expect(toMicropolisGameplaySoundWavPath('Explosion-High')).toBe('/sounds/explosion-high.wav');
    expect(toMicropolisGameplaySoundWavPath('Siren')).toBe('/sounds/siren.wav');
    expect(toMicropolisGameplaySoundWavPath('HonkHonk-Low   -speed 80')).toBe(
      '/sounds/honkhonk-low.wav',
    );
  });

  it('caches one audio element per normalized wav path and rewinds on replay', async () => {
    const createdByPath = new Map<string, FakeAudioElement>();
    const consumer = createMicropolisGameplayAudioConsumer({
      createAudioElement: (wavPath) => {
        const fakeAudioElement = new FakeAudioElement(wavPath);
        createdByPath.set(wavPath, fakeAudioElement);
        return fakeAudioElement;
      },
    });

    await consumer.playSoundSpec('Monster -speed 120');
    const monsterAudioElement = createdByPath.get('/sounds/monster.wav');
    if (monsterAudioElement === undefined) {
      throw new Error('Expected monster audio element to be created');
    }
    monsterAudioElement.currentTime = 1.5;

    await consumer.playSoundSpec('Monster -speed 80');
    expect(createdByPath.size).toBe(1);
    expect(monsterAudioElement.playCalls).toBe(2);
    expect(monsterAudioElement.currentTime).toBe(0);

    consumer.dispose();
    expect(monsterAudioElement.pauseCalls).toBe(1);
    expect(monsterAudioElement.src).toBe('');
  });

  it('treats autoplay-blocked browser playback as best-effort non-fatal', async () => {
    const createdByPath = new Map<string, FakeAudioElement>();
    const consumer = createMicropolisGameplayAudioConsumer({
      createAudioElement: (wavPath) => {
        const fakeAudioElement = new FakeAudioElement(wavPath);
        if (wavPath === '/sounds/siren.wav') {
          fakeAudioElement.playFailures.push({ name: 'NotAllowedError' });
        }
        createdByPath.set(wavPath, fakeAudioElement);
        return fakeAudioElement;
      },
    });

    await expect(consumer.playSoundSpec('Siren')).resolves.toBeUndefined();
    const sirenAudioElement = createdByPath.get('/sounds/siren.wav');
    if (sirenAudioElement === undefined) {
      throw new Error('Expected siren audio element to be created');
    }

    sirenAudioElement.currentTime = 3;
    await expect(consumer.playSoundSpec('Siren -speed 90')).resolves.toBeUndefined();
    expect(sirenAudioElement.playCalls).toBe(2);
    expect(sirenAudioElement.currentTime).toBe(0);
    expect(createdByPath.size).toBe(1);
  });

  it('warns with token/spec context and skips playback when wav asset is missing', async () => {
    const createAudioElement = vi.fn<(wavPath: string) => FakeAudioElement>((wavPath) => {
      return new FakeAudioElement(wavPath);
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const consumer = createMicropolisGameplayAudioConsumer({
      createAudioElement,
      resolveWavAssetAvailability: async () => false,
    });

    await expect(consumer.playSoundSpec('Monster -speed 120')).resolves.toBeUndefined();
    expect(createAudioElement).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      'Micropolis gameplay sound asset missing; skipping playback.',
      {
        token: 'monster',
        soundSpec: 'Monster -speed 120',
        wavPath: '/sounds/monster.wav',
      },
    );
    warnSpy.mockRestore();
  });
});
