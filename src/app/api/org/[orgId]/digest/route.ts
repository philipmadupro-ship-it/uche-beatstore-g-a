/**
 * The weekly owner digest, the caller's own switch (LABEL-38).
 *
 *  GET  `{ enabled, canManage, channelConfigured?, needsReset? }` — `channelConfigured` (a
 *       boolean, never the URL) only for a caller who may manage the org.
 *  PUT  `{ enabled }` — turn the caller's OWN digest on or off. The row it
 *       writes is (this org, the session's user); there is no way to name
 *       another member.
 *
 * `catalog.read` is enough: the digest holds only what that member can already
 * open (Needs attention and the week's activity, built through their scope by
 * the cron). `digest.subscribed|unsubscribed` is an everyday event, recorded
 * after the change and only when the switch actually moved. An external
 * project member is not a member of the org and is refused by the helper.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireOrgCapability } from '@/lib/auth/org-access';
import { DigestPreferenceBodySchema } from '@/lib/contracts';
import { isSupabaseConfigured } from '@/lib/db';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { recordEvent } from '@/lib/labelos/activity';
import { DigestSchemaMissing, channelStatus, readPreference, writePreference } from '@/lib/labelos/weekly-digest-store';
import { rateLimitDurable } from '@/lib/security/rate-limit';
import { readBody } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.digest');
type Params = { params: Promise<{ orgId: string }> };

const NO_STORE = { 'Cache-Control': 'private, no-store' };
const json = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: NO_STORE });
const NOT_READY = { error: 'The weekly digest is not available yet.', schemaReady: false };

export async function GET(_req: NextRequest, { params }: Params) {
  const { orgId } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'The weekly digest needs Supabase.' });
  const access = await requireOrgCapability(orgId, 'catalog.read');
  if (!access.ok) return access.res;
  const canManage = access.capabilities.has('org.manage');
  try {
    const enabled = await readPreference(access.admin, access.orgId, access.userId);
    const channel = canManage ? await channelStatus(access.admin, access.orgId) : undefined;
    return json(200, { schemaReady: true, enabled, canManage, ...(channel === undefined ? {} : { channelConfigured: channel.configured, needsReset: channel.needsReset }) });
  } catch (err) {
    if (err instanceof DigestSchemaMissing) return json(200, { schemaReady: false, enabled: false, canManage });
    log.error('digest read failed', { orgId, error: errorMessage(err) });
    return json(500, { error: 'Could not read the digest setting' });
  }
}

export async function PUT(req: NextRequest, { params }: Params) {
  const { orgId } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'The weekly digest needs Supabase.' });
  const access = await requireOrgCapability(orgId, 'catalog.read');
  if (!access.ok) return access.res;
  if (!(await rateLimitDurable(`org-digest-pref:${access.orgId}:${access.userId}`, 30, 60 * 60 * 1000))) {
    return json(429, { error: 'Too many changes. Try again later.' });
  }
  const parsed = await readBody(req, DigestPreferenceBodySchema);
  if (!parsed.ok) return parsed.res;
  const { enabled } = parsed.data;
  try {
    const before = await writePreference(access.admin, access.orgId, access.userId, enabled);
    if (before !== enabled) {
      await recordEvent(access.admin, { orgId: access.orgId, userId: access.userId }, enabled ? 'digest.subscribed' : 'digest.unsubscribed', { type: 'member', id: access.userId }, {});
    }
    return json(200, { schemaReady: true, enabled });
  } catch (err) {
    if (err instanceof DigestSchemaMissing) return json(503, NOT_READY);
    log.error('digest write failed', { orgId, error: errorMessage(err) });
    return json(500, { error: 'Could not save the digest setting' });
  }
}
