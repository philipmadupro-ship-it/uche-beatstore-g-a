import { describe, it, expect } from 'vitest';
import { deriveContactKind } from './kind';

describe('deriveContactKind', () => {
  it('is a buyer when they have any purchase, regardless of anything else', () => {
    expect(deriveContactKind({ purchases: 1, sends: 5, favorites: 3, crmStatus: 'cold' })).toBe('buyer');
  });

  it('is an artist when beats have been sent and there is no purchase', () => {
    expect(deriveContactKind({ purchases: 0, sends: 2, favorites: 0, crmStatus: null })).toBe('artist');
  });

  it('is a lead when they favorited something but never bought or been sent to', () => {
    expect(deriveContactKind({ purchases: 0, sends: 0, favorites: 1, crmStatus: null })).toBe('lead');
  });

  it('is a lead when crm_status is prospect even with zero favorites', () => {
    expect(deriveContactKind({ purchases: 0, sends: 0, favorites: 0, crmStatus: 'prospect' })).toBe('lead');
  });

  it('is a bare contact when there is no signal at all', () => {
    expect(deriveContactKind({ purchases: 0, sends: 0, favorites: 0, crmStatus: null })).toBe('contact');
  });

  it('purchases outrank artist status', () => {
    expect(deriveContactKind({ purchases: 1, sends: 10, favorites: 0, crmStatus: null })).toBe('buyer');
  });

  it('sends outrank lead status', () => {
    expect(deriveContactKind({ purchases: 0, sends: 1, favorites: 5, crmStatus: 'prospect' })).toBe('artist');
  });
});
