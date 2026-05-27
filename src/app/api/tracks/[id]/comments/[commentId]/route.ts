import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireRowOwnership } from '@/lib/db';
import { isSupabaseConfigured } from '@/lib/local-store';
import { errorMessage } from '@/lib/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * PATCH /api/tracks/[id]/comments/[commentId]   — owner-only moderation
 *   Body: { is_pinned?: boolean; is_hidden?: boolean }
 * DELETE /api/tracks/[id]/comments/[commentId]  — owner-only hard delete
 *
 * Both guard via requireRowOwnership('tracks', id) so a producer can
 * only moderate their own beats' comments.
 */

const patchSchema = z.object({
  is_pinned: z.boolean().optional(),
  is_hidden: z.boolean().optional(),
}).strict();

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; commentId: string }> },
) {
  const { id, commentId } = await params;
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });
  }
  const owner = await requireRowOwnership('tracks', id);
  if (!owner.ok) return owner.res;

  try {
    const raw = await req.json().catch(() => ({}));
    const parsed = patchSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid input' }, { status: 400 });
    }
    const { data, error } = await owner.admin
      .from('beat_comments')
      .update(parsed.data)
      .eq('id', commentId)
      .eq('track_id', id)            // double-check the comment belongs to this track
      .select('id, author_name, timestamp_seconds, body, is_pinned, is_hidden, created_at')
      .maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: 'Comment not found' }, { status: 404 });
    return NextResponse.json({ comment: data });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; commentId: string }> },
) {
  const { id, commentId } = await params;
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });
  }
  const owner = await requireRowOwnership('tracks', id);
  if (!owner.ok) return owner.res;

  try {
    const { error } = await owner.admin
      .from('beat_comments')
      .delete()
      .eq('id', commentId)
      .eq('track_id', id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
