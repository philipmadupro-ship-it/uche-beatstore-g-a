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

/**
 * GET /api/projects
 *
 * Caller's projects, newest first, with a `track_count` attached from the
 * project_tracks junction. The main row fetch goes through `scopedList`;
 * the count rollup is a one-off join we run alongside.
 */
export async function GET() {
  type ProjectRow = { id: string; user_id: string | null; [k: string]: unknown };

  const projects = await scopedList<ProjectRow>('projects', {
    orderBy: 'created_at',
    ascending: false,
  });
  if (isErrorResponse(projects)) return projects;

  const ids = projects.map((p) => p.id);
  const counts = new Map<string, number>();

  if (isSupabaseConfigured() && ids.length) {
    const admin = createServiceClient();
    const { data: pts } = await admin
      .from('project_tracks')
      .select('project_id')
      .in('project_id', ids);
    (pts ?? []).forEach((pt: { project_id: string }) => {
      counts.set(pt.project_id, (counts.get(pt.project_id) ?? 0) + 1);
    });
  } else if (!isSupabaseConfigured()) {
    const allPT = getAll('project_tracks') as { project_id: string }[];
    allPT.forEach((pt) => counts.set(pt.project_id, (counts.get(pt.project_id) ?? 0) + 1));
  }

  const withCount = projects.map((p) => ({ ...p, track_count: counts.get(p.id) ?? 0 }));
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
