import { NextRequest, NextResponse } from 'next/server';
import { getAppUrl } from '@/lib/env';
import { newShareToken } from '@/lib/share/token-access';
import bcrypt from 'bcryptjs';
import { isSupabaseConfigured, requireRowOwnership } from '@/lib/db';
import { readBody } from '@/lib/validate';
import { ProjectShareCreateBodySchema } from '@/lib/contracts';
import { errorMessage } from '@/lib/errors';
import { ownerShareRow, writeWithPlayback } from '@/lib/share/playback';
import { createLogger } from '@/lib/log';

const log = createLogger('api.playlists.shares');

export const runtime = 'nodejs';

/**
 * GET  /api/playlists/[id]/shares  → list playlist shares (owner only)
 * POST /api/playlists/[id]/shares  → create a share token for this playlist
 *
 * Creates a row in project_shares with content_type='playlist'.
 * The share resolves to /projects/share/{token} which renders the full
 * variant-driven experience (ClientVariant, ProducerVariant, etc).
 */

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    if (!isSupabaseConfigured()) {
      return NextResponse.json({ shares: [] });
    }
    const owner = await requireRowOwnership('playlists', id);
    if (!owner.ok) return owner.res;
    const { data, error } = await owner.admin
      .from('project_shares')
      .select('*')
      .eq('playlist_id', id)
      .eq('content_type', 'playlist')
      .order('created_at', { ascending: false });
    if (error) throw error;
    // Owner listing: `*` keeps working before mig 121; the hash never leaves.
    return NextResponse.json({ shares: (data ?? []).map((row) => ownerShareRow(row as Record<string, unknown>)) });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await readBody(req, ProjectShareCreateBodySchema);
  if (!parsed.ok) return parsed.res;
  const body = parsed.data;

  const role = body.role ?? 'viewer';
  const allowDownloads = body.allow_downloads !== false;
  const expiresDays = body.expires_days ?? null;
  const password = body.password ?? null;
  const invitedEmail = body.invited_email?.trim() || null;
  const label = body.label?.trim() || null;
  const recipientKind = body.recipient_kind || 'client';
  const salesEnabled = body.sales_enabled === true;
  // Full track unless the producer explicitly chose the 75 s preview (mig 121).
  const fullPlayback = body.full_playback === false ? false : undefined;

  const token = newShareToken();
  const password_hash = password ? await bcrypt.hash(password, 10) : null;
  const expires_at = expiresDays && expiresDays > 0
    ? new Date(Date.now() + expiresDays * 86400000).toISOString()
    : null;

  const APP_URL = getAppUrl();
  const url = `${APP_URL}/projects/share/${token}`;

  try {
    if (!isSupabaseConfigured()) {
      return NextResponse.json({ error: 'Playlist shares require Supabase' }, { status: 501 });
    }
    const owner = await requireRowOwnership('playlists', id);
    if (!owner.ok) return owner.res;

    const { data, error } = await writeWithPlayback(fullPlayback, (fields) =>
      owner.admin
        .from('project_shares')
        .insert({
          content_type: 'playlist',
          playlist_id: id,
          project_id: null,
          token,
          role,
          allow_downloads: allowDownloads,
          password_hash,
          expires_at,
          invited_email: invitedEmail,
          label,
          created_by: owner.userId,
          recipient_kind: recipientKind,
          sales_enabled: salesEnabled,
          ...fields,
        })
        .select('id, playlist_id, token, role, allow_downloads, expires_at, invited_email, label, plays, created_at, recipient_kind, sales_enabled, content_type')
        .single(),
    );
    if (error?.code === 'PLAYBACK_MIGRATION') {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (error) throw error;
    return NextResponse.json({ share: { ...data, full_playback: fullPlayback !== false }, url });
  } catch (error) {
    log.error('create failed', { playlistId: id, error: errorMessage(error) });
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
