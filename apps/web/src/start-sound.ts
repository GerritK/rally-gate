import { ref } from 'vue';
import { toneTimes } from './countdown';

/**
 * The countdown's tones, generated rather than played from files. Browsers
 * keep audio muted until a tap on the page, so this stays off after every
 * load until "Enable sound" or a Countdown click calls `enableSound`.
 */
export const soundEnabled = ref(false);

let context: AudioContext | null = null;
/** Per slot, so a cancelled countdown can be silenced. */
const scheduled = new Map<string, OscillatorNode[]>();

/** Call from a click handler: that tap is what unlocks audio. */
export function enableSound(): void {
  context ??= new AudioContext();
  void context.resume().then(() => {
    soundEnabled.value = context?.state === 'running';
  });
}

/**
 * Schedules a slot's tones on the audio clock, so they land on the second
 * however busy the page is. `nowMs` is server time; idempotent per key.
 */
export function scheduleTones(key: string, slotMs: number, nowMs: number) {
  if (!context || scheduled.has(key)) return;
  const audio = context;
  const offsetS = audio.currentTime - nowMs / 1000;
  scheduled.set(
    key,
    toneTimes(slotMs, nowMs).map(({ atMs, long }) => {
      const at = atMs / 1000 + offsetS;
      const length = long ? 0.8 : 0.15;
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      oscillator.frequency.value = long ? 1320 : 880;
      // A short ramp at either end, or the tone clicks.
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(0.4, at + 0.01);
      gain.gain.setValueAtTime(0.4, at + length - 0.02);
      gain.gain.linearRampToValueAtTime(0, at + length);
      oscillator.connect(gain).connect(audio.destination);
      oscillator.start(at);
      oscillator.stop(at + length);
      return oscillator;
    }),
  );
}

/** Every key not in `keep`: slots cancelled or gone. */
export function cancelTonesExcept(keep: Set<string>): void {
  for (const [key, oscillators] of scheduled) {
    if (keep.has(key)) continue;
    for (const oscillator of oscillators) oscillator.stop();
    scheduled.delete(key);
  }
}
