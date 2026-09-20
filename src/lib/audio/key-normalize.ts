/**
 * One canonical spelling for a track's key and scale.
 *
 * Three things write `tracks.key` / `tracks.scale`, and they disagree:
 *
 *   - `lib/upload/title-metadata` reads what the producer typed, so it emits
 *     flats whenever the producer wrote one (`Bb`, `Eb`).
 *   - `lib/audio/analyze.server` indexes into a sharps-only table, so it can
 *     never emit a flat.
 *   - Essentia (client) emits whatever its key extractor returns.
 *
 * The column is unconstrained `TEXT`, so all three spellings coexist in the
 * same table. Anything comparing keys as strings — the store filter did — then
 * treats `Bb` and `A#` as different keys, and a filter for one silently hides
 * every track stored as the other.
 *
 * Enharmonics are collapsed to sharps, which is what the Camelot table in
 * `lib/audio/harmonic.ts` and the server detector already use. The choice is
 * arbitrary; being the same everywhere is not.
 *
 * Deliberately tolerant on input, because it also runs over rows written
 * before any of this existed: a key may arrive with the scale glued onto it
 * (`F#m`, `Bb minor`, `C maj`), spelled out (`A flat`), with a unicode
 * accidental (`E♭`), or padded and miscased. What it will not do is invent a
 * key for input that names none — `normalizeKey` returns a null key rather
 * than a guess, because a confidently wrong key is worse than no key.
 */

/** The twelve pitch classes, in the spelling everything downstream expects. */
export const CHROMATIC = [
  'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B',
] as const;

export type CanonicalKey = (typeof CHROMATIC)[number];
export type Scale = 'major' | 'minor';

export interface NormalizedKey {
  /** Canonical tonic, e.g. `A#`. Null when the input named no recognisable note. */
  key: CanonicalKey | null;
  /** Null when neither the key string nor the scale column said which mode. */
  scale: Scale | null;
}

/** Semitones above C for each natural note. */
const NATURAL: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/**
 * A tonic, optionally followed by a scale: `F`, `F#`, `Bb minor`, `A flat maj`,
 * `Gm`. Case-insensitive; `readScale` is what distinguishes `m` from `M`.
 */
const KEY_RE =
  /^\s*([A-Ga-g])\s*(#|♯|b|♭|sharp|flat)?\s*[-_ ]*(min(?:or)?|maj(?:or)?|m)?\s*$/i;

function readAccidental(raw: string | undefined): number {
  if (!raw) return 0;
  const a = raw.trim().toLowerCase();
  return a === '#' || a === '♯' || a === 'sharp' ? 1 : -1;
}

/**
 * A single trailing letter follows the usual chord-symbol convention, where
 * case carries the meaning: `Cm` is C minor and `CM` is C major.
 *
 * `lib/upload/title-metadata` deliberately refuses that reading unless the
 * note is uppercase and the `m` lowercase, because it parses whole FILENAMES
 * and `FM radio.wav` would otherwise acquire a key it never claimed. Here the
 * input is a key column — a field whose only job is to name a key — so there
 * is no radio station to confuse it with, and `FM` is someone writing F major.
 */
function readScale(raw: string | undefined): Scale | null {
  if (!raw) return null;
  const s = raw.trim();
  if (s === 'm') return 'minor';
  if (s === 'M') return 'major';
  return /^min/i.test(s) ? 'minor' : 'major';
}

/** Normalise a scale column on its own (`Minor`, `min`, `MAJOR`, `aeolian`). */
export function normalizeScale(scale: string | null | undefined): Scale | null {
  if (!scale) return null;
  const s = scale.trim().toLowerCase();
  if (s === 'm' || s.startsWith('min') || s === 'aeolian') return 'minor';
  if (s.startsWith('maj') || s === 'ionian') return 'major';
  return null;
}

/**
 * Collapse a stored key + scale pair to canonical form.
 *
 * A scale named inside the key string wins over the `scale` column, because
 * it is the more specific statement: a row whose key reads `F#m` says minor
 * whatever an older, separately-detected `scale` column happens to hold.
 */
export function normalizeKey(
  key: string | null | undefined,
  scale?: string | null,
): NormalizedKey {
  const fromColumn = normalizeScale(scale);
  if (!key) return { key: null, scale: fromColumn };

  const m = key.match(KEY_RE);
  if (!m) return { key: null, scale: fromColumn };

  const pitch = (NATURAL[m[1].toUpperCase()] + readAccidental(m[2]) + 12) % 12;
  return {
    key: CHROMATIC[pitch],
    scale: readScale(m[3]) ?? fromColumn,
  };
}

/**
 * `"A# minor"`, the shape `lib/audio/harmonic.ts`'s Camelot table is keyed by.
 * Null when there is no key to name; an unknown scale defaults to major there,
 * so it is spelled out here rather than left to the lookup.
 */
export function canonicalKeyLabel(
  key: string | null | undefined,
  scale?: string | null,
): string | null {
  const n = normalizeKey(key, scale);
  if (!n.key) return null;
  return `${n.key} ${n.scale ?? 'major'}`;
}

/** Whether two stored key/scale pairs name the same key, whatever their spelling. */
export function sameKey(
  a: { key?: string | null; scale?: string | null },
  b: { key?: string | null; scale?: string | null },
): boolean {
  const na = normalizeKey(a.key, a.scale);
  const nb = normalizeKey(b.key, b.scale);
  if (!na.key || !nb.key || na.key !== nb.key) return false;
  // A row that never recorded its mode matches either mode of the same tonic.
  if (na.scale == null || nb.scale == null) return true;
  return na.scale === nb.scale;
}

/**
 * The relative major/minor — the key sharing the same pitches (A minor ↔ C
 * major). A minor third up from the minor tonic, or down from the major one;
 * `+9` is `-3` without a negative modulo.
 */
export function relativeKey(key: CanonicalKey, scale: Scale): { key: CanonicalKey; scale: Scale } {
  const i = CHROMATIC.indexOf(key);
  const shift = scale === 'minor' ? 3 : 9;
  return {
    key: CHROMATIC[(i + shift) % 12],
    scale: scale === 'minor' ? 'major' : 'minor',
  };
}
