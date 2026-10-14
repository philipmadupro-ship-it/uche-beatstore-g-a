import { describe, expect, it } from 'vitest';
import { isLabelOsNextPath, memberLanding } from './member-landing';

describe('memberLanding', () => {
  it('honours a Label OS `next` on /login only', () => {
    expect(memberLanding('/login', '/o/acme/artists?x=1')).toBe('/o/acme/artists?x=1');
    expect(memberLanding('/login', '/join/tok')).toBe('/join/tok');
    expect(memberLanding('/login', '/shared/p1')).toBe('/shared/p1');
    expect(memberLanding('/library', '/o/acme')).toBe('/o');
  });

  it('never honours any other `next`', () => {
    for (const next of ['/library', '/store', '//evil.test', '/\\evil.test', '/o/../library', '/o/%2e%2e/library', '/offline', '/orders', '/join', '/api/org', 'https://evil.test', '/o/a\nb', null, '']) {
      expect(memberLanding('/login', next), String(next)).toBe('/o');
    }
  });

  it('matches whole segments', () => {
    expect(isLabelOsNextPath('/o')).toBe(true);
    expect(isLabelOsNextPath('/shared')).toBe(true);
    expect(isLabelOsNextPath('/sharedx')).toBe(false);
    expect(isLabelOsNextPath('/share/tok')).toBe(false);
  });
});
