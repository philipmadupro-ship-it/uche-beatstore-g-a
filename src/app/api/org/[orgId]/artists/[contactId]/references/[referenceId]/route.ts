/**
 * PATCH / DELETE /api/org/[orgId]/artists/[contactId]/references/[referenceId]
 * (LABEL-26). `catalog.write` on the artist.
 *
 *   PATCH { title?, note?, url?, visibility?, position? }  omitted keeps; `note: null` clears.
 *         The pointer (track / file) and the kind never change — remove and
 *         add instead. `url` applies to a link only.
 *   DELETE
 *
 * An internal reference is invisible to a member whose role is `artist`: for
 * them it is 404, whatever abilities they hold, exactly as if it did not
 * exist. Making a reference internal needs a team role.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireObjectAccess } from '@/lib/auth/org-access';
import { isSupabaseConfigured } from '@/lib/db';
import { isMissingSchema } from '@/lib/artists/workspace-load';
import { readBody, isUUID } from '@/lib/validate';
import { OrgReferencePatchBodySchema } from '@/lib/contracts';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { recordEvent } from '@/lib/labelos/activity';
import { canReadInternalReference, partitionReferences, referenceReadableBy, safeReferenceUrl } from '@/lib/labelos/direction';
import { deleteReference, readReferenceRow, resolvePointers, updateReference, type ReferenceColumns } from '@/lib/labelos/direction-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.artists.references.item');

type Params = { params: Promise<{ orgId: string; contactId: string; referenceId: string }> };

const NO_STORE = { 'Cache-Control': 'no-store' };
const json = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: NO_STORE });
const NOT_FOUND = () => json(404, { error: 'Not found' });

export async function PATCH(req: NextRequest, { params }: Params) {
  const { orgId, contactId, referenceId } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'Creative direction needs Supabase.' });
  const access = await requireObjectAccess({ table: 'contacts', id: contactId, cap: 'catalog.write', orgId });
  if (!access.ok) return access.res;
  if (!isUUID(referenceId)) return NOT_FOUND();
  const parsed = await readBody(req, OrgReferencePatchBodySchema);
  if (!parsed.ok) return parsed.res;
  const body = parsed.data;

  try {
    const found = await readReferenceRow(access.admin, access.orgId, contactId, referenceId.toLowerCase());
    if (!found || !referenceReadableBy(access.role, found.visibility)) return NOT_FOUND();
    if (body.visibility === 'internal' && !canReadInternalReference(access.role)) return json(403, { error: 'Forbidden' });

    const columns: ReferenceColumns = {};
    if (body.title !== undefined) columns.title = body.title;
    if (body.note !== undefined) {
      if (body.note === null && found.kind === 'note') return json(400, { error: 'A note reference needs its note' });
      columns.note = body.note;
    }
    if (body.url !== undefined) {
      const url = found.kind === 'link' ? safeReferenceUrl(body.url) : null;
      if (!url) return json(400, { error: found.kind === 'link' ? 'A link must be an https address' : 'Only a link has an address' });
      columns.url = url;
    }
    if (body.visibility !== undefined) columns.visibility = body.visibility;
    if (body.position !== undefined) columns.position = body.position;

    const row = await updateReference(access.admin, access.orgId, contactId, found.id, columns);
    if (!row) return NOT_FOUND();

    // The event is internal if the reference is or WAS internal: a flip to artist-visible must not
    // advertise itself to the people who could not read it before it happened, and vice versa.
    const internal = found.visibility !== 'artist' || row.visibility !== 'artist';
    await recordEvent(
      access.admin,
      { orgId: access.orgId, userId: access.userId },
      'reference.updated',
      { type: 'contact', id: contactId, artistId: contactId },
      { kind: row.kind, fields: Object.keys(columns) },
      { visibility: internal ? 'internal' : 'artist' },
    );

    const { visible } = partitionReferences([row], access.role, await resolvePointers(access.admin, access, [row]));
    return json(200, { reference: visible[0] ?? null });
  } catch (err) {
    if (isMissingSchema(err)) return json(503, { error: 'Creative direction needs migration 152.' });
    log.error('reference update failed', { orgId: access.orgId, error: errorMessage(err) });
    return json(500, { error: 'Could not update the reference' });
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { orgId, contactId, referenceId } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'Creative direction needs Supabase.' });
  const access = await requireObjectAccess({ table: 'contacts', id: contactId, cap: 'catalog.write', orgId });
  if (!access.ok) return access.res;
  if (!isUUID(referenceId)) return NOT_FOUND();

  try {
    const found = await readReferenceRow(access.admin, access.orgId, contactId, referenceId.toLowerCase());
    if (!found || !referenceReadableBy(access.role, found.visibility)) return NOT_FOUND();
    if (!(await deleteReference(access.admin, access.orgId, contactId, found.id))) return NOT_FOUND();
    await recordEvent(
      access.admin,
      { orgId: access.orgId, userId: access.userId },
      'reference.removed',
      { type: 'contact', id: contactId, artistId: contactId },
      { kind: found.kind },
      { visibility: found.visibility === 'artist' ? 'artist' : 'internal' },
    );
    return json(200, { ok: true });
  } catch (err) {
    if (isMissingSchema(err)) return json(503, { error: 'Creative direction needs migration 152.' });
    log.error('reference delete failed', { orgId: access.orgId, error: errorMessage(err) });
    return json(500, { error: 'Could not remove the reference' });
  }
}
