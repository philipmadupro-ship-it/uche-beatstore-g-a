import { describe, expect, it } from 'vitest';
import {
  bytesSha256,
  parseSentSnapshot,
  sentSnapshotOf,
  cleanProviderUrl,
  cleanSignerName,
  contractEnd,
  expiryState,
  filterStore,
  hashSignToken,
  isWellFormedSignToken,
  linkReadable,
  linkUsable,
  maySignAs,
  newSignToken,
  parseDrawnSignature,
  planSign,
  requiredSigners,
  signerStates,
  signingProgress,
  type SignatureFact,
  type StoreRow,
} from './contract-signing';

const doc = {
  title: 'Recording agreement',
  typeLabel: 'Recording agreement',
  version: 2,
  parties: [
    { roleLabel: 'Label', name: 'North Records Ltd' },
    { roleLabel: 'Artist', name: 'Nova Example' },
  ],
  clauses: [{ id: 'c1', heading: 'Term', body: 'The term is 24 months.' }],
};

const sig = (partyId: string, sha: string, at = '2026-11-01T10:00:00.000Z', id = `s-${partyId}-${sha.slice(0, 2)}`): SignatureFact => ({
  id,
  partyId,
  role: 'artist',
  documentSha256: sha,
  contractVersion: 2,
  signedAt: at,
});

describe('the frozen sent copy', () => {
  it('bytesSha256 is the SHA-256 of the stored BYTES: one changed byte is a different hash', () => {
    const a = bytesSha256(Buffer.from('%PDF-1.4 sent copy'));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(bytesSha256(Buffer.from('%PDF-1.4 sent copy'))).toBe(a);
    expect(bytesSha256(Buffer.from('%PDF-1.4 sent copy!'))).not.toBe(a);
  });

  it('the snapshot keeps only what the signer reads and round-trips through jsonb', () => {
    const snap = sentSnapshotOf({ ...doc, generatedOn: '1 January 2026', statusLabel: 'Sent', missing: [] } as unknown as typeof doc & { clauses: typeof doc.clauses });
    expect(Object.keys(snap).sort()).toEqual(['clauses', 'parties', 'title', 'typeLabel', 'version']);
    expect(parseSentSnapshot(JSON.parse(JSON.stringify(snap)))).toEqual(snap);
  });

  it('refuses anything that is not a snapshot', () => {
    for (const bad of [null, 'x', 5, {}, { title: 'a' }, { title: 'a', typeLabel: 'b', version: 1, parties: 'no', clauses: [] }]) expect(parseSentSnapshot(bad)).toBeNull();
  });
});

describe('signerStates / signingProgress — a changed hash invalidates, derived on read', () => {
  const required = [
    { partyId: 'p-label', role: 'label' as const },
    { partyId: 'p-artist', role: 'artist' as const },
  ];

  it('nothing signed: all pending, not complete', () => {
    const s = signerStates(required, [], 'h1');
    expect(s.map((x) => x.status)).toEqual(['pending', 'pending']);
    expect(signingProgress(s)).toMatchObject({ total: 2, signed: 0, pending: 2, complete: false });
  });

  it('both signed the current document: complete', () => {
    const s = signerStates(required, [sig('p-label', 'h1'), sig('p-artist', 'h1')], 'h1');
    expect(signingProgress(s).complete).toBe(true);
  });

  it('a signature on an older hash is stale, not valid, and does not count', () => {
    const s = signerStates(required, [sig('p-label', 'h1'), sig('p-artist', 'h0')], 'h1');
    expect(s.map((x) => x.status)).toEqual(['signed', 'stale']);
    expect(signingProgress(s)).toMatchObject({ signed: 1, stale: 1, pending: 0, complete: false });
  });

  it('re-signing the new document makes the party valid again; the old row stays', () => {
    const rows = [sig('p-label', 'h1'), sig('p-artist', 'h0', '2026-10-01T00:00:00.000Z'), sig('p-artist', 'h1', '2026-11-02T00:00:00.000Z')];
    const s = signerStates(required, rows, 'h1');
    expect(signingProgress(s).complete).toBe(true);
    expect(rows).toHaveLength(3);
  });

  it('a contract with no parties is never complete', () => {
    expect(signingProgress(signerStates([], [], 'h1')).complete).toBe(false);
  });

  it('another contract’s party does not count', () => {
    const s = signerStates(required, [sig('someone-else', 'h1')], 'h1');
    expect(signingProgress(s).signed).toBe(0);
  });
});

describe('requiredSigners', () => {
  it('is one signer per party, in position order, with the first role', () => {
    const out = requiredSigners([
      { party_id: 'b', role: 'artist', position: 1 },
      { party_id: 'a', role: 'label', position: 0 },
      { party_id: 'b', role: 'featured', position: 2 },
    ]);
    expect(out).toEqual([
      { partyId: 'a', role: 'label' },
      { partyId: 'b', role: 'artist' },
    ]);
  });
});

describe('planSign', () => {
  const required = [{ partyId: 'p1', role: 'artist' as const }];
  const base = { contractVersion: 2, seenVersion: 2, required, partyId: 'p1' };
  const states = (x: Parameters<typeof signerStates>[1]) => signerStates(required, x, 'h');

  it('accepts a pending party on a sent contract', () => {
    expect(planSign({ ...base, contractStatus: 'sent', states: states([]) })).toEqual({ ok: true, role: 'artist' });
  });
  it.each([
    ['draft', 'not_sent'],
    ['void', 'void'],
    ['signed', 'already_signed'],
  ] as const)('%s contract: %s', (status, code) => {
    expect(planSign({ ...base, contractStatus: status, states: states([]) })).toEqual({ ok: false, code });
  });
  it('refuses a party that is not on the contract', () => {
    expect(planSign({ ...base, partyId: 'nobody', contractStatus: 'sent', states: states([]) })).toEqual({ ok: false, code: 'not_a_party' });
  });
  it('refuses a signer who read another version', () => {
    expect(planSign({ ...base, seenVersion: 1, contractStatus: 'sent', states: states([]) })).toEqual({ ok: false, code: 'changed' });
  });
  it('refuses a second valid signature, but accepts a re-sign over a stale one', () => {
    expect(planSign({ ...base, contractStatus: 'sent', states: states([sig('p1', 'h')]) })).toEqual({ ok: false, code: 'already_signed_by' });
    expect(planSign({ ...base, contractStatus: 'sent', states: states([sig('p1', 'old')]) })).toEqual({ ok: true, role: 'artist' });
  });
});

describe('maySignAs', () => {
  const base = { partyRole: 'artist' as const, partyUserId: null, partyConfirmedBy: null, userId: 'u1', memberRole: 'member', canWriteContracts: false };

  it('a person signs for the party linked to their account only when that account itself confirmed it', () => {
    expect(maySignAs({ ...base, partyUserId: 'u1', partyConfirmedBy: 'u1' })).toEqual({ ok: true, countersign: false });
  });

  it('a link nobody confirmed, or one a colleague confirmed, is not the party (LABEL-71 H1: self-linking is not consent)', () => {
    expect(maySignAs({ ...base, partyUserId: 'u1', partyConfirmedBy: null })).toEqual({ ok: false });
    expect(maySignAs({ ...base, partyUserId: 'u1', partyConfirmedBy: 'u2' })).toEqual({ ok: false });
    expect(maySignAs({ ...base, partyUserId: 'u1', partyConfirmedBy: null, memberRole: 'owner', canWriteContracts: true })).toEqual({ ok: false });
  });

  it('the label’s side (role label) is signed by an owner, an admin or a contracts writer', () => {
    for (const memberRole of ['owner', 'admin']) expect(maySignAs({ ...base, partyRole: 'label', memberRole })).toEqual({ ok: true, countersign: true });
    expect(maySignAs({ ...base, partyRole: 'label', canWriteContracts: true })).toEqual({ ok: true, countersign: true });
    expect(maySignAs({ ...base, partyRole: 'label' })).toEqual({ ok: false });
  });

  it('nobody signs for another role’s party by capability, whatever they may write', () => {
    expect(maySignAs({ ...base, memberRole: 'owner', canWriteContracts: true })).toEqual({ ok: false });
    expect(maySignAs({ ...base, partyRole: 'receiving', memberRole: 'admin', canWriteContracts: true })).toEqual({ ok: false });
  });
});

describe('signature input', () => {
  it('cleans a typed name and refuses an empty or absurd one', () => {
    expect(cleanSignerName('  Nova   Example\u0007 ')).toBe('Nova Example');
    expect(cleanSignerName('x')).toBeNull();
    expect(cleanSignerName('a'.repeat(201))).toBeNull();
    expect(cleanSignerName(42)).toBeNull();
  });

  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 1)]);
  it('accepts a PNG data URL and refuses other types, bad bytes and oversize', () => {
    const ok = parseDrawnSignature(`data:image/png;base64,${png.toString('base64')}`);
    expect(ok.ok && ok.bytes.equals(png)).toBe(true);
    expect(parseDrawnSignature(`data:image/svg+xml;base64,${png.toString('base64')}`)).toEqual({ ok: false, reason: 'format' });
    expect(parseDrawnSignature(`data:image/png;base64,${Buffer.from('not a png at all, really').toString('base64')}`)).toEqual({ ok: false, reason: 'format' });
    expect(parseDrawnSignature('https://evil.test/x.png')).toEqual({ ok: false, reason: 'format' });
    const big = Buffer.concat([png, Buffer.alloc(300 * 1024, 2)]);
    expect(parseDrawnSignature(`data:image/png;base64,${big.toString('base64')}`)).toEqual({ ok: false, reason: 'size' });
  });
});

describe('signer links', () => {
  it('tokens are opaque 43-char values and only their hash is meant to be stored', () => {
    const t = newSignToken();
    expect(isWellFormedSignToken(t)).toBe(true);
    expect(newSignToken()).not.toBe(t);
    expect(hashSignToken(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashSignToken(t)).not.toContain(t);
    expect(isWellFormedSignToken('short')).toBe(false);
    expect(isWellFormedSignToken(`${t}x`)).toBe(false);
    expect(isWellFormedSignToken('../'.padEnd(43, 'a'))).toBe(false);
  });

  it('works while sent, not revoked, not expired — and stops with the contract', () => {
    const now = new Date('2026-11-01T00:00:00Z');
    const live = { contractStatus: 'sent' as const, tokenRevoked: false, expiresAt: '2026-11-10T00:00:00Z' };
    expect(linkUsable(live, now)).toBe(true);
    expect(linkUsable({ ...live, tokenRevoked: true }, now)).toBe(false);
    expect(linkUsable({ ...live, expiresAt: '2026-10-31T00:00:00Z' }, now)).toBe(false);
    expect(linkUsable({ ...live, contractStatus: 'void' }, now)).toBe(false);
    expect(linkUsable({ ...live, contractStatus: 'signed' }, now)).toBe(false);
    expect(linkUsable({ ...live, contractStatus: 'draft' }, now)).toBe(false);
  });

  it('a signed contract’s link can still be opened for the receipt, but not signed; void and revoked cannot', () => {
    const now = new Date('2026-11-01T00:00:00Z');
    const live = { contractStatus: 'signed' as const, tokenRevoked: false, expiresAt: '2026-11-10T00:00:00Z' };
    expect(linkReadable(live, now)).toBe(true);
    expect(linkUsable(live, now)).toBe(false);
    expect(linkReadable({ ...live, contractStatus: 'void' }, now)).toBe(false);
    expect(linkReadable({ ...live, tokenRevoked: true }, now)).toBe(false);
    expect(linkReadable({ ...live, expiresAt: '2026-10-01T00:00:00Z' }, now)).toBe(false);
    expect(linkReadable({ ...live, contractStatus: 'draft' }, now)).toBe(false);
  });
});

describe('cleanProviderUrl', () => {
  it('keeps an https address, empties to null and refuses everything else', () => {
    expect(cleanProviderUrl('https://sign.example.com/doc/42')).toBe('https://sign.example.com/doc/42');
    expect(cleanProviderUrl('  ')).toBeNull();
    expect(cleanProviderUrl(null)).toBeNull();
    for (const bad of ['http://sign.example.com', 'javascript:alert(1)', 'https://user:pw@sign.example.com', 'https://localhost', 'https://a b.example.com', 'ftp://x.example.com', 'https://sign.example.com/d?e=a@b.com', 5]) {
      expect(cleanProviderUrl(bad), String(bad)).toBe('invalid');
    }
    expect(cleanProviderUrl(`https://sign.example.com/${'a'.repeat(500)}`)).toBe('invalid');
  });
});

describe('contractEnd / expiryState', () => {
  it('ends the day before the term’s anniversary', () => {
    expect(contractEnd('2026-01-01', 12)).toBe('2026-12-31');
    expect(contractEnd('2026-03-15', 24)).toBe('2028-03-14');
  });
  it('clamps to a short month and crosses years', () => {
    expect(contractEnd('2026-01-31', 1)).toBe('2026-02-27');
    expect(contractEnd('2026-11-15', 3)).toBe('2027-02-14');
  });
  it('is null without a start, a term, or on a bad date', () => {
    expect(contractEnd(null, 12)).toBeNull();
    expect(contractEnd('2026-01-01', null)).toBeNull();
    expect(contractEnd('2026-02-31', 12)).toBeNull();
    expect(contractEnd('01/01/2026', 12)).toBeNull();
  });

  const c = (status: 'sent' | 'signed' | 'draft' | 'void', eff = '2026-01-01', term = 12) => ({ status, effective_date: eff, term_months: term });
  it('marks sent and signed contracts ok / soon / expired and ignores drafts and void', () => {
    expect(expiryState(c('signed'), '2026-06-01')).toEqual({ kind: 'ok', days: 213 });
    expect(expiryState(c('signed'), '2026-11-01')).toEqual({ kind: 'soon', days: 60 });
    expect(expiryState(c('signed'), '2027-01-02')).toEqual({ kind: 'expired', days: 2 });
    expect(expiryState(c('sent'), '2026-12-31')).toEqual({ kind: 'soon', days: 0 });
    expect(expiryState(c('draft'), '2027-06-01')).toEqual({ kind: 'none' });
    expect(expiryState(c('void'), '2027-06-01')).toEqual({ kind: 'none' });
    expect(expiryState({ status: 'signed', effective_date: null, term_months: null }, '2026-06-01')).toEqual({ kind: 'none' });
  });
});

describe('filterStore', () => {
  const rows: StoreRow[] = [
    { id: '1', type: 'recording', title: 'Nova recording deal', status: 'signed', effective_date: '2026-01-01', term_months: 12, parties: [{ name: 'North Records' }, { name: 'Nova Example' }] },
    { id: '2', type: 'nda', title: 'Studio NDA', status: 'sent', effective_date: '2026-11-01', term_months: 36, parties: [{ name: 'North Records' }, { name: 'Kilo Ñandú' }] },
    { id: '3', type: 'recording', title: 'Kilo recording deal', status: 'draft', effective_date: null, term_months: null, parties: [{ name: 'Kilo Ñandú' }] },
  ];
  const ids = (q: Parameters<typeof filterStore>[1]) => filterStore(rows, q, '2026-11-01').map((r) => r.id);

  it('everything without a query', () => expect(ids({})).toEqual(['1', '2', '3']));
  it('every word must match, across title, type, party and status', () => {
    expect(ids({ q: 'nova' })).toEqual(['1']);
    expect(ids({ q: 'nova signed' })).toEqual(['1']);
    expect(ids({ q: 'kilo recording' })).toEqual(['3']);
    expect(ids({ q: 'north' })).toEqual(['1', '2']);
    expect(ids({ q: 'nova draft' })).toEqual([]);
  });
  it('folds accents and case', () => expect(ids({ q: 'NANDU' })).toEqual(['2', '3']));
  it('filters by status, type and expiring', () => {
    expect(ids({ status: 'sent' })).toEqual(['2']);
    expect(ids({ type: 'recording' })).toEqual(['1', '3']);
    expect(ids({ expiring: true })).toEqual(['1']);
    expect(ids({ status: 'all', type: 'all' })).toEqual(['1', '2', '3']);
  });
});
