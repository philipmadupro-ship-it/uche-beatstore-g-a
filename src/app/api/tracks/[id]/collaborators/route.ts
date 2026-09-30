import { NextRequest, NextResponse } from 'next/server';
import { requireRowOwnership } from '@/lib/auth/ownership';
import { readBody } from '@/lib/validate';
import { errorMessage, schemaCacheMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { CollaboratorCreateBodySchema, CollaboratorDeleteBodySchema, CollaboratorLinkBodySchema } from '@/lib/contracts';

const log = createLogger('api.tracks.collaborators');

/**
 * Track collaborator credits (migration 115). The junction table has no
 * user_id of its own — ownership rides on the parent track, same as
 * /api/tracks/[id]/tags.
 *
 * Migration 115 is not applied anywhere yet, so every handler has to survive
 * `track_collaborators` not existing. GET degrades to an empty list — a track
 * page must not 500 because credits aren't backed yet, same reasoning
 * CLAUDE.md documents for `store_layout` in `/api/store`. POST/DELETE surface
 * a readable "run the migration" message instead of a raw PostgREST error,
 * via the same `schemaCacheMessage` helper `/api/store` and friends use.
 */

function isMissingTableError(message: string): boolean {
  return schemaCacheMessage({ message }) !== null;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const owner = await requireRowOwnership('tracks', id);
    if (!owner.ok) return owner.res;

    // contact_id arrived in migration 124; read it when it exists, and fall
    // back to the 115 columns so credits still list before 124.
    const list = (columns: string) => owner.admin
      .from('track_collaborators')
      .select(columns)
      .eq('track_id', id)
      .order('created_at', { ascending: true });
    let { data, error } = await list('id, track_id, name, role, source, created_at, contact_id');
    if (error && (error as { code?: string }).code === '42703') ({ data, error } = await list('id, track_id, name, role, source, created_at'));

    if (error) {
      if (isMissingTableError(error.message ?? '')) {
        log.warn('track_collaborators missing; returning empty list', { trackId: id });
        return NextResponse.json([]);
      }
      throw new Error(error.message);
    }
    return NextResponse.json(data ?? []);
  } catch (error) {
    log.error('list failed', { trackId: id, error: errorMessage(error) });
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await readBody(req, CollaboratorCreateBodySchema);
  if (!parsed.ok) return parsed.res;
  const { name, role } = parsed.data;

  try {
    const owner = await requireRowOwnership('tracks', id);
    if (!owner.ok) return owner.res;

    // Always 'manual' — this is the producer typing a credit in, which must
    // never be clobbered by a later filename re-parse (that path is scoped to
    // source='filename', see lib/upload/collaborators.ts).
    const { data, error } = await owner.admin
      .from('track_collaborators')
      .insert({ track_id: id, name, role, source: 'manual' })
      .select('id, track_id, name, role, source, created_at')
      .single();

    if (error) {
      if (isMissingTableError(error.message ?? '')) {
        return NextResponse.json(
          { error: schemaCacheMessage({ message: error.message }) },
          { status: 503 },
        );
      }
      // Unique violation: (track_id, lower(name), role) already exists.
      if ((error as { code?: string }).code === '23505') {
        return NextResponse.json({ error: 'Already credited with that role' }, { status: 409 });
      }
      throw new Error(error.message);
    }

    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    log.error('create failed', { trackId: id, error: errorMessage(error) });
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await readBody(req, CollaboratorDeleteBodySchema);
  if (!parsed.ok) return parsed.res;
  const { id: collaboratorId } = parsed.data;

  try {
    const owner = await requireRowOwnership('tracks', id);
    if (!owner.ok) return owner.res;

    const { error } = await owner.admin
      .from('track_collaborators')
      .delete()
      .eq('id', collaboratorId)
      .eq('track_id', id);

    if (error) {
      if (isMissingTableError(error.message ?? '')) {
        return NextResponse.json(
          { error: schemaCacheMessage({ message: error.message }) },
          { status: 503 },
        );
      }
      throw new Error(error.message);
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    log.error('delete failed', { trackId: id, error: errorMessage(error) });
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

/**
 * PATCH { id, contact_id } — point a credit at a CRM contact (or unlink with
 * null), so "credit Artist #1 on the song" puts the song in their workspace.
 * The contact must be this producer's: the table has no owner column and no
 * trigger for it, so this route is the check.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await readBody(req, CollaboratorLinkBodySchema);
  if (!parsed.ok) return parsed.res;
  const { id: collaboratorId, contact_id: contactId } = parsed.data;

  try {
    const owner = await requireRowOwnership('tracks', id);
    if (!owner.ok) return owner.res;

    if (contactId) {
      const { data: contact } = await owner.admin
        .from('contacts')
        .select('id')
        .eq('id', contactId)
        .eq('user_id', owner.userId)
        .maybeSingle();
      if (!contact) return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    }

    const { data, error } = await owner.admin
      .from('track_collaborators')
      .update({ contact_id: contactId })
      .eq('id', collaboratorId)
      .eq('track_id', id)
      .select('id, track_id, name, role, source, created_at, contact_id');
    if (error) {
      if (isMissingTableError(error.message ?? '') || (error as { code?: string }).code === '42703') {
        return NextResponse.json({ error: 'Linking credits to contacts needs migration 124 applied on Supabase.' }, { status: 503 });
      }
      throw new Error(error.message);
    }
    const row = (data as unknown[] | null)?.[0];
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(row);
  } catch (error) {
    log.error('link failed', { trackId: id, error: errorMessage(error) });
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
