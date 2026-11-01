/**
 * Signing, links, provider address and supersede (LABEL-60), through the REAL
 * org-access, the real signing flow (document hash, planSign, the split-sheet
 * gate) and the route code, against an in-memory database whose audit
 * functions mirror migration 178 (lib/labelos/mocks/contract-signing-memory).
 *
 *   L: OWN (owner), LEG (legal: contracts.write), ART (role artist, Nova; the
 *      account behind party PN), MKT (marketing). L2: X (owner).
 *   Parties: PL the label (no account), PN Nova (account ART), PX (L2).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { memoryAdmin, type MemoryDb } from '@/lib/labelos/mocks/memory-db';
import { contractSigningMemory } from '@/lib/labelos/mocks/contract-signing-memory';
import { hashSignToken } from '@/lib/labelos/contract-signing';

const L = '10000000-0000-4000-8000-000000000001';
const L2 = '10000000-0000-4000-8000-000000000002';
const u = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const OWN = u(1);
const LEG = u(2);
const MKT = u(4);
const ART = u(5);
const X = u(7);
const STRANGER = u(8);
const C1 = '30000000-0000-4000-8000-0000000000c1';
const PL = '60000000-0000-4000-8000-000000000001';
const PN = '60000000-0000-4000-8000-000000000002';
const T1 = '50000000-0000-4000-8000-000000000001';
const K1 = '70000000-0000-4000-8000-000000000001';
const PNG = `data:image/png;base64,${Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 3)]).toString('base64')}`;

let current: string | null = null;
let db: MemoryDb;
const stored: string[] = [];
const removed: string[] = [];

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: current ? { id: current } : null } }) } }),
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => memoryAdmin(db).client }));
vi.mock('@/lib/log', () => ({ createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }) }));
vi.mock('@/lib/security/rate-limit', () => ({ rateLimitDurable: async () => true, clientIp: () => '203.0.113.9', rateLimit: () => true }));
vi.mock('@/lib/storage/project-assets', () => ({
  storeProjectAsset: async (_b: Buffer, key: string) => {
    stored.push(`local://${key}`);
    return `local://${key}`;
  },
  deleteProjectAssetObject: async (ref: string) => {
    removed.push(ref);
  },
  streamProjectAsset: async () => new Response('png-bytes', { status: 200, headers: { 'content-type': 'image/png' } }),
}));

const member = (user: string, role: string, functions: string[] = [], scope = 'org', org = L) => ({ org_id: org, user_id: user, role, functions, scope, cap_grants: [], cap_revokes: [] });

const contractRow = (over: Record<string, unknown> = {}) => ({
  id: K1, org_id: L, type: 'recording', title: 'Nova recording agreement', status: 'sent', template_id: null,
  template_source: 'platform:recording@1', template_version: 1, clauses: [{ id: 'a', heading: 'Parties', body: 'This agreement is between {{party.label}} and {{party.artist}}.' }],
  artist_contact_id: C1, track_id: null, release_id: null, effective_date: '2027-01-01', term_months: 24, territories: null, fields: {},
  internal_note: 'SECRET-NOTE', version: 1, created_by: OWN, voided_at: null, void_reason: null, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z',
  esign_provider_url: null, supersedes_id: null, superseded_by: null, ...over,
});

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-secret-key';
  current = null;
  stored.length = 0;
  removed.length = 0;
  db = {
    tables: {
      organizations: [{ id: L, kind: 'label', deleted_at: null, settings: {} }, { id: L2, kind: 'label', deleted_at: null, settings: {} }],
      org_members: [member(OWN, 'owner'), member(LEG, 'member', ['legal']), member(MKT, 'member', ['marketing']), member(ART, 'artist', [], 'artists'), member(X, 'owner', [], 'org', L2)],
      member_artist_scopes: [{ org_id: L, user_id: ART, contact_id: C1 }],
      contacts: [{ id: C1, org_id: L, user_id: null, name: 'Nova', category: 'artist' }],
      tracks: [{ id: T1, org_id: L, user_id: null, type: 'song', title: 'Midnight', song_stage: 'inbox' }],
      parties: [
        { id: PL, org_id: L, display_name: 'Label L', legal_name: 'Label L Ltd', address: '1 Label Way', user_id: null },
        { id: PN, org_id: L, display_name: 'Nova', legal_name: 'Nova Okafor', address: '2 Road', user_id: ART },
      ],
      contracts: [contractRow()],
      contract_parties: [
        { contract_id: K1, org_id: L, party_id: PL, role: 'label', position: 0 },
        { contract_id: K1, org_id: L, party_id: PN, role: 'artist', position: 1 },
      ],
      contract_signatures: [],
      contract_signers: [],
      contract_templates: [],
      split_sheets: [],
      split_lines: [],
      activity_events: [],
      user_profiles: [],
    },
    rpc: contractSigningMemory(),
  };
});

type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

async function call(method: string, as: string | null, part: 'signing' | 'links' | 'provider' | 'supersede' | 'image', body?: unknown, opts: { org?: string; contract?: string; signature?: string } = {}) {
  current = as;
  const org = opts.org ?? L;
  const contract = opts.contract ?? K1;
  const params: Record<string, string> = { orgId: org, contractId: contract };
  let mod: Record<string, Handler>;
  let path = `contracts/${contract}`;
  if (part === 'signing') {
    mod = (await import('./route')) as unknown as Record<string, Handler>;
    path += '/signing';
  } else if (part === 'links') {
    mod = (await import('./links/route')) as unknown as Record<string, Handler>;
    path += '/signing/links';
  } else if (part === 'provider') {
    mod = (await import('./provider/route')) as unknown as Record<string, Handler>;
    path += '/signing/provider';
  } else if (part === 'image') {
    mod = (await import('./signatures/[signatureId]/image/route')) as unknown as Record<string, Handler>;
    params.signatureId = opts.signature ?? 'x';
    path += `/signing/signatures/${params.signatureId}/image`;
  } else {
    mod = (await import('../supersede/route')) as unknown as Record<string, Handler>;
    path += '/supersede';
  }
  const init = method === 'GET' ? { method } : { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) };
  return mod[method](new NextRequest(`https://app.test/api/org/${org}/${path}`, init), { params: Promise.resolve(params) });
}

const sign = (as: string, party: string, extra: Record<string, unknown> = {}) =>
  call('POST', as, 'signing', { party_id: party, version: 1, name: 'Test Signer', ...extra });
const view = async (as: string) => (await call('GET', as, 'signing')).json();
const verbs = () => db.tables.activity_events.map((e) => e.verb);

describe('GET …/signing', () => {
  it('shows each party where it stands, the document hash, and who the caller may sign for', async () => {
    const v = await view(ART);
    expect(v.documentSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(v.signers.map((s: { name: string; status: string }) => [s.name, s.status])).toEqual([['Label L Ltd', 'pending'], ['Nova Okafor', 'pending']]);
    expect(v.youCanSignFor).toEqual([PN]);
    expect(v.canManage).toBe(false);
    expect(v.statement).toMatch(/not a qualified or advanced electronic signature/);
    expect(v.progress).toMatchObject({ total: 2, signed: 0, complete: false });
  });

  it('never sends the internal note, a token hash, an image reference or an address hash', async () => {
    await call('POST', LEG, 'links', { party_id: PN });
    await sign(ART, PN, { drawing: PNG });
    for (const who of [OWN, LEG, ART]) {
      const text = await (await call('GET', who, 'signing')).text();
      expect(text, who).not.toContain('SECRET-NOTE');
      expect(text, who).not.toMatch(/token_hash|signature_image|ip_hash|imageRef|local:\/\//);
    }
  });

  it('contracts staff see the link state; the artist does not, and neither sees the other’s link', async () => {
    await call('POST', LEG, 'links', { party_id: PN });
    const staff = await view(LEG);
    expect(staff.canManage).toBe(true);
    expect(staff.signers.find((s: { partyId: string }) => s.partyId === PN).link.active).toBe(true);
    expect(staff.youCanSignFor).toEqual([PL]); // the countersignature for the label’s side
    const artist = await view(ART);
    expect(artist.signers.every((s: { link?: unknown }) => s.link === undefined)).toBe(true);
  });

  it('a draft is not readable by the artist (404) and a stranger, marketing and another org get nothing', async () => {
    db.tables.contracts[0].status = 'draft';
    expect((await call('GET', ART, 'signing')).status).toBe(404);
    db.tables.contracts[0].status = 'sent';
    expect((await call('GET', STRANGER, 'signing')).status).toBe(403);
    expect((await call('GET', X, 'signing')).status).toBe(403);
    expect((await call('GET', MKT, 'signing')).status).toBe(404);
    expect((await call('GET', null, 'signing')).status).toBe(401);
  });
});

describe('POST …/signing — signing as a member', () => {
  it('the artist signs for their own party; the label’s countersignature completes the contract (sent → signed) with both events', async () => {
    const first = await sign(ART, PN);
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ ok: true, completed: false, status: 'sent' });
    expect(db.tables.contracts[0].status).toBe('sent');
    const second = await sign(LEG, PL);
    expect(await second.json()).toMatchObject({ ok: true, completed: true, status: 'signed' });
    expect(db.tables.contracts[0].status).toBe('signed');
    expect(verbs()).toEqual(['contract.signature_added', 'contract.signature_added', 'contract.signed']);
    const sig = db.tables.contract_signatures.find((s) => s.party_id === PL)!;
    expect(sig.countersign).toBe(true);
    expect(sig.via).toBe('member');
    expect(sig.ip_hash).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.stringify(db.tables.contract_signatures)).not.toContain('203.0.113.9'); // only the hash of the address is stored
  });

  it('nobody signs for another person’s party, whatever they may write', async () => {
    expect((await sign(ART, PL)).status).toBe(403);
    expect((await sign(LEG, PN)).status).toBe(403);
    expect((await sign(OWN, PN)).status).toBe(403);
    expect(db.tables.contract_signatures).toHaveLength(0);
  });

  it('a party that is not on the contract is 404; a stranger and another org are refused', async () => {
    expect((await sign(LEG, '60000000-0000-4000-8000-0000000000ff')).status).toBe(404);
    expect((await sign(STRANGER, PN)).status).toBe(403);
    expect((await call('POST', X, 'signing', { party_id: PN, version: 1, name: 'Mallory' })).status).toBe(403);
  });

  it('refuses a version the signer did not read (409, code changed) and a contract that is not out for signature', async () => {
    const stale = await call('POST', ART, 'signing', { party_id: PN, version: 7, name: 'Nova Okafor' });
    expect(stale.status).toBe(409);
    expect((await stale.json()).code).toBe('changed');
    db.tables.contracts[0].status = 'draft';
    expect((await sign(LEG, PL)).status).toBe(409);
    db.tables.contracts[0].status = 'void';
    expect((await (await sign(LEG, PL)).json()).code).toBe('void');
    expect(db.tables.contract_signatures).toHaveLength(0);
  });

  it('signing twice is refused; a signed contract takes no more', async () => {
    await sign(ART, PN);
    const again = await sign(ART, PN);
    expect(again.status).toBe(409);
    expect((await again.json()).code).toBe('already_signed_by');
    await sign(LEG, PL);
    expect((await (await sign(LEG, PL)).json()).code).toBe('already_signed');
  });

  it('validates the name and the drawing: a short name, an SVG and an oversized PNG are 400 and store nothing', async () => {
    expect((await sign(ART, PN, { name: 'x' })).status).toBe(400);
    expect((await sign(ART, PN, { drawing: 'data:image/svg+xml;base64,PHN2Zy8+' })).status).toBe(400);
    const big = `data:image/png;base64,${Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(260 * 1024, 1)]).toString('base64')}`;
    expect((await sign(ART, PN, { drawing: big })).status).toBe(400);
    expect(stored).toHaveLength(0);
    expect((await call('POST', ART, 'signing', { party_id: PN, version: 1, name: 'Nova Okafor', extra: 1 })).status).toBe(400);
  });

  it('a drawn signature goes to the private bucket under the org, the row keeps only the reference, and a failed write removes it again', async () => {
    const ok = await sign(ART, PN, { drawing: PNG });
    expect(ok.status).toBe(200);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatch(new RegExp(`^local://orgs/${L}/assets/${K1}/[A-Za-z0-9_-]+\\.png$`));
    expect(db.tables.contract_signatures[0]).toMatchObject({ method: 'drawn', signature_image: stored[0] });

    db.tables.contract_signatures.length = 0;
    db.rpc!.labelos_audit_contract_sign = () => ({ data: { error: 'changed' }, error: null });
    const lost = await sign(ART, PN, { drawing: PNG });
    expect(lost.status).toBe(409);
    expect(removed).toContain(stored[1]);
  });

  it('a missing migration 178 is a 503 naming it, not a 500', async () => {
    db.rpc!.labelos_audit_contract_sign = () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.labelos_audit_contract_sign in the schema cache' } });
    const res = await sign(ART, PN);
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/178/);
  });

  it('serves the drawn image to a reader of the contract only, as a stream, never as a URL', async () => {
    await sign(ART, PN, { drawing: PNG });
    const id = db.tables.contract_signatures[0].id as string;
    const ok = await call('GET', LEG, 'image', undefined, { signature: id });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toBe('image/png');
    expect((await call('GET', MKT, 'image', undefined, { signature: id })).status).toBe(404);
    expect((await call('GET', LEG, 'image', undefined, { signature: '70000000-0000-4000-8000-0000000000aa' })).status).toBe(404);
  });
});

describe('a changed document invalidates earlier signatures — derived on read, nothing rewritten', () => {
  it('editing a party’s legal name after Nova signed leaves her signature as a row that no longer counts, and the contract cannot complete on it', async () => {
    await sign(ART, PN);
    const before = JSON.stringify(db.tables.contract_signatures);
    db.tables.parties[1].legal_name = 'Nova Okafor-Smith';
    const v = await view(LEG);
    expect(v.signers.find((s: { partyId: string }) => s.partyId === PN).status).toBe('stale');
    expect(v.progress).toMatchObject({ signed: 0, stale: 1, pending: 1 });
    expect(JSON.stringify(db.tables.contract_signatures)).toBe(before);

    const label = await (await sign(LEG, PL)).json();
    expect(label.completed).toBe(false);
    expect(db.tables.contracts[0].status).toBe('sent');

    // Nova reads the new text and signs it: a second row, and now the contract completes.
    expect((await (await sign(ART, PN)).json()).completed).toBe(true);
    expect(db.tables.contract_signatures).toHaveLength(3);
    expect(db.tables.contracts[0].status).toBe('signed');
  });
});

describe('the split-sheet conditions on signing', () => {
  const feature = () => {
    Object.assign(db.tables.contracts[0], { type: 'feature', track_id: T1, fields: { master_share: '20' } });
    db.tables.contract_parties.length = 0;
    db.tables.contract_parties.push({ contract_id: K1, org_id: L, party_id: PL, role: 'label', position: 0 }, { contract_id: K1, org_id: L, party_id: PN, role: 'featured', position: 1 });
  };
  const sheet = (status: string, share: string) => {
    db.tables.split_sheets.push({ id: '80000000-0000-4000-8000-000000000001', org_id: L, track_id: T1, kind: 'master', version: 1, status, note: null, created_at: '2026-10-01T00:00:00Z' });
    db.tables.split_lines.push({ id: '80000000-0000-4000-8000-000000000002', split_sheet_id: '80000000-0000-4000-8000-000000000001', org_id: L, party_id: PN, role: 'master_owner', share, position: 0, created_at: '2026-10-01T00:00:00Z' });
  };

  it('require_signed_master_split: no signed master sheet → 409 master_split_not_signed; a signed one lets it through', async () => {
    feature();
    (db.tables.organizations[0] as { settings: unknown }).settings = { require_signed_master_split: true };
    const refused = await sign(ART, PN);
    expect(refused.status).toBe(409);
    expect((await refused.json()).code).toBe('master_split_not_signed');
    expect(db.tables.contract_signatures).toHaveLength(0);
    sheet('signed', '20.0000');
    expect((await sign(ART, PN)).status).toBe(200);
  });

  it('a SIGNED master sheet that disagrees with the contract blocks signing (split_drift), with or without the requirement', async () => {
    feature();
    sheet('signed', '35.0000');
    const refused = await sign(ART, PN);
    expect(refused.status).toBe(409);
    const body = await refused.json();
    expect(body.code).toBe('split_drift');
    expect(body.error).toMatch(/master split sheet/);
    expect(db.tables.contract_signatures).toHaveLength(0);
    expect((await view(ART)).blocked).toMatchObject({ code: 'split_drift' });
  });

  it('a circulated (not yet signed) sheet that disagrees does not block: it can still be amended', async () => {
    feature();
    sheet('circulated', '35.0000');
    expect((await sign(ART, PN)).status).toBe(200);
  });
});

describe('signing links', () => {
  it('contracts.write issues one: the token is in that response only, the database holds its hash, and the event names no token', async () => {
    const res = await call('POST', LEG, 'links', { party_id: PN });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(body.path).toBe(`/sign/${body.token}`);
    const row = db.tables.contract_signers[0];
    expect(row.token_hash).toBe(hashSignToken(body.token));
    expect(JSON.stringify(db.tables)).not.toContain(body.token);
    expect(verbs()).toEqual(['contract.signer_link_issued']);
    expect(JSON.stringify(db.tables.activity_events)).not.toMatch(/token/i);
  });

  it('a new link replaces the old one; revoking ends it', async () => {
    const a = await (await call('POST', LEG, 'links', { party_id: PN })).json();
    const b = await (await call('POST', LEG, 'links', { party_id: PN })).json();
    expect(b.token).not.toBe(a.token);
    expect(db.tables.contract_signers).toHaveLength(1);
    expect(db.tables.contract_signers[0].token_hash).toBe(hashSignToken(b.token));
    expect((await call('DELETE', LEG, 'links', { party_id: PN })).status).toBe(200);
    expect(db.tables.contract_signers[0].token_hash).toBeNull();
    expect((await call('DELETE', LEG, 'links', { party_id: PN })).status).toBe(409);
    expect(verbs()).toEqual(['contract.signer_link_issued', 'contract.signer_link_issued', 'contract.signer_link_revoked']);
  });

  it('only for a contract that is out for signature and a party on it; the artist, marketing and strangers cannot', async () => {
    db.tables.contracts[0].status = 'draft';
    expect((await call('POST', LEG, 'links', { party_id: PN })).status).toBe(409);
    db.tables.contracts[0].status = 'sent';
    expect((await call('POST', LEG, 'links', { party_id: '60000000-0000-4000-8000-0000000000ff' })).status).toBe(404);
    expect((await call('POST', ART, 'links', { party_id: PN })).status).toBe(403);
    expect((await call('POST', MKT, 'links', { party_id: PN })).status).toBe(403);
    expect((await call('POST', X, 'links', { party_id: PN })).status).toBe(403);
    expect(db.tables.contract_signers).toHaveLength(0);
  });
});

describe('the external e-signature address', () => {
  it('https only: http, javascript:, credentials and other schemes are 400; a good one is saved and recorded without being copied into the event', async () => {
    for (const bad of ['http://sign.example.com/d/1', 'javascript:alert(1)', 'https://u:p@sign.example.com/d/1', 'ftp://sign.example.com']) {
      expect((await call('PUT', LEG, 'provider', { url: bad })).status, bad).toBe(400);
    }
    expect((await call('PUT', LEG, 'provider', { url: 'https://sign.example.com/d/1' })).status).toBe(200);
    expect(db.tables.contracts[0].esign_provider_url).toBe('https://sign.example.com/d/1');
    const e = db.tables.activity_events.at(-1)!;
    expect(e.verb).toBe('contract.esign_url_set');
    expect(JSON.stringify(e.payload)).toBe('{"set":true}');
    expect((await view(ART)).providerUrl).toBe('https://sign.example.com/d/1');
    expect((await call('PUT', LEG, 'provider', { url: null })).status).toBe(200);
    expect(db.tables.contracts[0].esign_provider_url).toBeNull();
  });

  it('needs contracts.write; a void contract is not edited', async () => {
    expect((await call('PUT', ART, 'provider', { url: 'https://sign.example.com/d/1' })).status).toBe(403);
    db.tables.contracts[0].status = 'void';
    expect((await call('PUT', LEG, 'provider', { url: 'https://sign.example.com/d/1' })).status).toBe(409);
  });
});

describe('POST …/supersede', () => {
  it('voids a sent contract, starts a draft copy without the internal note, and stops its links', async () => {
    await call('POST', LEG, 'links', { party_id: PN });
    const res = await call('POST', LEG, 'supersede', { reason: 'Wrong term' });
    expect(res.status).toBe(200);
    const { new_id } = await res.json();
    const old = db.tables.contracts.find((c) => c.id === K1)!;
    const copy = db.tables.contracts.find((c) => c.id === new_id)!;
    expect(old).toMatchObject({ status: 'void', superseded_by: new_id, void_reason: 'Wrong term' });
    expect(copy).toMatchObject({ status: 'draft', supersedes_id: K1, internal_note: null });
    expect(db.tables.contract_parties.filter((p) => p.contract_id === new_id)).toHaveLength(2);
    expect(db.tables.contract_signers[0].token_hash).toBeNull();
    expect(verbs().at(-1)).toBe('contract.superseded');
    expect((await call('POST', LEG, 'supersede', {})).status).toBe(409);
  });

  it('a signed contract can be replaced and keeps its signatures; a draft cannot; the artist cannot', async () => {
    await sign(ART, PN);
    await sign(LEG, PL);
    expect((await call('POST', ART, 'supersede', {})).status).toBe(403);
    expect((await call('POST', LEG, 'supersede', {})).status).toBe(200);
    expect(db.tables.contract_signatures).toHaveLength(2);
    db.tables.contracts.find((c) => c.id !== K1)!.status = 'draft';
    const draft = db.tables.contracts.find((c) => c.id !== K1)!.id as string;
    expect((await call('POST', LEG, 'supersede', {}, { contract: draft })).status).toBe(409);
  });
});
