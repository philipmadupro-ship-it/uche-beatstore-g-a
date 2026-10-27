/**
 * GET /api/org/[orgId]/connected-releases — "Releases from connected
 * artists" (LABEL-71): the music artist orgs connected to this label have put
 * on the label owner's store, with where each stands (on the store, taken off
 * by the owner, refused by a credited artist).
 *
 * The STORE OWNER only: the owner of a label org who is also the owner of the
 * store. Everyone else — an admin, a member, an artist, a stranger, an
 * external member — gets the same 404 as an org that has no such page. Reads
 * nothing the public store does not already show, plus the owner's own veto
 * and the fact that an artist refused (never which one). Built field by field
 * (`lib/labelos/connected-releases-store`). Migration 186 missing:
 * `schemaReady: false` (the list still reads; Unlist then answers 503).
 */
import { NextResponse } from 'next/server';
import { requireOrgMember } from '@/lib/auth/org-access';
import { isSupabaseConfigured } from '@/lib/db';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { isStoreOwner, loadConnectedReleases } from '@/lib/labelos/connected-releases-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.connected-releases');

const NO_STORE = { 'Cache-Control': 'no-store' };
const json = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: NO_STORE });

export async function GET(_req: Request, { params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'Releases need Supabase.' });
  const access = await requireOrgMember(orgId);
  if (!access.ok) return access.res;
  const { admin, orgId: org, userId } = access;
  if (access.orgKind !== 'label' || access.role !== 'owner') return json(404, { error: 'Not found' });
  try {
    if (!(await isStoreOwner(admin, userId))) return json(404, { error: 'Not found' });
    const { releases, schemaReady } = await loadConnectedReleases(admin, org, new Date());
    return json(200, { schemaReady, releases });
  } catch (err) {
    log.error('connected releases failed', { orgId: org, error: errorMessage(err) });
    return json(500, { error: 'Could not read the releases from connected artists' });
  }
}
