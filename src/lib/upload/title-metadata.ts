/**
 * Read BPM, key and credited collaborators out of a beat's filename.
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
 *   - It never chooses between readings. Two tempos, two keys, or a key
 *     that is equally a word come back `needs_confirmation` (see `fields`),
 *     with the top-level value null so no detector is outranked by a guess.
 *   - A collaborator needs an explicit credit marker (`prod. by`, `feat.`,
 *     `w/`). See `COLLAB_MARKERS` for why the `A x B` convention is not one.
 */

import { normalizeKey } from '@/lib/audio/key-normalize';

/** How someone named in a filename was credited. */
export type CollaboratorRole = 'producer' | 'feature' | 'collaborator';

export interface Collaborator {
  /** The name as written, tidied — `Metro Boomin`, not `metro boomin`. */
  name: string;
  role: CollaboratorRole;
}

export interface TitleMetadata {
  /** Filename with extension, separators and any matched credits/BPM/key removed. */
  title: string;
  bpm: number | null;
  /** Tonic, normalised to sharps-or-flats as written, e.g. `F#`, `Bb`, `C`. */
  key: string | null;
  scale: 'major' | 'minor' | null;
  /** Everyone credited in the name, in the order they appeared. */
  collaborators: Collaborator[];
  /** Which fields came from the name. Useful for telling the producer. */
  matched: Array<'bpm' | 'key' | 'collaborators'>;
  /**
   * Fields the name mentions but does not settle — two tempos, two keys, or a
   * "key" that is just as likely an ordinary word. These are NOT applied: the
   * top-level `bpm` / `key` / `scale` stay null, so they cannot outrank a
   * detector, and the text stays in the title. See `fields` for why.
   */
  uncertain: Array<'bpm' | 'key'>;
  /** Per-field reading: value, source, confidence, status and candidates. */
  fields: {
    bpm: FieldReading<number>;
    key: FieldReading<{ key: string; scale: 'major' | 'minor' | null }>;
  };
}

/**
 * What the filename said about one field.
 *
 *   - `accepted` — one clear reading; `value` is set and is what the upload
 *     writes, above any detector.
 *   - `needs_confirmation` — the name mentions the field but not unambiguously.
 *     `value` is null, `candidates` holds every reading and `reason` says why.
 *     The producer has to confirm it; the parser never picks one.
 *   - `absent` — the name says nothing about it.
 *
 * `confidence` is `high` for an explicit marker (`140bpm`, `F# minor`),
 * `medium` for a convention that is usually but not always metadata (a bare
 * `140`), and `low` for anything left unconfirmed.
 */
export type FieldStatus = 'accepted' | 'needs_confirmation' | 'absent';
export type FieldConfidence = 'high' | 'medium' | 'low';

export interface FieldReading<T> {
  value: T | null;
  source: 'filename';
  confidence: FieldConfidence | null;
  status: FieldStatus;
  candidates: T[];
  reason: string | null;
}

function absent<T>(): FieldReading<T> {
  return { value: null, source: 'filename', confidence: null, status: 'absent', candidates: [], reason: null };
}

function unconfirmed<T>(candidates: T[], reason: string): FieldReading<T> {
  return { value: null, source: 'filename', confidence: 'low', status: 'needs_confirmation', candidates, reason };
}

function accepted<T>(value: T, confidence: FieldConfidence): FieldReading<T> {
  return { value, source: 'filename', confidence, status: 'accepted', candidates: [value], reason: null };
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
const MARKED_BPM = new RegExp(`(?:\\bbpm[\\s._-]*(\\d{2,3})\\b|\\b(\\d{2,3})[\\s._-]*bpm\\b|@[\\s]*(\\d{2,3})\\b)`, 'gi');

/** A bare number, e.g. "Night Shift 140" — not glued to other characters (v2, 808s, 2x). */
const BARE_NUMBER = /(?:^|[\s\-–—|([{,])(\d{2,3})(?=$|[\s\-–—|)\]},.])/g;

/**
 * A key with an accidental (`F#m`, `Bb maj`, `A flat minor`), a plain note
 * with a spelled-out quality (`G min`, `C major`), or the `Fm` shorthand.
 *
 * The shorthand is the only case-sensitive one: an uppercase note with a
 * lowercase `m`. Case-insensitively, `FM` (radio) and `fm` read as F-something
 * and every such filename would get a key it never claimed.
 */
const SPELLED_QUALITY = '(?:min(?:or)?|maj(?:or)?)';
const KEY_PATTERNS: Array<{ re: RegExp; marked: boolean }> = [
  { re: new RegExp(`\\bkey[\\s._-]*(?:of[\\s._-]*)?(${NOTE})(${ACCIDENTAL})?[\\s._-]*(${SPELLED_QUALITY}|m)?\\b`, 'gi'), marked: true },
  { re: new RegExp(`\\b(${NOTE})(${ACCIDENTAL})[\\s._-]*(${SPELLED_QUALITY}|m)?\\b`, 'gi'), marked: false },
  { re: new RegExp(`\\b(${NOTE})()[\\s._-]*(${SPELLED_QUALITY})\\b`, 'gi'), marked: false },
  // Case-sensitive shorthand: `Fm`, `C#m` handled above, `Gm`.
  { re: new RegExp(`\\b([A-G])()(m)\\b`, 'g'), marked: false },
];

/**
 * Why a single key reading should not be trusted on its own, or null.
 *
 *   - A note plus the LETTER `b` with nothing after it (`Bb`, `ab`, `db`) is a
 *     two-letter word as often as a key: `BB gun`, `AB test`, `db mix`. With a
 *     quality (`Bbm`, `Bb maj`), a key marker, `♭` or `flat`, it is a key.
 *   - `A` plus a spelled-out quality is also English: `A Major Problem`,
 *     `a minor thing`. Preceded by `in` (`in A minor`) it is a key.
 */
function keyDoubt(m: RegExpMatchArray, marked: boolean, before: string): string | null {
  if (marked) return null;
  const note = m[1];
  const accidental = m[2] ?? '';
  const quality = m[3] ?? '';
  if (accidental.toLowerCase() === 'b' && !quality) {
    return `"${m[0].trim()}" could be a word rather than a key`;
  }
  if (/^a$/i.test(note) && !accidental && quality.length > 1 && !/\bin\s*$/i.test(before)) {
    return `"${m[0].trim()}" could be ordinary words rather than a key`;
  }
  return null;
}

/** Two readings name the same key when their tonics are enharmonic and neither scale contradicts the other. */
function compatibleKeys(
  a: { key: string; scale: 'major' | 'minor' | null },
  b: { key: string; scale: 'major' | 'minor' | null },
): boolean {
  const tonicA = normalizeKey(a.key, null).key ?? a.key;
  const tonicB = normalizeKey(b.key, null).key ?? b.key;
  if (tonicA !== tonicB) return false;
  return a.scale == null || b.scale == null || a.scale === b.scale;
}

function keyLabel(k: { key: string; scale: 'major' | 'minor' | null }): string {
  return k.scale ? `${k.key} ${k.scale}` : k.key;
}

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

/**
 * The credit markers that introduce a name, and the role each implies.
 *
 * Every one of these is an EXPLICIT credit. The `A x B` convention common in
 * beat filenames is deliberately absent: in this corpus `Cardo x Metro type
 * beat` names the producers the beat is meant to sound LIKE, not the people
 * who made it. Reading those as collaborators would credit strangers on the
 * producer's own catalogue, which is worse than reading nothing — so `x` is
 * only ever treated as a separator BETWEEN names already inside a credit
 * group (`prod. by A x B`), never as a marker that starts one.
 */
const COLLAB_MARKERS: Array<{ re: string; role: CollaboratorRole }> = [
  { re: 'prod(?:uced)?\\.?\\s*(?:by)?', role: 'producer' },
  { re: 'feat(?:uring)?\\.?', role: 'feature' },
  { re: 'ft\\.?', role: 'feature' },
  { re: 'w\\/', role: 'collaborator' },
  { re: 'with', role: 'collaborator' },
];

const MARKER_ALTERNATION = COLLAB_MARKERS.map((m) => m.re).join('|');

/** Which role a matched marker belongs to. */
function roleForMarker(marker: string): CollaboratorRole {
  const cleaned = marker.trim().toLowerCase();
  for (const { re, role } of COLLAB_MARKERS) {
    if (new RegExp(`^(?:${re})$`, 'i').test(cleaned)) return role;
  }
  return 'collaborator';
}

/** A credit inside brackets: `(prod. by X)`, `[feat. Y & Z]`. */
const BRACKETED_CREDIT = new RegExp(
  `[([{]\\s*(${MARKER_ALTERNATION})\\s+([^)\\]}]+)[)\\]}]`,
  'gi',
);

/**
 * A credit with no brackets, running to the end of the name or to the next
 * bracket or credit marker — `Night Shift prod. by X feat. Y`.
 */
const BARE_CREDIT = new RegExp(
  `\\b(${MARKER_ALTERNATION})\\s+([^([{]*?)` +
    `(?=$|[([{]|\\s+(?:${MARKER_ALTERNATION})\\s)`,
  'gi',
);

/** Longer than this and it is a sentence, not a name. */
const MAX_NAME_LENGTH = 60;

/**
 * Split one credit group into names. `&`, `,`, `x` and `and` all separate
 * collaborators inside a group that a marker has already opened.
 *
 * The word separators need whitespace on both sides; the punctuation ones do
 * not. Without that, a name that IS one of the words — an artist called `X`,
 * or `Alex` under a word-boundary match — gets split into nothing and the
 * credit silently disappears.
 */
function splitNames(group: string): string[] {
  return group
    .split(/\s*(?:&|\+|,)\s*|\s+(?:x|and)\s+/i)
    .map((n) =>
      n
        .replace(/[\s._\-–—|]+$/g, '')
        .replace(/^[\s._\-–—|]+/g, '')
        .replace(/\s{2,}/g, ' ')
        .trim(),
    )
    .filter((n) => n !== '' && n.length <= MAX_NAME_LENGTH);
}

/**
 * Pull every credit out of the name, returning the names found and the text
 * with those credits removed.
 *
 * Bracketed credits are taken first: their closing bracket says exactly where
 * the credit ends, so they cannot swallow the rest of the name the way an
 * unbracketed one has to be guarded against.
 */
function extractCollaborators(input: string): {
  collaborators: Collaborator[];
  rest: string;
} {
  const collaborators: Collaborator[] = [];
  const seen = new Set<string>();

  const take = (marker: string, group: string) => {
    const role = roleForMarker(marker);
    for (const name of splitNames(group)) {
      const dedupeKey = `${role}\u0000${name.toLowerCase()}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      collaborators.push({ name, role });
    }
  };

  let rest = input.replace(BRACKETED_CREDIT, (_m, marker: string, group: string) => {
    take(marker, group);
    return ' ';
  });

  rest = rest.replace(BARE_CREDIT, (_m, marker: string, group: string) => {
    take(marker, group);
    return ' ';
  });

  return { collaborators, rest };
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

function distinct<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function looksLikeYear(n: number): boolean {
  return n >= 1900 && n <= 2199;
}

export function parseTitleMetadata(filename: string): TitleMetadata {
  const base = cleanBase(filename);
  let working = base;
  const matched: TitleMetadata['matched'] = [];

  // Credits come out first. A name can contain something that would otherwise
  // read as musical metadata — `feat. Gm`, `prod. by 140` — and removing the
  // credit before the BPM and key passes run means it never can.
  const credits = extractCollaborators(working);
  const collaborators = credits.collaborators;
  if (collaborators.length > 0) {
    working = credits.rest;
    matched.push('collaborators');
  }

  // Each field is read in full before anything is taken: every candidate the
  // name offers is collected, and a field is only applied when they agree. The
  // old parser stopped at the first match, so `beat 90 140` became 90 and
  // `Am Fm` became A minor — a coin toss written as the producer's own word,
  // above every detector.

  // BPM, explicitly marked. An explicit marker outranks any bare number.
  let bpmReading: FieldReading<number> = absent();
  const marked = [...working.matchAll(MARKED_BPM)]
    .map((m) => ({ text: m[0], value: Number(m[1] ?? m[2] ?? m[3]) }))
    .filter((m) => m.value >= MIN_MARKED_BPM && m.value <= MAX_MARKED_BPM);
  const markedValues = distinct(marked.map((m) => m.value));
  if (markedValues.length === 1) {
    bpmReading = accepted(markedValues[0], 'high');
    for (const m of marked) working = working.replace(m.text, ' ');
  } else if (markedValues.length > 1) {
    bpmReading = unconfirmed(markedValues, `the filename marks more than one tempo (${markedValues.join(', ')})`);
  }

  let keyReading: FieldReading<{ key: string; scale: 'major' | 'minor' | null }> = absent();
  {
    // Scan a copy with each hit blanked out, so one span is never read twice
    // by two patterns (`key of F#m` is also a plain `F#m`).
    let scan = working;
    const hits: Array<{ text: string; value: { key: string; scale: 'major' | 'minor' | null }; doubt: string | null }> = [];
    for (const { re, marked: isMarked } of KEY_PATTERNS) {
      for (const m of [...scan.matchAll(re)]) {
        const start = m.index ?? 0;
        // A note letter glued to digits ("A1", "C4") is a sample name, not a key.
        if (/^\d/.test(scan.slice(start + m[0].length))) continue;
        hits.push({
          text: m[0],
          value: { key: m[1].toUpperCase() + normaliseAccidental(m[2]), scale: normaliseScale(m[3]) },
          doubt: keyDoubt(m, isMarked, scan.slice(0, start)),
        });
        scan = scan.slice(0, start) + ' '.repeat(m[0].length) + scan.slice(start + m[0].length);
      }
    }

    const agree = hits.every((h) => compatibleKeys(h.value, hits[0].value));
    if (hits.length > 0 && !agree) {
      const labels = distinct(hits.map((h) => keyLabel(h.value)));
      keyReading = unconfirmed(
        hits.map((h) => h.value).filter((v, i) => labels.indexOf(keyLabel(v)) === i),
        `the filename names more than one key (${labels.join(', ')})`,
      );
    } else if (hits.length > 0) {
      // Every reading agrees. Take the most specific one (a scale if any gave it).
      const value = hits.find((h) => h.value.scale != null)?.value ?? hits[0].value;
      // Doubt only stands when nothing unambiguous backs the reading up.
      const clean = hits.find((h) => h.doubt == null);
      if (clean) {
        keyReading = accepted(value, 'high');
        for (const h of hits) working = working.replace(h.text, ' ');
      } else {
        keyReading = unconfirmed([value], hits[0].doubt!);
      }
    }
  }

  if (bpmReading.status === 'absent') {
    // Bare number, e.g. "Night Shift 140". Only inside a plausible range, and
    // never a year or something glued to other characters (v2, 808s, 2x).
    const bare = [...working.matchAll(BARE_NUMBER)]
      .map((m) => Number(m[1]))
      .filter((v) => v >= MIN_BARE_BPM && v <= MAX_BARE_BPM && !looksLikeYear(v));
    const bareValues = distinct(bare);
    if (bareValues.length === 1) {
      bpmReading = accepted(bareValues[0], 'medium');
      working = working.replace(new RegExp(`(^|[\\s\\-–—|([{,])${bareValues[0]}(?=$|[\\s\\-–—|)\\]},.])`, 'g'), '$1 ');
    } else if (bareValues.length > 1) {
      bpmReading = unconfirmed(bareValues, `the filename has more than one number that could be a tempo (${bareValues.join(', ')})`);
    }
  }

  const bpm = bpmReading.value;
  const key = keyReading.value?.key ?? null;
  const scale = keyReading.value?.scale ?? null;
  if (bpmReading.status === 'accepted') matched.push('bpm');
  if (keyReading.status === 'accepted') matched.push('key');
  const uncertain: TitleMetadata['uncertain'] = [];
  if (bpmReading.status === 'needs_confirmation') uncertain.push('bpm');
  if (keyReading.status === 'needs_confirmation') uncertain.push('key');

  const title = tidy(working.replace(/[\-–—]+/g, ' ')) || tidy(base.replace(/[\-–—]+/g, ' ')) || 'Untagged Track';
  return { title, bpm, key, scale, collaborators, matched, uncertain, fields: { bpm: bpmReading, key: keyReading } };
}

/** One-line summary for the UI: "140 BPM · F minor · with Metro from the filename". */
export function describeTitleMetadata(meta: TitleMetadata): string | null {
  if (!meta.matched.length) return null;
  const parts: string[] = [];
  if (meta.bpm != null) parts.push(`${meta.bpm} BPM`);
  if (meta.key) parts.push(`${meta.key}${meta.scale ? ` ${meta.scale}` : ''}`);
  if (meta.collaborators.length > 0) {
    parts.push(`with ${meta.collaborators.map((c) => c.name).join(', ')}`);
  }
  return parts.length ? `${parts.join(' · ')} from the filename` : null;
}

/**
 * One line naming what the filename left unsettled, or null when nothing was.
 * "BPM 90 or 140? · key Bb? — not applied from the filename; set it in the track details".
 */
export function describeUncertainTitleMetadata(meta: TitleMetadata): string | null {
  if (!meta.uncertain.length) return null;
  const parts: string[] = [];
  if (meta.fields.bpm.status === 'needs_confirmation') {
    parts.push(`BPM ${meta.fields.bpm.candidates.join(' or ')}?`);
  }
  if (meta.fields.key.status === 'needs_confirmation') {
    parts.push(`key ${meta.fields.key.candidates.map(keyLabel).join(' or ')}?`);
  }
  return `${parts.join(' · ')} — not read from the filename; set it in the track details`;
}
