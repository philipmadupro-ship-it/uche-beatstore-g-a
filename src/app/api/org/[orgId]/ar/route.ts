/**
 * GET /api/org/[orgId]/ar — the A&R inbox (LABEL-25, 07 §2.4): songs in
 * `inbox` / `in_review` the member may read, oldest first, with their own
 * review and the rating summary. `catalog.read`; a member limited to some
 * artists sees only those artists' songs, and working material D4 hides is
 * counted as `restricted`, never named. Stage moves and reviews go through
 * their own routes (`tracks/[id]/stage`, `tracks/[id]/reviews`).
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireOrgCapability } from '@/lib/auth/org-access';
import { isSupabaseConfigured } from '@/lib/db';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { loadArInbox } from '@/lib/labelos/ar-inbox-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.ar');

type Params = { params: Promise<{ orgId: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { orgId } = await params;
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'The inbox needs Supabase.' }, { status: 501 });
  const access = await requireOrgCapability(orgId, 'catalog.read');
  if (!access.ok) return access.res;
  try {
    return NextResponse.json(await loadArInbox(access), { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    log.error('inbox load failed', { orgId, error: errorMessage(err) });
    return NextResponse.json({ error: 'Could not load the inbox' }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
}
