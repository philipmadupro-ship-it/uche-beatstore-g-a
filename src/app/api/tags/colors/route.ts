import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/ownership';
import { errorMessage, schemaCacheMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { readBody } from '@/lib/validate';

const log = createLogger('api.tags.colors');

export const dynamic = 'force-dynamic';

/**
 * Per-producer tag colours.
 *
 * Read returns a flat `{ tag: hex }` map rather than rows: every caller wants
 * a lookup, and the whole set is small enough to send at once — a producer has
 * tens of tags, not thousands.
 */
export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.res;

  try {
    const { data, error } = await auth.admin
      .from('tag_colors')
      .select('tag, color')
      .eq('user_id', auth.userId);
    if (error) throw error;

    const colors: Record<string, string> = {};
    for (const row of data ?? []) colors[row.tag] = row.color;
    return NextResponse.json({ colors });
  } catch (err) {
    log.error('read failed', { error: errorMessage(err) });
    const pending = schemaCacheMessage(err);
    // A missing table on READ degrades to "no overrides" rather than an
    // error: the app has curated defaults for every tag, so the feature
    // still works, just uncustomised.
    if (pending) return NextResponse.json({ colors: {} });
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

const PutSchema = z.object({
  tag: z.string().trim().min(1).max(80),
  category: z.string().max(40).nullish(),
  /** Null clears the override and restores the app's default for that tag. */
  color: z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/).nullable(),
});

export async function PUT(req: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.res;

  const parsed = await readBody(req, PutSchema);
  if (!parsed.ok) return parsed.res;
  const { tag, category, color } = parsed.data;
  // Lower-cased here so 'Trap' and 'trap' can never become two rows carrying
  // different colours for what the producer thinks of as one tag.
  const key = tag.trim().toLowerCase();

  try {
    if (color === null) {
      const { error } = await auth.admin
        .from('tag_colors')
        .delete()
        .eq('user_id', auth.userId)
        .eq('tag', key);
      if (error) throw error;
      return NextResponse.json({ ok: true, tag: key, color: null });
    }

    const { error } = await auth.admin
      .from('tag_colors')
      .upsert({
        user_id: auth.userId,
        tag: key,
        category: category ?? null,
        color: color.toLowerCase(),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,tag' });
    if (error) throw error;

    return NextResponse.json({ ok: true, tag: key, color: color.toLowerCase() });
  } catch (err) {
    log.error('write failed', { error: errorMessage(err) });
    const pending = schemaCacheMessage(err);
    return NextResponse.json(
      { error: pending ?? errorMessage(err) },
      { status: pending ? 503 : 500 },
    );
  }
}
