/**
 * Creative direction (LABEL-26, 04 W6, 17 R3): a per-artist memory of where
 * the music is going and what it is measured against. Keyed by the roster
 * CONTACT (`artist_direction.contact_id`, `artist_references.contact_id`) —
 * the artist is a contact in workspace mode, there is no `artists` table.
 *
 * Pure rules; `direction-store.ts` reads and writes, the routes authorise.
 *
 *  - The direction is a small STRUCTURED document (a few short text fields and
 *    keywords). There is no free-form wiki: a field that is not in
 *    `DIRECTION_FIELDS` is dropped, a long one is refused.
 *  - A reference is a track of the org, a link, a visual file already on an org
 *    project, or a written note, each `artist`-visible or `internal`.
 *  - INTERNAL references are the team's (owner / admin / member). A member whose
 *    role is `artist` never reads one, whatever abilities were switched on for
 *    them: `canReadInternalReference`, the TS twin of the `internal` branch of
 *    migration 152's `artist_references_member_read`.
 */

import { VISUAL_ASSET_KINDS } from './org-assets';

export const DIRECTION_TEXT_MAX = 600;
export const DIRECTION_KEYWORD_MAX = 40;
export const DIRECTION_KEYWORDS_MAX = 12;

/** The structured fields, in display order. Each is short text. */
export const DIRECTION_FIELDS = ['sound', 'lyrics', 'visual', 'influences', 'avoid', 'next'] as const;
export type DirectionField = (typeof DIRECTION_FIELDS)[number];

export const DIRECTION_FIELD_LABEL: Record<DirectionField, string> = {
  sound: 'Sound',
  lyrics: 'Lyrics & themes',
  visual: 'Visual world',
  influences: 'Influences',
  avoid: 'Steer away from',
  next: 'Next move',
};

export const DIRECTION_FIELD_HINT: Record<DirectionField, string> = {
  sound: 'Tempo, palette, textures, the feeling of the records.',
  lyrics: 'What the songs are about; the voice and the point of view.',
  visual: 'Artwork, photography, colour and the look around the music.',
  influences: 'Who and what the artist is placed next to.',
  avoid: 'What does not fit — sounds, topics, comparisons.',
  next: 'The next release or move this direction is building toward.',
};

export type ArtistDirection = Partial<Record<DirectionField, string>> & { keywords?: string[] };

/**
 * A direction from anything a client or the database sent: known keys only,
 * strings trimmed, empties dropped, keywords de-duplicated (case-insensitive,
 * first spelling kept) and capped. Never throws — the contract refuses what is
 * too long before this runs; this is the shape guarantee for stored values.
 */
export function normalizeDirection(raw: unknown): ArtistDirection {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out: ArtistDirection = {};
  for (const f of DIRECTION_FIELDS) {
    const v = src[f];
    if (typeof v !== 'string') continue;
    const t = v.trim();
    if (t) out[f] = t.slice(0, DIRECTION_TEXT_MAX);
  }
  if (Array.isArray(src.keywords)) {
    const seen = new Set<string>();
    const keywords: string[] = [];
    for (const k of src.keywords) {
      if (typeof k !== 'string') continue;
      const t = k.trim().slice(0, DIRECTION_KEYWORD_MAX);
      const key = t.toLowerCase();
      if (!t || seen.has(key)) continue;
      seen.add(key);
      keywords.push(t);
      if (keywords.length >= DIRECTION_KEYWORDS_MAX) break;
    }
    if (keywords.length > 0) out.keywords = keywords;
  }
  return out;
}

export function isEmptyDirection(d: ArtistDirection): boolean {
  return Object.keys(normalizeDirection(d)).length === 0;
}

/** True when two directions say the same thing (so a no-op save writes and records nothing). */
export function sameDirection(a: ArtistDirection, b: ArtistDirection): boolean {
  return JSON.stringify(normalizeDirection(a)) === JSON.stringify(normalizeDirection(b));
}

/** Which fields a save changed, in field order — the event payload names fields, never their words. */
export function changedDirectionFields(before: ArtistDirection, after: ArtistDirection): Array<DirectionField | 'keywords'> {
  const a = normalizeDirection(before);
  const b = normalizeDirection(after);
  const out: Array<DirectionField | 'keywords'> = [];
  for (const f of DIRECTION_FIELDS) if ((a[f] ?? '') !== (b[f] ?? '')) out.push(f);
  if (JSON.stringify(a.keywords ?? []) !== JSON.stringify(b.keywords ?? [])) out.push('keywords');
  return out;
}

// ── References ──────────────────────────────────────────────────────────

export const REFERENCE_KINDS = ['track', 'link', 'file', 'note'] as const;
export type ReferenceKind = (typeof REFERENCE_KINDS)[number];

export const REFERENCE_KIND_LABEL: Record<ReferenceKind, string> = {
  track: 'Track',
  link: 'Link',
  file: 'File',
  note: 'Note',
};

export const REFERENCE_VISIBILITIES = ['artist', 'internal'] as const;
export type ReferenceVisibility = (typeof REFERENCE_VISIBILITIES)[number];

export const REFERENCE_TITLE_MAX = 200;
export const REFERENCE_NOTE_MAX = 2000;
export const REFERENCE_URL_MAX = 2000;
export const REFERENCES_PER_ARTIST_MAX = 200;

export function isReferenceKind(v: unknown): v is ReferenceKind {
  return typeof v === 'string' && (REFERENCE_KINDS as readonly string[]).includes(v);
}

/** Anything but the exact word `internal` is NOT internal here; the read paths go the other way (see below). */
export function isReferenceVisibility(v: unknown): v is ReferenceVisibility {
  return typeof v === 'string' && (REFERENCE_VISIBILITIES as readonly string[]).includes(v);
}

/**
 * May a member with this role read an internal reference? The team does
 * (owner, admin, member); a roster artist (role `artist`) never does, and an
 * unknown role does not either. Twin of the SQL policy's `role IN (…)`.
 */
export function canReadInternalReference(role: string): boolean {
  return role === 'owner' || role === 'admin' || role === 'member';
}

/**
 * Is a stored reference readable by this role? An allowlist: only the exact
 * value `artist` is open to everyone; `internal` — and any value this code
 * does not know — needs the team.
 */
export function referenceReadableBy(role: string, visibility: string): boolean {
  return visibility === 'artist' || canReadInternalReference(role);
}

/**
 * https links only (the column's CHECK too): no `javascript:`, `data:`,
 * `http:` or credentials in the address. Returns the normalised URL or null.
 */
export function safeReferenceUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const t = raw.trim();
  if (!t || t.length > REFERENCE_URL_MAX) return null;
  let u: URL;
  try {
    u = new URL(t);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.username || u.password || !u.hostname.includes('.')) return null;
  return u.toString();
}

/** "open.spotify.com" — the host, for a row that has no title worth showing twice. */
export function linkHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** A reference may point only at a visual, non-restricted file (migration 152's trigger holds the same list). */
export function referenceFileAllowed(asset: { kind: string; sensitivity: string }): boolean {
  return asset.sensitivity === 'normal' && (VISUAL_ASSET_KINDS as readonly string[]).includes(asset.kind);
}

export type ReferenceRow = {
  id: string;
  kind: string;
  title: string;
  note: string | null;
  url: string | null;
  track_id: string | null;
  asset_id: string | null;
  visibility: string;
  position: number;
  created_at: string;
  updated_at: string;
};

/** What a reference's pointer resolved to for THIS member; null = they may not open it. */
export type ResolvedPointer =
  | { kind: 'track'; title: string }
  | { kind: 'file'; label: string; fileKind: string; mime: string | null; downloadUrl: string }
  | null;

export type ReferenceView = {
  id: string;
  kind: ReferenceKind;
  title: string;
  note: string | null;
  url: string | null;
  host: string | null;
  trackId: string | null;
  trackTitle: string | null;
  assetId: string | null;
  file: { label: string; kind: string; mime: string | null; downloadUrl: string } | null;
  visibility: ReferenceVisibility;
  position: number;
  createdAt: string;
};

/**
 * Built field by field (never a spread of the row: no org id, no author id).
 * A track / file pointer the member may not open resolves to null and the
 * reference is left out by `partitionReferences` — it is counted, not shown.
 */
export function toReferenceView(row: ReferenceRow, pointer: ResolvedPointer): ReferenceView | null {
  if (!isReferenceKind(row.kind)) return null;
  const url = row.kind === 'link' ? safeReferenceUrl(row.url) : null;
  if (row.kind === 'link' && !url) return null;
  if (row.kind === 'track' && pointer?.kind !== 'track') return null;
  if (row.kind === 'file' && pointer?.kind !== 'file') return null;
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    note: row.note,
    url,
    host: url ? linkHost(url) : null,
    trackId: row.kind === 'track' ? row.track_id : null,
    trackTitle: pointer?.kind === 'track' ? pointer.title : null,
    assetId: row.kind === 'file' ? row.asset_id : null,
    file: pointer?.kind === 'file' ? { label: pointer.label, kind: pointer.fileKind, mime: pointer.mime, downloadUrl: pointer.downloadUrl } : null,
    visibility: row.visibility === 'artist' ? 'artist' : 'internal',
    position: row.position,
    createdAt: row.created_at,
  };
}

/**
 * Split the stored references into what this role is shown, and how many of
 * the ones it may read were left out because the pointer is not theirs to
 * open (a track still in development for marketing, a file outside their
 * capabilities). Internal references a role may not read are NOT counted:
 * their existence is not the artist's to know.
 */
export function partitionReferences(
  rows: readonly ReferenceRow[],
  role: string,
  resolve: (row: ReferenceRow) => ResolvedPointer,
): { visible: ReferenceView[]; restricted: number } {
  const visible: ReferenceView[] = [];
  let restricted = 0;
  for (const row of rows) {
    if (!referenceReadableBy(role, row.visibility)) continue;
    const view = toReferenceView(row, resolve(row));
    if (view) visible.push(view);
    else restricted += 1;
  }
  visible.sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt));
  return { visible, restricted };
}

/** The next free position: after the last one, so a new reference lands at the end. */
export function nextReferencePosition(positions: readonly number[]): number {
  return positions.length === 0 ? 0 : Math.max(...positions) + 1;
}
