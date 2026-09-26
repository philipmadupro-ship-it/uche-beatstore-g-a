import { describe, it, expect } from 'vitest';
import { isProjectAccessActive } from './project-access';

describe('isProjectAccessActive', () => {
  const now = Date.parse('2026-09-26T12:00:00Z');
  it('is active with no expiry', () => expect(isProjectAccessActive({ expires_at: null }, now)).toBe(true));
  it('is active before expiry', () => expect(isProjectAccessActive({ expires_at: '2026-09-27T00:00:00Z' }, now)).toBe(true));
  it('is revoked at or after expiry (refund sets expiry to now)', () => {
    expect(isProjectAccessActive({ expires_at: '2026-09-26T12:00:00Z' }, now)).toBe(false);
    expect(isProjectAccessActive({ expires_at: '2026-09-01T00:00:00Z' }, now)).toBe(false);
  });
  it('treats a missing row or garbage date as inactive', () => {
    expect(isProjectAccessActive(null, now)).toBe(false);
    expect(isProjectAccessActive({ expires_at: 'not a date' }, now)).toBe(false);
  });
});
