import { describe, it, expect } from 'vitest';
import {
  activityFromBeatSends,
  activityFromPurchases,
  buildContactTimeline,
  summarizeEngagement,
  dedupeKey,
  type StoredActivityRow,
  type BeatSendRow,
  type PurchaseRow,
} from './activity';

const titleMap = { t1: 'Yeat Synth', t2: 'Word Without You', t3: 'Found Me' };

describe('activityFromBeatSends', () => {
  it('emits sent/opened/clicked events when timestamps are present', () => {
    const sends: BeatSendRow[] = [{
      id: 'bs1', track_ids: ['t1'],
      sent_at: '2026-01-01T10:00:00Z',
      opened_at: '2026-01-01T11:00:00Z',
      link_clicked_at: '2026-01-01T12:00:00Z',
      message: 'check this',
    }];
    const out = activityFromBeatSends(sends, titleMap);
    expect(out.map((a) => a.kind)).toEqual(['beat_sent', 'email_opened', 'link_clicked']);
    expect(out[0].title).toBe('Sent Yeat Synth');
    expect(out[0].body).toBe('check this');
  });

  it('omits opened/clicked events when those timestamps are null', () => {
    const out = activityFromBeatSends(
      [{ id: 'bs1', track_ids: ['t1'], sent_at: '2026-01-01T10:00:00Z', opened_at: null, link_clicked_at: null }],
      titleMap,
    );
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('beat_sent');
  });

  it('summarizes multiple track titles', () => {
    const out = activityFromBeatSends(
      [{ id: 'bs1', track_ids: ['t1', 't2', 't3'], sent_at: '2026-01-01T10:00:00Z' }],
      titleMap,
    );
    expect(out[0].title).toBe('Sent Yeat Synth + 2 more');
  });
});

describe('activityFromPurchases', () => {
  it('formats a purchase with license + amount', () => {
    const purchases: PurchaseRow[] = [{
      id: 'p1', track_ids: ['t1'], license_type: 'exclusive', amount_usd: 130,
      created_at: '2026-02-01T10:00:00Z', stripe_session_id: 'cs_1',
    }];
    const out = activityFromPurchases(purchases, titleMap);
    expect(out[0].kind).toBe('purchase');
    expect(out[0].title).toBe('Bought Yeat Synth — $130');
    expect(out[0].body).toBe('Exclusive license');
    expect(out[0].metadata?.stripe_session_id).toBe('cs_1');
  });

  it('skips purchases with no created_at', () => {
    const out = activityFromPurchases([{ id: 'p1', track_ids: ['t1'], created_at: null }], titleMap);
    expect(out).toHaveLength(0);
  });
});

describe('buildContactTimeline', () => {
  it('merges stored + derived and sorts newest-first', () => {
    const stored: StoredActivityRow[] = [
      { id: 'n1', kind: 'note', title: 'Met at a session', occurred_at: '2026-01-15T10:00:00Z', metadata: {} },
    ];
    const beatSends: BeatSendRow[] = [
      { id: 'bs1', track_ids: ['t1'], sent_at: '2026-01-10T10:00:00Z' },
    ];
    const purchases: PurchaseRow[] = [
      { id: 'p1', track_ids: ['t1'], license_type: 'lease', amount_usd: 50, created_at: '2026-02-01T10:00:00Z', stripe_session_id: 'cs_1' },
    ];
    const tl = buildContactTimeline({ stored, beatSends, purchases, titleMap });
    expect(tl.map((a) => a.kind)).toEqual(['purchase', 'note', 'beat_sent']);
    // newest first
    expect(new Date(tl[0].occurredAt).getTime()).toBeGreaterThan(new Date(tl[1].occurredAt).getTime());
  });

  it('suppresses a derived purchase already represented by a stored row', () => {
    const stored: StoredActivityRow[] = [
      {
        id: 'a1', kind: 'purchase', title: 'Bought Yeat Synth — $130',
        occurred_at: '2026-02-01T10:00:00Z',
        metadata: { stripe_session_id: 'cs_1', dedupe_key: 'whatever' },
      },
    ];
    const purchases: PurchaseRow[] = [
      { id: 'p1', track_ids: ['t1'], license_type: 'exclusive', amount_usd: 130, created_at: '2026-02-01T10:00:00Z', stripe_session_id: 'cs_1' },
    ];
    const tl = buildContactTimeline({ stored, beatSends: [], purchases, titleMap });
    // Only the stored one survives — no duplicate.
    expect(tl.filter((a) => a.kind === 'purchase')).toHaveLength(1);
    expect(tl[0].derived).toBe(false);
  });

  it('keeps a derived beat_sent when no stored row covers it', () => {
    const tl = buildContactTimeline({
      stored: [],
      beatSends: [{ id: 'bs1', track_ids: ['t1'], sent_at: '2026-01-10T10:00:00Z' }],
      purchases: [],
      titleMap,
    });
    expect(tl).toHaveLength(1);
    expect(tl[0].derived).toBe(true);
  });
});

describe('dedupeKey', () => {
  it('keys purchases by stripe_session_id', () => {
    expect(dedupeKey({ id: 'x', kind: 'purchase', title: '', occurredAt: '', metadata: { stripe_session_id: 'cs_9' } }))
      .toBe('purchase:cs_9');
  });
  it('returns null for notes', () => {
    expect(dedupeKey({ id: 'x', kind: 'note', title: '', occurredAt: '', metadata: {} })).toBeNull();
  });
});

describe('summarizeEngagement', () => {
  it('counts events and sums revenue', () => {
    const tl = buildContactTimeline({
      stored: [],
      beatSends: [{ id: 'bs1', track_ids: ['t1'], sent_at: '2026-01-10T10:00:00Z', opened_at: '2026-01-10T11:00:00Z' }],
      purchases: [
        { id: 'p1', track_ids: ['t1'], license_type: 'lease', amount_usd: 50, created_at: '2026-02-01T10:00:00Z', stripe_session_id: 'cs_1' },
        { id: 'p2', track_ids: ['t2'], license_type: 'exclusive', amount_usd: 130, created_at: '2026-02-05T10:00:00Z', stripe_session_id: 'cs_2' },
      ],
      titleMap,
    });
    const s = summarizeEngagement(tl);
    expect(s.sends).toBe(1);
    expect(s.opens).toBe(1);
    expect(s.purchases).toBe(2);
    expect(s.revenue).toBe(180);
    expect(s.lastTouch).toBe('2026-02-05T10:00:00Z'); // newest
  });
});
