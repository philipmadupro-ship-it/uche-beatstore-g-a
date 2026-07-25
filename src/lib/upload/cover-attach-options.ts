import type { CoverAttachTarget } from './cover-attachment';

export type CoverAttachTargetKind = CoverAttachTarget['kind'];

export type CoverAttachOption = {
  id: string;
  label: string;
  detail?: string;
  coverUrl?: string | null;
  bpm?: number | null;
  musicalKey?: string | null;
  durationSeconds?: number | null;
  peaksUrl?: string | null;
};

type CoverAttachRecord = {
  id?: unknown;
  title?: unknown;
  name?: unknown;
  type?: unknown;
  bpm?: unknown;
  key?: unknown;
  duration_seconds?: unknown;
  peaks_url?: unknown;
  track_count?: unknown;
  cover_url?: unknown;
};

const endpointByKind: Record<Exclude<CoverAttachTargetKind, 'profile'>, string> = {
  track: '/api/tracks?paged=1&lean=1',
  project: '/api/projects',
  playlist: '/api/playlists',
};

function endpointForKind(kind: CoverAttachTargetKind, limit: number) {
  if (kind === 'profile') return null;
  const params = new URLSearchParams({ limit: String(limit) });
  return `${endpointByKind[kind]}${endpointByKind[kind].includes('?') ? '&' : '?'}${params.toString()}`;
}

function rowsForKind(kind: CoverAttachTargetKind, data: unknown): CoverAttachRecord[] {
  if (!data || typeof data !== 'object') return [];
  if (Array.isArray(data)) return data as CoverAttachRecord[];
  if (kind === 'track' && Array.isArray((data as { tracks?: unknown }).tracks)) return (data as { tracks: CoverAttachRecord[] }).tracks;
  if (kind === 'project' && Array.isArray((data as { projects?: unknown }).projects)) return (data as { projects: CoverAttachRecord[] }).projects;
  if (kind === 'playlist' && Array.isArray((data as { playlists?: unknown }).playlists)) return (data as { playlists: CoverAttachRecord[] }).playlists;
  return [];
}

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function numberOrNull(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function optionDetail(kind: CoverAttachTargetKind, row: CoverAttachRecord) {
  if (kind === 'track') {
    const parts = [text(row.type), typeof row.bpm === 'number' ? `${row.bpm} BPM` : '', text(row.key)].filter(Boolean);
    return parts.join(' / ') || undefined;
  }

  const count = typeof row.track_count === 'number' ? row.track_count : null;
  if (count === null) return undefined;
  return `${count} ${count === 1 ? 'track' : 'tracks'}`;
}

export function normalizeCoverAttachOptions(kind: CoverAttachTargetKind, data: unknown): CoverAttachOption[] {
  if (kind === 'profile') {
    return [{ id: 'profile', label: 'Profile hero', detail: 'Creator profile' }];
  }

  const options: CoverAttachOption[] = [];
  for (const row of rowsForKind(kind, data)) {
    const id = text(row.id);
    if (!id) continue;
    const detail = optionDetail(kind, row);
      options.push({
        id,
        label: text(row.title) || text(row.name) || id,
        ...(detail ? { detail } : {}),
        coverUrl: text(row.cover_url) || null,
        bpm: numberOrNull(row.bpm),
        musicalKey: text(row.key) || null,
        durationSeconds: numberOrNull(row.duration_seconds),
        peaksUrl: text(row.peaks_url) || null,
      });
  }
  return options;
}

export async function fetchCoverAttachOptions(kind: CoverAttachTargetKind, limit = 24) {
  const endpoint = endpointForKind(kind, limit);
  if (!endpoint) return normalizeCoverAttachOptions(kind, {});

  const response = await fetch(endpoint, { cache: 'no-store' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof data.error === 'string' ? data.error : `HTTP ${response.status}`);
  }

  return normalizeCoverAttachOptions(kind, data);
}
