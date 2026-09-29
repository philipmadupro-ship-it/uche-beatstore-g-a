import { NextRequest, NextResponse } from 'next/server';
import {
  isSupabaseConfigured,
  deleteRow,
  update,
  createServiceClient,
} from '@/lib/db';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { readBody } from '@/lib/validate';
import { writeWithPlayback } from '@/lib/share/playback';
import { ProjectSharePatchBodySchema } from '@/lib/contracts';
import { errorMessage } from '@/lib/errors';

export const runtime = 'nodejs';

/**
 * Project share single-row routes — owner only.
 *
 *   DELETE  → hard delete the share row
 *   PATCH   → flip allow_downloads / role / label / mark revoked
 *
 * Ownership flows through the parent project. requireRowOwnership('projects',
 * ...) doesn't apply because the URL param is the share id, not the project
 * id — we resolve the share → project_id, then verify the caller owns it.
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
    .select('id, project_id')
    .eq('id', shareId)
    .maybeSingle();
  if (error) {
    return { ok: false as const, res: NextResponse.json({ error: error.message }, { status: 500 }) };
  }
  if (!share) {
    return { ok: false as const, res: NextResponse.json({ error: 'Share not found' }, { status: 404 }) };
  }
  const { data: project } = await admin
    .from('projects')
    .select('user_id')
    .eq('id', share.project_id)
    .maybeSingle();
  if (project?.user_id && project.user_id !== user.id) {
    return { ok: false as const, res: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }
  return { ok: true as const, userId: user.id, admin, share };
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; shareId: string }> }) {
  const { shareId } = await params;
  try {
    if (isSupabaseConfigured()) {
      const gate = await requireShareOwner(shareId);
      if (!gate.ok) return gate.res;
      const { error } = await gate.admin.from('project_shares').delete().eq('id', shareId);
      if (error) throw error;
      return NextResponse.json({ success: true });
    }
    deleteRow('project_shares', shareId);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; shareId: string }> }) {
  const { shareId } = await params;
  const parsed = await readBody(req, ProjectSharePatchBodySchema);
  if (!parsed.ok) return parsed.res;
  const body = parsed.data;

  // Whitelisted patch — token / created_by / plays are never client-controllable.
  const patch: Record<string, unknown> = {};
  if (typeof body.allow_downloads === 'boolean') patch.allow_downloads = body.allow_downloads;
  if (body.role) patch.role = body.role;
  if (typeof body.label === 'string') patch.label = body.label.trim() || null;
  if (typeof body.invited_email === 'string') patch.invited_email = body.invited_email.trim() || null;
  if (body.revoke === true) patch.revoked_at = new Date().toISOString();
  // Mig 121: full track (true) or the 75 s preview (false). Goes through
  // writeWithPlayback so an unapplied migration refuses "preview" loudly.
  const fullPlayback = typeof body.full_playback === 'boolean' ? body.full_playback : undefined;

  if (Object.keys(patch).length === 0 && fullPlayback === undefined) {
    return NextResponse.json({ error: 'No editable fields in body' }, { status: 400 });
  }

  try {
    if (isSupabaseConfigured()) {
      const gate = await requireShareOwner(shareId);
      if (!gate.ok) return gate.res;
      const { data, error } = await writeWithPlayback(fullPlayback, (fields) =>
        gate.admin
          .from('project_shares')
          .update({ ...patch, ...fields })
          .eq('id', shareId)
          .select('id, project_id, token, role, allow_downloads, expires_at, invited_email, label, plays, revoked_at, created_at')
          .single(),
      );
      if (error?.code === 'PLAYBACK_MIGRATION') {
        return NextResponse.json({ error: error.message }, { status: 409 });
      }
      if (error) throw error;
      return NextResponse.json({ share: { ...data, ...(fullPlayback === undefined ? {} : { full_playback: fullPlayback }) } });
    }
    const updated = update('project_shares', shareId, fullPlayback === undefined ? patch : { ...patch, full_playback: fullPlayback });
    return NextResponse.json({ share: updated });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
