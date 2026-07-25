import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { isSupabaseConfigured } from '@/lib/local-store';
import { createServiceClient } from '@/lib/auth/ownership';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
const log = createLogger('api.projects.share.token.tracks');

export const runtime = 'nodejs';

interface ProjectShareEditorRow {
  project_id: string;
  revoked_at?: string | null;
  expires_at?: string | null;
  password_hash?: string | null;
  role?: string | null;
}

interface ProjectTrackPositionRow {
  track_id: string;
  position: number | null;
}

/**
 * PATCH /api/projects/share/[token]/tracks
 *   body: { track_ids: string[] }   — full ordered tracklist
 *   headers: x-share-password (if locked)
 *
 * Editor-role token writes the position of every track in the project to
 * match the order of `track_ids`. Tracks not in the array are left at
 * their current positions (we don't remove them — that's a destructive op
 * reserved for the owner).
 *
 * Conservative posture:
 *   - We refuse the request if `track_ids` contains an id that isn't
 *     already in the project. Editors can reorder, not add.
 *   - We bump `projects.updated_at` so the owner's project list reflects
 *     the activity.
 *   - We don't return the new tracklist — the client refetches the public
 *     reader to confirm.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const submittedPassword = req.headers.get('x-share-password') ?? '';

  try {
    if (!isSupabaseConfigured()) {
      return NextResponse.json({ error: 'Reorder requires Supabase' }, { status: 501 });
    }

    const body = await req.json().catch(() => ({})) as { track_ids?: unknown };
    const trackIds: unknown = body.track_ids;
    if (!Array.isArray(trackIds) || trackIds.length === 0 || !trackIds.every((t) => typeof t === 'string')) {
      return NextResponse.json({ error: 'track_ids: string[] required' }, { status: 400 });
    }
    const ordered = trackIds;

    const admin = createServiceClient();
    const { data: share, error: sErr } = await admin
      .from('project_shares')
      .select('*')
      .eq('token', token)
      .maybeSingle();
    if (sErr) throw sErr;
    if (!share) return NextResponse.json({ error: 'Link not found' }, { status: 404 });
    const editorShare = share as ProjectShareEditorRow;
    if (editorShare.revoked_at) return NextResponse.json({ error: 'Link revoked' }, { status: 410 });
    if (editorShare.expires_at && new Date(editorShare.expires_at).getTime() < Date.now()) {
      return NextResponse.json({ error: 'Link expired' }, { status: 410 });
    }
    if (editorShare.password_hash) {
      if (!submittedPassword) return NextResponse.json({ requiresPassword: true }, { status: 401 });
      const ok = await bcrypt.compare(submittedPassword, editorShare.password_hash);
      if (!ok) return NextResponse.json({ requiresPassword: true, error: 'Bad password' }, { status: 401 });
    }
    if (editorShare.role !== 'editor') {
      return NextResponse.json({ error: 'This link does not grant edit access.' }, { status: 403 });
    }

    // Pull the current junction set so we can validate the editor's
    // tracklist against it. Anything they propose that isn't already a
    // member gets the whole request rejected — partial application
    // would leave the project in an ambiguous state.
    const { data: junction, error: jErr } = await admin
      .from('project_tracks')
      .select('track_id, position')
      .eq('project_id', editorShare.project_id);
    if (jErr) throw jErr;

    const junctionRows = (junction ?? []) as ProjectTrackPositionRow[];
    const existing = new Set(junctionRows.map((j) => j.track_id));
    const unknown = ordered.find((t) => !existing.has(t));
    if (unknown) {
      return NextResponse.json(
        { error: `Track ${unknown} is not in this project. Editors can reorder but not add.` },
        { status: 400 },
      );
    }

    // Reassign positions 1..N in the new order. Tracks omitted from the
    // payload keep going on at positions starting after the explicit set,
    // preserving their relative order. This is rare in practice — the
    // client sends the full list — but the semantics matter if a client
    // ever sends a partial reorder.
    const omitted = junctionRows
      .filter((j) => !ordered.includes(j.track_id))
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      .map((j) => j.track_id);

    const finalOrder = [...ordered, ...omitted];

    // Sequential updates. project_tracks has a composite PK
    // (project_id, track_id) so we eq both for safety.
    for (let i = 0; i < finalOrder.length; i++) {
      const { error: uErr } = await admin
        .from('project_tracks')
        .update({ position: i + 1 })
        .eq('project_id', editorShare.project_id)
        .eq('track_id', finalOrder[i]);
      if (uErr) throw uErr;
    }

    await admin
      .from('projects')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', editorShare.project_id);

    return NextResponse.json({ success: true, count: finalOrder.length });
  } catch (error: unknown) {
    log.error('Editor reorder error:', { error: errorMessage(error) });
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
