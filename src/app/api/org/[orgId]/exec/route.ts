/**
 * GET /api/org/[orgId]/exec[?format=csv] — the executive dashboard (LABEL-67).
 * `exec.read` in a LABEL org licensed for the executive module, never a roster artist: every other caller is 404,
 * the same predicate as the page (`pageAllowed('exec')`). Read only, no audio. What is in the answer follows the caller: songs and
 * releases inside their artist scope and D4, and money / top songs / task load only for a whole-organization
 * reader (money also needs `finance.read`); a withheld section is named in `withheld`.
 *
 * `format=csv` is the same numbers as a file, every text cell formula-guarded, and is AUDITED BEFORE any data
 * is returned (`exec.exported`, the LABEL-34 pattern): if the event cannot be written there is no export.
 * Rate-limited per member.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireOrgModule } from '@/lib/auth/org-access';
import { isSupabaseConfigured } from '@/lib/db';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { recordEvent } from '@/lib/labelos/activity';
import { execCsv, execFileName } from '@/lib/labelos/exec-dashboard';
import { pageAllowed } from '@/lib/labelos/role-view';
import { loadExecDashboard } from '@/lib/labelos/exec-dashboard-store';
import { rateLimitDurable } from '@/lib/security/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.exec');

type Params = { params: Promise<{ orgId: string }> };

const NO_STORE = { 'Cache-Control': 'private, no-store' };
const json = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: NO_STORE });

export async function GET(req: NextRequest, { params }: Params) {
  const { orgId } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'The executive dashboard needs Supabase.' });
  const access = await requireOrgModule(orgId, 'executive');
  if (!access.ok) return access.res;
  // The page's own rule (label org, not a roster artist, exec.read, module licensed) — one 404 for every refusal: an owner of an artist or producer org
  // holds exec.read too, and must not reach what the page 404s.
  if (!pageAllowed('exec', { kind: access.orgKind, role: access.role, capabilities: access.capabilities, modules: access.entitlements?.modules })) return json(404, { error: 'Not found' });

  const format = req.nextUrl.searchParams.get('format') ?? 'json';
  if (format !== 'json' && format !== 'csv') return json(400, { error: 'format must be json or csv', field: 'format' });
  if (format === 'csv' && !(await rateLimitDurable(`exec-export:${access.orgId}:${access.userId}`, 30, 60 * 60 * 1000))) {
    return json(429, { error: 'Too many exports. Try again later.' });
  }

  try {
    const now = new Date();
    const view = await loadExecDashboard(access, now);
    if (format === 'json') return json(200, view);

    // Audit class: throws if it cannot be written, and then nothing is returned.
    await recordEvent(access.admin, { orgId: access.orgId, userId: access.userId }, 'exec.exported', { type: 'org', id: access.orgId }, {
      format: 'csv',
      scoped: view.scoped,
      sections: ['pipeline', 'months', 'blocked', 'waiting', ...(view.tasks ? ['tasks'] : []), ...(view.money ? ['money', 'topSongs'] : [])],
    });
    const slug = (await access.admin.from('organizations').select('slug').eq('id', access.orgId).maybeSingle()).data as { slug?: string } | null;
    return new NextResponse(execCsv(view), {
      headers: {
        ...NO_STORE,
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${execFileName(slug?.slug ?? 'org', now)}"`,
      },
    });
  } catch (err) {
    log.error('executive dashboard failed', { orgId, error: errorMessage(err) });
    return json(500, { error: 'Could not load the executive dashboard' });
  }
}
