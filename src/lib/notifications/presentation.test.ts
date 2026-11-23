import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  PRODUCER_NOTIFICATION_KINDS,
  disputeOutcome,
  formatFullTimestamp,
  formatRelativeTime,
  formatUsd,
  presentNotification,
} from './presentation';
import { ARTIST_REACTION_KIND } from './artist-reaction';
import { PORTAL_COMMENT_KIND } from '@/lib/artist-portal/comments';
import { PORTAL_UPLOAD_NOTIFICATION } from '@/lib/artist-portal/uploads';
import { ARTIST_MESSAGE_NOTIFICATION, ARTIST_REQUEST_NOTIFICATION } from '@/lib/artist-messages/messages';

const C = '11111111-1111-4111-8111-111111111111';
const P = '22222222-2222-4222-8222-222222222222';

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.ts$/.test(e.name) && !/\.test\.ts$/.test(e.name)) out.push(p);
  }
  return out;
}

describe('every producer writer kind is presented', () => {
  it('covers the kinds the writers insert', () => {
    const root = path.resolve(__dirname, '..', '..');
    const found = new Set<string>();
    for (const f of walk(root)) {
      if (f.includes(`${path.sep}labelos${path.sep}`) || f.includes(`${path.sep}portal${path.sep}`)) continue; // portal routes build rows through the constants below
      const src = fs.readFileSync(f, 'utf8');
      if (!src.includes('notifications')) continue;
      for (const m of src.matchAll(/kind:\s*'([a-z_]+)',\s*\n\s*title:/g)) found.add(m[1]);
    }
    // the literal-kind writers (webhook, offer, cron, mp3 alert, share comment) plus the exported constants
    for (const k of [ARTIST_REACTION_KIND, PORTAL_COMMENT_KIND, PORTAL_UPLOAD_NOTIFICATION, ARTIST_MESSAGE_NOTIFICATION, ARTIST_REQUEST_NOTIFICATION]) found.add(k);
    expect(found.size).toBeGreaterThanOrEqual(9);
    for (const k of found) expect(PRODUCER_NOTIFICATION_KINDS as readonly string[], `kind "${k}" has no presentation`).toContain(k);
  });

  it('is total: a real icon and label for every kind, only the bell for unknown ones', () => {
    for (const kind of PRODUCER_NOTIFICATION_KINDS) {
      const p = presentNotification({ kind, data: {} });
      expect(p.icon).not.toBe('bell');
      expect(p.label).not.toBe('Notice');
    }
    expect(presentNotification({ kind: 'mystery' })).toMatchObject({ icon: 'bell', href: null });
  });
});

describe('tone', () => {
  it('purchase and Interested are positive; passed is not', () => {
    expect(presentNotification({ kind: 'purchase' }).tone).toBe('positive');
    expect(presentNotification({ kind: 'artist_reaction', data: { decision: 'interested' } }).tone).toBe('positive');
    expect(presentNotification({ kind: 'artist_reaction', data: { decision: 'passed' } }).tone).toBe('neutral');
  });
  it('full refund is red, partial refund is warning', () => {
    expect(presentNotification({ kind: 'refund', data: { amount_usd: 5 } }).tone).toBe('danger');
    expect(presentNotification({ kind: 'refund', data: { outcome: 'partial' } }).tone).toBe('warning');
    expect(presentNotification({ kind: 'refund', data: { amount_refunded: 100 } }).tone).toBe('warning');
  });
  it('dispute: new and lost red, won and inquiry closed positive', () => {
    expect(presentNotification({ kind: 'dispute', data: { amount_usd: 5 } }).tone).toBe('danger');
    expect(disputeOutcome({ kind: 'dispute', data: { dispute_status: 'won' } })).toBe('won');
    expect(presentNotification({ kind: 'dispute', data: { dispute_status: 'won' } }).tone).toBe('positive');
    expect(presentNotification({ kind: 'dispute', data: { dispute_status: 'warning_closed' } }).tone).toBe('positive');
    expect(presentNotification({ kind: 'dispute', data: { dispute_status: 'lost' } }).tone).toBe('danger');
    expect(presentNotification({ kind: 'dispute', data: { outcome: 'won', dispute_status: 'lost' } }).tone).toBe('positive');
  });
  it('fulfilment alert is warning with its own icon', () => {
    expect(presentNotification({ kind: 'fulfillment_alert' })).toMatchObject({ tone: 'warning', icon: 'package-x' });
  });
});

describe('href', () => {
  it('sales kinds open /sales; offers open the offers view', () => {
    for (const kind of ['purchase', 'refund', 'dispute']) expect(presentNotification({ kind }).href).toBe('/sales');
    expect(presentNotification({ kind: 'buyer_offer' }).href).toBe('/sales?view=offers');
  });
  it('artist kinds open the matching workspace tab', () => {
    const d = { contact_id: C, project_id: P };
    expect(presentNotification({ kind: 'portal_comment', data: d }).href).toBe(`/contacts/${C}?tab=activity`);
    expect(presentNotification({ kind: 'artist_message', data: d }).href).toBe(`/contacts/${C}?tab=messages`);
    expect(presentNotification({ kind: 'artist_request', data: d }).href).toBe(`/contacts/${C}?tab=messages`);
    expect(presentNotification({ kind: 'portal_upload', data: d }).href).toBe(`/contacts/${C}?tab=files`);
    expect(presentNotification({ kind: 'artist_reaction', data: d }).href).toBe(`/contacts/${C}?tab=beats`);
  });
  it('falls back to the project, then to no link; never trusts a non-uuid', () => {
    expect(presentNotification({ kind: 'portal_comment', data: { project_id: P } }).href).toBe(`/projects/${P}`);
    expect(presentNotification({ kind: 'share_comment', data: { project_id: P } }).href).toBe(`/projects/${P}`);
    expect(presentNotification({ kind: 'share_comment', data: { project_id: '../x' } }).href).toBeNull();
    expect(presentNotification({ kind: 'artist_message', data: { contact_id: 'nope' } }).href).toBeNull();
    expect(presentNotification({ kind: 'artist_message', data: null }).href).toBeNull();
  });
});

describe('formatting', () => {
  it('money', () => {
    expect(formatUsd(1234.5)).toBe('$1,234.50');
    expect(formatUsd('25')).toBe('$25.00');
    expect(formatUsd(null)).toBe('$0.00');
    expect(formatUsd(NaN)).toBe('$0.00');
  });
  it('relative time', () => {
    const now = Date.parse('2026-11-23T12:00:00Z');
    const ago = (ms: number) => new Date(now - ms).toISOString();
    expect(formatRelativeTime(ago(10_000), now)).toBe('just now');
    expect(formatRelativeTime(ago(-5 * 60_000), now)).toBe('just now');
    expect(formatRelativeTime(ago(5 * 60_000), now)).toBe('5m ago');
    expect(formatRelativeTime(ago(3 * 3600_000), now)).toBe('3h ago');
    expect(formatRelativeTime(ago(6 * 86400_000), now)).toBe('6d ago');
    expect(formatRelativeTime(ago(10 * 86400_000), now)).toBe('Nov 13');
    expect(formatRelativeTime('2025-03-02T12:00:00Z', now)).toBe('Mar 2, 2025');
    expect(formatRelativeTime('garbage', now)).toBe('');
    expect(formatFullTimestamp('2026-11-23T12:00:00Z')).toContain('2026');
  });
});
