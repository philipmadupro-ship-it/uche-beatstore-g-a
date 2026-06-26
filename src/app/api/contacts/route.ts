import { NextRequest, NextResponse } from 'next/server';
import { scopedList, insertOwned, isErrorResponse, isSupabaseConfigured, createServiceClient, getAll, requireUser, query, update } from '@/lib/db';
import { safeSellerId } from '@/lib/auth/ownership';
import { readBody, parsePagination } from '@/lib/validate';
import { errorMessage } from '@/lib/errors';
import { ContactsBatchPatchBodySchema } from '@/lib/contracts';

/**
 * Contacts list + create — runs through the storage facade so the
 * `if (supabase) else (local)` boilerplate is centralized.
 *
 * GET  /api/contacts → caller's contacts, oldest-name-first, with tags attached
 *                       (mig 091). Null-owner legacy rows included by default.
 * POST /api/contacts → create with user_id auto-stamped from session.
 */
export async function GET(req: NextRequest) {
  const { limit, offset } = parsePagination(new URL(req.url).searchParams);
  const rows = await scopedList<{ id: string; [k: string]: unknown }>('contacts', {
    orderBy: 'name',
    ascending: true,
    limit,
    offset,
  });
  if (isErrorResponse(rows)) return rows;

  // Batch-attach tags so the CRM can filter/group by them client-side.
  const ids = rows.map((r) => r.id);
  const tagsByContact = new Map<string, { tag: string; category: string | null }[]>();
  if (ids.length) {
    if (isSupabaseConfigured()) {
      const admin = createServiceClient();
      const { data: tagRows } = await admin.from('contact_tags').select('contact_id, tag, category').in('contact_id', ids);
      (tagRows ?? []).forEach((r: any) => {
        const arr = tagsByContact.get(r.contact_id) ?? [];
        arr.push({ tag: r.tag, category: r.category });
        tagsByContact.set(r.contact_id, arr);
      });
    } else {
      (getAll('contact_tags') as any[]).forEach((r) => {
        const arr = tagsByContact.get(r.contact_id) ?? [];
        arr.push({ tag: r.tag, category: r.category ?? null });
        tagsByContact.set(r.contact_id, arr);
      });
    }
  }

  const withTags = rows.map((r) => ({ ...r, tags: tagsByContact.get(r.id) ?? [] }));
  return NextResponse.json(withTags);
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { name, email, role, label, instagram, twitter, notes } = body || {};

  if (!name || typeof name !== 'string' || !name.trim()) {
    return NextResponse.json({ error: 'Name is required' }, { status: 400 });
  }

  const result = await insertOwned('contacts', {
    name: name.trim(),
    email: email ?? null,
    role: role ?? null,
    label: label ?? null,
    instagram: instagram ?? null,
    twitter: twitter ?? null,
    notes: notes ?? null,
  });
  if (isErrorResponse(result)) return result;
  return NextResponse.json(result);
}

/**
 * PATCH /api/contacts — batch edit. Body { ids, patch: { crm_status?, category? } }.
 * Used by the CRM bulk-edit bar. Owner-scoped: only the caller's (or legacy-null)
 * rows among the given ids are updated.
 */
export async function PATCH(req: NextRequest) {
  const parsed = await readBody(req, ContactsBatchPatchBodySchema);
  if (!parsed.ok) return parsed.res;
  const { ids, patch } = parsed.data;
  if (Object.keys(patch).length === 0) return NextResponse.json({ updated: 0 });

  try {
    const auth = await requireUser();
    if (!auth.ok) return auth.res;

    if (isSupabaseConfigured()) {
      // Validate before interpolating into .or() (comma footgun).
      const safeId = safeSellerId(auth.userId);
      if (!safeId) return NextResponse.json({ updated: 0 });
      // Single UPDATE … IN (ids) scoped to owner-or-legacy-null. No N round-trips.
      const { data, error } = await auth.admin
        .from('contacts')
        .update(patch)
        .in('id', ids)
        .or(`user_id.eq.${safeId},user_id.is.null`)
        .select('id');
      if (error) throw new Error(error.message);
      return NextResponse.json({ updated: data?.length ?? 0 });
    }

    // Local-store fallback.
    const idset = new Set(ids);
    const rows = query('contacts', (c) => idset.has((c as any).id)) as any[];
    rows.forEach((r) => update('contacts', r.id, patch));
    return NextResponse.json({ updated: rows.length });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
