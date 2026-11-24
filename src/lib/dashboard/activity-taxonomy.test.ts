import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_GROUPS, ACTIVITY_KINDS, KIND_GROUP, KIND_ICON, commentItem, contactActivityItem, excerpt, filterByGroup,
  groupByDay, groupCounts, mergeActivity, notificationItem, openedItem, ratingItem, sendItem, uploadItem, versionItem,
  type ActivityItem, type Names,
} from './activity-taxonomy';

const T1 = '30000000-0000-4000-8000-000000000001';
const T2 = '30000000-0000-4000-8000-000000000002';
const C1 = '50000000-0000-4000-8000-000000000001';
const P1 = '40000000-0000-4000-8000-000000000001';
const names: Names = {
  track: (id) => ({ [T1]: 'Night Shift', [T2]: 'Cold Front' } as Record<string, string>)[id ?? ''] ?? null,
  contact: (id) => (id === C1 ? 'Nova' : null),
  project: (id) => (id === P1 ? 'EP One' : null),
};

describe('taxonomy tables are total', () => {
  it('every kind has a group in the four groups and an icon', () => {
    for (const k of ACTIVITY_KINDS) {
      expect(ACTIVITY_GROUPS).toContain(KIND_GROUP[k]);
      expect(KIND_ICON[k]).toBeTruthy();
    }
    expect(ACTIVITY_GROUPS).toHaveLength(4);
  });
});

describe('Music rows', () => {
  it('say which track, and link to it', () => {
    expect(uploadItem({ id: T1, title: 'Night Shift', created_at: '2026-11-01T00:00:00Z' })).toMatchObject({ title: 'Uploaded “Night Shift”', group: 'music', href: `/library/${T1}` });
    expect(versionItem({ id: 'v', track_id: T1, version_label: 'v2', created_at: 'x' }, names).title).toBe('New version v2 of “Night Shift”');
    expect(ratingItem({ id: 'r', track_id: T2, rating: 4, rated_at: 'x' }, names).title).toBe('Rated “Cold Front” 4/5');
  });
});

describe('Sharing rows', () => {
  it('a send names the track(s) and the person, never "status sent"', () => {
    const one = sendItem({ id: 's', contact_id: C1, track_ids: [T1], sent_at: 'x' }, names);
    expect(one.title).toBe('Sent “Night Shift” to Nova');
    expect(one.href).toBe(`/contacts/${C1}`);
    expect(sendItem({ id: 's', contact_id: C1, track_ids: [T1, T2, T2], sent_at: 'x' }, names).title).toBe('Sent “Night Shift” +2 to Nova');
    expect(one.title).not.toMatch(/status/i);
  });
  it('opened is one row per send, with the click folded in, and nothing without an open', () => {
    expect(openedItem({ id: 's', contact_id: C1 }, names)).toBeNull();
    expect(openedItem({ id: 's', contact_id: C1, opened_at: 'a', link_clicked_at: null }, names)?.title).toBe('Nova opened your send');
    expect(openedItem({ id: 's', contact_id: C1, opened_at: 'a', link_clicked_at: 'b' }, names)?.title).toBe('Nova opened your send and clicked the link');
  });
});

describe('Artist rows', () => {
  const row = (kind: string, metadata: Record<string, unknown> = {}) => ({ id: 'a1', contact_id: C1, kind, metadata, occurred_at: '2026-11-02T00:00:00Z' });
  it('an artist reaction names the beat; a producer-set decision is not news', () => {
    expect(contactActivityItem(row('decision_changed', { set_by: 'artist', decision: 'interested', track_id: T1 }), names)).toMatchObject({
      kind: 'artist_reaction', title: 'Nova is interested in “Night Shift”', tone: 'positive', href: `/contacts/${C1}?tab=beats`,
    });
    expect(contactActivityItem(row('decision_changed', { set_by: 'artist', decision: 'passed', track_id: T1 }), names)?.title).toBe('Nova passed on “Night Shift”');
    expect(contactActivityItem(row('decision_changed', { set_by: 'producer', decision: 'selected', track_id: T1 }), names)).toBeNull();
  });
  it('messages, requests and portal uploads link to the right workspace tab and never carry a body', () => {
    expect(contactActivityItem(row('artist_message', { body: 'secret text' }), names)).toMatchObject({ title: 'Nova sent you a message', href: `/contacts/${C1}?tab=messages` });
    expect(contactActivityItem(row('artist_request'), names)?.title).toBe('Nova made a request');
    expect(contactActivityItem(row('artist_request_resolved'), names)?.title).toBe('Request from Nova closed');
    expect(contactActivityItem(row('file_uploaded', { project_id: P1 }), names)).toMatchObject({ title: 'Nova sent a file to “EP One”', href: `/contacts/${C1}?tab=files` });
    expect(JSON.stringify(contactActivityItem(row('artist_message', { body: 'secret text' }), names))).not.toContain('secret');
  });
  it('high-volume and duplicate kinds are excluded', () => {
    for (const k of ['track_played', 'portal_opened', 'track_downloaded', 'file_downloaded', 'artist_notified', 'note', 'stage_change', 'portal_comment', 'share_comment', 'beat_sent', 'favorited', 'purchase']) {
      expect(contactActivityItem(row(k), names), k).toBeNull();
    }
  });
  it('a comment says who, where and a trimmed excerpt; owner comments read "You"', () => {
    const long = 'x'.repeat(200);
    const c = commentItem({ id: 'c', project_id: P1, user_id: null, share_token: 'SECRET-TOKEN', author_name: 'Guest', body: long, created_at: 'x' }, names);
    expect(c.title.startsWith('Guest commented on “EP One”: “')).toBe(true);
    expect(c.title.length).toBeLessThan(120);
    expect(JSON.stringify(c)).not.toContain('SECRET-TOKEN');
    expect(c.meta).toMatchObject({ via: 'share' });
    expect(commentItem({ id: 'c', project_id: P1, user_id: 'me', body: 'hi', created_at: 'x' }, names).title).toContain('You commented');
    expect(commentItem({ id: 'c', project_id: P1, contact_id: C1, body: 'hi', created_at: 'x' }, names)).toMatchObject({ meta: { via: 'portal' } });
  });
});

describe('Sales rows (notifications)', () => {
  const n = (kind: string, title = 'New sale — Night Shift ($29.00)') => ({ id: 'n1', kind, title, data: {}, created_at: 'x' });
  it('only the money and delivery kinds become rows; the duplicates of other streams do not', () => {
    for (const k of ['purchase', 'refund', 'dispute', 'buyer_offer', 'fulfillment_alert']) expect(notificationItem(n(k), { tone: 'neutral', href: '/sales' }), k).not.toBeNull();
    for (const k of ['share_comment', 'portal_comment', 'artist_reaction', 'artist_message', 'artist_request', 'portal_upload', 'task_assigned', 'weird']) {
      expect(notificationItem(n(k), { tone: 'neutral', href: null }), k).toBeNull();
    }
  });
  it('uses the stored title and the presented tone and href, never the body', () => {
    const it = notificationItem({ ...n('purchase'), body: 'From buyer@example.com' } as never, { tone: 'positive', href: '/sales' })!;
    expect(it).toMatchObject({ kind: 'sale', group: 'sales', tone: 'positive', href: '/sales', title: 'New sale — Night Shift ($29.00)' });
    expect(JSON.stringify(it)).not.toContain('@');
  });
});

describe('merge, filter, group', () => {
  const mk = (id: string, at: string, group: ActivityItem['group'] = 'music'): ActivityItem =>
    ({ id, kind: 'upload', group, tone: 'neutral', at, title: id, href: null });
  it('newest first, unique ids, capped', () => {
    const out = mergeActivity([mk('a', '2026-11-01T00:00:00Z'), mk('b', '2026-11-03T00:00:00Z'), mk('a', '2026-11-02T00:00:00Z'), mk('c', '2026-11-02T12:00:00Z')], 3);
    expect(out.map((i) => i.id)).toEqual(['b', 'c', 'a']);
  });
  it('counts and filters by group', () => {
    const items = [mk('a', '1', 'music'), mk('b', '2', 'sales'), mk('c', '3', 'sales')];
    expect(groupCounts(items)).toEqual({ music: 1, sales: 2, artists: 0, sharing: 0 });
    expect(filterByGroup(items, 'sales').map((i) => i.id)).toEqual(['b', 'c']);
    expect(filterByGroup(items, 'all')).toHaveLength(3);
  });
  it('day sections: Today / Yesterday / dated, in the given order', () => {
    const now = Date.parse('2026-11-24T15:00:00Z');
    const s = groupByDay([mk('a', '2026-11-24T10:00:00Z'), mk('b', '2026-11-24T09:00:00Z'), mk('c', '2026-11-23T20:00:00Z'), mk('d', '2026-11-20T08:00:00Z')], now, 'UTC');
    expect(s.map((x) => x.label)).toEqual(['Today', 'Yesterday', 'Fri, Nov 20']);
    expect(s[0].items.map((i) => i.id)).toEqual(['a', 'b']);
  });
  it('excerpt collapses whitespace and cuts with an ellipsis', () => {
    expect(excerpt('  a \n b  ')).toBe('a b');
    expect(excerpt('abcdef', 3)).toBe('abc…');
    expect(excerpt(null)).toBe('');
  });
});
