import { useEffect, useRef, useState } from 'react';

import { SOUND_PREVIEW_SPECS, toMicropolisSoundPreviewWavPath } from './micropolis-soundboard.ts';

/**
 * Manual sound-preview panel for route `/` verification.
 * Mirrors the interactive `UIMakeSound`/`EchoPlaySound` flow in
 * `ref/micropolis/res/micropolis.tcl`, with Sugar wav lookup behavior from
 * `ref/micropolis/micropolisactivity.py`.
 * Parity note: this panel is intentionally preview-only and separate from
 * authoritative gameplay sound-delta playback.
 */
export function MicropolisSoundPreviewPanel() {
  const [soundStatus, setSoundStatus] = useState<string>('');
  const soundPreviewAudioByPath = useRef<Map<string, HTMLAudioElement>>(new Map());

  useEffect(() => {
    const soundPreviewAudioElementsByPath = soundPreviewAudioByPath.current;
    return () => {
      for (const audioElement of soundPreviewAudioElementsByPath.values()) {
        audioElement.pause();
        audioElement.src = '';
      }
      soundPreviewAudioElementsByPath.clear();
    };
  }, []);

  return (
    <section className="grid gap-2 rounded-md border border-slate-700 p-2.5">
      <strong className="font-mono text-[13px]">Sound Test</strong>
      <div className="font-mono text-xs text-slate-700">
        Manual verification only: preview Micropolis wav assets (`/sounds/*.wav`) from the
        Sugar-style token route. Gameplay audio remains host-envelope driven.
      </div>
      <div className="flex flex-wrap gap-2">
        {SOUND_PREVIEW_SPECS.map((soundSpec) => (
          <button
            key={soundSpec.token}
            onClick={() => {
              void playMicropolisSoundPreview({
                token: soundSpec.token,
                audioByPath: soundPreviewAudioByPath.current,
              })
                .then(() => {
                  setSoundStatus(`Played ${soundSpec.label}`);
                })
                .catch((error: unknown) => {
                  const detail = error instanceof Error ? error.message : 'unknown playback error';
                  setSoundStatus(`Failed to play ${soundSpec.label}: ${detail}`);
                });
            }}
            type="button"
          >
            {soundSpec.label}
          </button>
        ))}
      </div>
      <div className="min-h-4 font-mono text-xs text-teal-700">{soundStatus}</div>
    </section>
  );
}

/**
 * Plays one Micropolis preview sound via browser audio.
 * Mirrors Tcl `EchoPlaySound` token forwarding in
 * `ref/micropolis/res/micropolis.tcl` and Sugar `<token>.wav` lookup in
 * `ref/micropolis/micropolisactivity.py`.
 * Parity note: this helper is scoped to the manual preview panel only.
 */
async function playMicropolisSoundPreview({
  token,
  audioByPath,
}: {
  token: string;
  audioByPath: Map<string, HTMLAudioElement>;
}): Promise<void> {
  if (typeof Audio === 'undefined') {
    throw new Error('Audio API unavailable in this environment.');
  }

  const wavPath = toMicropolisSoundPreviewWavPath(token);
  let audioElement = audioByPath.get(wavPath);
  if (audioElement === undefined) {
    audioElement = new Audio(wavPath);
    audioElement.preload = 'auto';
    audioByPath.set(wavPath, audioElement);
  }

  audioElement.currentTime = 0;
  await audioElement.play();
}
