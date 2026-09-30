import { describe, expect, it } from 'vitest';
import {
  buildArtistMessageNotification,
  buildMessageEmail,
  openRequests,
  requestStatusPatch,
  shouldEmailMessage,
  toArtistMessage,
  unreadFrom,
  type MessageRow,
} from './messages';

const row = (over: Partial<MessageRow> = {}): MessageRow => ({
  id: 'm1',
  contact_id: 'c1',
  project_id: null,
  author: 'artist',
  kind: 'message',
  body: 'hello',
  request_status: null,
  resolved_at: null,
  read_at: null,
  emailed_at: '2026-09-29T10:00:00Z',
  created_at: '2026-09-29T09:00:00Z',
  ...over,
});
const names = { artistName: 'Nova', producerName: 'U2C' };

describe('toArtistMessage', () => {
  it('never gives the portal the contact id or the email stamp', () => {
    const m = toArtistMessage(row({ author: 'producer' }), { audience: 'portal', ...names });
    expect(m).not.toHaveProperty('emailedAt');
    expect(JSON.stringify(m)).not.toContain('c1');
    expect(m.authorName).toBe('U2C');
  });
  it('shows the producer when an email went out', () => {
    expect(toArtistMessage(row(), { audience: 'producer', ...names }).emailedAt).toBe('2026-09-29T10:00:00Z');
  });
  it('reads an unknown request status as open and names the project', () => {
    const m = toArtistMessage(row({ kind: 'request', request_status: 'weird', project_id: 'p1' }), {
      audience: 'portal', ...names, projectNames: new Map([['p1', 'Tape']]),
    });
    expect(m.requestStatus).toBe('open');
    expect(m.projectName).toBe('Tape');
  });
  it('a producer row is never a request', () => {
    const m = toArtistMessage(row({ author: 'producer', kind: 'request', request_status: 'open' }), { audience: 'producer', ...names });
    expect(m.kind).toBe('message');
    expect(m.requestStatus).toBeNull();
  });
});

describe('counts', () => {
  const list = [
    toArtistMessage(row({ id: 'a' }), { audience: 'producer', ...names }),
    toArtistMessage(row({ id: 'b', read_at: '2026-09-29T11:00:00Z' }), { audience: 'producer', ...names }),
    toArtistMessage(row({ id: 'c', author: 'producer' }), { audience: 'producer', ...names }),
    toArtistMessage(row({ id: 'd', kind: 'request', request_status: 'open' }), { audience: 'producer', ...names }),
    toArtistMessage(row({ id: 'e', kind: 'request', request_status: 'done' }), { audience: 'producer', ...names }),
  ];
  it('counts unread per author', () => {
    expect(unreadFrom(list, 'artist')).toBe(3);
    expect(unreadFrom(list, 'producer')).toBe(1);
  });
  it('lists only open requests', () => {
    expect(openRequests(list).map((m) => m.id)).toEqual(['d']);
  });
});

describe('requestStatusPatch', () => {
  it('stamps resolution and clears it on reopen', () => {
    expect(requestStatusPatch('done', 'T')).toEqual({ request_status: 'done', resolved_at: 'T' });
    expect(requestStatusPatch('open', 'T')).toEqual({ request_status: 'open', resolved_at: null });
  });
});

describe('shouldEmailMessage', () => {
  const now = new Date('2026-09-29T12:00:00Z');
  const base = { hasEmail: true, portalLive: true, artistLastSeenAt: null, unreadEmailedAt: [], now };
  it('emails by default', () => {
    expect(shouldEmailMessage(base)).toEqual({ email: true });
  });
  it('needs an address and a live portal', () => {
    expect(shouldEmailMessage({ ...base, hasEmail: false })).toEqual({ email: false, reason: 'no_email' });
    expect(shouldEmailMessage({ ...base, portalLive: false })).toEqual({ email: false, reason: 'no_portal' });
  });
  it('skips an artist who is on the portal right now', () => {
    expect(shouldEmailMessage({ ...base, artistLastSeenAt: '2026-09-29T11:55:00Z' })).toEqual({ email: false, reason: 'active' });
    expect(shouldEmailMessage({ ...base, artistLastSeenAt: '2026-09-29T11:40:00Z' })).toEqual({ email: true });
  });
  it('sends one email per burst of unread messages', () => {
    expect(shouldEmailMessage({ ...base, unreadEmailedAt: [null, '2026-09-29T09:00:00Z'] })).toEqual({ email: false, reason: 'recently_emailed' });
    expect(shouldEmailMessage({ ...base, unreadEmailedAt: ['2026-09-29T02:00:00Z'] })).toEqual({ email: true });
  });
});

describe('emails and notifications', () => {
  it('escapes the message body', () => {
    const e = buildMessageEmail({ artistName: 'Nova', producerName: 'U2C', portalUrl: 'https://x/artist/t', body: '<b>hi</b>\nthere' });
    expect(e.html).toContain('&lt;b&gt;hi&lt;/b&gt;<br>there');
    expect(e.subject).toBe('New message from U2C');
    expect(e.text).toContain('https://x/artist/t');
  });
  it('words a request and trims long bodies', () => {
    const n = buildArtistMessageNotification({
      ownerId: 'u', contactId: 'c', contactName: 'Nova', messageId: 'm', kind: 'request', body: 'x'.repeat(300), projectName: 'Tape',
    });
    expect(n.kind).toBe('artist_request');
    expect(n.title).toBe('Nova asked for something for Tape');
    expect(n.body.length).toBe(140);
  });
});
