import { describe, it, expect } from 'vitest';
import { normalizeEmail, normalizeEmailOrNull } from './email';

describe('normalizeEmail', () => {
  it('trims and lowercases', () => {
    expect(normalizeEmail('  Buyer@Example.COM ')).toBe('buyer@example.com');
  });

  it('is idempotent', () => {
    const once = normalizeEmail(' Foo@Bar.com ');
    expect(normalizeEmail(once)).toBe(once);
  });

  it('collapses the casing variants that used to create duplicate contacts', () => {
    const variants = ['foo@bar.com', 'Foo@Bar.com', 'FOO@BAR.COM', ' foo@bar.com '];
    expect(new Set(variants.map(normalizeEmail)).size).toBe(1);
  });
});

describe('normalizeEmailOrNull', () => {
  it('returns null for nullish and blank input', () => {
    expect(normalizeEmailOrNull(null)).toBeNull();
    expect(normalizeEmailOrNull(undefined)).toBeNull();
    expect(normalizeEmailOrNull('   ')).toBeNull();
  });

  it('normalises a real address', () => {
    expect(normalizeEmailOrNull(' Buyer@Example.COM ')).toBe('buyer@example.com');
  });
});
