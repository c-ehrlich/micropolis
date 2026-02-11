import { describe, expect, it } from 'vitest';

import { createMicropolisGameplaySoundPlaybackPolicy } from './micropolis-gameplay-sound-playback-policy.ts';

describe('micropolis gameplay sound playback policy', () => {
  it('uses applied-only mode by default (playback requires applied outcome gate + userSoundOn)', () => {
    const policy = createMicropolisGameplaySoundPlaybackPolicy();

    expect(
      policy({
        defaultShouldAttemptPlayback: true,
        reducerOutcome: 'applied',
        userSoundOn: true,
        envelopeKind: 'patch',
      }),
    ).toBe(true);
    expect(
      policy({
        defaultShouldAttemptPlayback: false,
        reducerOutcome: 'gap-detected',
        userSoundOn: true,
        envelopeKind: 'patch',
      }),
    ).toBe(false);
    expect(
      policy({
        defaultShouldAttemptPlayback: true,
        reducerOutcome: 'applied',
        userSoundOn: false,
        envelopeKind: 'snapshot',
      }),
    ).toBe(false);
  });

  it('supports all-sequenced mode so playback policy can differ from applied-only gating', () => {
    const policy = createMicropolisGameplaySoundPlaybackPolicy({
      mode: 'all-sequenced',
    });

    expect(
      policy({
        defaultShouldAttemptPlayback: false,
        reducerOutcome: 'gap-detected',
        userSoundOn: true,
        envelopeKind: 'patch',
      }),
    ).toBe(true);
    expect(
      policy({
        defaultShouldAttemptPlayback: false,
        reducerOutcome: 'dropped-stale',
        userSoundOn: false,
        envelopeKind: 'resync',
      }),
    ).toBe(false);
  });
});
