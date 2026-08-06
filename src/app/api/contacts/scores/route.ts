import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/ownership';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { scoreLead, type LeadTier } from '@/lib/contacts/scoring';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.contacts.scores');

/**
 * GET /api/contacts/scores
 *
 * Batched lead scores for every contact the producer owns, computed from
 * beat-send engagement (sends/opens/clicks) + purchases + buyer_favorites
 * matched by buyer email. Returns { scores: { [contactId]: { score, tier } } }
 * in 4 queries total (not N) so it scales to 500+ contacts.
 */
export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.res;
  const { admin, userId } = auth;

  try {
    // 1. The producer's contacts (id + email)
    const { data: contacts } = await admin
      .from('contacts')
      .select('id, email')
      .or(`user_id.eq.${userId},user_id.is.null`)
      .limit(5000);

    const contactRows = contacts ?? [];
    if (contactRows.length === 0) return NextResponse.json({ scores: {} });

    const contactIds = contactRows.map((c) => c.id);
    const emailToContact = new Map<string, string>();
    for (const c of contactRows) {
      if (c.email) emailToContact.set(c.email.toLowerCase().trim(), c.id);
    }

    // 2. Beat sends for those contacts — aggregate per contact in JS.
    const { data: sends } = await admin
      .from('beat_sends')
      .select('contact_id, sent_at, opened_at, link_clicked_at')
      .in('contact_id', contactIds)
      .limit(20000);

    type Agg = { sends: number; opens: number; clicks: number; plays: number; favorites: number; purchases: number; revenue: number; lastTouch: number };
    const agg = new Map<string, Agg>();
    const touch = (id: string): Agg => {
      let a = agg.get(id);
      if (!a) { a = { sends: 0, opens: 0, clicks: 0, plays: 0, favorites: 0, purchases: 0, revenue: 0, lastTouch: 0 }; agg.set(id, a); }
      return a;
    };
    for (const s of sends ?? []) {
      const a = touch(s.contact_id as string);
      a.sends++;
      if (s.opened_at) a.opens++;
      if (s.link_clicked_at) a.clicks++;
      for (const ts of [s.sent_at, s.opened_at, s.link_clicked_at]) {
        if (ts) a.lastTouch = Math.max(a.lastTouch, new Date(ts as string).getTime());
      }
    }

    // 3. Purchases for this seller — map to contacts by buyer email.
    const { data: purchases } = await admin
      .from('license_purchases')
      .select('buyer_email, amount_usd, created_at, status')
      .eq('seller_user_id', userId)
      .eq('status', 'paid')
      .limit(20000);
    for (const p of purchases ?? []) {
      const cid = p.buyer_email ? emailToContact.get((p.buyer_email as string).toLowerCase().trim()) : undefined;
      if (!cid) continue;
      const a = touch(cid);
      a.purchases++;
      a.revenue += Number(p.amount_usd ?? 0) || 0;
      if (p.created_at) a.lastTouch = Math.max(a.lastTouch, new Date(p.created_at as string).getTime());
    }

    // 4. Favorites — the buyer-account signal (AGENTS.md "Buyer accounts").
    // Every producer's contacts share one buyer_favorites table (no
    // seller scoping on that table — single-producer app), so this is
    // unfiltered and mapped to contacts by email like purchases above.
    const emails = [...emailToContact.keys()];
    if (emails.length > 0) {
      const { data: favorites } = await admin
        .from('buyer_favorites')
        .select('email, created_at')
        .in('email', emails)
        .limit(20000);
      for (const f of favorites ?? []) {
        const cid = emailToContact.get((f.email as string).toLowerCase().trim());
        if (!cid) continue;
        const a = touch(cid);
        a.favorites++;
        if (f.created_at) a.lastTouch = Math.max(a.lastTouch, new Date(f.created_at as string).getTime());
      }
    }

    // 5. Score each contact. Raw signal counts ride along with score/tier —
    // the CRM list derives each contact's kind (buyer/artist/lead/contact,
    // see lib/contacts/kind.ts) and its revenue/favorites badges from these
    // without a second round-trip.
    const now = Date.now();
    const scores: Record<string, {
      score: number; tier: LeadTier;
      sends: number; purchases: number; revenue: number; favorites: number;
    }> = {};
    for (const id of contactIds) {
      const a = agg.get(id);
      const r = scoreLead({
        sends: a?.sends ?? 0,
        opens: a?.opens ?? 0,
        clicks: a?.clicks ?? 0,
        plays: a?.plays ?? 0,
        favorites: a?.favorites ?? 0,
        purchases: a?.purchases ?? 0,
        revenue: a?.revenue ?? 0,
        lastTouch: a?.lastTouch ? new Date(a.lastTouch).toISOString() : null,
        now,
      });
      scores[id] = {
        score: r.score, tier: r.tier,
        sends: a?.sends ?? 0, purchases: a?.purchases ?? 0,
        revenue: a?.revenue ?? 0, favorites: a?.favorites ?? 0,
      };
    }

    return NextResponse.json({ scores });
  } catch (err) {
    log.error('scores failed', { error: errorMessage(err) });
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
