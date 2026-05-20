import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/auth/ownership';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { errorMessage } from '@/lib/errors';
import { ProjectSharePatchBodySchema } from '@/lib/contracts';
import { readBody } from '@/lib/validate';

export const runtime = 'nodejs';

/**
 * Generic single-share management — works for project, playlist, and track shares.
 *
 *   DELETE → revoke (hard delete)
 *   PATCH  → update allow_downloads / label / invited_email / revoke
 *
 * Ownership is verified by tracing the share's content_type to the
 * owning project / playlist / track and checking auth.uid() matches.
 */
async function requireShareOwner(shareId: string) {
  const cookieClient = await createServerClient();
  const { data: { user } } = await cookieClient.auth.getUser();
  if (!user) {
    return { ok: false as const, res: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }) };
  }
  const admin = createServiceClient();
  const { data: share, error } = await admin
    .from('project_shares')
    .select('id, content_type, project_id, playlist_id, track_id')
    .eq('id', shareId)
    .maybeSingle();
  if (error) return { ok: false as const, res: NextResponse.json({ error: error.message }, { status: 500 }) };
  if (!share) return { ok: false as const, res: NextResponse.json({ error: 'Share not found' }, { status: 404 }) };

  const contentType = share.content_type ?? 'project';
  let ownerUserId: string | null = null;

  if (contentType === 'project' && share.project_id) {
    const { data } = await admin.from('projects').select('user_id').eq('id', share.project_id).maybeSingle();
    ownerUserId = data?.user_id ?? null;
  } else if (contentType === 'playlist' && share.playlist_id) {
    const { data } = await admin.from('playlists').select('user_id').eq('id', share.playlist_id).maybeSingle();
    ownerUserId = data?.user_id ?? null;
  } else if (contentType === 'track' && share.track_id) {
    const { data } = await admin.from('tracks').select('user_id').eq('id', share.track_id).maybeSingle();
    ownerUserId = data?.user_id ?? null;
  }

  if (ownerUserId && ownerUserId !== user.id) {
    return { ok: false as const, res: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }
  return { ok: true as const, userId: user.id, admin, share };
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ shareId: string }> }) {
  const { shareId } = await params;
  try {
    const gate = await requireShareOwner(shareId);
    if (!gate.ok) return gate.res;
    const { error } = await gate.admin.from('project_shares').delete().eq('id', shareId);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ shareId: string }> }) {
  const { shareId } = await params;
  const parsed = await readBody(req, ProjectSharePatchBodySchema);
  if (!parsed.ok) return parsed.res;
  const body = parsed.data;

  const patch: Record<string, unknown> = {};
  if (typeof body.allow_downloads === 'boolean') patch.allow_downloads = body.allow_downloads;
  if (body.role) patch.role = body.role;
  if (typeof body.label === 'string') patch.label = body.label.trim() || null;
  if (typeof body.invited_email === 'string') patch.invited_email = body.invited_email.trim() || null;
  if (body.revoke === true) patch.revoked_at = new Date().toISOString();

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'No editable fields in body' }, { status: 400 });
  }

  try {
    const gate = await requireShareOwner(shareId);
    if (!gate.ok) return gate.res;
    const { data, error } = await gate.admin
      .from('project_shares')
      .update(patch)
      .eq('id', shareId)
      .select('id, token, role, allow_downloads, expires_at, invited_email, label, plays, revoked_at, created_at')
      .single();
    if (error) throw error;
    return NextResponse.json({ share: data });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
