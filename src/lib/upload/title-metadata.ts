/**
 * Read BPM and key out of a beat's filename.
 *
 * Producers name files the way they think: `Night Shift 140 Fm.wav`,
 * `drill_type_beat_142bpm_Gmin.mp3`, `COLD FRONT (Bb maj) 92 BPM.wav`. That is
 * the metadata the app otherwise asks them to re-enter by hand, or guesses
 * from the audio. When the name says it, believe the name: the producer made
 * the beat, and a detector working from audio regularly halves or doubles a
 * tempo and picks the relative major over the minor.
 *
 * The matched parts are also removed from the title, so the library shows
 * `Night Shift` rather than `Night Shift 140 Fm`.
 *
 * Deliberately conservative — a wrong BPM written confidently is worse than
 * no BPM, because nothing later re-checks it:
 *   - A bare number only counts as BPM inside a plausible tempo range, and
 *     never when it looks like a year, a version (`v2`), an 808, or part of a
 *     longer token.
 *   - A key needs a real accidental or a major/minor suffix. A lone `F` or a
 *     word like `Am` is left alone.
 */

export interface TitleMetadata {
  /** Filename with extension, separators and any matched BPM/key removed. */
  title: string;
  bpm: number | null;
  /** Tonic, normalised to sharps-or-flats as written, e.g. `F#`, `Bb`, `C`. */
  key: string | null;
  scale: 'major' | 'minor' | null;
  /** Which fields came from the name. Useful for telling the producer. */
  matched: Array<'bpm' | 'key'>;
}

/** Tempos outside this stay unmatched when the number is bare. */
export const MIN_BARE_BPM = 60;
export const MAX_BARE_BPM = 220;
/** With an explicit `bpm` marker we trust a wider range. */
export const MIN_MARKED_BPM = 30;
export const MAX_MARKED_BPM = 300;

const NOTE = '[A-Ga-g]';
const ACCIDENTAL = '(?:#|♯|b|♭|\\s?sharp|\\s?flat)';

/** `140bpm`, `140 bpm`, `bpm 140`, `@140`. */
const MARKED_BPM = new RegExp(`(?:\\bbpm[\\s._-]*(\\d{2,3})\\b|\\b(\\d{2,3})[\\s._-]*bpm\\b|@[\\s]*(\\d{2,3})\\b)`, 'i');

/**
 * A key with an accidental (`F#m`, `Bb maj`, `A flat minor`), a plain note
 * with a spelled-out quality (`G min`, `C major`), or the `Fm` shorthand.
 *
 * The shorthand is the only case-sensitive one: an uppercase note with a
 * lowercase `m`. Case-insensitively, `FM` (radio) and `fm` read as F-something
 * and every such filename would get a key it never claimed.
 */
const SPELLED_QUALITY = '(?:min(?:or)?|maj(?:or)?)';
const KEY_PATTERNS: Array<{ re: RegExp }> = [
  { re: new RegExp(`\\bkey[\\s._-]*(?:of[\\s._-]*)?(${NOTE})(${ACCIDENTAL})?[\\s._-]*(${SPELLED_QUALITY}|m)?\\b`, 'i') },
  { re: new RegExp(`\\b(${NOTE})(${ACCIDENTAL})[\\s._-]*(${SPELLED_QUALITY}|m)?\\b`, 'i') },
  { re: new RegExp(`\\b(${NOTE})()[\\s._-]*(${SPELLED_QUALITY})\\b`, 'i') },
  // Case-sensitive shorthand: `Fm`, `C#m` handled above, `Gm`.
  { re: new RegExp(`\\b([A-G])()(m)\\b`) },
];

function normaliseAccidental(raw: string | undefined): string {
  if (!raw) return '';
  const a = raw.trim().toLowerCase();
  if (a === '#' || a === '♯' || a === 'sharp') return '#';
  return 'b';
}

function normaliseScale(raw: string | undefined): 'major' | 'minor' | null {
  if (!raw) return null;
  return /^m(in(or)?)?$/i.test(raw.trim()) ? 'minor' : 'major';
}

/** Strip the extension and turn separators into spaces. */
function cleanBase(filename: string): string {
  return filename
    .replace(/\.[^/.]+$/, '')
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Tidy a title after cutting matches out of the middle of it. */
function tidy(title: string): string {
  return title
    .replace(/[\s]*[([{][\s)\]}]*[)\]}]/g, ' ')   // emptied brackets
    .replace(/[([{]\s*$/g, ' ')                    // a bracket left hanging open
    .replace(/\s*[-–—|,]\s*(?=[-–—|,]|$)/g, ' ')   // orphaned separators
    .replace(/^[\s\-–—|,.]+|[\s\-–—|,.]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function looksLikeYear(n: number): boolean {
  return n >= 1900 && n <= 2199;
}

export function parseTitleMetadata(filename: string): TitleMetadata {
  const base = cleanBase(filename);
  let working = base;
  const matched: TitleMetadata['matched'] = [];

  let bpm: number | null = null;
  const markedBpm = working.match(MARKED_BPM);
  if (markedBpm) {
    const value = Number(markedBpm[1] ?? markedBpm[2] ?? markedBpm[3]);
    if (value >= MIN_MARKED_BPM && value <= MAX_MARKED_BPM) {
      bpm = value;
      working = working.replace(markedBpm[0], ' ');
      matched.push('bpm');
    }
  }

  let key: string | null = null;
  let scale: 'major' | 'minor' | null = null;
  for (const { re } of KEY_PATTERNS) {
    const m = working.match(re);
    if (!m) continue;
    // A note letter glued to digits ("A1", "C4") is a sample name, not a key.
    const after = working.slice((m.index ?? 0) + m[0].length);
    if (/^\d/.test(after)) continue;
    key = m[1].toUpperCase() + normaliseAccidental(m[2]);
    scale = normaliseScale(m[3]);
    working = working.replace(m[0], ' ');
    matched.push('key');
    break;
  }

  if (bpm == null) {
    // Bare number, e.g. "Night Shift 140". Only inside a plausible range, and
    // never a year or something glued to other characters (v2, 808s, 2x).
    const bare = working.match(/(?:^|[\s\-–—|([{,])(\d{2,3})(?=$|[\s\-–—|)\]},.])/);
    if (bare) {
      const value = Number(bare[1]);
      if (value >= MIN_BARE_BPM && value <= MAX_BARE_BPM && !looksLikeYear(value)) {
        bpm = value;
        working = working.replace(bare[1], ' ');
        matched.push('bpm');
      }
    }
  }

  const title = tidy(working.replace(/[\-–—]+/g, ' ')) || tidy(base.replace(/[\-–—]+/g, ' ')) || 'Untagged Track';
  return { title, bpm, key, scale, matched };
}

/** One-line summary for the UI: "BPM 140 · F minor from the filename". */
export function describeTitleMetadata(meta: TitleMetadata): string | null {
  if (!meta.matched.length) return null;
  const parts: string[] = [];
  if (meta.bpm != null) parts.push(`${meta.bpm} BPM`);
  if (meta.key) parts.push(`${meta.key}${meta.scale ? ` ${meta.scale}` : ''}`);
  return parts.length ? `${parts.join(' · ')} from the filename` : null;
}
