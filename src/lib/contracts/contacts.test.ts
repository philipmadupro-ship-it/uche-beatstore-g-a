import { describe, it, expect } from 'vitest';
import {
  ContactCreateBodySchema,
  ContactPatchBodySchema,
  ContactSegmentUpdateBodySchema,
} from './index';

/**
 * The create route used to hand-destructure seven keys and drop the rest.
 * AddContactModal has always collected `phone` and `category` — and the CRM
 * filters key on `category` — so both were lost on every hand-added contact.
 * These assertions are what stops that from silently returning.
 */
describe('ContactCreateBodySchema', () => {
  it('keeps every field the add-contact form collects', () => {
    const parsed = ContactCreateBodySchema.parse({
      name: 'Artist',
      email: 'artist@example.com',
      phone: '+33 6 00 00 00 00',
      role: 'rapper',
      label: 'Indie',
      category: 'buyer',
      instagram: '@artist',
      twitter: '@artist',
      notes: 'met at a session',
    });
    expect(parsed.phone).toBe('+33 6 00 00 00 00');
    expect(parsed.category).toBe('buyer');
  });

  it('accepts the columns that had no writer at all', () => {
    const parsed = ContactCreateBodySchema.parse({
      name: 'Artist',
      genre: 'Drill',
      city: 'Paris',
      country: 'France',
      website: 'https://artist.example',
    });
    expect(parsed.website).toBe('https://artist.example');
    expect(parsed.genre).toBe('Drill');
  });

  it('requires a name', () => {
    expect(ContactCreateBodySchema.safeParse({ email: 'a@b.com' }).success).toBe(false);
    expect(ContactCreateBodySchema.safeParse({ name: '' }).success).toBe(false);
  });

  it('rejects a malformed email instead of storing it', () => {
    expect(ContactCreateBodySchema.safeParse({ name: 'A', email: 'not-an-email' }).success).toBe(false);
  });

  it('rejects unknown keys rather than dropping them silently', () => {
    expect(ContactCreateBodySchema.safeParse({ name: 'A', nope: 1 }).success).toBe(false);
  });

  it('accepts the customer stage', () => {
    expect(ContactCreateBodySchema.parse({ name: 'A', crm_status: 'customer' }).crm_status).toBe('customer');
  });
});

describe('ContactPatchBodySchema', () => {
  it('exposes the same writable fields as create, so the two cannot drift', () => {
    const createKeys = Object.keys(ContactCreateBodySchema.shape).sort();
    const patchKeys = Object.keys(ContactPatchBodySchema.shape).sort();
    expect(patchKeys).toEqual(createKeys);
  });

  it('makes name optional, unlike create', () => {
    expect(ContactPatchBodySchema.safeParse({ notes: 'just a note' }).success).toBe(true);
  });
});

describe('ContactSegmentUpdateBodySchema', () => {
  it('allows a name-only patch so a rename need not resend the filters', () => {
    expect(ContactSegmentUpdateBodySchema.safeParse({ name: 'Active buyers' }).success).toBe(true);
  });

  it('allows retargeting filters without renaming', () => {
    expect(ContactSegmentUpdateBodySchema.safeParse({
      filters: { category: 'buyer', sort: 'recent' },
    }).success).toBe(true);
  });

  it('rejects an empty name', () => {
    expect(ContactSegmentUpdateBodySchema.safeParse({ name: '' }).success).toBe(false);
  });
});
