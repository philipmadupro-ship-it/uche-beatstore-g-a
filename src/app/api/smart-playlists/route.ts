import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { scopedList, insertOwned, isErrorResponse } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Smart playlists — saved, auto-updating filter views (mig 067).
 *
 *   GET  /api/smart-playlists           — caller's saved views, newest first
 *   POST /api/smart-playlists           — create { name, filter }
 *
 * The `filter` jsonb mirrors the serialized LibraryFilters shape. We don't
 * validate its internals strictly — it's the client's own filter spec and
 * the library re-applies it against the live catalogue at render time.
 */
export async function GET() {
  const rows = await scopedList('smart_playlists', { orderBy: 'created_at', ascending: false });
  if (isErrorResponse(rows)) return rows;
  return NextResponse.json({ smart_playlists: rows });
}

const bodySchema = z.object({
  name: z.string().trim().min(1).max(80),
  filter: z.record(z.string(), z.unknown()).default({}),
});

export async function POST(req: NextRequest) {
  const raw = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  const result = await insertOwned('smart_playlists', {
    name: parsed.data.name,
    filter: parsed.data.filter,
  });
  if (isErrorResponse(result)) return result;
  return NextResponse.json({ smart_playlist: result });
}
