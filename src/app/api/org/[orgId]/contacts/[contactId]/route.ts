/**
 * /api/org/[orgId]/contacts/[contactId] — one person in the org's directory
 * (LABEL-10).
 *
 *  GET     capability `catalog.read`.
 *  PATCH   capability `catalog.write`. An artist org keeps exactly one
 *          artist (D1).
 *  DELETE  capability `catalog.write`, and a member who sees the whole org;
 *          an artist org's own artist cannot be deleted (D1).
 *
 * The row is resolved by requireObjectAccess, which reads its org from the
 * ROW: a producer contact (org_id IS NULL), another org's contact, or one
 * outside the caller's artist scope is 404 — the same answer as a contact
 * that does not exist. Writes are then addressed by (org, id).
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireObjectAccess, scopedOrgQuery, type ObjectAccessResult } from '@/lib/auth/org-access';
import { OrgContactPatchBodySchema } from '@/lib/contracts';
import { errorMessage } from '@/lib/errors';
import { recordEvent } from '@/lib/labelos/activity';
import {
  DUPLICATE_EMAIL,
  ORG_CONTACT_COLUMNS,
  isDuplicateEmail,
  toContactWrite,
  toOrgContactView,
  type OrgContactRow,
} from '@/lib/labelos/org-contacts';
import { artistOrgRemovalError, artistOrgRosterError } from '@/lib/labelos/roster';
import { createLogger } from '@/lib/log';
import { readBody } from '@/lib/validate';

const log = createLogger('api.org.contacts.id');

type Params = { params: Promise<{ orgId: string; contactId: string }> };
type Access = Extract<ObjectAccessResult, { ok: true }>;

async function readContact(access: Access): Promise<OrgContactRow | null> {
  const { data, error } = await scopedOrgQuery(access.admin, 'contacts', access, ORG_CONTACT_COLUMNS)
    .eq('id', access.object.id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as unknown as OrgContactRow | null;
}

const NOT_FOUND = () => NextResponse.json({ error: 'Not found' }, { status: 404 });

export async function GET(_req: NextRequest, { params }: Params) {
  const { orgId, contactId } = await params;
  const access = await requireObjectAccess({ table: 'contacts', id: contactId, cap: 'catalog.read', orgId });
  if (!access.ok) return access.res;
  try {
    const row = await readContact(access);
    if (!row) return NOT_FOUND();
    return NextResponse.json({ contact: toOrgContactView(row) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    log.error('read org contact failed', { orgId: access.orgId, error: errorMessage(err) });
    return NextResponse.json({ error: 'Could not load the contact' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { orgId, contactId } = await params;
  const access = await requireObjectAccess({ table: 'contacts', id: contactId, cap: 'catalog.write', orgId });
  if (!access.ok) return access.res;

  const parsed = await readBody(req, OrgContactPatchBodySchema);
  if (!parsed.ok) return parsed.res;
  const patch = toContactWrite(parsed.data);
  const { admin } = access;

  try {
    const before = await readContact(access);
    if (!before) return NOT_FOUND();

    if (access.orgKind === 'artist' && (patch.category !== undefined || patch.secondary_category !== undefined)) {
      const { data, error } = await scopedOrgQuery(admin, 'contacts', access, 'id, category, secondary_category');
      if (error) throw new Error(error.message);
      const existing = (data ?? []) as unknown as { id: string; category: string | null; secondary_category: string | null }[];
      const refused = artistOrgRosterError(access.orgKind, existing, {
        id: before.id,
        category: patch.category !== undefined ? patch.category : before.category,
        secondary_category: patch.secondary_category !== undefined ? patch.secondary_category : before.secondary_category,
      });
      if (refused) return NextResponse.json({ error: refused }, { status: 409 });
    }

    const { data: updated, error: updateErr } = await admin
      .from('contacts')
      .update(patch)
      .eq('org_id', access.orgId)
      .eq('id', before.id)
      .select(ORG_CONTACT_COLUMNS);
    if (isDuplicateEmail(updateErr)) return NextResponse.json({ error: DUPLICATE_EMAIL }, { status: 409 });
    if (updateErr) throw new Error(updateErr.message);
    const row = (Array.isArray(updated) ? updated[0] : null) as unknown as OrgContactRow | null;
    if (!row) return NOT_FOUND();
    const contact = toOrgContactView(row);

    await recordEvent(
      admin,
      { orgId: access.orgId, userId: access.userId },
      'contact.updated',
      { type: 'contact', id: contact.id, artistId: contact.in_roster ? contact.id : null },
      { fields: Object.keys(patch).sort() },
    );
    return NextResponse.json({ contact });
  } catch (err) {
    log.error('update org contact failed', { orgId: access.orgId, error: errorMessage(err) });
    return NextResponse.json({ error: 'Could not save the contact' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { orgId, contactId } = await params;
  const access = await requireObjectAccess({ table: 'contacts', id: contactId, cap: 'catalog.write', orgId });
  if (!access.ok) return access.res;
  if (access.artistScope !== null) {
    return NextResponse.json(
      { error: 'Only members who see the whole organization can remove people from its directory.' },
      { status: 403 },
    );
  }
  const { admin } = access;

  try {
    const before = await readContact(access);
    if (!before) return NOT_FOUND();
    const refused = artistOrgRemovalError(access.orgKind, before);
    if (refused) return NextResponse.json({ error: refused }, { status: 409 });

    const { data: removed, error: deleteErr } = await admin
      .from('contacts')
      .delete()
      .eq('org_id', access.orgId)
      .eq('id', before.id)
      .select('id');
    if (deleteErr) throw new Error(deleteErr.message);
    if (!Array.isArray(removed) || removed.length === 0) return NOT_FOUND();

    await recordEvent(
      admin,
      { orgId: access.orgId, userId: access.userId },
      'contact.deleted',
      { type: 'contact', id: before.id },
      { name: before.name },
    );
    return NextResponse.json({ removed: true });
  } catch (err) {
    log.error('delete org contact failed', { orgId: access.orgId, error: errorMessage(err) });
    return NextResponse.json({ error: 'Could not remove the contact' }, { status: 500 });
  }
}
