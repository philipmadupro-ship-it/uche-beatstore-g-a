import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured, requireUser, query, getAll, insert, deleteRow } from '@/lib/db';
import { readBody } from '@/lib/validate';
import { errorMessage } from '@/lib/errors';
import { ContactsBulkTagsBodySchema } from '@/lib/contracts';

interface ContactIdRow {
  id: string;
}

interface ContactTagRow {
  id?: string;
  contact_id: string;
  tag: string;
  category?: string | null;
}

/**
 * POST /api/contacts/tags/bulk — add and/or remove tags across many contacts in
 * one request. Body { ids, add?, remove? }. Merges (never overwrites): adds are
 * upserted, removes are deleted. Owner-scoped to the caller's (or legacy-null)
 * contacts so a forged id can't tag someone else's rows.
 *
 * Built as a single batched call (not N per-contact round-trips) so "tag all
 * filtered" stays fast at 500+ contacts.
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
      // Restrict to owned contacts first.
      const { data: owned } = await auth.admin
        .from('contacts')
        .select('id')
        .in('id', ids)
        .or(`user_id.eq.${auth.userId},user_id.is.null`);
      const ownedIds = ((owned ?? []) as ContactIdRow[]).map((c) => c.id);
      if (ownedIds.length === 0) return NextResponse.json({ updated: 0 });

      if (remove.length) {
        await auth.admin.from('contact_tags').delete().in('contact_id', ownedIds).in('tag', remove);
      }
      if (add.length) {
        const rows = ownedIds.flatMap((cid: string) => add.map((tag) => ({ contact_id: cid, tag, category: 'custom' })));
        await auth.admin.from('contact_tags').upsert(rows, { onConflict: 'contact_id,tag' });
      }
      return NextResponse.json({ updated: ownedIds.length });
    }

    // Local-store fallback.
    const idset = new Set(ids);
    if (remove.length) {
      const removeSet = new Set(remove);
      getAll<ContactTagRow>('contact_tags')
        .filter((r) => idset.has(r.contact_id) && removeSet.has(r.tag))
        .forEach((r) => { if (r.id) deleteRow('contact_tags', r.id); });
    }
    if (add.length) {
      for (const cid of ids) {
        for (const tag of add) {
          const exists = query<ContactTagRow>(
            'contact_tags',
            (t) => t.contact_id === cid && t.tag === tag,
          ).length > 0;
          if (!exists) insert('contact_tags', { contact_id: cid, tag, category: 'custom' });
        }
      }
    }
    return NextResponse.json({ updated: ids.length });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
