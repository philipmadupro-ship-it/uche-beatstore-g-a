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
const emails: { to: string; text: string; subject: string }[] = [];
let emailFails = false;
let db: MemoryDb;
const stored: string[] = [];
const removed: string[] = [];

vi.mock('server-only', () => ({}));
vi.mock('resend', () => ({
  Resend: class {
    emails = {
      send: async (m: { to: string; text: string; subject: string }) => {
        if (emailFails) return { error: { message: 'boom' } };
        emails.push({ to: m.to, text: m.text, subject: m.subject });
        return { error: null };
      },
    };
  },
}));
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
  esign_provider_url: null, supersedes_id: null, superseded_by: null,
  // The frozen sent copy (migration 178): signatures bind to this hash, whatever a party is called later.
  sent_document_sha256: 'f'.repeat(64), sent_document_ref: 'local://orgs/x/assets/y/sent.pdf', sent_snapshot: { title: 'Nova recording agreement', typeLabel: 'Recording agreement', version: 1, parties: [{ roleLabel: 'Label', name: 'Label L Ltd' }, { roleLabel: 'Artist', name: 'Nova Okafor' }], clauses: [{ id: 'a', heading: 'Parties', body: 'Between Label L Ltd and Nova Okafor.' }] },
  ...over,
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
        { id: PN, org_id: L, display_name: 'Nova', legal_name: 'Nova Okafor', address: '2 Road', user_id: ART, user_linked_by: OWN, email: 'nova@example.com', details_confirmed_by: ART, details_confirmed_at: '2026-10-02T00:00:00Z' },
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

const currentSha = async () => (await (await call('GET', LEG, 'signing')).json()).documentSha256 as string;
const sign = async (as: string, party: string, extra: Record<string, unknown> = {}) =>
  call('POST', as, 'signing', { party_id: party, version: 1, document_sha256: await currentSha(), name: 'Test Signer', ...extra });
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
    expect((await call('POST', X, 'signing', { party_id: PN, version: 1, document_sha256: 'a'.repeat(64), name: 'Mallory' })).status).toBe(403);
  });

  it('refuses a version the signer did not read (409, code changed) and a contract that is not out for signature', async () => {
    const stale = await call('POST', ART, 'signing', { party_id: PN, version: 7, document_sha256: await currentSha(), name: 'Nova Okafor' });
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
    expect((await call('POST', ART, 'signing', { party_id: PN, version: 1, document_sha256: await currentSha(), name: 'Nova Okafor', extra: 1 })).status).toBe(400);
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

describe('the text the signer read', () => {
  it('a signature on a hash the signer did not see is a 409 even when the version is the same', async () => {
    const res = await call('POST', ART, 'signing', { party_id: PN, version: 1, document_sha256: 'a'.repeat(64), name: 'Nova Okafor' });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('changed');
    expect(db.tables.contract_signatures).toHaveLength(0);
  });

  it('a contract sent before 178 has no frozen copy: nothing can be signed, and the page says why', async () => {
    Object.assign(db.tables.contracts[0], { sent_document_sha256: null, sent_document_ref: null, sent_snapshot: null });
    const res = await call('POST', LEG, 'signing', { party_id: PL, version: 1, document_sha256: 'f'.repeat(64), name: 'Test Signer' });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('no_frozen_copy');
    expect((await view(LEG)).blocked).toMatchObject({ code: 'no_frozen_copy' });
  });
});

describe('the frozen sent copy: renaming a party or a song after sending changes nothing a signer signed', () => {
  it('Nova’s signature stays valid when her legal name and the song’s title are edited afterwards; the contract completes', async () => {
    await sign(ART, PN);
    const hashBefore = (await view(LEG)).documentSha256;
    db.tables.parties[1].legal_name = 'Nova Okafor-Smith';
    db.tables.tracks[0].title = 'Renamed';
    const v = await view(LEG);
    expect(v.documentSha256).toBe(hashBefore);
    expect(v.signers.find((s: { partyId: string }) => s.partyId === PN).status).toBe('signed');
    expect(v.progress).toMatchObject({ signed: 1, stale: 0 });
    expect((await (await sign(LEG, PL)).json()).completed).toBe(true);
    expect(db.tables.contracts[0].status).toBe('signed');
  });

  it('a signature recorded against another hash does not count (derived on read, nothing rewritten)', async () => {
    await sign(ART, PN);
    db.tables.contract_signatures[0].document_sha256 = 'e'.repeat(64);
    const before = JSON.stringify(db.tables.contract_signatures);
    const v = await view(LEG);
    expect(v.signers.find((s: { partyId: string }) => s.partyId === PN).status).toBe('stale');
    expect(JSON.stringify(db.tables.contract_signatures)).toBe(before);
  });
});

describe('who may sign as a party (LABEL-71 H1)', () => {
  it('a rights writer who links a party to their OWN account cannot sign as it', async () => {
    Object.assign(db.tables.parties[1], { user_id: LEG, details_confirmed_by: null, details_confirmed_at: null });
    const res = await call('POST', LEG, 'signing', { party_id: PN, version: 1, document_sha256: await currentSha(), name: 'Nova Okafor' });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('not_your_party');
    expect((await view(LEG)).youCanSignFor).not.toContain(PN);
    expect(db.tables.contract_signatures).toHaveLength(0);
  });

  it('nor when a colleague confirmed the link, nor can the real account sign once its confirmation is gone', async () => {
    Object.assign(db.tables.parties[1], { user_id: LEG, details_confirmed_by: OWN });
    expect((await sign(LEG, PN)).status).toBe(403);
    Object.assign(db.tables.parties[1], { user_id: ART, details_confirmed_by: null });
    expect((await sign(ART, PN)).status).toBe(403);
    expect(db.tables.contract_signatures).toHaveLength(0);
  });

  // The attack from the review: PATCH the party to point at yourself, confirm it as yourself, sign.
  async function party(method: 'PATCH' | 'POST', as: string, part: '' | 'confirm', body: unknown) {
    current = as;
    const mod = (await (part ? import('../../../parties/[partyId]/confirm/route') : import('../../../parties/[partyId]/route'))) as unknown as Record<string, Handler>;
    return mod[method](
      new NextRequest(`https://app.test/api/org/${L}/parties/${PN}${part ? '/confirm' : ''}`, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
      { params: Promise.resolve({ orgId: L, partyId: PN }) },
    );
  }

  it('H1: link yourself, confirm yourself, sign → the confirm is refused and the signature is 403', async () => {
    Object.assign(db.tables.parties[1], { user_id: null, user_linked_by: null, details_confirmed_by: null, details_confirmed_at: null });
    expect((await party('PATCH', LEG, '', { user_id: LEG })).status).toBe(200);
    expect(db.tables.parties[1]).toMatchObject({ user_id: LEG, user_linked_by: LEG });
    const confirm = await party('POST', LEG, 'confirm', {});
    expect(confirm.status).toBe(403);
    expect((await confirm.json()).code).toBe('self_linked');
    expect(db.tables.parties[1].details_confirmed_by ?? null).toBeNull();
    // Even if a confirmation got onto the row some other way, a link made by the signer themself signs nobody.
    db.tables.parties[1].details_confirmed_by = LEG;
    const res = await call('POST', LEG, 'signing', { party_id: PN, version: 1, document_sha256: await currentSha(), name: 'Nova Okafor' });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('not_your_party');
    expect(db.tables.contract_signatures).toHaveLength(0);
  });

  it('an account someone else linked, once it confirms the party itself, signs for it', async () => {
    Object.assign(db.tables.parties[1], { user_id: null, user_linked_by: null, details_confirmed_by: null, details_confirmed_at: null });
    expect((await party('PATCH', LEG, '', { user_id: ART })).status).toBe(200);
    expect(db.tables.parties[1]).toMatchObject({ user_id: ART, user_linked_by: LEG });
    expect((await sign(ART, PN)).status).toBe(403); // not confirmed yet
    expect((await party('POST', ART, 'confirm', {})).status).toBe(200);
    expect((await sign(ART, PN)).status).toBe(200);
    expect(db.tables.contract_signatures[0]).toMatchObject({ party_id: PN, via: 'member', signed_by_user: ART });
  });

  it('the label’s own side is signed by an owner, an admin or a contracts writer', async () => {
    expect((await sign(OWN, PL)).status).toBe(200);
    expect(db.tables.contract_signatures[0]).toMatchObject({ party_id: PL, countersign: true });
  });

  it('a party in another role is not the label’s side: no capability signs it, it signs through its link', async () => {
    db.tables.contract_parties.find((p) => p.party_id === PL)!.role = 'disclosing';
    expect((await sign(LEG, PL)).status).toBe(403);
    expect((await sign(OWN, PL)).status).toBe(403);
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

const tokenIn = (mail: { text: string }) => /\/sign\/([A-Za-z0-9_-]{43})/.exec(mail.text)![1];

describe('signing links', () => {
  beforeEach(() => {
    emails.length = 0;
    emailFails = false;
  });

  it('contracts.write issues one: the token goes to the PARTY by email and appears in no response (M1); the database holds its hash', async () => {
    const res = await call('POST', LEG, 'links', { party_id: PN });
    expect(res.status).toBe(200);
    const raw = await res.text();
    expect(emails).toHaveLength(1);
    expect(emails[0].to).toBe('nova@example.com');
    const token = tokenIn(emails[0]);
    expect(raw).not.toContain(token);
    expect(JSON.parse(raw)).toEqual({ ok: true, sentTo: 'no***@example.com', expiresAt: expect.any(String) });
    expect(db.tables.contract_signers[0].token_hash).toBe(hashSignToken(token));
    expect(db.tables.contract_signers[0].link_issued_by).toBe(LEG);
    expect(JSON.stringify(db.tables)).not.toContain(token);
    expect(verbs()).toEqual(['contract.signer_link_issued']);
    expect(JSON.stringify(db.tables.activity_events)).not.toMatch(/token/i);
    // The issuer sees that a link is out, never the link.
    expect(JSON.stringify(await view(LEG))).not.toContain(token);
  });

  it('M1: the certificate says which member issued the link a signature came through', async () => {
    await call('POST', LEG, 'links', { party_id: PN });
    const sha = await currentSha();
    db.tables.contract_signatures.push({ id: 'sig-link', contract_id: K1, org_id: L, party_id: PN, role: 'artist', contract_version: 1, document_sha256: sha, signer_name: 'Nova Okafor', method: 'typed', via: 'link', countersign: false, signed_by_user: null, signature_image: null, ip_hash: null, signed_at: '2026-10-05T10:00:00Z' });
    const nova = (await view(ART)).signers.find((x: { partyId: string }) => x.partyId === PN);
    expect(nova.signature).toMatchObject({ via: 'link', linkIssuedBy: expect.any(String) });
    expect(nova.signature.linkIssuedBy.length).toBeGreaterThan(0);
  });

  it('a party with no usable address is 409 and nothing is issued or sent', async () => {
    db.tables.parties[1].email = null;
    const res = await call('POST', LEG, 'links', { party_id: PN });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('no_party_email');
    db.tables.parties[1].email = 'not an address';
    expect((await call('POST', LEG, 'links', { party_id: PN })).status).toBe(409);
    expect(db.tables.contract_signers).toHaveLength(0);
    expect(emails).toHaveLength(0);
  });

  it('review G14: the link goes only to the address on file when the contract was SENT — an email edited since is refused (409), nothing issued or sent', async () => {
    db.tables.contracts[0].sent_snapshot = { ...(db.tables.contracts[0].sent_snapshot as object), signerEmails: { [PN]: 'nova@example.com' } };
    db.tables.parties[1].email = 'attacker@evil.test'; // a rights writer edits the party's address, then asks for the link
    const res = await call('POST', LEG, 'links', { party_id: PN });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('party_email_changed');
    expect(db.tables.contract_signers).toHaveLength(0);
    expect(emails).toHaveLength(0);
    // Changing it back, or only its letter case, is the same address.
    db.tables.parties[1].email = 'Nova@Example.com';
    expect((await call('POST', LEG, 'links', { party_id: PN })).status).toBe(200);
    expect(emails[0].to.toLowerCase()).toBe('nova@example.com');
  });

  it('review G14: a party that had no address when the contract was sent cannot be given one afterwards', async () => {
    db.tables.contracts[0].sent_snapshot = { ...(db.tables.contracts[0].sent_snapshot as object), signerEmails: {} };
    const res = await call('POST', LEG, 'links', { party_id: PN });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('party_email_changed');
    expect(emails).toHaveLength(0);
  });

  it('when the email cannot be sent the link is not left live (502, revoked)', async () => {
    emailFails = true;
    expect((await call('POST', LEG, 'links', { party_id: PN })).status).toBe(502);
    expect(db.tables.contract_signers[0].token_hash).toBeNull();
  });

  it('a new link replaces the old one; revoking ends it', async () => {
    await call('POST', LEG, 'links', { party_id: PN });
    await call('POST', LEG, 'links', { party_id: PN });
    const [a, b] = emails.map(tokenIn);
    expect(b).not.toBe(a);
    expect(db.tables.contract_signers).toHaveLength(1);
    expect(db.tables.contract_signers[0].token_hash).toBe(hashSignToken(b));
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
