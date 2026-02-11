/**
 * Browser audio element contract used by the gameplay sound consumer.
 * Mirrors the minimal playback controls required by Micropolis sound dispatch
 * (`MakeSound` / `MakeSoundOn`) in `ref/micropolis/src/sim/w_sound.c`, adapted
 * to the web `Audio` API.
 */
interface MicropolisGameplayAudioElement {
  currentTime: number;
  preload: string;
  src: string;
  pause(): void;
  play(): Promise<void>;
}

/**
 * Runtime-facing gameplay sound playback adapter.
 * Mirrors Micropolis gameplay sound dispatch ownership from
 * `ref/micropolis/src/sim/w_sound.c`, with Tcl forwarding in
 * `ref/micropolis/res/micropolis.tcl` and Sugar wav lookup in
 * `ref/micropolis/micropolisactivity.py`.
 */
export interface MicropolisGameplayAudioConsumer {
  playSoundSpec(soundSpec: string): Promise<void>;
  dispose(): void;
}

/**
 * Optional construction hooks for deterministic gameplay-audio tests.
 * Mirrors production behavior when omitted; test callers may inject
 * `createAudioElement` to avoid browser API coupling.
 */
export interface CreateMicropolisGameplayAudioConsumerOptions {
  createAudioElement?: (wavPath: string) => MicropolisGameplayAudioElement;
}

/**
 * Normalizes one Micropolis gameplay sound spec to a wav token stem.
 * Mirrors Sugar token handling:
 * - `EchoPlaySound` forwards the first list element from `soundspec` in
 *   `ref/micropolis/res/micropolis.tcl`.
 * - `play_sound` lowercases it before `<name>.wav` lookup in
 *   `ref/micropolis/micropolisactivity.py`.
 * Difference: none; this is a 1:1 normalization rule.
 */
export function normalizeMicropolisGameplaySoundToken(soundSpec: string): string {
  const trimmedSoundSpec = soundSpec.trimStart();
  if (trimmedSoundSpec === '') {
    return '';
  }

  const firstWhitespaceIndex = trimmedSoundSpec.search(/\s/);
  const firstToken =
    firstWhitespaceIndex === -1
      ? trimmedSoundSpec
      : trimmedSoundSpec.slice(0, firstWhitespaceIndex);
  return firstToken.toLowerCase();
}

/**
 * Builds one browser wav asset path for a gameplay `soundSpec`.
 * Mirrors Sugar `res/sounds/<name>.wav` lookup in
 * `ref/micropolis/micropolisactivity.py`, adapted to Vite `public/sounds`.
 */
export function toMicropolisGameplaySoundWavPath(soundSpec: string): string {
  return `/sounds/${normalizeMicropolisGameplaySoundToken(soundSpec)}.wav`;
}

/**
 * Creates a dedicated gameplay sound consumer for authoritative runtime events.
 * Mirrors Micropolis runtime sound dispatch boundaries in
 * `ref/micropolis/src/sim/w_sound.c`.
 * Parity note: audio elements are cached by normalized wav path and rewound
 * (`currentTime=0`) for repeated playback, matching repeated sound intents.
 */
export function createMicropolisGameplayAudioConsumer(
  options: CreateMicropolisGameplayAudioConsumerOptions = {},
): MicropolisGameplayAudioConsumer {
  const createAudioElement = options.createAudioElement ?? createBrowserAudioElement;
  const audioByPath = new Map<string, MicropolisGameplayAudioElement>();

  return {
    async playSoundSpec(soundSpec: string): Promise<void> {
      const wavPath = toMicropolisGameplaySoundWavPath(soundSpec);
      let audioElement = audioByPath.get(wavPath);
      if (audioElement === undefined) {
        audioElement = createAudioElement(wavPath);
        audioElement.preload = 'auto';
        audioByPath.set(wavPath, audioElement);
      }

      audioElement.currentTime = 0;
      await audioElement.play();
    },
    dispose(): void {
      for (const audioElement of audioByPath.values()) {
        audioElement.pause();
        audioElement.src = '';
      }
      audioByPath.clear();
    },
  };
}

/**
 * Creates one browser-backed audio element for gameplay sound playback.
 * Mirrors runtime `PlaySound <token>` dispatch from `EchoPlaySound` in
 * `ref/micropolis/res/micropolis.tcl`, adapted to browser `Audio`.
 */
function createBrowserAudioElement(wavPath: string): MicropolisGameplayAudioElement {
  if (typeof Audio === 'undefined') {
    throw new Error('Audio API unavailable in this environment.');
  }

  return new Audio(wavPath);
}
