import { describe, expect, it } from 'vitest';
import { importedDeliveredAt, planImport } from './release-import';

const NOW = new Date('2026-10-13T10:00:00Z');

describe('planImport', () => {
  it('owner and admin may; A&R, members and artists may not (403 before anything else is looked at)', () => {
    expect(planImport({ role: 'owner', releaseDate: '2024-01-01' }, NOW)).toEqual({ ok: true });
    expect(planImport({ role: 'admin', releaseDate: '2024-01-01' }, NOW)).toEqual({ ok: true });
    for (const role of ['member', 'artist']) {
      expect(planImport({ role, releaseDate: null }, NOW)).toMatchObject({ ok: false, status: 403 });
    }
  });
  it('needs a date that has come', () => {
    expect(planImport({ role: 'owner', releaseDate: null }, NOW)).toMatchObject({ ok: false, status: 400, field: 'release_date' });
    expect(planImport({ role: 'owner', releaseDate: '2026-10-14' }, NOW)).toMatchObject({ ok: false, status: 400 });
    expect(planImport({ role: 'owner', releaseDate: '2026-10-13' }, NOW)).toEqual({ ok: true });
  });
  it('is delivered at noon UTC of its day', () => {
    expect(importedDeliveredAt('2024-02-02')).toBe('2024-02-02T12:00:00.000Z');
  });
});
