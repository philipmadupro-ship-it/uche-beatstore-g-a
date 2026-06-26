import { NextRequest, NextResponse } from 'next/server';
import {
  scopedList,
  insertOwned,
  isErrorResponse,
  createServiceClient,
  isSupabaseConfigured,
  getAll,
} from '@/lib/db';
import { nextProjectName } from '@/lib/naming';
import { parsePagination } from '@/lib/validate';

type ProjectTrackPreviewRow = {
  project_id: string;
  track_id: string;
  position?: number | null;
};

function addPreviewCover(map: Map<string, string[]>, ownerId: string, cover?: unknown) {
  if (typeof cover !== 'string' || !cover) return;
  const covers = map.get(ownerId) ?? [];
  if (!covers.includes(cover) && covers.length < 4) {
    covers.push(cover);
    map.set(ownerId, covers);
  }
}

/**
 * GET /api/projects
 *
 * Caller's projects, newest first, with a `track_count` attached from the
 * project_tracks junction. The main row fetch goes through `scopedList`;
 * the count rollup is a one-off join we run alongside.
 */
export async function GET(req: NextRequest) {
  type ProjectRow = { id: string; user_id: string | null; [k: string]: unknown };

  const { limit, offset } = parsePagination(new URL(req.url).searchParams);
  const projects = await scopedList<ProjectRow>('projects', {
    orderBy: 'created_at',
    ascending: false,
    limit,
    offset,
  });
  if (isErrorResponse(projects)) return projects;

  const ids = projects.map((p) => p.id);
  const counts = new Map<string, number>();
  // Tags + folder membership attached alongside the count so the list can
  // filter by tag and by folder without per-row round-trips (mig 081/083).
  const tagsByProject = new Map<string, { tag: string; category: string | null }[]>();
  const foldersByProject = new Map<string, string[]>();
  const previewCoversByProject = new Map<string, string[]>();

  if (isSupabaseConfigured() && ids.length) {
    const admin = createServiceClient();
    const [{ data: pts }, { data: tagRows }, { data: folderRows }] = await Promise.all([
      admin.from('project_tracks').select('project_id, track_id, position').in('project_id', ids),
      admin.from('project_tags').select('project_id, tag, category').in('project_id', ids),
      admin.from('project_folder_items').select('project_id, folder_id').in('project_id', ids),
    ]);

    const projectTrackRows = (pts ?? []) as ProjectTrackPreviewRow[];
    const trackIds = [...new Set(projectTrackRows.map((pt) => pt.track_id).filter(Boolean))];
    const coverByTrack = new Map<string, string | null>();
    if (trackIds.length) {
      const { data: trackRows } = await admin.from('tracks').select('id, cover_url').in('id', trackIds);
      (trackRows ?? []).forEach((track: { id: string; cover_url: string | null }) => {
        coverByTrack.set(track.id, track.cover_url);
      });
    }

    projectTrackRows.forEach((pt) => {
      counts.set(pt.project_id, (counts.get(pt.project_id) ?? 0) + 1);
    });
    [...projectTrackRows]
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      .forEach((pt) => addPreviewCover(previewCoversByProject, pt.project_id, coverByTrack.get(pt.track_id)));

    (tagRows ?? []).forEach((r: { project_id: string; tag: string; category: string | null }) => {
      const arr = tagsByProject.get(r.project_id) ?? [];
      arr.push({ tag: r.tag, category: r.category });
      tagsByProject.set(r.project_id, arr);
    });
    (folderRows ?? []).forEach((r: { project_id: string; folder_id: string }) => {
      const arr = foldersByProject.get(r.project_id) ?? [];
      arr.push(r.folder_id);
      foldersByProject.set(r.project_id, arr);
    });
  } else if (!isSupabaseConfigured()) {
    const allPT = getAll('project_tracks') as ProjectTrackPreviewRow[];
    const coverByTrack = new Map(
      (getAll('tracks') as { id: string; cover_url?: string | null }[]).map((track) => [track.id, track.cover_url ?? null]),
    );
    allPT.forEach((pt) => counts.set(pt.project_id, (counts.get(pt.project_id) ?? 0) + 1));
    [...allPT]
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      .forEach((pt) => addPreviewCover(previewCoversByProject, pt.project_id, coverByTrack.get(pt.track_id)));
    (getAll('project_tags') as { project_id: string; tag: string; category?: string }[]).forEach((r) => {
      const arr = tagsByProject.get(r.project_id) ?? [];
      arr.push({ tag: r.tag, category: r.category ?? null });
      tagsByProject.set(r.project_id, arr);
    });
    (getAll('project_folder_items') as { project_id: string; folder_id: string }[]).forEach((r) => {
      const arr = foldersByProject.get(r.project_id) ?? [];
      arr.push(r.folder_id);
      foldersByProject.set(r.project_id, arr);
    });
  }

  const withCount = projects.map((p) => ({
    ...p,
    track_count: counts.get(p.id) ?? 0,
    tags: tagsByProject.get(p.id) ?? [],
    folder_ids: foldersByProject.get(p.id) ?? [],
    preview_covers: previewCoversByProject.get(p.id) ?? [],
  }));
  return NextResponse.json({ projects: withCount }, {
    headers: { 'Cache-Control': 'private, max-age=15, stale-while-revalidate=60' },
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const rawName = typeof body.name === 'string' ? body.name.trim() : '';

  // We need the user id BEFORE the insert to seed the auto-name fallback,
  // so we briefly bypass insertOwned() and stamp manually. Still going
  // through the facade for the actual write would mean a second round
  // trip; not worth it for this hot path.
  const name = rawName || (await nextProjectName(null));
  const result = await insertOwned('projects', {
    name,
    cover_url: null,
    description: null,
    bpm_target: null,
    key_target: null,
    status: 'in_progress',
    updated_at: new Date().toISOString(),
  });
  if (isErrorResponse(result)) return result;
  return NextResponse.json({ project: result });
}
