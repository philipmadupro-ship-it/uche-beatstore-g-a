/**
 * GET /api/sign/[token]/document (review G14): the signer downloads the exact frozen sent PDF through their link.
 * Same one-404 gate as the signing page; the bytes are re-hashed against `sent_document_sha256` before the first byte.
 */
import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { memoryAdmin, type MemoryDb } from '@/lib/labelos/mocks/memory-db';
import { hashSignToken, newSignToken } from '@/lib/labelos/contract-signing';

const L = '10000000-0000-4000-8000-000000000001';
const PN = '60000000-0000-4000-8000-000000000002';
const K1 = '70000000-0000-4000-8000-000000000001';
const PDF = Buffer.from('%PDF-1.4 the exact sent copy');
const SHA = createHash('sha256').update(PDF).digest('hex');

let db: MemoryDb;
let stored: Buffer | null = PDF;

vi.mock('server-only', () => ({}));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => memoryAdmin(db).client }));
vi.mock('@/lib/log', () => ({ createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }) }));
vi.mock('@/lib/security/rate-limit', () => ({ rateLimitDurable: async () => true, clientIp: () => '203.0.113.9', rateLimit: () => true }));
vi.mock('@/lib/storage/project-assets', () => ({ openProjectAsset: async () => (stored ? new Uint8Array(stored) : null) }));

let TOKEN: string;

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-secret-key';
  stored = PDF;
  TOKEN = newSignToken();
  db = {
    tables: {
      organizations: [{ id: L, kind: 'label', deleted_at: null, settings: {} }],
      org_entitlements: [],
      parties: [{ id: PN, org_id: L, display_name: 'Nova', legal_name: 'Nova Okafor', address: null, user_id: null }],
      contacts: [],
      tracks: [],
      releases: [],
      contracts: [
        {
          id: K1, org_id: L, type: 'nda', title: 'Studio NDA', status: 'sent', template_id: null, template_source: 'platform:nda@1', template_version: 1, clauses: [],
          artist_contact_id: null, track_id: null, release_id: null, effective_date: null, term_months: null, territories: null, fields: {}, internal_note: 'SECRET', version: 1,
          created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', esign_provider_url: null,
          sent_document_sha256: SHA, sent_document_ref: 'local://orgs/x/assets/y/sent.pdf',
          sent_snapshot: { title: 'Studio NDA', typeLabel: 'NDA', version: 1, parties: [], clauses: [] },
        },
      ],
      contract_parties: [{ contract_id: K1, org_id: L, party_id: PN, role: 'receiving', position: 0 }],
      contract_signers: [{ id: 's1', contract_id: K1, org_id: L, party_id: PN, role: 'receiving', token_hash: hashSignToken(TOKEN), link_issued_at: '2026-10-30T00:00:00Z', link_expires_at: '2099-01-01T00:00:00Z', link_revoked_at: null }],
      contract_signatures: [],
    },
    rpc: {},
  };
});

async function get(token: string) {
  const { GET } = await import('./route');
  return (await GET(new NextRequest(`https://app.test/api/sign/${token}/document`), { params: Promise.resolve({ token }) })) as Response;
}

describe('the signer’s copy of the frozen document', () => {
  it('serves exactly the stored bytes, private, as a PDF', async () => {
    const res = await get(TOKEN);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('cache-control')).toContain('no-store');
    expect(Buffer.from(await res.arrayBuffer()).equals(PDF)).toBe(true);
  });

  it('serves a fully signed contract’s document too (the receipt), but a void or draft one answers the one 404', async () => {
    db.tables.contracts[0]!.status = 'signed';
    expect((await get(TOKEN)).status).toBe(200);
    for (const status of ['void', 'draft']) {
      db.tables.contracts[0]!.status = status;
      const res = await get(TOKEN);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'Not found' });
    }
  });

  it('a malformed, unknown or revoked link is the same 404', async () => {
    expect((await get('short')).status).toBe(404);
    expect((await get(newSignToken())).status).toBe(404);
    db.tables.contract_signers[0]!.token_hash = null;
    expect((await get(TOKEN)).status).toBe(404);
  });

  it('bytes that no longer match the hash the signatures were made against are never sent (same 404)', async () => {
    stored = Buffer.from('%PDF-1.4 tampered');
    const res = await get(TOKEN);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Not found' });
  });

  it('a missing stored copy, or a contract sent before signing existed, is the same 404', async () => {
    stored = null;
    expect((await get(TOKEN)).status).toBe(404);
    stored = PDF;
    db.tables.contracts[0]!.sent_document_sha256 = null;
    expect((await get(TOKEN)).status).toBe(404);
  });
});
