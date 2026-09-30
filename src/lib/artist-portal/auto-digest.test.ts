import { describe, expect, it } from 'vitest';
import { autoDigestDue } from './auto-digest';

const now = new Date('2026-09-29T17:00:00Z');

describe('autoDigestDue', () => {
  it('sends only when there is something new', () => {
    expect(autoDigestDue({ unnotified: 0, lastNotifiedAt: [null], now })).toBe(false);
    expect(autoDigestDue({ unnotified: 2, lastNotifiedAt: [null], now })).toBe(true);
  });
  it('waits a day after any notify, manual or automatic', () => {
    expect(autoDigestDue({ unnotified: 1, lastNotifiedAt: ['2026-09-29T10:00:00Z', null], now })).toBe(false);
    expect(autoDigestDue({ unnotified: 1, lastNotifiedAt: ['2026-09-28T20:00:00Z', '2026-09-20T00:00:00Z'], now })).toBe(true);
  });
  it('ignores unparseable stamps', () => {
    expect(autoDigestDue({ unnotified: 1, lastNotifiedAt: ['garbage'], now })).toBe(true);
  });
});
