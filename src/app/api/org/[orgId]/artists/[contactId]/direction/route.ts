/**
 * /api/org/[orgId]/artists/[contactId]/direction (LABEL-26) — one roster
 * artist's creative direction and reference list.
 *
 *   GET  `catalog.read` on the artist (scope applies: out of scope = 404).
 *        { direction, updatedAt, references, restrictedReferences, permissions }.
 *        INTERNAL references are left out for a member whose role is `artist`
 *        — not hidden by the client, absent from the payload — and are not
 *        counted either: their existence is not the artist's to know.
 *   PUT  { direction }  `catalog.write`. The whole structured document; an
 *        empty string clears a field. A save that changes nothing writes and
 *        records nothing.
 *
 * Built field by field (lib/labelos/direction): no org id, no author id.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireObjectAccess } from '@/lib/auth/org-access';
import { isSupabaseConfigured } from '@/lib/db';
import { isMissingSchema } from '@/lib/artists/workspace-load';
import { readBody } from '@/lib/validate';
import { OrgDirectionPutBodySchema } from '@/lib/contracts';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { recordEvent } from '@/lib/labelos/activity';
import { canReadInternalReference, changedDirectionFields, normalizeDirection, partitionReferences, sameDirection } from '@/lib/labelos/direction';
import { listReferenceRows, readDirection, resolvePointers, writeDirection } from '@/lib/labelos/direction-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.artists.direction');

type Params = { params: Promise<{ orgId: string; contactId: string }> };

const NO_STORE = { 'Cache-Control': 'no-store' };
const json = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: NO_STORE });

export async function GET(_req: NextRequest, { params }: Params) {
  const { orgId, contactId } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'Creative direction needs Supabase.' });
  const access = await requireObjectAccess({ table: 'contacts', id: contactId, cap: 'catalog.read', orgId });
  if (!access.ok) return access.res;
  try {
    const [doc, rows] = await Promise.all([
      readDirection(access.admin, access.orgId, contactId),
      listReferenceRows(access.admin, access.orgId, contactId),
    ]);
    const { visible, restricted } = partitionReferences(rows, access.role, await resolvePointers(access.admin, access, rows));
    return json(200, {
      schemaReady: true,
      direction: doc.direction,
      updatedAt: doc.updatedAt,
      references: visible,
      restrictedReferences: restricted,
      permissions: { write: access.capabilities.has('catalog.write'), internal: canReadInternalReference(access.role) },
    });
  } catch (err) {
    if (isMissingSchema(err)) return json(200, { schemaReady: false, direction: {}, updatedAt: null, references: [], restrictedReferences: 0, permissions: { write: false, internal: false } });
    log.error('direction load failed', { orgId: access.orgId, error: errorMessage(err) });
    return json(500, { error: 'Could not load the direction' });
  }
}

export async function PUT(req: NextRequest, { params }: Params) {
  const { orgId, contactId } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'Creative direction needs Supabase.' });
  const access = await requireObjectAccess({ table: 'contacts', id: contactId, cap: 'catalog.write', orgId });
  if (!access.ok) return access.res;
  const parsed = await readBody(req, OrgDirectionPutBodySchema);
  if (!parsed.ok) return parsed.res;
  const next = normalizeDirection(parsed.data.direction);

  try {
    const before = await readDirection(access.admin, access.orgId, contactId);
    if (before.updatedAt !== null && sameDirection(before.direction, next)) {
      return json(200, { direction: before.direction, updatedAt: before.updatedAt });
    }
    const updatedAt = await writeDirection(access.admin, { orgId: access.orgId, contactId, userId: access.userId, direction: next });
    // Everyday event, best effort: the direction is saved either way. Names fields, never their words.
    await recordEvent(
      access.admin,
      { orgId: access.orgId, userId: access.userId },
      'direction.updated',
      { type: 'contact', id: contactId, artistId: contactId },
      { fields: changedDirectionFields(before.direction, next) },
    );
    return json(200, { direction: next, updatedAt });
  } catch (err) {
    if (isMissingSchema(err)) return json(503, { error: 'Creative direction needs migration 152.' });
    log.error('direction save failed', { orgId: access.orgId, error: errorMessage(err) });
    return json(500, { error: 'Could not save the direction' });
  }
}
