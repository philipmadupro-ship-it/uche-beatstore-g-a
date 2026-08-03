import { describe, it, expect } from 'vitest';
import {
  aggregateFreeDownloadLeads,
  leadsNotYetContacts,
  contactFromLead,
  normaliseEmail,
  type FreeDownloadRow,
} from './free-download-leads';

const row = (
  email: string,
  downloaded_at: string,
  track_title = 'Beat One',
  track_id = 't-1',
): FreeDownloadRow => ({ email, downloaded_at, track_title, track_id });

describe('normaliseEmail', () => {
  it('treats case and surrounding whitespace as the same person', () => {
    expect(normaliseEmail('  A@X.com ')).toBe('a@x.com');
  });
});

describe('aggregateFreeDownloadLeads', () => {
  it('collapses repeat downloads into one lead', () => {
    // The table stores one row per download; a lead is a person.
    const out = aggregateFreeDownloadLeads([
      row('a@x.com', '2026-01-01T00:00:00Z'),
      row('a@x.com', '2026-02-01T00:00:00Z', 'Beat Two', 't-2'),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].downloads).toBe(2);
    expect(out[0].tracks).toEqual(['Beat One', 'Beat Two']);
  });

  it('matches the same address written differently', () => {
    const out = aggregateFreeDownloadLeads([
      row('A@X.com', '2026-01-01T00:00:00Z'),
      row('a@x.com ', '2026-01-02T00:00:00Z'),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].downloads).toBe(2);
  });

  it('tracks the first and last download', () => {
    const out = aggregateFreeDownloadLeads([
      row('a@x.com', '2026-02-01T00:00:00Z'),
      row('a@x.com', '2026-01-01T00:00:00Z'),
      row('a@x.com', '2026-03-01T00:00:00Z'),
    ]);
    expect(out[0].firstDownloadAt).toBe('2026-01-01T00:00:00Z');
    expect(out[0].lastDownloadAt).toBe('2026-03-01T00:00:00Z');
  });

  it('sorts by most recent activity, not by volume', () => {
    // A producer following up wants who is warm NOW, not who was busiest once.
    const out = aggregateFreeDownloadLeads([
      row('busy@x.com', '2026-01-01T00:00:00Z'),
      row('busy@x.com', '2026-01-02T00:00:00Z'),
      row('busy@x.com', '2026-01-03T00:00:00Z'),
      row('recent@x.com', '2026-06-01T00:00:00Z'),
    ]);
    expect(out[0].email).toBe('recent@x.com');
    expect(out[1].downloads).toBe(3);
  });

  it('does not list the same track twice for one lead', () => {
    const out = aggregateFreeDownloadLeads([
      row('a@x.com', '2026-01-01T00:00:00Z', 'Beat One'),
      row('a@x.com', '2026-01-02T00:00:00Z', 'Beat One'),
    ]);
    expect(out[0].tracks).toEqual(['Beat One']);
    expect(out[0].downloads).toBe(2);
  });

  it('skips rows with no usable email rather than creating a blank lead', () => {
    const out = aggregateFreeDownloadLeads([
      { email: '', track_id: 't', downloaded_at: '2026-01-01T00:00:00Z' },
      { email: '   ', track_id: 't', downloaded_at: '2026-01-01T00:00:00Z' },
      row('a@x.com', '2026-01-01T00:00:00Z'),
    ]);
    expect(out).toHaveLength(1);
  });

  it('returns empty for empty input', () => {
    expect(aggregateFreeDownloadLeads([])).toEqual([]);
  });

  it('falls back to the track id when no title was joined', () => {
    const out = aggregateFreeDownloadLeads([
      { email: 'a@x.com', track_id: 'track-42', downloaded_at: '2026-01-01T00:00:00Z' },
    ]);
    expect(out[0].tracks).toEqual(['track-42']);
  });
});

describe('leadsNotYetContacts', () => {
  const leads = aggregateFreeDownloadLeads([
    row('a@x.com', '2026-01-01T00:00:00Z'),
    row('b@x.com', '2026-01-02T00:00:00Z'),
  ]);

  it('excludes leads already in the CRM', () => {
    expect(leadsNotYetContacts(leads, ['a@x.com']).map((l) => l.email)).toEqual(['b@x.com']);
  });

  it('matches contacts stored with different casing', () => {
    // Otherwise promoting would silently create a duplicate contact.
    expect(leadsNotYetContacts(leads, ['  A@X.COM '])).toHaveLength(1);
  });

  it('ignores contacts with no email', () => {
    expect(leadsNotYetContacts(leads, [null, undefined, ''])).toHaveLength(2);
  });
});

describe('contactFromLead', () => {
  it('uses the local part as an editable placeholder name', () => {
    // The contacts API requires a name; a free download only gives an address.
    // "dprod" beats forty contacts all called "Unknown".
    const [lead] = aggregateFreeDownloadLeads([row('dprod@label.com', '2026-01-01T00:00:00Z')]);
    expect(contactFromLead(lead).name).toBe('dprod');
    expect(contactFromLead(lead).email).toBe('dprod@label.com');
  });

  it('records provenance in the notes', () => {
    const [lead] = aggregateFreeDownloadLeads([
      row('a@x.com', '2026-01-01T00:00:00Z', 'Beat One'),
      row('a@x.com', '2026-01-02T00:00:00Z', 'Beat Two', 't-2'),
    ]);
    const contact = contactFromLead(lead);
    expect(contact.notes).toContain('2 downloads');
    expect(contact.notes).toContain('Beat One');
  });

  it('singularises a single download', () => {
    const [lead] = aggregateFreeDownloadLeads([row('a@x.com', '2026-01-01T00:00:00Z')]);
    expect(contactFromLead(lead).notes).toContain('1 download ');
  });
});
