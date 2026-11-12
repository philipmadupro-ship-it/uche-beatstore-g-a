/**
 * /api/sign/[token] (LABEL-60): the external signer's entrance, through the
 * real route, the real signing flow and a memory database whose audit
 * functions mirror migration 178. No session exists anywhere in this file:
 * the link is the only credential.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { memoryAdmin, type MemoryDb } from '@/lib/labelos/mocks/memory-db';
import { contractSigningMemory } from '@/lib/labelos/mocks/contract-signing-memory';
import { hashSignToken, newSignToken } from '@/lib/labelos/contract-signing';

const L = '10000000-0000-4000-8000-000000000001';
const L2 = '10000000-0000-4000-8000-000000000002';
const PL = '60000000-0000-4000-8000-000000000001';
const PN = '60000000-0000-4000-8000-000000000002';
const K1 = '70000000-0000-4000-8000-000000000001';
const K2 = '70000000-0000-4000-8000-000000000002';
const OTHER_PARTY = '60000000-0000-4000-8000-000000000009';
const PNG = `data:image/png;base64,${Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 3)]).toString('base64')}`;

let db: MemoryDb;
let allowed = true;
const removed: string[] = [];
const stored: string[] = [];

vi.mock('server-only', () => ({}));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => memoryAdmin(db).client }));
vi.mock('@/lib/log', () => ({ createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }) }));
vi.mock('@/lib/security/rate-limit', () => ({ rateLimitDurable: async () => allowed, clientIp: () => '203.0.113.9', rateLimit: () => true }));
vi.mock('@/lib/storage/project-assets', () => ({
  storeProjectAsset: async (_b: Buffer, key: string) => {
    stored.push(`local://${key}`);
    return `local://${key}`;
  },
  deleteProjectAssetObject: async (ref: string) => {
    removed.push(ref);
  },
}));

const contractRow = (over: Record<string, unknown> = {}) => ({
  id: K1, org_id: L, type: 'nda', title: 'Studio NDA', status: 'sent', template_id: null, template_source: 'platform:nda@1', template_version: 1,
  clauses: [{ id: 'a', heading: 'Parties', body: 'Between {{party.disclosing}} and {{party.receiving}}.' }],
  artist_contact_id: null, track_id: null, release_id: null, effective_date: null, term_months: null, territories: null, fields: {},
  internal_note: 'SECRET-NOTE', version: 1, created_by: null, voided_at: null, void_reason: null, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z',
  esign_provider_url: 'https://sign.example.com/d/1', supersedes_id: null, superseded_by: null,
  sent_document_sha256: 'c'.repeat(64), sent_document_ref: 'local://orgs/x/assets/y/sent.pdf',
  sent_snapshot: { title: 'Studio NDA', typeLabel: 'Non-disclosure (NDA)', version: 1, parties: [{ roleLabel: 'Disclosing party', name: 'Label L Ltd' }, { roleLabel: 'Receiving party', name: 'Nova Okafor' }], clauses: [{ id: 'a', heading: 'Parties', body: 'Between Label L Ltd and Nova Okafor.' }] },
  ...over,
});

let TOKEN_PN: string;
let TOKEN_PL: string;

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-secret-key';
  allowed = true;
  stored.length = 0;
  removed.length = 0;
  TOKEN_PN = newSignToken();
  TOKEN_PL = newSignToken();
  db = {
    tables: {
      organizations: [{ id: L, kind: 'label', deleted_at: null, settings: {} }, { id: L2, kind: 'label', deleted_at: null, settings: {} }],
      org_entitlements: [],
      parties: [
        { id: PL, org_id: L, display_name: 'Label L', legal_name: 'Label L Ltd', address: '1 Label Way', user_id: null },
        { id: PN, org_id: L, display_name: 'Nova', legal_name: 'Nova Okafor', address: '2 Road', user_id: null },
      ],
      contacts: [],
      tracks: [],
      releases: [],
      contracts: [contractRow(), contractRow({ id: K2, title: 'A different contract', internal_note: 'OTHER-NOTE' })],
      contract_parties: [
        { contract_id: K1, org_id: L, party_id: PL, role: 'disclosing', position: 0 },
        { contract_id: K1, org_id: L, party_id: PN, role: 'receiving', position: 1 },
        { contract_id: K2, org_id: L, party_id: PN, role: 'receiving', position: 0 },
      ],
      contract_signers: [
        { id: 's1', contract_id: K1, org_id: L, party_id: PN, role: 'receiving', token_hash: hashSignToken(TOKEN_PN), link_issued_at: '2026-10-30T00:00:00Z', link_expires_at: '2099-01-01T00:00:00Z', link_revoked_at: null },
        { id: 's2', contract_id: K1, org_id: L, party_id: PL, role: 'disclosing', token_hash: hashSignToken(TOKEN_PL), link_issued_at: '2026-10-30T00:00:00Z', link_expires_at: '2099-01-01T00:00:00Z', link_revoked_at: null },
      ],
      contract_signatures: [],
      split_sheets: [],
      split_lines: [],
      activity_events: [],
    },
    rpc: contractSigningMemory(),
  };
});

type Handler = (req: NextRequest, ctx: { params: Promise<{ token: string }> }) => Promise<Response>;
async function call(method: 'GET' | 'POST', token: string, body?: unknown) {
  const mod = (await import('./route')) as unknown as Record<string, Handler>;
  const init = method === 'GET' ? { method } : { method, headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9' }, body: JSON.stringify(body ?? {}) };
  return mod[method](new NextRequest(`https://app.test/api/sign/${token}`, init), { params: Promise.resolve({ token }) });
}
const shaOf = async (token: string) => (await (await call('GET', token)).json()).documentSha256 as string;
const sign = async (token: string, extra: Record<string, unknown> = {}) => call('POST', token, { version: 1, document_sha256: await shaOf(token), name: 'Nova Okafor', ...extra });

describe('every failure to identify the caller is one 404', () => {
  async function notFound(res: Response) {
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Not found' });
  }

  it('malformed, unknown, and another contract’s token look the same', async () => {
    await notFound(await call('GET', 'short'));
    await notFound(await call('GET', '../../etc/passwd'));
    await notFound(await call('GET', newSignToken()));
    await notFound(await call('POST', newSignToken(), { version: 1, document_sha256: 'a'.repeat(64), name: 'Nova Okafor' }));
  });

  it('revoked, expired, void, draft, deleted-org and unlicensed-module links look the same too', async () => {
    db.tables.contract_signers[0].token_hash = null; // revoked
    await notFound(await call('GET', TOKEN_PN));
    db.tables.contract_signers[0].token_hash = hashSignToken(TOKEN_PN);

    db.tables.contract_signers[0].link_expires_at = '2020-01-01T00:00:00Z';
    await notFound(await call('GET', TOKEN_PN));
    db.tables.contract_signers[0].link_expires_at = '2099-01-01T00:00:00Z';

    for (const status of ['void', 'draft']) {
      db.tables.contracts[0].status = status;
      await notFound(await call('GET', TOKEN_PN));
      await notFound(await sign(TOKEN_PN));
    }
    db.tables.contracts[0].status = 'sent';

    (db.tables.organizations[0] as { deleted_at: unknown }).deleted_at = '2026-10-31T00:00:00Z';
    await notFound(await call('GET', TOKEN_PN));
    (db.tables.organizations[0] as { deleted_at: unknown }).deleted_at = null;

    db.tables.org_entitlements.push({ org_id: L, modules: ['catalog'], max_seats: null, max_artists: null, setup_done: true });
    await notFound(await call('GET', TOKEN_PN));
    expect(db.tables.contract_signatures).toHaveLength(0);
  });

  it('a link whose party was taken off the contract is a 404', async () => {
    db.tables.contract_parties = db.tables.contract_parties.filter((p) => !(p.contract_id === K1 && p.party_id === PN));
    await notFound(await call('GET', TOKEN_PN));
  });
});

describe('GET', () => {
  it('serves the contract text and THIS party’s state; nothing of any other contract, link or note', async () => {
    const res = await call('GET', TOKEN_PN);
    expect(res.status).toBe(200);
    const text = await res.text();
    const body = JSON.parse(text);
    expect(body.contract).toMatchObject({ title: 'Studio NDA', version: 1, status: 'sent' });
    expect(body.you).toMatchObject({ name: 'Nova Okafor' });
    expect(body.clauses[0].body).toBe('Between Label L Ltd and Nova Okafor.'); // the text it was SENT with, not a live merge
    expect(body).toMatchObject({ state: 'pending', canSign: true, completed: false, providerUrl: 'https://sign.example.com/d/1' });
    expect(body.documentSha256).toBe('c'.repeat(64));
    expect(body.statement).toMatch(/not a qualified or advanced electronic signature/);
    for (const secret of ['SECRET-NOTE', 'OTHER-NOTE', 'A different contract', 'token_hash', TOKEN_PL, hashSignToken(TOKEN_PL), hashSignToken(TOKEN_PN), 'signer_link']) {
      expect(text, secret).not.toContain(secret);
    }
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
  });

  it('is rate limited by address (429), and the per-link allowance is not spent by a stranger’s guess', async () => {
    allowed = false;
    expect((await call('GET', TOKEN_PN)).status).toBe(429);
    expect((await call('GET', newSignToken())).status).toBe(429);
  });
});

describe('POST — signing through the link', () => {
  it('records the signature for the link’s party only, with no account, a hashed address and via link', async () => {
    const res = await sign(TOKEN_PN, { drawing: PNG });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, completed: false });
    const row = db.tables.contract_signatures[0];
    expect(row).toMatchObject({ party_id: PN, contract_id: K1, via: 'link', countersign: false, signed_by_user: null, method: 'drawn', signer_name: 'Nova Okafor' });
    expect(row.ip_hash).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.stringify(db.tables.contract_signatures)).not.toContain('203.0.113.9');
    expect(String(row.signature_image)).toMatch(new RegExp(`^local://orgs/${L}/assets/${K1}/`));
    const e = db.tables.activity_events.at(-1)!;
    expect(e).toMatchObject({ verb: 'contract.signature_added', actor_id: null });
    expect(JSON.stringify(db.tables.activity_events)).not.toContain(TOKEN_PN);
  });

  it('the last party completes the contract; afterwards the link still shows a receipt but takes no more', async () => {
    await sign(TOKEN_PL, { name: 'Label L Ltd' });
    const done = await sign(TOKEN_PN);
    expect(await done.json()).toEqual({ ok: true, completed: true });
    expect(db.tables.contracts[0].status).toBe('signed');
    expect(db.tables.activity_events.map((e) => e.verb)).toEqual(['contract.signature_added', 'contract.signature_added', 'contract.signed']);

    const receipt = await (await call('GET', TOKEN_PN)).json();
    expect(receipt).toMatchObject({ state: 'signed', canSign: false, completed: true });
    expect(receipt.receipt.signerName).toBe('Nova Okafor');
    const again = await sign(TOKEN_PN);
    expect(again.status).toBe(409);
    expect((await again.json()).code).toBe('already_signed');
  });

  it('refuses a version the signer did not read, a short name and a bad drawing — and stores nothing', async () => {
    const stale = await call('POST', TOKEN_PN, { version: 3, document_sha256: await shaOf(TOKEN_PN), name: 'Nova Okafor' });
    expect(stale.status).toBe(409);
    expect((await stale.json()).code).toBe('changed');
    expect((await sign(TOKEN_PN, { name: 'x' })).status).toBe(400);
    expect((await sign(TOKEN_PN, { drawing: 'data:image/svg+xml;base64,PHN2Zy8+' })).status).toBe(400);
    expect((await call('POST', TOKEN_PN, { version: 1, document_sha256: await shaOf(TOKEN_PN), name: 'Nova Okafor', party_id: PL })).status).toBe(400); // the party is the link's, never the body's
    expect(db.tables.contract_signatures).toHaveLength(0);
    expect(stored).toHaveLength(0);
  });

  it('a sign function that throws leaves no orphaned drawn image behind (review G14)', async () => {
    const body = { version: 1, document_sha256: await shaOf(TOKEN_PN), name: 'Nova Okafor', drawing: PNG };
    db.rpc = { ...db.rpc, labelos_audit_contract_sign: () => { throw new Error('network down'); } };
    const res = await call('POST', TOKEN_PN, body);
    expect(res.status).toBe(503);
    expect(stored).toHaveLength(1);
    expect(removed).toEqual(stored);
  });

  it('renaming a party after the contract was sent changes nothing the signer sees or signed: the frozen text, the same hash, still valid', async () => {
    await sign(TOKEN_PN);
    db.tables.parties[1].legal_name = 'Nova Okafor-Smith';
    const page = await (await call('GET', TOKEN_PN)).json();
    expect(page.state).toBe('signed');
    expect(page.clauses[0].body).toBe('Between Label L Ltd and Nova Okafor.');
    expect(page.documentSha256).toBe('c'.repeat(64));
    expect((await (await sign(TOKEN_PL, { name: 'Label L Ltd' })).json()).completed).toBe(true);
  });

  it('a contract sent before 178 (no frozen copy) is not offered for signing: one 404', async () => {
    Object.assign(db.tables.contracts[0], { sent_document_sha256: null, sent_document_ref: null, sent_snapshot: null });
    expect((await call('GET', TOKEN_PN)).status).toBe(404);
  });

  it('a link revoked or rotated while the signer was mid-request records nothing (the database re-checks it under its lock)', async () => {
    const sha = await shaOf(TOKEN_PN);
    db.tables.contract_signers[0].token_hash = hashSignToken(newSignToken()); // rotated after the route resolved the old one
    const res = await call('POST', TOKEN_PN, { version: 1, document_sha256: sha, name: 'Nova Okafor' });
    expect(res.status).toBe(404);
    expect(db.tables.contract_signatures).toHaveLength(0);
  });

  it('is limited per address: 429, and nothing is stored', async () => {
    allowed = false;
    expect((await sign(TOKEN_PN)).status).toBe(429);
    expect(db.tables.contract_signatures).toHaveLength(0);
  });
});
