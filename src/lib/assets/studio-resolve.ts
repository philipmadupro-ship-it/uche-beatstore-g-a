/**
 * Turn an asset id from the URL into a `StudioSource` (AUDIO-03), through the
 * reads the dashboard already has — each one owner-gated on the server:
 *
 *   project file  GET /api/projects/[id]/assets   (views; never a stored url)
 *   track WAV     GET /api/tracks/[id]
 *   stem          GET /api/stems?track_id=         (its `job.stems`, already proxy URLs)
 *
 * If the network read fails but this browser holds a saved copy of that id,
 * the source is built from the saved copy alone ("offline copy"). An id that
 * is malformed, foreign or gone is a plain reason, never a blank page.
 * No fetch of anything but the three routes above, and the id is validated
 * (`parseAssetId`) before it is put in any of them.
 */
import { assetsOfProject } from './from-project';
import { assetsOfTrack, type StemRefs } from './from-track';
import { parseAssetId, studioPlayable, studioSourceOf, type StudioSource } from './studio';
import type { ProjectAssetView } from '@/lib/projects/asset-view';

export type StudioResolveResult =
  | { ok: true; source: StudioSource }
  | { ok: false; reason: 'invalid' | 'not_found' | 'not_audio' | 'unavailable'; message: string };

export interface StudioResolveDeps {
  fetchImpl?: typeof fetch;
  /** The saved-copy meta for a cache id (IndexedDB), or null. Injected so this stays testable. */
  readSaved?: (cacheId: string) => Promise<{ title: string; size: number } | null>;
}

const MESSAGES = {
  invalid: 'That link does not point at a file the Studio can open.',
  not_found: 'That file is not in your library any more.',
  unavailable: 'Could not reach that file. Check your connection and try again.',
} as const;

async function getJson(f: typeof fetch, url: string): Promise<{ status: number; body: unknown } | null> {
  try {
    const res = await f(url, { cache: 'no-store' });
    const body = res.ok ? await res.json().catch(() => null) : null;
    return { status: res.status, body };
  } catch {
    return null;
  }
}

export async function resolveStudioAsset(id: string, deps: StudioResolveDeps = {}): Promise<StudioResolveResult> {
  const parsed = parseAssetId(id);
  if (!parsed) return { ok: false, reason: 'invalid', message: MESSAGES.invalid };
  const f = deps.fetchImpl ?? fetch;

  const fromSaved = async (fallbackSrc: string): Promise<StudioResolveResult | null> => {
    const saved = await deps.readSaved?.(id).catch(() => null);
    if (!saved) return null;
    // Only the saved copy is known here, so there is no fingerprint to compare: a saved copy is trusted.
    const kind = parsed.source === 'project_file' ? 'project_file' : parsed.source === 'track_stem' ? 'stem' : 'wav';
    return {
      ok: true,
      source: { id, kind, title: saved.title, from: null, src: fallbackSrc, cacheId: id, contentKey: undefined, sizeBytes: saved.size, offlineOnly: true },
    };
  };
  const failed = (r: { status: number } | null): StudioResolveResult =>
    r && (r.status === 404 || r.status === 403 || r.status === 401)
      ? { ok: false, reason: 'not_found', message: MESSAGES.not_found }
      : { ok: false, reason: 'unavailable', message: MESSAGES.unavailable };

  if (parsed.source === 'project_file') {
    const downloadRoute = `/api/projects/${parsed.projectId}/assets/${parsed.fileId}/download`;
    const list = await getJson(f, `/api/projects/${parsed.projectId}/assets`);
    const views = (list?.body as { assets?: ProjectAssetView[] } | null)?.assets;
    if (!list || !Array.isArray(views)) return (await fromSaved(downloadRoute)) ?? failed(list);
    const view = views.find((v) => v.id === parsed.fileId && v.project_id === parsed.projectId);
    if (!view) return { ok: false, reason: 'not_found', message: MESSAGES.not_found };
    const asset = assetsOfProject([view])[0];
    if (!studioPlayable(asset).ok) return { ok: false, reason: 'not_audio', message: (studioPlayable(asset) as { reason: string }).reason };
    const project = await getJson(f, `/api/projects/${parsed.projectId}`);
    const name = (project?.body as { project?: { name?: string } } | null)?.project?.name ?? null;
    const source = studioSourceOf(asset, { from: name });
    return source ? { ok: true, source } : { ok: false, reason: 'not_audio', message: 'The Studio only opens audio.' };
  }

  // A track's own WAV or one of its stems.
  const trackRes = await getJson(f, `/api/tracks/${parsed.trackId}`);
  const row = trackRes?.body as { id?: string; title?: string | null; audio_url?: string | null; wav_url?: string | null } | null;
  if (!trackRes || !row || typeof row.id !== 'string') return (await fromSaved('')) ?? failed(trackRes);
  let stems: StemRefs | null = null;
  if (parsed.source === 'track_stem') {
    const stemRes = await getJson(f, `/api/stems?track_id=${parsed.trackId}`);
    const job = (stemRes?.body as { job?: { status?: string; stems?: StemRefs | null } } | null)?.job;
    if (job?.status === 'ready' && job.stems) stems = job.stems;
  }
  const asset = assetsOfTrack({ id: row.id, title: row.title, audio_url: row.audio_url, wav_url: row.wav_url }, stems).find((a) => a.id === id);
  if (!asset) return { ok: false, reason: 'not_found', message: MESSAGES.not_found };
  const source = studioSourceOf(asset, { from: row.title?.trim() || null });
  return source ? { ok: true, source } : { ok: false, reason: 'not_audio', message: 'The Studio only opens audio.' };
}
