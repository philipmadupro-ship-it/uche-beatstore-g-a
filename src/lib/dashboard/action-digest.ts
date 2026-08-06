/**
 * Cross-surface action digest — "what needs me today," in one place.
 *
 * THE GAP THIS CLOSES. A producer already sees catalog issues on Home (see
 * `lib/store/readiness.ts` / `SellReadinessPanel`) — but everything else that
 * needs a producer's attention is scattered across three other surfaces they
 * have to remember to check: an "Awaiting stems" / "Needs refund review" badge
 * buried in a /sales row, a pending offer with no count anywhere outside
 * /sales's Offers tab, and a brand-new CRM lead (see `lib/contacts/activity.ts`
 * "favorited" derivation) that only shows up if you happen to sort /contacts
 * by Lead score. None of it is wrong, all of it is invisible unless you go
 * looking on the surface that owns it.
 *
 * This does not replace any of those surfaces — /sales and /contacts stay the
 * real, full views. It just answers "is there anything today?" without a tour
 * of four pages, and links straight to the surface that can actually act on it.
 *
 * Pure and dependency-free, same rule as readiness.ts and activity.ts: logic
 * living in a component can't be unit-tested and gets silently reverted.
 */

export type DigestDomain = 'sales' | 'offers' | 'crm';

export interface DigestItem {
  id: string;
  domain: DigestDomain;
  label: string;
  detail: string;
  href: string;
  /** ISO timestamp, used only for ordering — never displayed directly. */
  occurredAt: string;
}

export interface ActionDigest {
  items: DigestItem[];
  countsByDomain: Record<DigestDomain, number>;
  total: number;
}

/* ── Raw row shapes (subset of what each source API already returns) ─── */

export interface DigestSaleRow {
  id: string;
  item_label: string;
  needs_stems_upload?: boolean | null;
  needs_refund_review?: boolean | null;
  created_at: string;
}

export interface DigestOfferRow {
  id: string;
  track_title: string | null;
  buyer_email: string;
  status: string;
  created_at: string;
}

export interface DigestLeadRow {
  id: string;
  name: string;
  email: string | null;
  created_at: string;
}

/**
 * Build the unified digest from the three already-fetched source arrays.
 *
 * Sorted newest-first within the merged list so the most recent thing that
 * needs attention leads, regardless of which domain it came from — a
 * producer opening this after a few days away shouldn't have to mentally
 * re-sort three separate lists.
 */
export function buildActionDigest(input: {
  sales: DigestSaleRow[];
  offers: DigestOfferRow[];
  leads: DigestLeadRow[];
}): ActionDigest {
  const items: DigestItem[] = [];

  for (const s of input.sales) {
    if (s.needs_stems_upload) {
      items.push({
        id: `sale-stems-${s.id}`,
        domain: 'sales',
        label: 'Awaiting stems',
        detail: s.item_label,
        href: '/sales?status=Needs+stems',
        occurredAt: s.created_at,
      });
    }
    if (s.needs_refund_review) {
      items.push({
        id: `sale-refund-${s.id}`,
        domain: 'sales',
        label: 'Needs refund review',
        detail: s.item_label,
        href: '/sales?status=Needs+refund+review',
        occurredAt: s.created_at,
      });
    }
  }

  for (const o of input.offers) {
    if (o.status !== 'pending') continue;
    items.push({
      id: `offer-${o.id}`,
      domain: 'offers',
      label: 'Pending offer',
      detail: `${o.track_title ?? 'a track'} — ${o.buyer_email}`,
      href: '/sales?view=offers',
      occurredAt: o.created_at,
    });
  }

  for (const l of input.leads) {
    items.push({
      id: `lead-${l.id}`,
      domain: 'crm',
      label: 'New lead',
      detail: l.name || l.email || 'Unknown',
      href: `/contacts/${l.id}`,
      occurredAt: l.created_at,
    });
  }

  items.sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());

  const countsByDomain: Record<DigestDomain, number> = { sales: 0, offers: 0, crm: 0 };
  for (const item of items) countsByDomain[item.domain]++;

  return { items, countsByDomain, total: items.length };
}
