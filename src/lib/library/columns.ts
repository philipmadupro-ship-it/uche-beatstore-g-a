/**
 * Configurable library columns.
 *
 * The library list had four fixed columns. Different workflows want different
 * things visible — someone pricing a catalogue wants Store and License, someone
 * mixing wants BPM, Key and Energy — and neither should have to squint past the
 * other's columns.
 *
 * Everything here is pure: which columns exist, how a preference is validated,
 * and how a set of columns becomes a CSS grid template. The React side only
 * renders what these return. Column layout is exactly the sort of logic that
 * looks obviously right inline and silently rots — a dropped column id or an
 * off-by-one grid template is invisible until someone's saved layout breaks.
 */

import type { Track, TrackTag } from '@/lib/types';

export type TrackWithTags = Track & { track_tags?: TrackTag[] };

export type ColumnAlign = 'left' | 'right';

export interface LibraryColumn {
  id: string;
  label: string;
  /** CSS grid track size for this column at desktop width. */
  width: string;
  align: ColumnAlign;
  /** Sort key, when this column can order the list. */
  sort?: 'title' | 'recent' | 'rating' | 'bpm-desc';
  /** Cannot be hidden — without it a row is unidentifiable. */
  required?: boolean;
  /** Reads the display value for a track. Empty string renders as a dash. */
  value: (track: TrackWithTags) => string;
}

const fmtDuration = (seconds: number | null | undefined): string => {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
};

const fmtDate = (iso: string | null | undefined): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

/** 0..1 analysis scores are meaningless as decimals to a producer; show percent. */
const fmtScore = (v: number | null | undefined): string =>
  v == null || !Number.isFinite(v) ? '' : `${Math.round(v * 100)}`;

const tagsOf = (t: TrackWithTags, category: string): string[] =>
  (t.track_tags ?? []).filter((tt) => tt.category === category).map((tt) => tt.tag);

/** Container format, inferred from the stored key — there is no format column
 *  in the schema, but the extension is authoritative enough to display. */
export function fileTypeOf(track: TrackWithTags): string {
  const source = track.wav_url || track.audio_url || '';
  const match = /\.([a-z0-9]{2,5})(?:\?|$)/i.exec(source);
  return match ? match[1].toUpperCase() : '';
}

export function licenseLabelOf(track: TrackWithTags): string {
  if (track.exclusive_sold) return 'Exclusive sold';
  if (!track.store_listed) return 'Unlisted';
  if (track.free_download_enabled) return 'Free';
  const lease = track.lease_price_usd;
  if (lease != null && Number.isFinite(lease)) return `$${lease}`;
  return 'Listed';
}

/**
 * Every column the library can show.
 *
 * Deliberately excludes Artist, Producer, Plays, Downloads, Revenue and Last
 * Updated. None has a source on this payload: the app is single-producer so
 * artist/producer are constant, plays live in `share_plays`, revenue in
 * `license_purchases`, and `tracks` has no `updated_at`. Offering a column
 * that can only ever render a dash is worse than not offering it — it looks
 * like missing data rather than a missing feature.
 */
export const LIBRARY_COLUMNS: LibraryColumn[] = [
  { id: 'title',    label: 'Title',      width: 'minmax(0,1.45fr)', align: 'left',  sort: 'title', required: true, value: (t) => t.title },
  { id: 'tags',     label: 'Tags',       width: 'minmax(0,1fr)',    align: 'left',  value: (t) => (t.track_tags ?? []).map((x) => x.tag).join(', ') },
  { id: 'genre',    label: 'Genre',      width: 'minmax(0,0.7fr)',  align: 'left',  value: (t) => tagsOf(t, 'genre').join(', ') },
  { id: 'mood',     label: 'Mood',       width: 'minmax(0,0.7fr)',  align: 'left',  value: (t) => tagsOf(t, 'mood').join(', ') },
  { id: 'bpm',      label: 'BPM',        width: '64px',             align: 'right', sort: 'bpm-desc', value: (t) => (t.bpm ? String(t.bpm) : '') },
  { id: 'key',      label: 'Key',        width: '56px',             align: 'right', value: (t) => (t.key ? `${t.key}${t.scale === 'minor' ? 'm' : ''}` : '') },
  { id: 'duration', label: 'Duration',   width: '72px',             align: 'right', value: (t) => fmtDuration(t.duration_seconds) },
  { id: 'energy',   label: 'Energy',     width: '68px',             align: 'right', value: (t) => fmtScore(t.energy) },
  { id: 'type',     label: 'Type',       width: '96px',             align: 'left',  value: (t) => t.type ?? '' },
  { id: 'status',   label: 'Status',     width: '96px',             align: 'left',  value: (t) => t.status ?? '' },
  { id: 'license',  label: 'License',    width: '104px',            align: 'left',  value: licenseLabelOf },
  { id: 'filetype', label: 'File type',  width: '80px',             align: 'left',  value: fileTypeOf },
  { id: 'added',    label: 'Date added', width: '92px',             align: 'right', sort: 'recent', value: (t) => fmtDate(t.created_at) },
  { id: 'rating',   label: 'Rating',     width: '148px',            align: 'right', sort: 'rating', value: (t) => (t.rating ? String(t.rating) : '') },
];

const BY_ID = new Map(LIBRARY_COLUMNS.map((c) => [c.id, c]));

export const REQUIRED_COLUMN_IDS = LIBRARY_COLUMNS.filter((c) => c.required).map((c) => c.id);

/** What the library showed before it was configurable. */
export const DEFAULT_COLUMN_IDS = ['title', 'tags', 'duration', 'added', 'rating'];

export function getColumn(id: string): LibraryColumn | undefined {
  return BY_ID.get(id);
}

/**
 * Turn a stored preference into a usable column list.
 *
 * localStorage is untrusted: it was written by an older build that may have had
 * different column ids, and can be edited by hand. Unknown ids are dropped,
 * duplicates collapsed, and required columns forced back in at the front — a
 * saved layout that hid Title would otherwise render an unreadable table with
 * no way to recover but clearing site data.
 */
export function resolveColumns(ids: unknown): LibraryColumn[] {
  const list = Array.isArray(ids) ? ids : DEFAULT_COLUMN_IDS;

  const seen = new Set<string>();
  const resolved: LibraryColumn[] = [];
  for (const id of list) {
    if (typeof id !== 'string') continue;
    const col = BY_ID.get(id);
    if (!col || seen.has(id)) continue;
    seen.add(id);
    resolved.push(col);
  }

  for (const id of REQUIRED_COLUMN_IDS) {
    if (!seen.has(id)) resolved.unshift(BY_ID.get(id)!);
  }

  // An empty or wholly invalid preference falls back rather than rendering
  // a single-column table.
  return resolved.length > 1 ? resolved : LIBRARY_COLUMNS.filter((c) => DEFAULT_COLUMN_IDS.includes(c.id));
}

/**
 * Build the row's `grid-template-columns`.
 *
 * The leading and trailing tracks are the cover/play control and the actions
 * menu. They are structural rather than data columns, so they are not
 * configurable and are always present.
 */
export function gridTemplate(columns: LibraryColumn[]): string {
  return ['40px', ...columns.map((c) => c.width), '32px'].join(' ');
}

/** Move a column, for drag-to-reorder. Out-of-range indices are no-ops. */
export function reorderColumns(ids: string[], from: number, to: number): string[] {
  if (from === to) return ids;
  if (from < 0 || from >= ids.length || to < 0 || to >= ids.length) return ids;
  const next = [...ids];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** Toggle visibility. Required columns cannot be removed. */
export function toggleColumn(ids: string[], id: string): string[] {
  if (!BY_ID.has(id)) return ids;
  if (ids.includes(id)) {
    if (REQUIRED_COLUMN_IDS.includes(id)) return ids;
    return ids.filter((x) => x !== id);
  }
  return [...ids, id];
}
