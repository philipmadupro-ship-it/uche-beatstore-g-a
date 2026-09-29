/**
 * Linked material: how the tracks of one record point at each other.
 *
 * Two stores feed one model:
 *   - song_beats (mig 132): a song built on beats          → relation 'beat'
 *   - track_links (mig 133): instrumental / loop / topline / version
 * A link reads "to is from's <relation>" (the song's beat, the beat's loop).
 * The drawer, the zip download and "send all" all see the same list through
 * `mergeLinks`, so a song opened anywhere shows its beat, its instrumental and
 * its loops, and a loop shows the beats that use it.
 */

export const STORED_RELATIONS = ['instrumental', 'loop', 'topline', 'version'] as const;
export type StoredRelation = (typeof STORED_RELATIONS)[number];
export type LinkRelation = 'beat' | StoredRelation;

export function isStoredRelation(v: unknown): v is StoredRelation {
  return typeof v === 'string' && (STORED_RELATIONS as readonly string[]).includes(v);
}

export interface LinkTrack {
  id: string;
  title: string | null;
  type: string | null;
}

export interface LinkedItem {
  relation: LinkRelation;
  /** 'out': the other track is this one's <relation>. 'in': this track is the other's <relation>. */
  direction: 'out' | 'in';
  track: LinkTrack;
  position: number;
}

/** What a linked track is, seen from the track being viewed. */
export function linkLabel(relation: LinkRelation, direction: 'out' | 'in'): string {
  const out: Record<LinkRelation, string> = {
    beat: 'Beat', instrumental: 'Instrumental', loop: 'Loop', topline: 'Topline', version: 'Version',
  };
  const inn: Record<LinkRelation, string> = {
    beat: 'Song on it', instrumental: 'Song', loop: 'Used in', topline: 'Written on', version: 'Version of',
  };
  return direction === 'out' ? out[relation] : inn[relation];
}

/** Display order of groups in the drawer and the zip. */
const ORDER: Array<[LinkRelation, 'out' | 'in']> = [
  ['beat', 'out'], ['instrumental', 'out'], ['topline', 'out'], ['loop', 'out'], ['version', 'out'],
  ['beat', 'in'], ['instrumental', 'in'], ['topline', 'in'], ['loop', 'in'], ['version', 'in'],
];

export interface RawLinks {
  /** song_beats rows touching the track. */
  songBeats: ReadonlyArray<{ song_track_id: string; beat_track_id: string; position: number }>;
  /** track_links rows touching the track. */
  links: ReadonlyArray<{ from_track_id: string; to_track_id: string; relation: string; position: number }>;
  /** The track's main beat (tracks.beat_track_id), in case song_beats is missing. */
  mainBeatId?: string | null;
}

/**
 * Every track linked to `trackId`, one hop, each once (the first relation in
 * display order wins), grouped in display order, positions kept within a group.
 * Tracks missing from `tracks` (another owner's, deleted) are dropped.
 */
export function mergeLinks(trackId: string, raw: RawLinks, tracks: ReadonlyMap<string, LinkTrack>): LinkedItem[] {
  const items: LinkedItem[] = [];
  const add = (relation: LinkRelation, direction: 'out' | 'in', otherId: string, position: number) => {
    if (otherId === trackId) return;
    const track = tracks.get(otherId);
    if (track) items.push({ relation, direction, track, position });
  };
  if (raw.mainBeatId) add('beat', 'out', raw.mainBeatId, -1);
  for (const r of raw.songBeats) {
    if (r.song_track_id === trackId) add('beat', 'out', r.beat_track_id, r.position);
    if (r.beat_track_id === trackId) add('beat', 'in', r.song_track_id, r.position);
  }
  for (const r of raw.links) {
    if (!isStoredRelation(r.relation)) continue;
    if (r.from_track_id === trackId) add(r.relation, 'out', r.to_track_id, r.position);
    if (r.to_track_id === trackId) add(r.relation, 'in', r.from_track_id, r.position);
  }
  const rank = (i: LinkedItem) => ORDER.findIndex(([rel, dir]) => rel === i.relation && dir === i.direction);
  const sorted = items.sort((a, b) => rank(a) - rank(b) || a.position - b.position);
  const seen = new Set<string>();
  return sorted.filter((i) => (seen.has(i.track.id) ? false : (seen.add(i.track.id), true)));
}

/**
 * The relation a new link most likely is, from the two tracks' types, as
 * "to is from's <relation>". The drawer pre-selects it; the producer can
 * change it. A song linking a beat is 'beat' (song_beats); everything else
 * lands in track_links.
 */
export function suggestRelation(fromType: string | null, toType: string | null): LinkRelation {
  if (toType === 'beat' && fromType === 'song') return 'beat';
  if (toType === 'instrumental') return 'instrumental';
  if (toType === 'loop') return 'loop';
  if (toType === 'topline') return 'topline';
  if (fromType === 'song' && toType === 'beat') return 'beat';
  return 'version';
}

/** Relations the drawer offers for linking from a track of `fromType`. */
export function relationChoices(fromType: string | null): LinkRelation[] {
  return fromType === 'song'
    ? ['beat', 'instrumental', 'topline', 'loop', 'version']
    : ['loop', 'topline', 'instrumental', 'version'];
}

/* ── The one-zip download ──────────────────────────────────────────────── */

export const BUNDLE_MAX_TRACKS = 20;

const EXT_RE = /\.(wav|mp3|flac|aiff|aif|m4a|ogg)(?:\?|$)/i;

function safeName(s: string): string {
  return s.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Untitled';
}

/**
 * File names inside the zip: the track itself first, then each linked track
 * labelled by what it is — "01 NIGHT DRIVE.wav", "02 NIGHT DRIVE (Beat) — MIDNIGHT.wav".
 * Numbered so the set sorts in the order the drawer shows it, and never two
 * entries with one name.
 */
export function bundleFileNames(
  main: { title: string | null; source: string },
  linked: ReadonlyArray<{ label: string; title: string | null; source: string }>,
): string[] {
  const mainTitle = safeName(main.title ?? '');
  const ext = (s: string) => (s.match(EXT_RE)?.[1] ?? 'wav').toLowerCase();
  const names = [
    `01 ${mainTitle}.${ext(main.source)}`,
    ...linked.map((l, i) => `${String(i + 2).padStart(2, '0')} ${safeName(l.label)} - ${safeName(l.title ?? '')}.${ext(l.source)}`),
  ];
  const used = new Map<string, number>();
  return names.map((n) => {
    const k = n.toLowerCase();
    const count = used.get(k) ?? 0;
    used.set(k, count + 1);
    return count === 0 ? n : n.replace(/(\.[a-z0-9]+)$/, ` (${count + 1})$1`);
  });
}

export function bundleZipName(title: string | null): string {
  return `${safeName(title ?? 'Tracks')} - linked.zip`;
}

/** A short text file that says what each entry in the zip is. */
export function bundleReadme(mainTitle: string | null, entries: ReadonlyArray<{ file: string; label: string }>): string {
  return [
    `${mainTitle ?? 'Untitled'} — linked material`,
    '',
    ...entries.map((e) => `${e.file}  (${e.label})`),
    '',
  ].join('\n');
}
