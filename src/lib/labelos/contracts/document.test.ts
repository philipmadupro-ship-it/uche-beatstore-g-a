import { describe, expect, it } from 'vitest';
import { contractDocumentFileName, renderContractDocumentPdf, toWinAnsi } from './document';
import { pdfText } from './pdf-text';
import { renderClauses } from './render';
import { renderContext } from './context';

const clauses = [
  { id: 'a', heading: 'Advance', body: 'The Label pays {{party.artist}} an advance of {{advance}} {{currency}}.\n\nSecond paragraph for {{song.title}}.' },
  { id: 'b', heading: 'Term', body: 'This runs for {{contract.term}} from {{contract.effective_date}}.' },
];

describe('contract PDF', () => {
  it('contains the filled values, the header facts and the parties', async () => {
    const ctx = renderContext({
      row: { title: 'Nova recording agreement', effective_date: '2027-03-01', term_months: 24, territories: ['WW'], fields: { advance: '25000', currency: 'USD' } },
      links: [{ party_id: 'p1', role: 'artist', position: 0 }],
      identities: new Map([['p1', { id: 'p1', display_name: 'Nova', legal_name: 'Nova Okafor Ltd', address: null }]]),
      artistName: 'Nova', songTitle: 'Midnight Run', releaseTitle: null,
    });
    const doc = renderClauses(clauses, ctx);
    const pdf = await renderContractDocumentPdf({
      title: 'Nova recording agreement', typeLabel: 'Recording agreement', statusLabel: 'Draft', version: 3,
      parties: [{ roleLabel: 'Artist', name: 'Nova Okafor Ltd' }], clauses: doc.clauses, missing: doc.missing, generatedOn: '27 October 2026',
    });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    const text = pdfText(pdf);
    expect(text).toContain('Nova recording agreement');
    expect(text).toContain('Artist: Nova Okafor Ltd');
    expect(text).toContain('an advance of 25000 USD');
    expect(text).toContain('Second paragraph for Midnight Run');
    expect(text).toContain('2 years from 1 March 2027');
    expect(text).toContain('version 3');
    expect(text).not.toContain('[');
    expect(text).not.toContain('{{');
  });

  it('prints an empty value in brackets and says the document is a draft', async () => {
    const doc = renderClauses(clauses, renderContext({ row: { title: 'T', effective_date: null, term_months: null, territories: null, fields: {} }, links: [], identities: new Map(), artistName: null, songTitle: null, releaseTitle: null }));
    const pdf = await renderContractDocumentPdf({ title: 'T', typeLabel: 'X', statusLabel: 'Draft', version: 1, parties: [], clauses: doc.clauses, missing: doc.missing, generatedOn: 'today' });
    const text = pdfText(pdf);
    expect(text).toContain('[Advance]');
    expect(text).toMatch(/Draft: \d+ values are still empty/);
  });

  it('paginates a long contract and footers every page', async () => {
    const long = Array.from({ length: 40 }, (_, i) => ({ id: `c${i}`, heading: `Clause ${i}`, body: 'Lorem ipsum dolor sit amet. '.repeat(30) }));
    const pdf = await renderContractDocumentPdf({ title: 'Long', typeLabel: 'X', statusLabel: 'Sent for signature', version: 2, parties: [], clauses: long, missing: [], generatedOn: 'today' });
    const text = pdfText(pdf);
    expect(text).toMatch(/page 1 of \d+/);
    const pages = Number(/page 1 of (\d+)/.exec(text)![1]);
    expect(pages).toBeGreaterThan(1);
    expect(text).toContain(`page ${pages} of ${pages}`);
  });

  it('keeps Latin-1 and smart punctuation, replaces what WinAnsi cannot draw', () => {
    expect(toWinAnsi('Zoë – “quoted” €5')).toBe('Zoë – “quoted” €5');
    expect(toWinAnsi('Ünal 田中')).toBe('Ünal ??');
  });

  it('names the file after the contract and its version', () => {
    expect(contractDocumentFileName('0f3a9c1e-1111-4222-8333-444455556666', 4, 'sent')).toBe('contract-0f3a9c1e1111-v4-sent.pdf');
  });
});
