import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireRowOwnership } from '@/lib/auth/ownership';
import { readBody } from '@/lib/validate';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.contacts.tasks');

/**
 * GET  /api/contacts/[id]/tasks   — tasks for one contact (open first, then done)
 * POST /api/contacts/[id]/tasks   — create a follow-up task
 */

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireRowOwnership('contacts', id);
  if (!auth.ok) return auth.res;

  try {
    const { data, error } = await auth.admin
      .from('contact_tasks')
      .select('id, title, due_at, done_at, created_at')
      .eq('contact_id', id)
      .order('done_at', { ascending: true, nullsFirst: true })
      .order('due_at', { ascending: true, nullsFirst: false })
      .limit(200);
    if (error) throw error;
    return NextResponse.json({ tasks: data ?? [] });
  } catch (err) {
    log.error('tasks fetch failed', { error: errorMessage(err) });
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

const CreateSchema = z.object({
  title: z.string().min(1).max(300),
  due_at: z.string().datetime().nullable().optional(),
}).strict();

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireRowOwnership('contacts', id);
  if (!auth.ok) return auth.res;

  const parsed = await readBody(req, CreateSchema);
  if (!parsed.ok) return parsed.res;

  try {
    const { data, error } = await auth.admin
      .from('contact_tasks')
      .insert({
        contact_id: id,
        user_id: auth.userId,
        title: parsed.data.title,
        due_at: parsed.data.due_at ?? null,
      })
      .select('id, title, due_at, done_at, created_at')
      .single();
    if (error) throw error;
    return NextResponse.json({ task: data });
  } catch (err) {
    log.error('task create failed', { error: errorMessage(err) });
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
