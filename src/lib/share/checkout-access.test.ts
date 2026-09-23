import { describe, it, expect } from 'vitest';
import { shareCheckoutBlock, tracksOutsideShare } from './checkout-access';

const NOW = Date.parse('2026-09-17T12:00:00Z');

describe('shareCheckoutBlock', () => {
  it('allows an open, unexpired, unrevoked share', () => {
    expect(shareCheckoutBlock({ sales_enabled: true }, NOW)).toBeNull();
    expect(shareCheckoutBlock({ sales_enabled: true, expires_at: '2026-09-18T00:00:00Z' }, NOW)).toBeNull();
  });

  it('refuses when sales are not enabled, including a missing flag', () => {
    expect(shareCheckoutBlock({ sales_enabled: false }, NOW)?.status).toBe(403);
    expect(shareCheckoutBlock({}, NOW)?.status).toBe(403);
    expect(shareCheckoutBlock({ sales_enabled: null }, NOW)?.status).toBe(403);
  });

  it('refuses a revoked share even with sales enabled', () => {
    expect(shareCheckoutBlock({ sales_enabled: true, revoked_at: '2026-09-01T00:00:00Z' }, NOW))
      .toEqual({ status: 410, error: 'This link has been revoked.' });
  });

  it('refuses an expired share', () => {
    expect(shareCheckoutBlock({ sales_enabled: true, expires_at: '2026-09-17T11:59:59Z' }, NOW)?.status).toBe(410);
  });

  it('reports revocation before a disabled flag, so the buyer sees why the link is dead', () => {
    expect(shareCheckoutBlock({ sales_enabled: false, revoked_at: '2026-09-01T00:00:00Z' }, NOW)?.status).toBe(410);
  });
});

describe('tracksOutsideShare', () => {
  it('returns nothing when every track is in the share', () => {
    expect(tracksOutsideShare(['a', 'b'], ['b', 'a', 'c'])).toEqual([]);
  });

  it('returns each foreign track once', () => {
    expect(tracksOutsideShare(['a', 'x', 'x', 'y'], ['a'])).toEqual(['x', 'y']);
  });

  it('treats an empty share as containing nothing', () => {
    expect(tracksOutsideShare(['a'], [])).toEqual(['a']);
  });
});
