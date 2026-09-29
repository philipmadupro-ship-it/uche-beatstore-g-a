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
 * POST /api/contacts/[id]/portal  { action: 'create' | 'revoke' | 'reissue', password? }
 *
 *   create  — the contact's one portal (idempotent: returns the existing one).
 *   revoke  — the link stops working (410) until reissued.
 *   reissue — a NEW token on the same row, un-revoked. The old link dies
 *             (404); history stays attached to the contact. This is the
 *             answer to a forwarded link.
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
  const { action, password } = parsed.data;

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
    if (password !== undefined && action !== 'revoke') {
      patch.password_hash = password ? await bcrypt.hash(password, 10) : null;
    }

    const { data, error } = await admin
      .from('artist_portals')
      .update(patch)
      .eq('id', portal.id)
      .eq('user_id', userId)
      .select('id, token, revoked_at, password_hash, last_viewed_at, view_count, created_at')
      .single();
    if (error) throw error;

    if (action !== 'create') {
      await admin.from('contact_activity').insert({
        contact_id: id,
        user_id: userId,
        kind: 'note',
        title: action === 'revoke' ? 'Revoked the portal link' : 'Reissued the portal link — the old link no longer works',
        metadata: { portal_action: action },
      });
    }

    const { password_hash, ...safe } = data as Record<string, unknown> & { token: string; password_hash: string | null };
    return NextResponse.json({ portal: { ...safe, hasPassword: !!password_hash, url: portalUrl(safe.token) } });
  } catch (err) {
    if (isSchemaNotReady(err)) return schemaNotReadyResponse();
    log.error('portal action failed', { id, action, error: errorMessage(err) });
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
