/**
 * Circle-of-fifths ordering for sorting by key. Sorting alphabetically would
 * scatter compatible keys; this puts harmonically related keys next to each
 * other (C / G / D / A / E / B / F# / C# / G# / D# / A# / F). One rule for the
 * Library's Key sort and the share pages'.
 */
const KEY_ORDER: Record<string, number> = {
  C: 0, G: 1, D: 2, A: 3, E: 4, B: 5,
  'F#': 6, 'C#': 7, 'G#': 8, 'D#': 9, 'A#': 10, F: 11,
  // Flat aliases — Postgres / Essentia sometimes emits these instead of
  // sharps. Map them to the equivalent sharp slot so a mixed dataset still
  // sorts coherently.
  Db: 7, Eb: 9, Gb: 6, Ab: 8, Bb: 10,
};

export function keyRank(t: { key?: string | null; scale?: string | null }): number {
  if (!t.key) return 999;
  const base = KEY_ORDER[t.key] ?? 998;
  // Minor sits after major in each slot so a key listing groups
  // C major then C minor, D major then D minor, etc.
  return base * 2 + (t.scale === 'minor' ? 1 : 0);
}
