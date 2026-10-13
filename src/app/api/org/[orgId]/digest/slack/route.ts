/**
 * The org's Slack channel for the weekly digest (LABEL-38). Capability
 * `org.manage` (owner / admin).
 *
 *  PUT     `{ url }` — validate (https, `hooks.slack.com`, Slack's own path),
 *          encrypt, store. Answers `{ configured: true }`.
 *  DELETE  remove it. Answers `{ configured: false }`.
 *
 * The URL is a secret: it is never returned, never put in an event payload
 * and never logged. `digest.channel_set|removed` are AUDIT events — if the
 * event cannot be written the change is put back and the request fails.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireOrgCapability } from '@/lib/auth/org-access';
import { DigestSlackBodySchema } from '@/lib/contracts';
import { isSupabaseConfigured } from '@/lib/db';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { recordEvent } from '@/lib/labelos/activity';
import { validateSlackWebhookUrl } from '@/lib/labelos/slack-webhook';
import { SecretUnavailableError } from '@/lib/labelos/webhook-secret';
import { DigestSchemaMissing, clearChannel, restoreChannel, writeChannel } from '@/lib/labelos/weekly-digest-store';
import { rateLimitDurable } from '@/lib/security/rate-limit';
import { readBody } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.digest.slack');
type Params = { params: Promise<{ orgId: string }> };

const NO_STORE = { 'Cache-Control': 'private, no-store' };
const json = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: NO_STORE });

export async function PUT(req: NextRequest, { params }: Params) {
  const { orgId } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'The weekly digest needs Supabase.' });
  const access = await requireOrgCapability(orgId, 'org.manage');
  if (!access.ok) return access.res;
  if (!(await rateLimitDurable(`org-digest-slack:${access.orgId}:${access.userId}`, 20, 60 * 60 * 1000))) {
    return json(429, { error: 'Too many changes. Try again later.' });
  }
  const parsed = await readBody(req, DigestSlackBodySchema);
  if (!parsed.ok) return parsed.res;
  const checked = validateSlackWebhookUrl(parsed.data.url);
  if (!checked.ok) return json(400, { error: checked.reason });

  let backup: Awaited<ReturnType<typeof writeChannel>>;
  try {
    backup = await writeChannel(access.admin, access.orgId, access.userId, checked.url);
  } catch (err) {
    if (err instanceof SecretUnavailableError) return json(503, { error: 'The server has no secret configured to store a webhook.' });
    if (err instanceof DigestSchemaMissing) return json(503, { error: 'The weekly digest is not available yet.', schemaReady: false });
    log.error('digest channel write failed', { orgId, error: errorMessage(err) });
    return json(500, { error: 'Could not save the Slack webhook' });
  }
  try {
    await recordEvent(access.admin, { orgId: access.orgId, userId: access.userId }, 'digest.channel_set', { type: 'org', id: access.orgId }, { replaced: !!backup?.cipher }, { audit: true });
  } catch (err) {
    await restoreChannel(access.admin, access.orgId, backup).catch(() => undefined);
    log.error('digest channel audit failed', { orgId, error: errorMessage(err) });
    return json(500, { error: 'Could not save the Slack webhook' });
  }
  return json(200, { configured: true });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { orgId } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'The weekly digest needs Supabase.' });
  const access = await requireOrgCapability(orgId, 'org.manage');
  if (!access.ok) return access.res;
  let backup: Awaited<ReturnType<typeof clearChannel>>;
  try {
    backup = await clearChannel(access.admin, access.orgId);
  } catch (err) {
    if (err instanceof DigestSchemaMissing) return json(200, { configured: false });
    log.error('digest channel clear failed', { orgId, error: errorMessage(err) });
    return json(500, { error: 'Could not remove the Slack webhook' });
  }
  // Nothing was stored: idempotent, and no event for a no-op.
  if (!backup?.cipher) return json(200, { configured: false });
  try {
    await recordEvent(access.admin, { orgId: access.orgId, userId: access.userId }, 'digest.channel_removed', { type: 'org', id: access.orgId }, {}, { audit: true });
  } catch (err) {
    await restoreChannel(access.admin, access.orgId, backup).catch(() => undefined);
    log.error('digest channel audit failed', { orgId, error: errorMessage(err) });
    return json(500, { error: 'Could not remove the Slack webhook' });
  }
  return json(200, { configured: false });
}
