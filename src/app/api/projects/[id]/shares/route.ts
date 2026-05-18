import { NextRequest, NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import bcrypt from 'bcryptjs';
import { isSupabaseConfigured, insert, query, requireRowOwnership } from '@/lib/db';
import { readBody } from '@/lib/validate';
import { ProjectShareCreateBodySchema, SHARE_ROLES } from '@/lib/contracts';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';

const log = createLogger('api.projects.shares');

export const runtime = 'nodejs';

// Role tuple now lives in @/lib/contracts (SHARE_ROLES) so the client
// can import the same list. Kept as a local alias for readability.
const ROLES = SHARE_ROLES;

/**
 * Project-share owner CRUD.
 *
 *  GET   /api/projects/[id]/shares  → list owner's shares for this project
 *  POST  /api/projects/[id]/shares  → create a new share token
 *
 * Both require ownership of the parent project via requireRowOwnership.
 * The password_hash is never returned to the client; everything else
 * round-trips so the share modal can render expiry / role / play counts.
 */

interface ShareRow {
  id: string;
  project_id: string;
  token: string;
  role: 'viewer' | 'commenter' | 'editor';
  allow_downloads: boolean;
  expires_at: string | null;
  invited_email: string | null;
  label: string | null;
  plays: number;
  created_at: string;
  revoked_at: string | null;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    if (isSupabaseConfigured()) {
      const owner = await requireRowOwnership('projects', id);
      if (!owner.ok) return owner.res;
      const { data, error } = await owner.admin
        .from('project_shares')
        .select('id, project_id, token, role, allow_downloads, expires_at, invited_email, label, plays, created_at, revoked_at, recipient_kind, sales_enabled')
        .eq('project_id', id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return NextResponse.json({ shares: data ?? [] });
    }

    const shares = (query('project_shares', (s) => (s as any).project_id === id) as any[])
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    return NextResponse.json({ shares });
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
  // Default off — a share is closed-form unless the producer
  // explicitly flips the For-sale toggle.
  const salesEnabled = body.sales_enabled === true;

  const token = nanoid(12);
  const password_hash = password ? await bcrypt.hash(password, 10) : null;
  const expires_at = expiresDays && expiresDays > 0
    ? new Date(Date.now() + expiresDays * 86400000).toISOString()
    : null;

  const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const url = `${APP_URL}/projects/share/${token}`;

  try {
    if (isSupabaseConfigured()) {
      const owner = await requireRowOwnership('projects', id);
      if (!owner.ok) return owner.res;

      const { data, error } = await owner.admin
        .from('project_shares')
        .insert({
          project_id: id,
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
        })
        .select('id, project_id, token, role, allow_downloads, expires_at, invited_email, label, plays, created_at, recipient_kind, sales_enabled')
        .single();
      if (error) throw error;
      return NextResponse.json({ share: data, url });
    }

    const share = insert('project_shares', {
      project_id: id,
      token,
      role,
      allow_downloads: allowDownloads,
      password_hash,
      expires_at,
      invited_email: invitedEmail,
      label,
      plays: 0,
      created_by: null,
      recipient_kind: recipientKind,
      sales_enabled: salesEnabled,
    });
    return NextResponse.json({ share, url });
  } catch (error) {
    log.error('create failed', { projectId: id, error: errorMessage(error) });
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
