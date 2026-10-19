/**
 * The metadata of an org recording or song (LABEL-53): what a person types in
 * the editor, checked and reduced to the columns that really change.
 *
 * Pure. The route (`PATCH /api/org/[orgId]/songs/[trackId]`) reads the row,
 * calls `planMetadataPatch` and writes `plan.set` under a compare-and-set on
 * `metadata_updated_at`; the event it records lists `plan.changed` — field
 * NAMES, never values (a note, a P-line or an owner may be private).
 *
 * Who may write what: the identifier a distributor keys on, the ISRC, needs
 * `release.write` (it is a release gate's input); every other field needs
 * `catalog.write`. A request naming both needs both.
 *
 * Codes go through lib/labelos/identifiers (one normal form per code). The
 * database holds the same rules (173 `tracks_metadata_format`).
 */
import type { Capability } from '@/lib/labelos/capabilities';
import { parseIdentifier } from '@/lib/labelos/identifiers';

export const METADATA_FIELDS = [
  'title',
  'version_label',
  'isrc',
  'iswc',
  'bpm',
  'key',
  'language',
  'explicit',
  'genre',
  'recorded_on',
  'p_line',
  'master_owner',
  'notes',
] as const;
export type MetadataField = (typeof METADATA_FIELDS)[number];

export type MetadataValues = {
  title: string | null;
  version_label: string | null;
  isrc: string | null;
  iswc: string | null;
  bpm: number | null;
  key: string | null;
  language: string | null;
  explicit: boolean | null;
  genre: string | null;
  recorded_on: string | null;
  p_line: string | null;
  master_owner: string | null;
  notes: string | null;
};

/** The columns the editor reads, in the order the form shows them. */
export const METADATA_COLUMNS = `${METADATA_FIELDS.join(', ')}, metadata_updated_at`;

export const TEXT_MAX: Record<'title' | 'version_label' | 'key' | 'genre' | 'p_line' | 'master_owner' | 'notes', number> = {
  title: 200,
  version_label: 80,
  key: 20,
  genre: 80,
  p_line: 200,
  master_owner: 200,
  notes: 4000,
};
export const BPM_MIN = 20;
export const BPM_MAX = 400;

/** A language as the sleeve writes it: "en", "fr", "pt-BR". Lower-case primary tag, ASCII (the 173 CHECK). */
export const LANGUAGE_RE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

/** The capability a field needs. The ISRC is a release input; the rest are the catalogue's. */
export function capabilityFor(field: MetadataField): Capability {
  return field === 'isrc' ? 'release.write' : 'catalog.write';
}

export function isRealDate(v: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

/** Everything the body may carry: absent = leave, null / blank = clear (not for the title). */
export type MetadataInput = { [K in MetadataField]?: (K extends 'bpm' ? number | string : MetadataValues[K]) | undefined };

export type MetadataPlan =
  | { ok: true; set: Partial<MetadataValues>; changed: MetadataField[] }
  | { ok: false; status: 400 | 403; error: string; field?: MetadataField };

const bad = (field: MetadataField, error: string): MetadataPlan => ({ ok: false, status: 400, error, field });

function blankToNull(v: string): string | null {
  const t = v.trim();
  return t === '' ? null : t;
}

/** Control characters (a pasted NUL, a newline in a one-line field) never belong in a label. */
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

export function planMetadataPatch(input: MetadataInput, current: MetadataValues, caps: ReadonlySet<string>): MetadataPlan {
  const named = METADATA_FIELDS.filter((f) => input[f] !== undefined);
  if (named.length === 0) return { ok: true, set: {}, changed: [] };

  // Permission first, so a caller learns nothing about values they may not write.
  for (const f of named) {
    if (!caps.has(capabilityFor(f))) return { ok: false, status: 403, error: 'Forbidden', field: f };
  }

  const set: Partial<MetadataValues> = {};
  for (const f of named) {
    const raw = input[f];
    let next: string | number | boolean | null;
    if (f === 'explicit') {
      next = raw === null ? null : Boolean(raw);
    } else if (f === 'bpm') {
      if (raw === null) next = null;
      else {
        const n = typeof raw === 'string' && raw.trim() === '' ? NaN : Number(raw);
        if (!Number.isInteger(n) || n < BPM_MIN || n > BPM_MAX) return bad(f, `bpm: a whole number from ${BPM_MIN} to ${BPM_MAX}`);
        next = n;
      }
    } else {
      // Notes keep the author's own spacing; only an all-blank note counts as cleared.
      const text = raw === null ? null : f === 'notes' ? (String(raw).trim() === '' ? null : String(raw)) : blankToNull(String(raw));
      if (text === null) {
        if (f === 'title') return bad(f, 'title: a recording needs a title');
        next = null;
      } else if (f === 'isrc' || f === 'iswc') {
        const parsed = parseIdentifier(f, text);
        if (!parsed.ok) return bad(f, parsed.error);
        next = parsed.value;
      } else if (f === 'language') {
        // "EN" and "pt-br" are how people type it; the form kept is language lower, region as typed upper.
        const [primary, ...rest] = text.split('-');
        const tidy = [primary.toLowerCase(), ...rest.map((p) => (p.length === 2 ? p.toUpperCase() : p))].join('-');
        if (!LANGUAGE_RE.test(tidy)) return bad(f, 'language: a code such as en, fr or pt-BR');
        next = tidy;
      } else if (f === 'recorded_on') {
        if (!isRealDate(text)) return bad(f, 'recorded_on: a real date, YYYY-MM-DD');
        next = text;
      } else {
        const max = TEXT_MAX[f];
        if (text.length > max) return bad(f, `${f}: at most ${max} characters`);
        // Notes are the one multi-line field.
        if (f !== 'notes' && CONTROL.test(text)) return bad(f, `${f}: no line breaks or control characters`);
        next = text;
      }
    }
    if (next !== current[f]) (set as Record<string, unknown>)[f] = next;
  }
  return { ok: true, set, changed: Object.keys(set) as MetadataField[] };
}

/** The editor shows every field except the ISWC on a recording: a work has the ISWC, and a song that is its own master still needs an ISRC. */
export function fieldsFor(kind: 'song' | 'recording'): MetadataField[] {
  return kind === 'song' ? [...METADATA_FIELDS] : METADATA_FIELDS.filter((f) => f !== 'iswc');
}
