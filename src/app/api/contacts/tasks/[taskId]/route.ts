import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/ownership';
import { readBody } from '@/lib/validate';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.contacts.tasks.mutate');

/**
 * PATCH  /api/contacts/tasks/[taskId]  — toggle done / edit title or due date
 * DELETE /api/contacts/tasks/[taskId]  — remove a task
 *
 * Owner-gated: the RLS policy on contact_tasks already restricts to the
 * authenticated user, and we additionally scope the query by user_id.
 */

const PatchSchema = z.object({
  done: z.boolean().optional(),
  title: z.string().min(1).max(300).optional(),
  due_at: z.string().datetime().nullable().optional(),
}).strict();

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params;
  const auth = await requireUser();
  if (!auth.ok) return auth.res;

  const parsed = await readBody(req, PatchSchema);
  if (!parsed.ok) return parsed.res;

  const patch: Record<string, unknown> = {};
  if (parsed.data.done !== undefined) patch.done_at = parsed.data.done ? new Date().toISOString() : null;
  if (parsed.data.title !== undefined) patch.title = parsed.data.title;
  if (parsed.data.due_at !== undefined) patch.due_at = parsed.data.due_at;

  try {
    const { data, error } = await auth.admin
      .from('contact_tasks')
      .update(patch)
      .eq('id', taskId)
      .eq('user_id', auth.userId)
      .select('id, title, due_at, done_at, created_at')
      .maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ task: data });
  } catch (err) {
    log.error('task patch failed', { error: errorMessage(err) });
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params;
  const auth = await requireUser();
  if (!auth.ok) return auth.res;

  try {
    const { error } = await auth.admin
      .from('contact_tasks')
      .delete()
      .eq('id', taskId)
      .eq('user_id', auth.userId);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err) {
    log.error('task delete failed', { error: errorMessage(err) });
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
