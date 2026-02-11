import { describe, expect, it } from 'vitest';

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

  public constructor(src: string) {
    this.src = src;
  }

  public pause(): void {
    this.pauseCalls += 1;
  }

  public async play(): Promise<void> {
    this.playCalls += 1;
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
  });

  it('builds gameplay wav path from normalized token stem', () => {
    expect(toMicropolisGameplaySoundWavPath('Explosion-High')).toBe('/sounds/explosion-high.wav');
    expect(toMicropolisGameplaySoundWavPath('Siren')).toBe('/sounds/siren.wav');
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
});
