/**
 * GET /api/org/[orgId]/search?q= — the org command palette's search
 * (LABEL-36, 08 §A3). `catalog.read`; results are grouped by entity (Artists,
 * Songs, Releases, People, Projects, Files) and carry only what the caller
 * may see: a member limited to some artists never finds another artist's
 * songs, files, projects or releases, and D4 hides a song row (and a file)
 * they could not open. A query that is only an identifier (ISRC, ISWC, UPC,
 * IPI) comes back as `jump` — straight to the recording's song, the release
 * or the party — when the caller may open it.
 *
 * There is NO total, no "N more", no "N hidden": the response holds the
 * hits and nothing about the ones left out. Read-only, so no event; an
 * external project member is refused (403/404 by `requireOrgCapability`),
 * which is the default for any org route not in lib/labelos/external-routes.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireOrgCapability } from '@/lib/auth/org-access';
import { isSupabaseConfigured } from '@/lib/db';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { MAX_QUERY_CHARS, EMPTY_SEARCH } from '@/lib/labelos/org-search';
import { SearchNotReadyError, searchOrg } from '@/lib/labelos/org-search-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.search');

type Params = { params: Promise<{ orgId: string }> };

const NO_STORE = { 'Cache-Control': 'no-store' };

export async function GET(req: NextRequest, { params }: Params) {
  const { orgId } = await params;
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'Search needs Supabase.' }, { status: 501, headers: NO_STORE });
  const access = await requireOrgCapability(orgId, 'catalog.read');
  if (!access.ok) return access.res;
  // A query past the cap is read up to it; nothing else is accepted from the URL.
  const q = (req.nextUrl.searchParams.get('q') ?? '').slice(0, MAX_QUERY_CHARS * 2);
  try {
    return NextResponse.json({ schemaReady: true, ...(await searchOrg(access, q)) }, { headers: NO_STORE });
  } catch (err) {
    if (err instanceof SearchNotReadyError) {
      return NextResponse.json({ schemaReady: false, ...EMPTY_SEARCH }, { headers: NO_STORE });
    }
    log.error('org search failed', { orgId: access.orgId, error: errorMessage(err) });
    return NextResponse.json({ error: 'Search failed' }, { status: 500, headers: NO_STORE });
  }
}
