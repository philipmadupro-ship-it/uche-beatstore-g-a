import { describe, expect, it } from 'vitest';
import {
  agoLabel,
  describeEarlierSend,
  findDuplicateSends,
  priorSendTrackIds,
  recipientKey,
  type PriorSend,
} from './duplicate-sends';

const NOW = Date.parse('2026-11-24T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();
const send = (o: Partial<PriorSend> & { sent_at: string }): PriorSend => ({
  contact_id: 'c1',
  track_ids: ['t1'],
  share_token: 'tok',
  ...o,
});
const find = (over: Partial<Parameters<typeof findDuplicateSends>[0]> = {}) =>
  findDuplicateSends({
    recipients: [{ key: 'c1', contactId: 'c1' }],
    newTrackIds: ['t1', 't2'],
    priorSends: [],
    now: NOW,
    ...over,
  });

describe('recipientKey', () => {
  it('prefers the contact id and otherwise normalises the email', () => {
    expect(recipientKey({ contact_id: 'c1', email: 'A@B.com' })).toBe('c1');
    expect(recipientKey({ email: '  Nova@Example.COM ' })).toBe('nova@example.com');
    expect(recipientKey({})).toBeNull();
  });
});

describe('findDuplicateSends', () => {
  it('flags an earlier send that shares a track, listing only the overlap', () => {
    const [e] = find({ priorSends: [send({ sent_at: daysAgo(3), track_ids: ['t1', 't9'] })] });
    expect(e.overlappingTrackIds).toEqual(['t1']);
    expect(e.lastSentAt).toBe(daysAgo(3));
  });

  it('is quiet with no overlap, no history, or an outside window', () => {
    expect(find({ priorSends: [send({ sent_at: daysAgo(2), track_ids: ['t9'] })] })).toEqual([]);
    expect(find()).toEqual([]);
    expect(find({ priorSends: [send({ sent_at: daysAgo(91) })] })).toEqual([]);
    expect(find({ priorSends: [send({ sent_at: daysAgo(89) })] })).toHaveLength(1);
  });

  it('ignores other contacts, future dates and bad dates', () => {
    expect(find({ priorSends: [send({ sent_at: daysAgo(2), contact_id: 'c2' })] })).toEqual([]);
    expect(find({ priorSends: [send({ sent_at: new Date(NOW + 86_400_000).toISOString() })] })).toEqual([]);
    expect(find({ priorSends: [send({ sent_at: 'nope' })] })).toEqual([]);
  });

  it('merges overlaps across sends and reports the most recent one', () => {
    const [e] = find({
      priorSends: [
        send({ sent_at: daysAgo(30), track_ids: ['t2'], share_token: 'old' }),
        send({ sent_at: daysAgo(5), track_ids: ['t1'], share_token: 'new', opened_at: daysAgo(5) }),
      ],
    });
    expect(e.overlappingTrackIds).toEqual(['t1', 't2']);
    expect(e.lastSentAt).toBe(daysAgo(5));
    expect(e.shareToken).toBe('new');
    expect(e.outcome.emailOpened).toBe(true);
  });

  it('an earlier PROJECT send covers the project\'s current tracks (added after it was sent)', () => {
    const projectTracksByToken = new Map([['proj', ['t1', 't2', 't3']]]);
    const [e] = find({
      newTrackIds: ['t3'],
      priorSends: [send({ sent_at: daysAgo(10), track_ids: ['t1'], share_token: 'proj' })],
      projectTracksByToken,
    });
    expect(e.overlappingTrackIds).toEqual(['t3']);
  });

  it('a project being sent now counts as its tracks against earlier track sends', () => {
    const [e] = find({
      newTrackIds: ['t1', 't2', 't3'], // the route expands project_id to these
      priorSends: [send({ sent_at: daysAgo(1), track_ids: ['t3'] })],
    });
    expect(e.overlappingTrackIds).toEqual(['t3']);
  });

  it('one entry per recipient key, in the new send order, deduplicated', () => {
    const out = find({
      recipients: [
        { key: 'c1', contactId: 'c1' },
        { key: 'c1', contactId: 'c1' },
        { key: 'nova@x.com', contactId: 'c1' },
        { key: 'nobody@x.com', contactId: null },
      ],
      newTrackIds: ['t2', 't1', 't1'],
      priorSends: [send({ sent_at: daysAgo(2), track_ids: ['t1', 't2'] })],
    });
    expect(out.map((e) => e.key)).toEqual(['c1', 'nova@x.com']);
    expect(out[0].overlappingTrackIds).toEqual(['t2', 't1']);
  });

  it('claims no activity unless share_events was readable', () => {
    const base = { priorSends: [send({ sent_at: daysAgo(2) })] };
    expect(find(base)[0].outcome.activity).toBeNull();
    expect(find({ ...base, activityByToken: new Map([['tok', { opens: 2, plays: 2, downloads: 1 }]]) })[0].outcome.activity).toEqual({
      opens: 2,
      plays: 2,
      downloads: 1,
    });
    expect(find({ ...base, activityByToken: new Map() })[0].outcome.activity).toEqual({ opens: 0, plays: 0, downloads: 0 });
  });

  it('nothing to send means nothing to warn about', () => {
    expect(find({ newTrackIds: [], priorSends: [send({ sent_at: daysAgo(2) })] })).toEqual([]);
  });
});

describe('priorSendTrackIds', () => {
  it('unions track_ids with the project tracks and tolerates nulls', () => {
    const m = new Map([['p', ['b', 'c']]]);
    expect(priorSendTrackIds({ contact_id: 'c', track_ids: ['a', 'b'], share_token: 'p', sent_at: '' }, m).sort()).toEqual(['a', 'b', 'c']);
    expect(priorSendTrackIds({ contact_id: 'c', track_ids: null, share_token: null, sent_at: '' })).toEqual([]);
  });
});

describe('wording', () => {
  it('agoLabel', () => {
    expect(agoLabel(daysAgo(0), NOW)).toBe('today');
    expect(agoLabel(daysAgo(1), NOW)).toBe('yesterday');
    expect(agoLabel(daysAgo(3), NOW)).toBe('3 days ago');
    expect(agoLabel(daysAgo(35), NOW)).toBe('5 weeks ago');
    expect(agoLabel('bad', NOW)).toBe('');
  });

  it('describes opened / played / downloaded, and stays silent when nothing is known', () => {
    const at = daysAgo(3);
    expect(
      describeEarlierSend({ lastSentAt: at, outcome: { emailOpened: true, linkClicked: false, activity: { opens: 1, plays: 2, downloads: 0 } } }, NOW),
    ).toBe('3 days ago · opened · played 2×');
    expect(
      describeEarlierSend({ lastSentAt: at, outcome: { emailOpened: false, linkClicked: false, activity: { opens: 1, plays: 0, downloads: 1 } } }, NOW),
    ).toBe('3 days ago · opened · downloaded');
    expect(describeEarlierSend({ lastSentAt: at, outcome: { emailOpened: false, linkClicked: true, activity: null } }, NOW)).toBe('3 days ago · opened');
    expect(describeEarlierSend({ lastSentAt: at, outcome: { emailOpened: false, linkClicked: false, activity: null } }, NOW)).toBe('3 days ago');
  });
});

import { planRecipientSend, recipientRefFor } from './duplicate-sends';

describe('recipientRefFor', () => {
  it('saved contacts by id, typed addresses by email', () => {
    expect(recipientRefFor({ id: 'c1', email: 'a@b.com' })).toEqual({ contact_id: 'c1' });
    expect(recipientRefFor({ id: 'adhoc:new@x.com', email: 'new@x.com' })).toEqual({ email: 'new@x.com' });
  });
});

describe('planRecipientSend', () => {
  const none = { removed: {}, skipped: new Set<string>() };
  const dups = new Set(['c1']);

  it('sends everything to a recipient who is not a duplicate, whatever was chosen', () => {
    const choices = { removed: { c2: ['t1'] }, skipped: new Set(['c2']) };
    expect(planRecipientSend('c2', ['t1', 't2'], choices, dups)).toEqual({ skip: false, trackIds: ['t1', 't2'], trimmed: false });
  });

  it('drops the removed tracks for that recipient only', () => {
    expect(planRecipientSend('c1', ['t1', 't2'], { ...none, removed: { c1: ['t1'] } }, dups)).toEqual({ skip: false, trackIds: ['t2'], trimmed: true });
  });

  it('skips a recipient who is skipped or left with nothing', () => {
    expect(planRecipientSend('c1', ['t1'], { ...none, skipped: new Set(['c1']) }, dups).skip).toBe(true);
    expect(planRecipientSend('c1', ['t1'], { ...none, removed: { c1: ['t1'] } }, dups).skip).toBe(true);
  });

  it('a stale choice is ignored once the check no longer reports the recipient', () => {
    expect(planRecipientSend('c1', ['t9'], { ...none, skipped: new Set(['c1']) }, new Set()).skip).toBe(false);
  });

  it('a project send cannot drop tracks, only skip', () => {
    expect(planRecipientSend('c1', [], { ...none, removed: { c1: ['t1'] } }, dups, false)).toEqual({ skip: false, trackIds: [], trimmed: false });
    expect(planRecipientSend('c1', [], { ...none, skipped: new Set(['c1']) }, dups, false).skip).toBe(true);
  });
});
