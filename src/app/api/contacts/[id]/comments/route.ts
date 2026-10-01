import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient, requireRowOwnership } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/db';
import { readBody } from '@/lib/validate';
import { ArtistCommentBodySchema } from '@/lib/contracts';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { selectIn } from '@/lib/db/chunked-in';
import { isMissingSchema } from '@/lib/artists/workspace-load';
import { PORTAL_COMMENT_COLUMNS, toPortalComment, type CommentRow } from '@/lib/artist-portal/comments';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.contacts.comments');

async function names(admin: ReturnType<typeof createServiceClient>, userId: string, contactId: string) {
  const [contact, profile] = await Promise.all([
    admin.from('contacts').select('name').eq('id', contactId).eq('user_id', userId).maybeSingle(),
    admin.from('creator_profiles').select('display_name').eq('user_id', userId).maybeSingle(),
  ]);
  return {
    artistName: (contact.data as { name?: string | null } | null)?.name ?? '',
    producerName: (profile.data as { display_name?: string | null } | null)?.display_name ?? '',
  };
}

/**
 * GET  /api/contacts/[id]/comments — this artist's portal thread, every
 *      project, with project and track names for the workspace.
 * POST /api/contacts/[id]/comments — the producer writes in that thread
 *      { project_id, track_id?, parent_id?, body }. The artist sees it in
 *      their portal on the next visit; nothing is emailed.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isSupabaseConfigured()) return NextResponse.json({ schemaReady: false, comments: [] });
  const auth = await requireRowOwnership('contacts', id);
  if (!auth.ok) return auth.res;
  const { admin, userId } = auth;

  try {
    const { data, error } = await admin
      .from('project_comments')
      .select(PORTAL_COMMENT_COLUMNS)
      .eq('contact_id', id)
      .is('deleted_at', null)
      .order('created_at', { ascending: true })
      .limit(1000);
    if (error) {
      if (isMissingSchema(error)) return NextResponse.json({ schemaReady: false, comments: [] });
      throw error;
    }
    const rows = (data ?? []) as CommentRow[];
    const projectIds = [...new Set(rows.map((r) => r.project_id))];
    const trackIds = [...new Set(rows.map((r) => r.track_id).filter((t): t is string => !!t))];
    const [projects, tracks] = await Promise.all([
      selectIn<{ id: string; name: string | null }>((ids) => admin.from('projects').select('id, name').in('id', ids).eq('user_id', userId), projectIds),
      selectIn<{ id: string; title: string | null }>((ids) => admin.from('tracks').select('id, title').in('id', ids).eq('user_id', userId), trackIds),
    ]);
    // Owner filter: a comment counts only on a project this producer owns.
    const projectName = new Map(projects.map((p) => [p.id, p.name ?? 'Untitled project']));
    const trackTitle = new Map(tracks.map((t) => [t.id, t.title ?? 'Untitled']));
    const n = await names(admin, userId, id);
    const comments = rows
      .filter((r) => projectName.has(r.project_id))
      .map((r) => ({
        ...toPortalComment(r, n),
        projectName: projectName.get(r.project_id)!,
        trackTitle: r.track_id ? trackTitle.get(r.track_id) ?? null : null,
      }));
    return NextResponse.json({ schemaReady: true, comments });
  } catch (err) {
    log.error('load failed', { id, error: errorMessage(err) });
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'The artist workspace needs Supabase.' }, { status: 501 });
  const auth = await requireRowOwnership('contacts', id);
  if (!auth.ok) return auth.res;
  const { admin, userId } = auth;
  const parsed = await readBody(req, ArtistCommentBodySchema);
  if (!parsed.ok) return parsed.res;
  const body = parsed.data;

  try {
    const { data: link, error: linkErr } = await admin
      .from('project_contacts')
      .select('project_id')
      .eq('project_id', body.project_id)
      .eq('contact_id', id)
      .eq('user_id', userId)
      .maybeSingle();
    if (linkErr) throw linkErr;
    if (!link) return NextResponse.json({ error: 'This project is not linked to this artist.' }, { status: 404 });

    const trackId = body.track_id ?? null;
    if (trackId) {
      const { data: pt } = await admin.from('project_tracks').select('track_id').eq('project_id', body.project_id).eq('track_id', trackId).limit(1);
      if (!pt || pt.length === 0) return NextResponse.json({ error: 'That track is not in this project.' }, { status: 404 });
    }
    const parentId = body.parent_id ?? null;
    if (parentId) {
      const { data: parent } = await admin.from('project_comments').select('id')
        .eq('id', parentId).eq('project_id', body.project_id).eq('contact_id', id).maybeSingle();
      if (!parent) return NextResponse.json({ error: 'That comment is not in this thread.' }, { status: 404 });
    }

    const n = await names(admin, userId, id);
    const { data, error } = await admin
      .from('project_comments')
      .insert({
        project_id: body.project_id,
        track_id: trackId,
        user_id: userId,
        share_token: null,
        contact_id: id,
        author_name: n.producerName || 'Producer',
        body: body.body,
        parent_id: parentId,
      })
      .select(PORTAL_COMMENT_COLUMNS)
      .single();
    if (error) {
      if (isMissingSchema(error)) {
        return NextResponse.json({ error: 'Portal comments need migration 128 applied on Supabase.', migration: '128' }, { status: 503 });
      }
      throw error;
    }
    return NextResponse.json({ comment: toPortalComment(data as CommentRow, n) }, { status: 201 });
  } catch (err) {
    log.error('reply failed', { id, error: errorMessage(err) });
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
