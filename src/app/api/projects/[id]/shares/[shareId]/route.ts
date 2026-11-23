import { NextRequest, NextResponse } from 'next/server';
import {
  isSupabaseConfigured,
  deleteRow,
  createServiceClient,
} from '@/lib/db';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { handleProjectSharePatch } from '@/lib/share/project-share-patch';
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
  return handleProjectSharePatch(req, shareId, async () => {
    if (!isSupabaseConfigured()) return { ok: true, admin: null };
    const gate = await requireShareOwner(shareId);
    return gate.ok ? { ok: true, admin: gate.admin } : { ok: false, res: gate.res };
  });
}
