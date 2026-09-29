import { NextRequest, NextResponse } from 'next/server';
import { requireRowOwnership } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/db';
import { readBody } from '@/lib/validate';
import { ContactDecisionBodySchema } from '@/lib/contracts';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { describeDecisionChange, isDecision, type Decision } from '@/lib/contacts/decisions';
import { isSchemaNotReady, schemaNotReadyResponse } from '@/lib/artists/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.contacts.decisions');

/**
 * PUT /api/contacts/[id]/decisions  { track_ids, decision, project_id? }
 *
 * The producer sets (or clears, with null) this artist's decision on one or
 * more beats — the Beats tab's dropdown and its BatchActionBar both land
 * here. Only tracks the producer owns are written; the rest are reported in
 * `skipped`. Each real change is logged as a `decision_changed` timeline row;
 * re-sending the same decision changes nothing and logs nothing.
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'The artist workspace needs Supabase.' }, { status: 501 });
  const auth = await requireRowOwnership('contacts', id);
  if (!auth.ok) return auth.res;
  const { admin, userId } = auth;

  const parsed = await readBody(req, ContactDecisionBodySchema);
  if (!parsed.ok) return parsed.res;
  const { track_ids, decision, project_id } = parsed.data;

  try {
    const [{ data: contact, error: cErr }, { data: owned, error: tErr }, { data: existing, error: sErr }] = await Promise.all([
      admin.from('contacts').select('id, name').eq('id', id).eq('user_id', userId).maybeSingle(),
      admin.from('tracks').select('id, title').in('id', track_ids).eq('user_id', userId),
      admin.from('contact_track_states').select('track_id, decision').eq('contact_id', id).eq('user_id', userId).in('track_id', track_ids),
    ]);
    if (cErr) throw cErr;
    if (tErr) throw tErr;
    if (sErr) throw sErr;
    if (!contact) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    if (project_id) {
      const { data: project } = await admin.from('projects').select('id').eq('id', project_id).eq('user_id', userId).maybeSingle();
      if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const ownedRows = (owned ?? []) as Array<{ id: string; title: string | null }>;
    const ownedIds = new Set(ownedRows.map((t) => t.id));
    const before = new Map(((existing ?? []) as Array<{ track_id: string; decision: string | null }>)
      .map((r) => [r.track_id, isDecision(r.decision) ? r.decision : null]));
    const changed = ownedRows.filter((t) => (before.get(t.id) ?? null) !== decision);

    if (changed.length > 0) {
      const now = new Date().toISOString();
      const { error: upErr } = await admin
        .from('contact_track_states')
        .upsert(changed.map((t) => ({
          user_id: userId,
          contact_id: id,
          track_id: t.id,
          decision,
          set_by: 'producer',
          updated_at: now,
          ...(project_id !== undefined ? { project_id } : {}),
        })), { onConflict: 'contact_id,track_id' });
      if (upErr) throw upErr;

      const { error: actErr } = await admin.from('contact_activity').insert(changed.map((t) => ({
        contact_id: id,
        user_id: userId,
        kind: 'decision_changed',
        title: describeDecisionChange({ contactName: contact.name ?? 'Artist', trackTitle: t.title ?? 'a beat', decision: decision as Decision | null, setBy: 'producer' }),
        metadata: { track_id: t.id, decision, previous: before.get(t.id) ?? null, set_by: 'producer' },
        occurred_at: now,
      })));
      if (actErr) log.warn('decision timeline rows failed', { error: errorMessage(actErr) });
    }

    return NextResponse.json({
      updated: changed.map((t) => t.id),
      unchanged: ownedRows.filter((t) => !changed.includes(t)).map((t) => t.id),
      skipped: track_ids.filter((t) => !ownedIds.has(t)),
      decision,
    });
  } catch (err) {
    if (isSchemaNotReady(err)) return schemaNotReadyResponse();
    log.error('decision write failed', { id, error: errorMessage(err) });
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
