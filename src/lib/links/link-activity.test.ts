import { describe, expect, it } from 'vitest';
import { agoLabel, summarizeLinkActivity, type ShareEventRow } from './link-activity';

const ev = (kind: ShareEventRow['kind'], ip: string | null, at: string): ShareEventRow => ({ kind, ip_hash: ip, created_at: at });

describe('summarizeLinkActivity', () => {
  it('counts people, plays, downloads and last activity; opens is the link counter', () => {
    const a = summarizeLinkActivity({
      link: { plays: 5, created_at: '2026-11-01T00:00:00Z' },
      events: [
        ev('open', 'a', '2026-11-23T10:00:00Z'),
        ev('open', 'b', '2026-11-23T11:00:00Z'),
        ev('play', 'a', '2026-11-23T10:01:00Z'),
        ev('play', 'a', '2026-11-23T10:02:00Z'),
        ev('download', 'b', '2026-11-23T11:05:00Z'),
        ev('download_all', 'c', '2026-11-23T12:00:00Z'),
      ],
      sends: [{ contact_id: 'c1', sent_at: '2026-11-02T00:00:00Z' }, { contact_id: null, sent_at: '2026-11-03T00:00:00Z' }],
    });
    expect(a).toMatchObject({ sends: 2, opens: 5, people: 3, plays: 2, downloads: 2, lastActivityAt: '2026-11-23T12:00:00.000Z' });
  });

  it('says "since" when the link is older than its first event, and not otherwise', () => {
    const events = [ev('open', 'a', '2026-11-23T10:00:00Z')];
    expect(summarizeLinkActivity({ link: { plays: 40, created_at: '2026-10-01T00:00:00Z' }, events, sends: [] }).since).toBe(
      '2026-11-23T10:00:00.000Z',
    );
    expect(summarizeLinkActivity({ link: { plays: 1, created_at: '2026-11-23T09:30:00Z' }, events, sends: [] }).since).toBeNull();
    expect(summarizeLinkActivity({ link: { plays: 40, created_at: '2026-10-01T00:00:00Z' }, events: [], sends: [] }).since).toBeNull();
  });

  it('is empty and safe with nothing recorded', () => {
    expect(summarizeLinkActivity({ link: { plays: null, created_at: 'x' }, events: [], sends: [] })).toEqual({
      sends: 0, opens: 0, people: 0, plays: 0, downloads: 0, lastActivityAt: null, since: null, contacts: [],
    });
  });

  it('folds an email open / click into last activity and rolls sends up per contact', () => {
    const a = summarizeLinkActivity({
      link: { plays: 0, created_at: '2026-11-01T00:00:00Z' },
      events: [ev('open', 'a', '2026-11-05T00:00:00Z')],
      sends: [
        { contact_id: 'c1', sent_at: '2026-11-01T00:00:00Z', opened_at: '2026-11-09T00:00:00Z' },
        { contact_id: 'c1', sent_at: '2026-11-03T00:00:00Z', link_clicked_at: '2026-11-04T00:00:00Z' },
        { contact_id: 'c2', sent_at: '2026-11-08T00:00:00Z' },
      ],
    });
    expect(a.lastActivityAt).toBe('2026-11-09T00:00:00.000Z');
    expect(a.contacts).toEqual([
      { contactId: 'c2', sends: 1, emailOpened: false, linkClicked: false, lastSentAt: '2026-11-08T00:00:00Z' },
      { contactId: 'c1', sends: 2, emailOpened: true, linkClicked: true, lastSentAt: '2026-11-03T00:00:00Z' },
    ]);
  });
});

describe('agoLabel', () => {
  const now = Date.parse('2026-11-23T12:00:00Z');
  it('reads minutes, hours, days', () => {
    expect(agoLabel('2026-11-23T11:59:50Z', now)).toBe('just now');
    expect(agoLabel('2026-11-23T11:30:00Z', now)).toBe('30m ago');
    expect(agoLabel('2026-11-23T10:00:00Z', now)).toBe('2h ago');
    expect(agoLabel('2026-11-18T12:00:00Z', now)).toBe('5d ago');
    expect(agoLabel(null, now)).toBeNull();
  });
});
