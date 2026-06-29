import { describe, it, expect } from 'vitest';
import { parseCartItems, CartItemSchema } from './stripe-webhook';

describe('parseCartItems', () => {
  it('parses a well-formed cart with defaults filled', () => {
    const raw = JSON.stringify([
      { track_id: 't1', license_id: 'lease', license_type: 'lease' },
      { track_id: 't2' }, // license_id / license_type default to ''
    ]);
    const items = parseCartItems(raw);
    expect(items).toEqual([
      { track_id: 't1', license_id: 'lease', license_type: 'lease' },
      { track_id: 't2', license_id: '', license_type: '' },
    ]);
  });

  it('drops items missing track_id but keeps the valid ones', () => {
    const raw = JSON.stringify([
      { track_id: 't1' },
      { license_id: 'lease' }, // no track_id → dropped
      { track_id: '' }, // empty track_id → dropped
      { track_id: 't2' },
    ]);
    const items = parseCartItems(raw);
    expect(items.map((i) => i.track_id)).toEqual(['t1', 't2']);
  });

  it('returns [] for a non-array root', () => {
    expect(parseCartItems(JSON.stringify({ track_id: 't1' }))).toEqual([]);
    expect(parseCartItems(JSON.stringify('nope'))).toEqual([]);
  });

  it('returns [] for malformed JSON', () => {
    expect(parseCartItems('{not json')).toEqual([]);
  });

  it('returns [] for empty / nullish input', () => {
    expect(parseCartItems('')).toEqual([]);
    expect(parseCartItems(undefined)).toEqual([]);
    expect(parseCartItems(null)).toEqual([]);
  });

  it('drops non-object items', () => {
    const raw = JSON.stringify(['string', 42, null, { track_id: 't1' }]);
    expect(parseCartItems(raw).map((i) => i.track_id)).toEqual(['t1']);
  });
});

describe('CartItemSchema', () => {
  it('rejects a missing track_id at the schema level', () => {
    expect(CartItemSchema.safeParse({ license_id: 'x' }).success).toBe(false);
  });
});
