import { describe, expect, it } from 'vitest';
import { contactsToCsv } from './export';
import {
  inferCategory,
  inferColumnMap,
  parseCSV,
  rowsToContacts,
  rowsToResults,
} from './import';
import type { Contact } from '@/lib/types';

describe('contact import helpers', () => {
  it('infers common column aliases', () => {
    expect(inferColumnMap(['Artist Name', 'Business Email', 'IG Handle'])).toMatchObject({
      name: 0,
      email: 1,
      instagram: 2,
    });
  });

  it('normalizes rows and fills contact names from email or handles', () => {
    const contacts = rowsToContacts(
      ['Email Address', 'Instagram', 'Website', 'Role'],
      [
        ['Artist@Example.COM', '@darkkeys', 'beats.example.com', 'Producer'],
        ['', '@novox', '', 'Rapper'],
      ],
    );

    expect(contacts).toEqual([
      {
        name: 'artist',
        email: 'artist@example.com',
        instagram: 'darkkeys',
        website: 'https://beats.example.com',
        role: 'Producer',
        category: 'producer',
      },
      {
        name: '@novox',
        instagram: 'novox',
        role: 'Rapper',
        category: 'rapper',
      },
    ]);
  });

  it('returns validation errors without dropping the parsed row', () => {
    const results = rowsToResults(['Name', 'Email'], [['Ari', 'bad-email']]);

    expect(results).toHaveLength(1);
    expect(results[0]?.contact).toEqual({ name: 'Ari' });
    expect(results[0]?.errors).toEqual(['Invalid email: bad-email']);
  });

  it('parses quoted CSV cells', () => {
    expect(parseCSV('"Name","Notes"\n"Ari","said ""send loops"""')).toEqual([
      ['Name', 'Notes'],
      ['Ari', 'said "send loops"'],
    ]);
  });

  it('infers category from music roles', () => {
    expect(inferCategory('A&R')).toBe('a&r');
    expect(inferCategory('playlist curator')).toBe('curator');
  });
});

describe('contact export helpers', () => {
  it('escapes CSV cells and joins tags in one field', () => {
    const contact: Contact = {
      id: 'c1',
      name: 'Ari "The Pen"',
      email: 'ari@example.com',
      phone: null,
      role: 'Rapper',
      label: null,
      category: 'artist',
      crm_status: 'active',
      city: 'Lagos',
      country: 'NG',
      instagram: 'ari',
      created_at: '2026-07-25T00:00:00.000Z',
      tags: [
        { tag: 'vip', category: 'crm' },
        { tag: 'drill', category: 'genre' },
      ],
    };

    expect(contactsToCsv([contact])).toContain('"Ari ""The Pen"""');
    expect(contactsToCsv([contact])).toContain('"vip | drill"');
  });
});
