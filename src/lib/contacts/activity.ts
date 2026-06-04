/**
 * Contact activity timeline — pure builders.
 *
 * The CRM timeline is the merge of three sources:
 *   1. Stored `contact_activity` rows (manual notes, stage changes, and
 *      system events the webhooks already logged).
 *   2. Derived events from `beat_sends` (sent / opened / link-clicked) — so
 *      the timeline is correct even for sends that predate activity logging.
 *   3. Derived events from `license_purchases` matched by buyer email — the
 *      buyer→contact link, surfaced as a "Bought X" event.
 *
 * Everything here is pure (no IO) so the merge/dedupe/sort logic is unit
 * tested in isolation — the route just feeds it rows. This is the
 * `filterAndSortTracks` template applied to the CRM.
 */

export type ActivityKind =
  | 'beat_sent'
  | 'email_opened'
  | 'link_clicked'
  | 'track_played'
  | 'purchase'
  | 'note'
  | 'stage_change';

export interface ContactActivity {
  id: string;
  kind: ActivityKind;
  title: string;
  body?: string | null;
  metadata?: Record<string, unknown>;
  /** ISO timestamp. */
  occurredAt: string;
  /** True when synthesized from beat_sends/purchases (not a stored row). */
  derived?: boolean;
}

/* ── Raw row shapes (subset of DB columns the builders need) ─────────── */

export interface StoredActivityRow {
  id: string;
  kind: string;
  title: string;
  body?: string | null;
  metadata?: Record<string, unknown> | null;
  occurred_at: string;
}

export interface BeatSendRow {
  id: string;
  track_ids?: string[] | null;
  sent_at?: string | null;
  opened_at?: string | null;
  link_clicked_at?: string | null;
  message?: string | null;
}

export interface PurchaseRow {
  id: string;
  track_ids?: string[] | null;
  license_type?: string | null;
  amount_usd?: number | null;
  created_at?: string | null;
  stripe_session_id?: string | null;
}

/* ── Helpers ─────────────────────────────────────────────────────────── */

function titlesFor(ids: string[] | null | undefined, titleMap: Record<string, string>): string {
  const list = (ids ?? []).map((id) => titleMap[id]).filter(Boolean);
  if (list.length === 0) return 'a track';
  if (list.length === 1) return list[0];
  if (list.length === 2) return `${list[0]} + ${list[1]}`;
  return `${list[0]} + ${list.length - 1} more`;
}

function fmtMoney(n: number | null | undefined): string {
  if (n == null) return '';
  return `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

/* ── Derivers ────────────────────────────────────────────────────────── */

/** beat_sends → up to 3 events each (sent, opened, link-clicked). */
export function activityFromBeatSends(
  sends: BeatSendRow[],
  titleMap: Record<string, string>,
): ContactActivity[] {
  const out: ContactActivity[] = [];
  for (const s of sends) {
    const what = titlesFor(s.track_ids, titleMap);
    if (s.sent_at) {
      out.push({
        id: `bs-sent-${s.id}`,
        kind: 'beat_sent',
        title: `Sent ${what}`,
        body: s.message ?? null,
        metadata: { beat_send_id: s.id, track_ids: s.track_ids ?? [] },
        occurredAt: s.sent_at,
        derived: true,
      });
    }
    if (s.opened_at) {
      out.push({
        id: `bs-open-${s.id}`,
        kind: 'email_opened',
        title: `Opened the email`,
        metadata: { beat_send_id: s.id },
        occurredAt: s.opened_at,
        derived: true,
      });
    }
    if (s.link_clicked_at) {
      out.push({
        id: `bs-click-${s.id}`,
        kind: 'link_clicked',
        title: `Clicked the beat link`,
        metadata: { beat_send_id: s.id },
        occurredAt: s.link_clicked_at,
        derived: true,
      });
    }
  }
  return out;
}

/** license_purchases (matched by buyer email) → one "Bought X" event each. */
export function activityFromPurchases(
  purchases: PurchaseRow[],
  titleMap: Record<string, string>,
): ContactActivity[] {
  return purchases
    .filter((p) => p.created_at)
    .map((p) => {
      const what = titlesFor(p.track_ids, titleMap);
      const lic = p.license_type === 'exclusive' ? 'Exclusive' : 'Lease';
      const amt = fmtMoney(p.amount_usd);
      return {
        id: `pur-${p.id}`,
        kind: 'purchase' as const,
        title: `Bought ${what}${amt ? ` — ${amt}` : ''}`,
        body: `${lic} license`,
        metadata: {
          purchase_id: p.id,
          track_ids: p.track_ids ?? [],
          amount_usd: p.amount_usd ?? null,
          stripe_session_id: p.stripe_session_id ?? null,
        },
        occurredAt: p.created_at as string,
        derived: true,
      };
    });
}

/** Stored rows → ContactActivity (kind validated loosely; unknowns kept as note). */
export function activityFromStored(rows: StoredActivityRow[]): ContactActivity[] {
  const known: ActivityKind[] = [
    'beat_sent', 'email_opened', 'link_clicked', 'track_played', 'purchase', 'note', 'stage_change',
  ];
  return rows.map((r) => ({
    id: r.id,
    kind: (known.includes(r.kind as ActivityKind) ? r.kind : 'note') as ActivityKind,
    title: r.title,
    body: r.body ?? null,
    metadata: r.metadata ?? {},
    occurredAt: r.occurred_at,
    derived: false,
  }));
}

/* ── Merge ───────────────────────────────────────────────────────────── */

/**
 * Build the full timeline: merge stored + derived, drop derived events that a
 * stored row already represents (same dedupe_key), and sort newest-first.
 *
 * Stored rows win over derived ones — once the webhook logs a purchase, the
 * derived purchase for the same stripe_session_id is suppressed so it shows
 * once. Dedupe key per source:
 *   purchase    → stripe_session_id (or purchase_id)
 *   beat_sent   → beat_send_id
 *   email_opened/link_clicked → beat_send_id + kind
 */
export function buildContactTimeline(params: {
  stored: StoredActivityRow[];
  beatSends: BeatSendRow[];
  purchases: PurchaseRow[];
  titleMap: Record<string, string>;
}): ContactActivity[] {
  const stored = activityFromStored(params.stored);
  const derived = [
    ...activityFromBeatSends(params.beatSends, params.titleMap),
    ...activityFromPurchases(params.purchases, params.titleMap),
  ];

  // Index of dedupe keys already present in stored rows.
  const storedKeys = new Set<string>();
  for (const s of stored) {
    const k = dedupeKey(s);
    if (k) storedKeys.add(k);
  }

  const merged = [
    ...stored,
    ...derived.filter((d) => {
      const k = dedupeKey(d);
      return !k || !storedKeys.has(k);
    }),
  ];

  return merged.sort(
    (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
  );
}

/** Stable key used to suppress a derived event the stored row already covers. */
export function dedupeKey(a: ContactActivity): string | null {
  const m = a.metadata ?? {};
  switch (a.kind) {
    case 'purchase':
      return `purchase:${(m.stripe_session_id as string) ?? (m.purchase_id as string) ?? ''}`;
    case 'beat_sent':
      return m.beat_send_id ? `beat_sent:${m.beat_send_id}` : null;
    case 'email_opened':
      return m.beat_send_id ? `email_opened:${m.beat_send_id}` : null;
    case 'link_clicked':
      return m.beat_send_id ? `link_clicked:${m.beat_send_id}` : null;
    default:
      return null;
  }
}

/* ── Engagement summary (feeds the header + lead scoring later) ───────── */

export interface EngagementSummary {
  sends: number;
  opens: number;
  clicks: number;
  plays: number;
  purchases: number;
  revenue: number;
  lastTouch: string | null;
}

export function summarizeEngagement(timeline: ContactActivity[]): EngagementSummary {
  const s: EngagementSummary = {
    sends: 0, opens: 0, clicks: 0, plays: 0, purchases: 0, revenue: 0, lastTouch: null,
  };
  for (const a of timeline) {
    switch (a.kind) {
      case 'beat_sent': s.sends++; break;
      case 'email_opened': s.opens++; break;
      case 'link_clicked': s.clicks++; break;
      case 'track_played': s.plays++; break;
      case 'purchase':
        s.purchases++;
        s.revenue += Number((a.metadata?.amount_usd as number) ?? 0) || 0;
        break;
    }
  }
  s.lastTouch = timeline[0]?.occurredAt ?? null;
  return s;
}
