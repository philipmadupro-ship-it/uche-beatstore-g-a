import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/ownership';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { scoreLead, type LeadTier } from '@/lib/contacts/scoring';
import { selectInChunks } from '@/lib/db-in-chunks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.contacts.scores');

/**
 * GET /api/contacts/scores
 *
 * Batched lead scores for every contact the producer owns, computed from
 * beat-send engagement (sends/opens/clicks), share-link plays, purchases, and
 * buyer_favorites matched by buyer email. Returns
 * { scores: { [contactId]: { score, tier, reasons, …counts } } } in 5 queries
 * total (not N) so it scales to 500+ contacts.
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
      // Owner-only, matching /api/contacts and /api/beat_sends. Scoring an
      // orphan row the rest of the CRM cannot open was half of why the
      // pipeline numbers never reconciled.
      .eq('user_id', userId)
      .limit(5000);

    const contactRows = contacts ?? [];
    if (contactRows.length === 0) return NextResponse.json({ scores: {} });

    const contactIds = contactRows.map((c) => c.id);
    const emailToContact = new Map<string, string>();
    for (const c of contactRows) {
      if (c.email) emailToContact.set(c.email.toLowerCase().trim(), c.id);
    }

    // 2. Beat sends for those contacts — aggregate per contact in JS.
    // Chunked — one id per contact in the URL otherwise (see lib/db-in-chunks).
    const sends = await selectInChunks<{
      contact_id: string; sent_at: string | null; opened_at: string | null;
      link_clicked_at: string | null; share_token: string | null;
    }>(contactIds, (batch) => admin
      .from('beat_sends')
      .select('contact_id, sent_at, opened_at, link_clicked_at, share_token')
      .in('contact_id', batch));

    type Agg = { sends: number; opens: number; clicks: number; plays: number; favorites: number; purchases: number; revenue: number; lastTouch: number };
    const agg = new Map<string, Agg>();
    const touch = (id: string): Agg => {
      let a = agg.get(id);
      if (!a) { a = { sends: 0, opens: 0, clicks: 0, plays: 0, favorites: 0, purchases: 0, revenue: 0, lastTouch: 0 }; agg.set(id, a); }
      return a;
    };
    // share_token → the contacts it was sent to. Normally 1:1 (each send mints
    // its own nanoid link), but a producer can reuse a token across contacts,
    // and then a play genuinely cannot be attributed to one of them.
    const contactsByToken = new Map<string, Set<string>>();
    for (const s of sends) {
      const a = touch(s.contact_id as string);
      a.sends++;
      if (s.opened_at) a.opens++;
      if (s.link_clicked_at) a.clicks++;
      for (const ts of [s.sent_at, s.opened_at, s.link_clicked_at]) {
        if (ts) a.lastTouch = Math.max(a.lastTouch, new Date(ts as string).getTime());
      }
      const token = s.share_token as string | null;
      if (token) {
        const set = contactsByToken.get(token) ?? new Set<string>();
        set.add(s.contact_id as string);
        contactsByToken.set(token, set);
      }
    }

    // Plays on those share links. scoreLead weights a play at 6 — above an
    // open at 4 — but nothing ever populated the field, so the strongest
    // pre-purchase engagement signal was silently absent from every score.
    // Ambiguous tokens (sent to more than one contact) are skipped rather
    // than counted for all of them, which would inflate every score involved.
    const attributableTokens = [...contactsByToken.entries()]
      .filter(([, set]) => set.size === 1)
      .map(([token]) => token);
    if (attributableTokens.length > 0) {
      const plays = await selectInChunks<{ link_token: string; played_at: string | null }>(
        attributableTokens,
        (batch) => admin.from('share_plays').select('link_token, played_at').in('link_token', batch),
      );
      for (const p of plays) {
        const set = contactsByToken.get(p.link_token as string);
        const cid = set ? [...set][0] : undefined;
        if (!cid) continue;
        const a = touch(cid);
        a.plays++;
        if (p.played_at) a.lastTouch = Math.max(a.lastTouch, new Date(p.played_at as string).getTime());
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
      // Emails are variable-length and there is no relation to join through,
      // so chunking is the only option here.
      const favorites = await selectInChunks<{ email: string; created_at: string | null }>(
        emails,
        (batch) => admin.from('buyer_favorites').select('email, created_at').in('email', batch),
      );
      for (const f of favorites) {
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
      score: number; tier: LeadTier; reasons: string[];
      sends: number; plays: number; purchases: number; revenue: number; favorites: number;
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
        // scoreLead already computes the human-readable drivers, strongest
        // first. Dropping them left the list showing a tier dot nobody could
        // interpret; the list now uses them as the dot's tooltip.
        reasons: r.reasons,
        sends: a?.sends ?? 0, plays: a?.plays ?? 0, purchases: a?.purchases ?? 0,
        revenue: a?.revenue ?? 0, favorites: a?.favorites ?? 0,
      };
    }

    return NextResponse.json({ scores });
  } catch (err) {
    log.error('scores failed', { error: errorMessage(err) });
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
