/**
 * GET /api/org/[orgId]/creative — the artistic direction workspace (LABEL-68): one place across direction, references,
 * reviews, song stages and releases, for the member who holds `creative.read`.
 *
 * It owns no data and writes nothing. Every number is read from the source the earlier tasks built (direction and
 * references: LABEL-26; reviews and the A&R stages: LABEL-24 / 25; releases and their approvals: LABEL-30 / 32) through
 * the SAME scope and D4 rules those screens apply (`lib/labelos/creative-workspace-store`): a member limited to some
 * artists sees only them, working material D4 hides is counted for a viewer allowed to see such counts and never named,
 * and an internal reference never reaches a member whose role is `artist`.
 *
 * `creative.read` belongs to the artistic department: an org without it (not licensed, or switched off by the owner) answers
 * 404 here through `requireOrgCapability`, exactly like the capability it asks for. Built field by field: no org id, no
 * user id, no review text.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireOrgCapability } from '@/lib/auth/org-access';
import { isSupabaseConfigured } from '@/lib/db';
import { errorMessage } from '@/lib/errors';
import { loadCreativeWorkspace } from '@/lib/labelos/creative-workspace-store';
import { createLogger } from '@/lib/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.creative');

type Params = { params: Promise<{ orgId: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { orgId } = await params;
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'The creative workspace needs Supabase.' }, { status: 501 });
  const access = await requireOrgCapability(orgId, 'creative.read');
  if (!access.ok) return access.res;
  try {
    return NextResponse.json(await loadCreativeWorkspace(access), { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    log.error('creative workspace load failed', { orgId, error: errorMessage(err) });
    return NextResponse.json({ error: 'Could not load the creative workspace' }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
}
