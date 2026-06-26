import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured, requireUser, query, getAll, insert, deleteRow } from '@/lib/db';
import { safeSellerId } from '@/lib/auth/ownership';
import { readBody } from '@/lib/validate';
import { errorMessage } from '@/lib/errors';
import { ContactsBulkTagsBodySchema } from '@/lib/contracts';

/**
 * POST /api/tracks/tags/bulk — add and/or remove tags across many tracks in
 * one request. Mirrors /api/contacts/tags/bulk/route.ts exactly, targeting
 * track_tags instead of contact_tags.
 */
export async function POST(req: NextRequest) {
  const parsed = await readBody(req, ContactsBulkTagsBodySchema);
  if (!parsed.ok) return parsed.res;
  const { ids, add = [], remove = [] } = parsed.data;
  if (add.length === 0 && remove.length === 0) return NextResponse.json({ updated: 0 });

  try {
    const auth = await requireUser();
    if (!auth.ok) return auth.res;

    if (isSupabaseConfigured()) {
      // Validate before interpolating into .or() (comma footgun).
      const safeId = safeSellerId(auth.userId);
      if (!safeId) return NextResponse.json({ updated: 0 });
      // Restrict to owned tracks.
      const { data: owned } = await auth.admin
        .from('tracks')
        .select('id')
        .in('id', ids)
        .or(`user_id.eq.${safeId},user_id.is.null`);
      const ownedIds = (owned ?? []).map((t: any) => t.id);
      if (ownedIds.length === 0) return NextResponse.json({ updated: 0 });

      if (remove.length) {
        await auth.admin.from('track_tags').delete().in('track_id', ownedIds).in('tag', remove);
      }
      if (add.length) {
        const rows = ownedIds.flatMap((tid: string) => add.map((tag) => ({ track_id: tid, tag, category: 'custom' })));
        await auth.admin.from('track_tags').upsert(rows, { onConflict: 'track_id,tag' });
      }
      return NextResponse.json({ updated: ownedIds.length });
    }

    // Local-store fallback.
    const idset = new Set(ids);
    if (remove.length) {
      const removeSet = new Set(remove);
      (getAll('track_tags') as any[])
        .filter((r) => idset.has(r.track_id) && removeSet.has(r.tag))
        .forEach((r) => deleteRow('track_tags', r.id));
    }
    if (add.length) {
      for (const tid of ids) {
        for (const tag of add) {
          const exists = query('track_tags', (t) => (t as any).track_id === tid && (t as any).tag === tag).length > 0;
          if (!exists) insert('track_tags', { track_id: tid, tag, category: 'custom' });
        }
      }
    }
    return NextResponse.json({ updated: ids.length });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
