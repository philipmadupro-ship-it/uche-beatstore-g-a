import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/ownership';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.contacts.tasks.due');

/**
 * GET /api/contacts/tasks   — every OPEN task for the producer, soonest-due
 * first, with the contact name attached. Powers the "Follow-ups" panel on
 * /contacts (overdue + due today + upcoming).
 */
export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.res;

  try {
    const { data: tasks, error } = await auth.admin
      .from('contact_tasks')
      .select('id, contact_id, title, due_at, created_at')
      .eq('user_id', auth.userId)
      .is('done_at', null)
      .order('due_at', { ascending: true, nullsFirst: false })
      .limit(200);
    if (error) throw error;

    const rows = tasks ?? [];
    const contactIds = [...new Set(rows.map((t) => t.contact_id as string))];
    let nameMap: Record<string, string> = {};
    if (contactIds.length > 0) {
      const { data: contacts } = await auth.admin
        .from('contacts')
        .select('id, name')
        .in('id', contactIds);
      nameMap = Object.fromEntries((contacts ?? []).map((c) => [c.id, c.name]));
    }

    const out = rows.map((t) => ({
      id: t.id,
      contact_id: t.contact_id,
      contact_name: nameMap[t.contact_id as string] ?? 'Unknown',
      title: t.title,
      due_at: t.due_at,
    }));

    return NextResponse.json({ tasks: out });
  } catch (err) {
    log.error('due tasks failed', { error: errorMessage(err) });
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
