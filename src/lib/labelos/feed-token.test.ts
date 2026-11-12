import { describe, expect, it } from 'vitest';
import { feedPath, feedState, parseFeedToken, signFeedToken, verifyFeedToken, type FeedIdentity } from './feed-token';

const SECRET = 'test-secret';
const ORG = '10000000-0000-4000-8000-000000000001';
const ORG2 = '10000000-0000-4000-8000-000000000002';
const USER = '20000000-0000-4000-8000-000000000001';
const USER2 = '20000000-0000-4000-8000-000000000002';
const id: FeedIdentity = { orgId: ORG, userId: USER, joinedAt: '2026-09-01T10:00:00+00:00', version: 1 };

const check = (token: string, who: FeedIdentity, secret = SECRET) => {
  const parsed = parseFeedToken(token);
  return !!parsed && parsed.userId === who.userId && verifyFeedToken(secret, who, parsed.mac);
};

describe('feed state from the member’s own audit events', () => {
  it('is off until a link is issued, on after, off after a revoke, on again after a re-issue', () => {
    expect(feedState([])).toEqual({ active: false, version: 0 });
    expect(feedState(['calendar_feed.issued'])).toEqual({ active: true, version: 1 });
    expect(feedState(['calendar_feed.issued', 'calendar_feed.revoked'])).toEqual({ active: false, version: 2 });
    expect(feedState(['calendar_feed.issued', 'calendar_feed.revoked', 'calendar_feed.issued'])).toEqual({ active: true, version: 3 });
    expect(feedState(['calendar_feed.issued', 'org.exported'])).toEqual({ active: true, version: 1 });
  });
});

describe('feed token', () => {
  const token = signFeedToken(SECRET, id);

  it('is <user>.<43 chars of base64url> and verifies for its own person, org, membership and version', () => {
    expect(token).toMatch(/^[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/);
    expect(check(token, id)).toBe(true);
  });

  it('is deterministic (so the URL can be shown again without storing it)', () => {
    expect(signFeedToken(SECRET, id)).toBe(token);
  });

  it('does not verify for another org, another person, a rejoin, a new version or another secret', () => {
    expect(check(token, { ...id, orgId: ORG2 })).toBe(false);
    expect(check(token, { ...id, userId: USER2 })).toBe(false);
    expect(check(token, { ...id, joinedAt: '2026-10-01T10:00:00+00:00' })).toBe(false);
    expect(check(token, { ...id, version: 2 })).toBe(false);
    expect(check(token, id, 'another-secret')).toBe(false);
  });

  it('a token carrying someone else’s id with your MAC does not verify for them', () => {
    const mac = token.split('.')[1];
    expect(check(`${USER2}.${mac}`, { ...id, userId: USER2 })).toBe(false);
  });

  it('rejects anything not shaped like a token before any lookup', () => {
    for (const bad of [null, undefined, '', 'x', `${USER}`, `${USER}.`, `${USER}.short`, `not-a-uuid-not-a-uuid-not-a-uuid-xxxx.${'A'.repeat(43)}`, `${USER}.${'A'.repeat(44)}`, `${USER}.${'!'.repeat(43)}`, `${token}${token}`, 42]) {
      expect(parseFeedToken(bad as never), String(bad)).toBeNull();
    }
    expect(parseFeedToken(token)).toEqual({ userId: USER, mac: token.split('.')[1] });
  });

  it('builds the subscription path with the token URL-encoded', () => {
    expect(feedPath(ORG, token)).toBe(`/api/org/${ORG}/calendar.ics?token=${token}`);
  });
});
