/**
 * GET /api/org/[orgId]/artists/[contactId]/references/choices (LABEL-26) —
 * what the reference pickers offer. `catalog.write` on the artist.
 *
 *   ?kind=track&q=<title>   org tracks the member may read (D4, artist scope)
 *   ?kind=file              visual files on the ARTIST's projects the member may open
 *
 * Only what the member could open anyway; names a title or a label, nothing else.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireObjectAccess } from '@/lib/auth/org-access';
import { isSupabaseConfigured } from '@/lib/db';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { fileChoices, trackChoices } from '@/lib/labelos/direction-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.artists.references.choices');

type Params = { params: Promise<{ orgId: string; contactId: string }> };

const NO_STORE = { 'Cache-Control': 'no-store' };
const json = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: NO_STORE });

export async function GET(req: NextRequest, { params }: Params) {
  const { orgId, contactId } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'Creative direction needs Supabase.' });
  const access = await requireObjectAccess({ table: 'contacts', id: contactId, cap: 'catalog.write', orgId });
  if (!access.ok) return access.res;
  const q = new URL(req.url).searchParams;
  const kind = q.get('kind');
  try {
    if (kind === 'track') return json(200, { tracks: await trackChoices(access.admin, access, q.get('q') ?? '') });
    if (kind === 'file') return json(200, { files: await fileChoices(access.admin, access, contactId) });
    return json(400, { error: 'Ask for kind=track or kind=file' });
  } catch (err) {
    log.error('choices failed', { orgId: access.orgId, kind, error: errorMessage(err) });
    return json(500, { error: 'Could not load the choices' });
  }
}
