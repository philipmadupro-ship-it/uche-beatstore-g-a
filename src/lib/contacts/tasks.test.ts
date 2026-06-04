import { describe, it, expect } from 'vitest';
import { categorizeDue, dueLabel } from './tasks';

const NOW = Date.parse('2026-06-04T12:00:00Z');
// Use local noon offsets so day-boundary math is unambiguous in test TZ.
const at = (iso: string) => new Date(iso).toISOString();

describe('categorizeDue', () => {
  it('null is someday', () => {
    expect(categorizeDue(null, NOW)).toBe('someday');
    expect(categorizeDue(undefined, NOW)).toBe('someday');
  });
  it('garbage is someday', () => {
    expect(categorizeDue('not-a-date', NOW)).toBe('someday');
  });
  it('a time earlier today is still today (until midnight)', () => {
    const earlierToday = at('2026-06-04T06:00:00Z');
    // Could be 'today' or 'overdue' depending on TZ midnight; assert it's not upcoming.
    expect(['today', 'overdue']).toContain(categorizeDue(earlierToday, NOW));
  });
  it('clearly past day is overdue', () => {
    expect(categorizeDue(at('2026-06-01T12:00:00Z'), NOW)).toBe('overdue');
  });
  it('clearly future day is upcoming', () => {
    expect(categorizeDue(at('2026-06-10T12:00:00Z'), NOW)).toBe('upcoming');
  });
});

describe('dueLabel', () => {
  it('no date', () => {
    expect(dueLabel(null, NOW)).toBe('No date');
  });
  it('future within a week reads In Nd or Tomorrow', () => {
    const l = dueLabel(at('2026-06-06T12:00:00Z'), NOW);
    expect(['Tomorrow', 'In 2d']).toContain(l);
  });
  it('far future uses a date', () => {
    expect(dueLabel(at('2026-08-01T12:00:00Z'), NOW)).toMatch(/Aug/);
  });
  it('overdue reads Nd overdue or Yesterday', () => {
    const l = dueLabel(at('2026-06-01T12:00:00Z'), NOW);
    expect(l === 'Yesterday' || /overdue/.test(l)).toBe(true);
  });
});
