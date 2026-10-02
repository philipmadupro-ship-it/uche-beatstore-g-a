/**
 * PATCH /api/org/[orgId] { name } — rename the organization (LABEL-09,
 * carried from LABEL-07). Capability `org.manage`. The producer's personal
 * org is named once, when it is created, and the switcher shows that name,
 * so an owner needs to be able to change it. The name only: the slug, and
 * with it every /o/<slug> link already sent, stays.
 *
 * `org.settings_changed` is recorded as an audit event; if it cannot be
 * written the old name is put back and the request fails.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireOrgCapability } from '@/lib/auth/org-access';
import { OrgPatchBodySchema } from '@/lib/contracts';
import { errorMessage } from '@/lib/errors';
import { recordEvent } from '@/lib/labelos/activity';
import { createLogger } from '@/lib/log';
import { readBody } from '@/lib/validate';

const log = createLogger('api.org.patch');

type OrgRow = { id: string; name: string; slug: string; kind: string };

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const access = await requireOrgCapability(orgId, 'org.manage');
  if (!access.ok) return access.res;

  const parsed = await readBody(req, OrgPatchBodySchema);
  if (!parsed.ok) return parsed.res;
  const name = parsed.data.name.replace(/\s+/g, ' ');
  const { admin } = access;

  try {
    // `organizations` is keyed by `id`: the org the helper just authorised.
    const { data: before, error: readErr } = await admin
      .from('organizations')
      .select('id, name, slug, kind')
      .eq('id', access.orgId)
      .is('deleted_at', null)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);
    const current = before as OrgRow | null;
    if (!current) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (current.name === name) return NextResponse.json({ org: current });

    const { data: updated, error: updateErr } = await admin
      .from('organizations')
      .update({ name })
      .eq('id', access.orgId)
      .is('deleted_at', null)
      .select('id, name, slug, kind');
    if (updateErr) throw new Error(updateErr.message);
    const org = (Array.isArray(updated) ? updated[0] : null) as OrgRow | null;
    if (!org) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    try {
      await recordEvent(
        admin,
        { orgId: access.orgId, userId: access.userId },
        'org.settings_changed',
        { type: 'org', id: access.orgId },
        { name: { from: current.name, to: name } },
        { audit: true },
      );
    } catch (err) {
      await admin.from('organizations').update({ name: current.name }).eq('id', access.orgId).eq('name', name);
      throw err;
    }
    return NextResponse.json({ org });
  } catch (err) {
    log.error('rename org failed', { orgId: access.orgId, error: errorMessage(err) });
    return NextResponse.json({ error: 'Could not rename the organization' }, { status: 500 });
  }
}
