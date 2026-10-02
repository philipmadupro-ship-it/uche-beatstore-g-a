/**
 * /api/org/[orgId]/contacts — the org's own people directory, whose artists
 * are its roster (LABEL-10, 17 R3; Q2: a label sees nothing of the
 * producer's CRM).
 *
 *  GET   capability `catalog.read`. The contacts the caller's artist scope
 *        allows (scopedOrgQuery: an artists-scoped member sees only their
 *        contacts, and none with zero). `?view=roster` keeps the roster.
 *  POST  capability `catalog.write`, and a member who sees the whole org:
 *        a scoped member could not see the contact they had just added.
 *        An artist org keeps exactly one artist, itself (D1). Email is
 *        normalised and unique per org (409).
 *
 * The org comes from the authorised context; the row is written with
 * `user_id` NULL, so it can never reach the producer's CRM.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireOrgCapability, scopedOrgQuery } from '@/lib/auth/org-access';
import { OrgContactCreateBodySchema } from '@/lib/contracts';
import { errorMessage } from '@/lib/errors';
import { recordEvent } from '@/lib/labelos/activity';
import {
  DUPLICATE_EMAIL,
  ORG_CONTACT_COLUMNS,
  isDuplicateEmail,
  orgContactRoles,
  toContactWrite,
  toOrgContactView,
  type OrgContactRow,
} from '@/lib/labelos/org-contacts';
import { artistOrgRosterError } from '@/lib/labelos/roster';
import { createLogger } from '@/lib/log';
import { readBody } from '@/lib/validate';

const log = createLogger('api.org.contacts');

export async function GET(req: NextRequest, { params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const access = await requireOrgCapability(orgId, 'catalog.read');
  if (!access.ok) return access.res;
  const rosterOnly = req.nextUrl.searchParams.get('view') === 'roster';
  try {
    const { data, error } = await scopedOrgQuery(access.admin, 'contacts', access, ORG_CONTACT_COLUMNS)
      .order('name', { ascending: true })
      .limit(2000);
    if (error) throw new Error(error.message);
    const contacts = ((data ?? []) as unknown as OrgContactRow[]).map(toOrgContactView);
    return NextResponse.json(
      { contacts: rosterOnly ? contacts.filter((c) => c.in_roster) : contacts },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    log.error('list org contacts failed', { orgId: access.orgId, error: errorMessage(err) });
    return NextResponse.json({ error: 'Could not list contacts' }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const access = await requireOrgCapability(orgId, 'catalog.write');
  if (!access.ok) return access.res;
  if (access.artistScope !== null) {
    return NextResponse.json(
      { error: 'Only members who see the whole organization can add people to its directory.' },
      { status: 403 },
    );
  }

  const parsed = await readBody(req, OrgContactCreateBodySchema);
  if (!parsed.ok) return parsed.res;
  const fields = toContactWrite(parsed.data);
  const { admin } = access;

  try {
    if (access.orgKind === 'artist') {
      // The whole org, not the caller's scoped view (orgContactRoles).
      const existing = await orgContactRoles(admin, access);
      const refused = artistOrgRosterError(access.orgKind, existing, fields);
      if (refused) return NextResponse.json({ error: refused }, { status: 409 });
    }

    const { data: inserted, error: insertErr } = await admin
      .from('contacts')
      .insert({ ...fields, org_id: access.orgId, user_id: null })
      .select(ORG_CONTACT_COLUMNS)
      .single();
    if (isDuplicateEmail(insertErr)) return NextResponse.json({ error: DUPLICATE_EMAIL }, { status: 409 });
    if (insertErr || !inserted) throw new Error(insertErr?.message ?? 'insert returned nothing');
    const contact = toOrgContactView(inserted as unknown as OrgContactRow);

    // Everyday event: best effort, never fails the request (lib/labelos/activity).
    await recordEvent(
      admin,
      { orgId: access.orgId, userId: access.userId },
      'contact.created',
      { type: 'contact', id: contact.id, artistId: contact.in_roster ? contact.id : null },
      { name: contact.name, in_roster: contact.in_roster },
    );
    return NextResponse.json({ contact }, { status: 201 });
  } catch (err) {
    log.error('create org contact failed', { orgId: access.orgId, error: errorMessage(err) });
    return NextResponse.json({ error: 'Could not add the contact' }, { status: 500 });
  }
}
