import { PITCH_CLASSES } from '../chord-extract';
import { ESSENTIA_SAMPLE_RATE } from '../essentia-extract';

/** Equal-tempered frequency of a pitch class in octave 4 (A4 = 440 Hz). */
function hz(pc: (typeof PITCH_CLASSES)[number]): number {
  const semitonesFromA = PITCH_CLASSES.indexOf(pc);
  // A, A#, B sit above C in octave 3 of the C-based numbering; fold them down
  // so every triad voicing stays within one octave around middle C.
  return 440 * 2 ** ((semitonesFromA >= 3 ? semitonesFromA - 12 : semitonesFromA) / 12);
}

/** Two seconds per chord: triad + the root an octave down, a little noise. */
export function progression(
  chords: Array<(typeof PITCH_CLASSES)[number][]>,
  secondsEach = 2,
  sr = ESSENTIA_SAMPLE_RATE,
): Float32Array {
  const per = Math.round(sr * secondsEach);
  const out = new Float32Array(per * chords.length);
  let seed = 7;
  for (let c = 0; c < chords.length; c++) {
    const freqs = chords[c].map(hz);
    freqs.push(freqs[0] / 2);
    for (let i = 0; i < per; i++) {
      const t = i / sr;
      let v = 0;
      for (const f of freqs) v += Math.sin(2 * Math.PI * f * t) * 0.15;
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      out[c * per + i] = v + ((seed / 0x7fffffff) - 0.5) * 0.01;
    }
  }
  return out;
}

