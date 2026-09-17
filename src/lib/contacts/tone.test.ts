import { describe, it, expect } from 'vitest';
import { deriveActivityTone } from './tone';

const NOW = Date.parse('2026-08-19T00:00:00.000Z');
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

describe('deriveActivityTone', () => {
  it('is active while a send is inside the 30-day window', () => {
    expect(deriveActivityTone({ lastSentAt: daysAgo(1), now: NOW })).toBe('active');
    expect(deriveActivityTone({ lastSentAt: daysAgo(30), now: NOW })).toBe('active');
  });

  it('cools to engaged once the last send ages out', () => {
    expect(deriveActivityTone({ lastSentAt: daysAgo(31), now: NOW })).toBe('engaged');
    expect(deriveActivityTone({ lastSentAt: daysAgo(400), now: NOW })).toBe('engaged');
  });

  it('is cold only for someone with no sends and no purchases', () => {
    expect(deriveActivityTone({ lastSentAt: null, now: NOW })).toBe('cold');
    expect(deriveActivityTone({ now: NOW })).toBe('cold');
  });

  it('never calls a paying customer cold', () => {
    // The regression this helper exists for: $2,000 spent, never sent a beat,
    // previously rendered as "Cold" in both the list and the detail page.
    expect(deriveActivityTone({ lastSentAt: null, purchases: 1, now: NOW })).toBe('engaged');
  });

  it('lets a live send conversation still read as active for a buyer', () => {
    expect(deriveActivityTone({ lastSentAt: daysAgo(2), purchases: 3, now: NOW })).toBe('active');
  });

  it('ignores an unparseable timestamp rather than throwing', () => {
    expect(deriveActivityTone({ lastSentAt: 'not-a-date', purchases: 0, now: NOW })).toBe('engaged');
  });
});
