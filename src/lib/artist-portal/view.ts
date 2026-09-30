/**
 * The artist portal's JSON, built from explicit field lists.
 *
 * The portal is public-by-token, so what it returns is the security boundary.
 * Every object here is constructed field by field — never spread from a row —
 * so a column added to `tracks` or `contacts` later cannot leak through it.
 * Rules (route test asserts them against a hostile row):
 *   - no private storage reference: anything `r2://` is dropped, and audio
 *     only ever goes out as a short-lived signed share-media URL;
 *   - no CRM: notes, tags, stage, tasks, email and phone never appear;
 *   - only this artist's own decision, never another artist's.
 */

import type { Decision } from '@/lib/contacts/decisions';
import type { PublicArtworkTheme } from '@/lib/artwork/public-theme';
import type { PortalAudience } from '@/lib/artist-portal/audience';

export interface PortalTrackSource {
  id: string;
  title: string | null;
  type: string | null;
  bpm: number | null;
  key: string | null;
  scale: string | null;
  duration_seconds: number | null;
  cover_url: string | null;
  beat_track_id?: string | null;
  // Present on the row, must never be emitted.
  audio_url?: string | null;
  wav_url?: string | null;
  preview_url?: string | null;
  notes?: string | null;
  [key: string]: unknown;
}

export interface PortalTrack {
  id: string;
  title: string;
  type: 'beat' | 'song' | 'instrumental' | 'remix' | 'loop' | 'topline';
  bpm: number | null;
  key: string | null;
  scale: string | null;
  duration_seconds: number | null;
  cover_url: string | null;
  /** Every portal project this track is in (a beat can sit in two). */
  projectIds: string[];
  isNew: boolean;
  decision: Decision | null;
  decisionSetBy: 'producer' | 'artist' | null;
  canDownload: boolean;
  /** The first beat a song is built on (its main beat when it can be), when that beat is in this portal too. */
  builtOn: { id: string; title: string } | null;
  /** The song's other beats that are in this portal (mig 132). */
  builtOnOthers: Array<{ id: string; title: string }>;
  /** Separated stems exist for this track (the producer portal offers to ask for them). */
  hasStems: boolean;
  streamUrl: string | null;
  peaksUrl: string | null;
}

export interface PortalProject {
  id: string;
  name: string;
  cover_url: string | null;
  description: string | null;
  isNew: boolean;
  newCount: number;
  beats: number;
  songs: number;
  files: number;
  allowDownloads: boolean;
  canComment: boolean;
  /** The producer's pitch of this project to this label (mig 135); null elsewhere. */
  pitchNote: string | null;
}

/** A project file the producer put in the portal. No storage reference, ever. */
export interface PortalFile {
  id: string;
  projectId: string;
  kind: 'reference' | 'artwork' | 'lyrics' | 'document' | 'audio' | 'other';
  label: string;
  fileName: string;
  mime: string | null;
  sizeBytes: number | null;
  isNew: boolean;
  /** The portal's own streaming route for this file. */
  url: string;
}

export interface PortalView {
  portal: {
    artistName: string;
    lastVisitAt: string | null;
    /** Who the portal is shaped for, from the contact's main role (lib/artist-portal/audience). */
    audience: PortalAudience;
  };
  producer: { name: string; logo_url: string | null; avatar_url: string | null };
  projects: PortalProject[];
  tracks: PortalTrack[];
  files: PortalFile[];
  /** The producer's generated-artwork identity, as every public page receives it. */
  artworkTheme: PublicArtworkTheme;
}

/** A URL the public may load: http(s) or an app-relative path. Never `r2://`, never a data or JS URL. */
export function publicUrlOrNull(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  if (value.startsWith('/') && !value.startsWith('//')) return value;
  try {
    const u = new URL(value);
    return u.protocol === 'https:' || u.protocol === 'http:' ? value : null;
  } catch {
    return null;
  }
}

function portalType(type: string | null): PortalTrack['type'] {
  return type === 'song' || type === 'instrumental' || type === 'remix' || type === 'loop' || type === 'topline' ? type : 'beat';
}

export function toPortalTrack(
  row: PortalTrackSource,
  ctx: {
    projectIds: string[];
    isNew: boolean;
    decision: Decision | null;
    decisionSetBy: 'producer' | 'artist' | null;
    canDownload: boolean;
    /** In-portal beats, main first. */
    builtOn: ReadonlyArray<{ id: string; title: string }>;
    hasStems?: boolean;
    streamUrl: string | null;
    peaksUrl: string | null;
  },
): PortalTrack {
  return {
    id: row.id,
    title: row.title?.trim() || 'Untitled',
    type: portalType(row.type),
    bpm: typeof row.bpm === 'number' ? row.bpm : null,
    key: typeof row.key === 'string' ? row.key : null,
    scale: typeof row.scale === 'string' ? row.scale : null,
    duration_seconds: typeof row.duration_seconds === 'number' ? row.duration_seconds : null,
    cover_url: publicUrlOrNull(row.cover_url),
    projectIds: [...ctx.projectIds],
    isNew: ctx.isNew,
    decision: ctx.decision,
    decisionSetBy: ctx.decision ? ctx.decisionSetBy : null,
    canDownload: ctx.canDownload,
    builtOn: ctx.builtOn[0] ? { id: ctx.builtOn[0].id, title: ctx.builtOn[0].title } : null,
    builtOnOthers: ctx.builtOn.slice(1).map((b) => ({ id: b.id, title: b.title })),
    hasStems: ctx.hasStems === true,
    streamUrl: ctx.streamUrl,
    peaksUrl: ctx.peaksUrl,
  };
}

export function toPortalProject(
  row: { id: string; name: string | null; cover_url: string | null; description: string | null; [key: string]: unknown },
  ctx: { isNew: boolean; newCount: number; beats: number; songs: number; files: number; allowDownloads: boolean; canComment: boolean; pitchNote?: string | null },
): PortalProject {
  return {
    id: row.id,
    name: row.name?.trim() || 'Untitled project',
    cover_url: publicUrlOrNull(row.cover_url),
    description: typeof row.description === 'string' ? row.description : null,
    isNew: ctx.isNew,
    newCount: ctx.newCount,
    beats: ctx.beats,
    songs: ctx.songs,
    files: ctx.files,
    allowDownloads: ctx.allowDownloads,
    canComment: ctx.canComment,
    pitchNote: ctx.pitchNote ?? null,
  };
}

const FILE_KINDS: ReadonlyArray<PortalFile['kind']> = ['reference', 'artwork', 'lyrics', 'document', 'audio', 'other'];

export function toPortalFile(
  row: { id: string; project_id: string; kind: string; label: string | null; file_name: string | null; mime: string | null; size_bytes: number | string | null },
  ctx: { token: string; isNew: boolean },
): PortalFile {
  const size = row.size_bytes == null ? null : Number(row.size_bytes);
  return {
    id: row.id,
    projectId: row.project_id,
    kind: (FILE_KINDS as readonly string[]).includes(row.kind) ? (row.kind as PortalFile['kind']) : 'other',
    label: row.label?.trim() || row.file_name?.trim() || 'Untitled file',
    fileName: (row.file_name ?? '').split(/[\\/]/).pop() ?? '',
    mime: typeof row.mime === 'string' ? row.mime : null,
    sizeBytes: size != null && Number.isFinite(size) ? size : null,
    isNew: ctx.isNew,
    url: `/api/portal/${encodeURIComponent(ctx.token)}/files/${row.id}`,
  };
}

/**
 * The artwork theme with every URL passed through `publicUrlOrNull`. The
 * shared loader (lib/artwork/public-theme) returns profile URLs as stored; a
 * logo or default artwork saved as a private `r2://` reference must not reach
 * a public portal.
 */
export function toPortalArtworkTheme(theme: PublicArtworkTheme): PublicArtworkTheme {
  const kinds = Object.keys(theme.artwork) as Array<keyof PublicArtworkTheme['artwork']>;
  return {
    logo_url: publicUrlOrNull(theme.logo_url),
    artwork: Object.fromEntries(kinds.map((k) => [k, {
      url: publicUrlOrNull(theme.artwork[k]?.url),
      palette: [...(theme.artwork[k]?.palette ?? [])],
    }])) as PublicArtworkTheme['artwork'],
    tag_colors: { ...theme.tag_colors },
  };
}
