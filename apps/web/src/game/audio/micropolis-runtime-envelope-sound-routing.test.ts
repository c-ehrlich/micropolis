import { describe, expect, it, vi } from 'vitest';

import type { HostEnvelope } from '../runtime/protocol.ts';
import { routeMicropolisGameplaySoundDeltas } from './micropolis-runtime-envelope-sound-routing.ts';

describe('routeMicropolisGameplaySoundDeltas', () => {
  it('does not infer playback from reject reason without host sound deltas', () => {
    const playSoundSpec = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const gameplayAudioConsumer = { playSoundSpec, dispose: vi.fn() };
    const gameplaySoundPlaybackPolicy = vi.fn(() => true);

    const rejectEnvelope: HostEnvelope = {
      kind: 'reject',
      roomId: 'room',
      clientId: 'client',
      tick: 2,
      serverSeq: 2,
      commandId: 'cmd-no-funds',
      reason: 'no-funds',
    };

    routeMicropolisGameplaySoundDeltas({
      envelope: rejectEnvelope,
      reducerOutcome: 'applied',
      userSoundOn: true,
      gameplayAudioConsumer,
      gameplaySoundPlaybackPolicy,
    });

    expect(gameplaySoundPlaybackPolicy).toHaveBeenCalledTimes(1);
    expect(playSoundSpec).not.toHaveBeenCalled();
  });

  it('does not infer playback from patch message deltas without host sound deltas', () => {
    const playSoundSpec = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const gameplayAudioConsumer = { playSoundSpec, dispose: vi.fn() };
    const gameplaySoundPlaybackPolicy = vi.fn(() => true);

    const patchEnvelope: HostEnvelope = {
      kind: 'patch',
      roomId: 'room',
      clientId: 'client',
      tick: 3,
      serverSeq: 3,
      payload: {
        // Message id `43` is the major-earthquake message in `doMessage` in
        // `ref/micropolis/src/sim/s_msg.c`; route audio must still ignore this
        // unless the host sends explicit `soundDeltas`.
        messageDeltas: [{ id: 43, text: 'Major earthquake reported.' }],
      },
    };

    routeMicropolisGameplaySoundDeltas({
      envelope: patchEnvelope,
      reducerOutcome: 'applied',
      userSoundOn: true,
      gameplayAudioConsumer,
      gameplaySoundPlaybackPolicy,
    });

    expect(gameplaySoundPlaybackPolicy).toHaveBeenCalledTimes(1);
    expect(playSoundSpec).not.toHaveBeenCalled();
  });

  it('plays only host-provided sound deltas when policy allows playback', () => {
    const playSoundSpec = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const gameplayAudioConsumer = { playSoundSpec, dispose: vi.fn() };
    const gameplaySoundPlaybackPolicy = vi.fn(() => true);

    const ackEnvelope: HostEnvelope = {
      kind: 'ack',
      roomId: 'room',
      clientId: 'client',
      tick: 4,
      serverSeq: 4,
      commandId: 'cmd-siren',
      soundDeltas: [{ channel: 'city', soundSpec: 'Siren' }],
    };

    routeMicropolisGameplaySoundDeltas({
      envelope: ackEnvelope,
      reducerOutcome: 'applied',
      userSoundOn: true,
      gameplayAudioConsumer,
      gameplaySoundPlaybackPolicy,
    });

    expect(playSoundSpec).toHaveBeenCalledTimes(1);
    expect(playSoundSpec).toHaveBeenCalledWith('Siren');
  });

  it('respects playback policy and skips host sound deltas when denied', () => {
    const playSoundSpec = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const gameplayAudioConsumer = { playSoundSpec, dispose: vi.fn() };
    const gameplaySoundPlaybackPolicy = vi.fn(() => false);

    const envelope: HostEnvelope = {
      kind: 'patch',
      roomId: 'room',
      clientId: 'client',
      tick: 5,
      serverSeq: 5,
      payload: {},
      soundDeltas: [{ channel: 'warning', soundSpec: 'Explosion High' }],
    };

    routeMicropolisGameplaySoundDeltas({
      envelope,
      reducerOutcome: 'applied',
      userSoundOn: true,
      gameplayAudioConsumer,
      gameplaySoundPlaybackPolicy,
    });

    expect(gameplaySoundPlaybackPolicy).toHaveBeenCalledTimes(1);
    expect(playSoundSpec).not.toHaveBeenCalled();
  });
});
