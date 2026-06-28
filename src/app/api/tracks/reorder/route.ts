import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured, query, requireUser, update } from '@/lib/db';
import { errorMessage } from '@/lib/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ReorderItem = {
  id: string;
  store_sort_order: number;
};

function parseItems(value: unknown): ReorderItem[] | null {
  if (!Array.isArray(value)) return null;
  const seen = new Set<string>();
  const items: ReorderItem[] = [];
  for (const row of value) {
    const id = typeof row?.id === 'string' ? row.id : '';
    const order = Number(row?.store_sort_order);
    if (!id || !Number.isInteger(order) || order < 0 || seen.has(id)) return null;
    seen.add(id);
    items.push({ id, store_sort_order: order });
  }
  return items;
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const items = parseItems(body.items);
    if (!items || items.length === 0) {
      return NextResponse.json({ error: 'items required' }, { status: 400 });
    }
    if (items.length > 1000) {
      return NextResponse.json({ error: 'too many items' }, { status: 400 });
    }

    if (!isSupabaseConfigured()) {
      const ids = new Set(items.map((item) => item.id));
      const existing = query('tracks', (track) => ids.has((track as { id: string }).id)) as Array<{ id: string }>;
      const existingIds = new Set(existing.map((track) => track.id));
      for (const item of items) {
        if (existingIds.has(item.id)) update('tracks', item.id, { store_sort_order: item.store_sort_order });
      }
      return NextResponse.json({ updated: existingIds.size });
    }

    const owner = await requireUser();
    if (!owner.ok) return owner.res;

    let updated = 0;
    for (const item of items) {
      const { data, error } = await owner.admin
        .from('tracks')
        .update({ store_sort_order: item.store_sort_order })
        .eq('id', item.id)
        .eq('user_id', owner.userId)
        .select('id');
      if (error) throw error;
      updated += data?.length ?? 0;
    }

    return NextResponse.json({ updated });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
