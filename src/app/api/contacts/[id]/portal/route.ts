import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { requireRowOwnership } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/db';
import { readBody } from '@/lib/validate';
import { ArtistPortalActionBodySchema } from '@/lib/contracts';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { ensurePortal, newPortalToken, portalUrl } from '@/lib/artists/portal-send';
import { isSchemaNotReady, schemaNotReadyResponse } from '@/lib/artists/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.contacts.portal');

/**
 * POST /api/contacts/[id]/portal  { action: 'create' | 'revoke' | 'reissue' | 'settings', password?, auto_digest?, require_sign_in? }
 *
 *   create  — the contact's one portal (idempotent: returns the existing one).
 *   revoke  — the link stops working (410) until reissued.
 *   reissue — a NEW token on the same row, un-revoked. The old link dies
 *             (404); history stays attached to the contact. This is the
 *             answer to a forwarded link.
 *   settings — `auto_digest`: the daily cron sends the Notify digest when
 *             something is new (off by default, mig 129). `require_sign_in`:
 *             the artist confirms their email before the portal opens (mig
 *             131; needs an email on the contact).
 * `password` (optional, create/reissue) sets or, with null, clears the lock.
 * The token is returned to the producer only; it is a bearer credential.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'The artist workspace needs Supabase.' }, { status: 501 });
  const auth = await requireRowOwnership('contacts', id);
  if (!auth.ok) return auth.res;
  const { admin, userId } = auth;

  const parsed = await readBody(req, ArtistPortalActionBodySchema);
  if (!parsed.ok) return parsed.res;
  const { action, password, auto_digest, require_sign_in } = parsed.data;

  try {
    const { portal } = await ensurePortal(admin, userId, id);
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (action === 'revoke') patch.revoked_at = new Date().toISOString();
    if (action === 'reissue') {
      patch.token = newPortalToken();
      patch.revoked_at = null;
      patch.last_viewed_at = null;
      patch.previous_viewed_at = null;
    }
    if (action === 'settings' && auto_digest !== undefined) patch.auto_digest = auto_digest;
    if (action === 'settings' && require_sign_in !== undefined) {
      if (require_sign_in) {
        // Sign-in emails the contact's own address; without one nobody could get in.
        const { data: c } = await admin.from('contacts').select('email').eq('id', id).eq('user_id', userId).maybeSingle();
        if (!(c as { email?: string | null } | null)?.email?.trim()) {
          return NextResponse.json({ error: 'Add an email address to this contact before requiring sign-in.' }, { status: 400 });
        }
      }
      patch.require_sign_in = require_sign_in;
    }
    if (password !== undefined && action !== 'revoke') {
      patch.password_hash = password ? await bcrypt.hash(password, 10) : null;
    }

    const { data, error } = await admin
      .from('artist_portals')
      .update(patch)
      .eq('id', portal.id)
      .eq('user_id', userId)
      .select('*')
      .single();
    if (error) throw error;

    if (action === 'revoke' || action === 'reissue') {
      await admin.from('contact_activity').insert({
        contact_id: id,
        user_id: userId,
        kind: 'note',
        title: action === 'revoke' ? 'Revoked the portal link' : 'Reissued the portal link — the old link no longer works',
        metadata: { portal_action: action },
      });
    }

    const row = data as Record<string, unknown> & { token: string; password_hash: string | null };
    const portalOut = {
      id: row.id, token: row.token, revoked_at: row.revoked_at, last_viewed_at: row.last_viewed_at, view_count: row.view_count,
      created_at: row.created_at, auto_digest: !!row.auto_digest, require_sign_in: !!row.require_sign_in,
    };
    return NextResponse.json({ portal: { ...portalOut, hasPassword: !!row.password_hash, url: portalUrl(row.token) } });
  } catch (err) {
    if (isSchemaNotReady(err)) return schemaNotReadyResponse();
    log.error('portal action failed', { id, action, error: errorMessage(err) });
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
