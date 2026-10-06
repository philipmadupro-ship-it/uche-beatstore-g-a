/**
 * GET /api/org/[orgId]/tasks/assignees (LABEL-23): the members a task may be
 * handed to, for the assignee picker. `?kind=&id=` narrows it to those who
 * can reach that object (artist scope, D4 for a song), so the picker never
 * offers a member the server would refuse. Names only — no emails. Needs
 * `tasks.write`, the ability to hand work out at all.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireObjectAccess, requireOrgCapability } from '@/lib/auth/org-access';
import { isSupabaseConfigured } from '@/lib/db';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { parseTarget } from '@/lib/labelos/tasks';
import { TARGET_OBJECT_TABLE, assignableMembers } from '@/lib/labelos/tasks-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.tasks.assignees');

type Params = { params: Promise<{ orgId: string }> };

const NO_STORE = { 'Cache-Control': 'no-store' };
const json = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: NO_STORE });

export async function GET(req: NextRequest, { params }: Params) {
  const { orgId } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'Tasks need Supabase.' });
  const access = await requireOrgCapability(orgId, 'tasks.write');
  if (!access.ok) return access.res;
  const q = new URL(req.url).searchParams;
  const target = parseTarget({ kind: q.get('kind') ?? undefined, id: q.get('id') ?? undefined });
  if (target === undefined) return json(400, { error: 'Name an object with kind and id' });
  try {
    if (target) {
      const obj = await requireObjectAccess({ table: TARGET_OBJECT_TABLE[target.kind], id: target.id, cap: 'catalog.read', orgId: access.orgId });
      if (!obj.ok) return obj.res;
    }
    return json(200, { members: await assignableMembers(access.admin, access.orgId, target) });
  } catch (err) {
    log.error('assignee list failed', { orgId: access.orgId, error: errorMessage(err) });
    return json(500, { error: 'Could not load the members' });
  }
}
