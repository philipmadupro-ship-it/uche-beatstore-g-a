import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireRowOwnership } from '@/lib/auth/ownership';
import { readBody } from '@/lib/validate';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import {
  buildContactTimeline,
  summarizeEngagement,
  type StoredActivityRow,
  type BeatSendRow,
  type PurchaseRow,
} from '@/lib/contacts/activity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.contacts.activity');

/**
 * GET  /api/contacts/[id]/activity
 *   Full CRM timeline for a contact: merge of stored contact_activity rows,
 *   derived beat-send events, and matched purchases (buyer email = contact
 *   email). Returns { timeline, summary }.
 *
 * POST /api/contacts/[id]/activity
 *   Add a manual note (or other owner-authored event) to the timeline.
 */

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireRowOwnership('contacts', id);
  if (!auth.ok) return auth.res;
  const { admin, userId } = auth;

  try {
    // Contact (for the buyer-email match)
    const { data: contact } = await admin
      .from('contacts')
      .select('id, email')
      .eq('id', id)
      .maybeSingle();

    // 1. Stored activity rows
    const { data: stored } = await admin
      .from('contact_activity')
      .select('id, kind, title, body, metadata, occurred_at')
      .eq('contact_id', id)
      .order('occurred_at', { ascending: false })
      .limit(500);

    // 2. Beat sends for this contact
    const { data: beatSends } = await admin
      .from('beat_sends')
      .select('id, track_ids, sent_at, opened_at, link_clicked_at, message')
      .eq('contact_id', id)
      .order('sent_at', { ascending: false })
      .limit(200);

    // 3. Purchases matched by buyer email (the buyer → contact link)
    let purchases: PurchaseRow[] = [];
    if (contact?.email) {
      const { data: pur } = await admin
        .from('license_purchases')
        .select('id, track_ids, license_type, amount_usd, created_at, stripe_session_id')
        .eq('seller_user_id', userId)
        .eq('buyer_email', contact.email.toLowerCase().trim())
        .eq('status', 'paid')
        .order('created_at', { ascending: false })
        .limit(200);
      purchases = (pur ?? []) as PurchaseRow[];
    }

    // Title map for every referenced track id
    const trackIds = new Set<string>();
    (beatSends ?? []).forEach((b) => (b.track_ids ?? []).forEach((t: string) => trackIds.add(t)));
    purchases.forEach((p) => (p.track_ids ?? []).forEach((t: string) => trackIds.add(t)));
    let titleMap: Record<string, string> = {};
    if (trackIds.size > 0) {
      const { data: tracks } = await admin
        .from('tracks')
        .select('id, title')
        .in('id', [...trackIds]);
      titleMap = Object.fromEntries((tracks ?? []).map((t) => [t.id, t.title]));
    }

    const timeline = buildContactTimeline({
      stored: (stored ?? []) as StoredActivityRow[],
      beatSends: (beatSends ?? []) as BeatSendRow[],
      purchases,
      titleMap,
    });
    const summary = summarizeEngagement(timeline);

    return NextResponse.json({ timeline, summary });
  } catch (err) {
    log.error('activity fetch failed', { error: errorMessage(err) });
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

const NoteSchema = z.object({
  kind: z.enum(['note', 'stage_change']).default('note'),
  title: z.string().min(1).max(300),
  body: z.string().max(5000).nullable().optional(),
  occurred_at: z.string().datetime().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
}).strict();

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireRowOwnership('contacts', id);
  if (!auth.ok) return auth.res;
  const { admin, userId } = auth;

  const parsed = await readBody(req, NoteSchema);
  if (!parsed.ok) return parsed.res;

  try {
    const { data, error } = await admin
      .from('contact_activity')
      .insert({
        contact_id: id,
        user_id: userId,
        kind: parsed.data.kind,
        title: parsed.data.title,
        body: parsed.data.body ?? null,
        metadata: parsed.data.metadata ?? {},
        occurred_at: parsed.data.occurred_at ?? new Date().toISOString(),
      })
      .select('id, kind, title, body, metadata, occurred_at')
      .single();

    if (error) throw error;
    return NextResponse.json({ activity: data });
  } catch (err) {
    log.error('activity insert failed', { error: errorMessage(err) });
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
