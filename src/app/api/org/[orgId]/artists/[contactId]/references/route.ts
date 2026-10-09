/**
 * POST /api/org/[orgId]/artists/[contactId]/references (LABEL-26) — add one
 * reference to the artist's direction. `catalog.write` on the artist.
 *
 *   { kind: 'track', track_id }          a track of the org the member may read
 *   { kind: 'link',  url, title }        https only
 *   { kind: 'file',  asset_id }          a visual file (artwork / photo / video /
 *                                        lyrics, not restricted) on an org project,
 *                                        uploaded through LABEL-15's project files
 *   { kind: 'note',  title, note }
 *   + title? note? visibility? ('artist' default | 'internal')
 *
 * An INTERNAL reference needs a team role: a member whose role is `artist`
 * can neither read nor create one (403). A track / file the member cannot
 * open is 404, as opening it would be. The event of an internal reference is
 * internal too, and names the kind, never the words.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireObjectAccess } from '@/lib/auth/org-access';
import { isSupabaseConfigured } from '@/lib/db';
import { isMissingSchema } from '@/lib/artists/workspace-load';
import { readBody } from '@/lib/validate';
import { OrgReferenceCreateBodySchema } from '@/lib/contracts';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { recordEvent } from '@/lib/labelos/activity';
import {
  canReadInternalReference,
  linkHost,
  nextReferencePosition,
  partitionReferences,
  REFERENCES_PER_ARTIST_MAX,
  safeReferenceUrl,
} from '@/lib/labelos/direction';
import { insertReference, listReferenceRows, readableFiles, readableTracks, resolvePointers } from '@/lib/labelos/direction-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.artists.references');

type Params = { params: Promise<{ orgId: string; contactId: string }> };

const NO_STORE = { 'Cache-Control': 'no-store' };
const json = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: NO_STORE });

export async function POST(req: NextRequest, { params }: Params) {
  const { orgId, contactId } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'Creative direction needs Supabase.' });
  const access = await requireObjectAccess({ table: 'contacts', id: contactId, cap: 'catalog.write', orgId });
  if (!access.ok) return access.res;
  const parsed = await readBody(req, OrgReferenceCreateBodySchema);
  if (!parsed.ok) return parsed.res;
  const body = parsed.data;
  const visibility = body.visibility ?? 'artist';
  if (visibility === 'internal' && !canReadInternalReference(access.role)) return json(403, { error: 'Forbidden' });

  try {
    const existing = await listReferenceRows(access.admin, access.orgId, contactId);
    if (existing.length >= REFERENCES_PER_ARTIST_MAX) return json(409, { error: `An artist holds at most ${REFERENCES_PER_ARTIST_MAX} references` });

    let title = body.title ?? '';
    let url: string | null = null;
    let trackId: string | null = null;
    let assetId: string | null = null;
    if (body.kind === 'track') {
      // The member must be able to open the track themself (D4 row rule, artist scope): else it does not exist for them.
      const tracks = await readableTracks(access.admin, access, [body.track_id!]);
      const found = tracks.get(body.track_id!.toLowerCase());
      if (found === undefined) return json(404, { error: 'Not found' });
      trackId = body.track_id!.toLowerCase();
      title = title || found;
    } else if (body.kind === 'file') {
      const files = await readableFiles(access.admin, access, [body.asset_id!]);
      const file = files.get(body.asset_id!.toLowerCase());
      if (!file) return json(404, { error: 'Not found' });
      assetId = file.id;
      title = title || file.label;
    } else if (body.kind === 'link') {
      url = safeReferenceUrl(body.url);
      if (!url) return json(400, { error: 'A link must be an https address' });
      title = title || linkHost(url);
    }

    const row = await insertReference(access.admin, {
      orgId: access.orgId,
      contactId,
      userId: access.userId,
      kind: body.kind,
      title,
      note: body.note ?? null,
      url,
      trackId,
      assetId,
      visibility,
      position: nextReferencePosition(existing.map((r) => r.position)),
    });

    await recordEvent(
      access.admin,
      { orgId: access.orgId, userId: access.userId },
      'reference.added',
      { type: 'contact', id: contactId, artistId: contactId },
      { kind: body.kind, visibility },
      { visibility: visibility === 'internal' ? 'internal' : 'artist' },
    );

    const { visible } = partitionReferences([row], access.role, await resolvePointers(access.admin, access, [row]));
    return json(201, { reference: visible[0] ?? null });
  } catch (err) {
    if (isMissingSchema(err)) return json(503, { error: 'Creative direction needs migration 152.' });
    log.error('reference create failed', { orgId: access.orgId, error: errorMessage(err) });
    return json(500, { error: 'Could not add the reference' });
  }
}
