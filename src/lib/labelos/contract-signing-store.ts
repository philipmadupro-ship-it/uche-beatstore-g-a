/**
 * The reads and writes behind contract signing (LABEL-60). Rules are
 * `contract-signing.ts` (pure); this file touches the database and the private
 * bucket. Service-role client, org filter on every query; WHO may do what is
 * the route's.
 *
 * Migration 178 may not be applied. A missing table, column or function is
 * `SigningNotReadyError`: GETs answer `schemaReady: false`, writes 503 naming
 * 178 — never 500. PostgREST answers an INSERT into a missing table with an
 * empty 404 that carries no code, so every write probes with a read first.
 *
 * What never leaves: the token hash, the drawn image's reference, the address
 * hash. A view carries `hasImage` and `hasLink` booleans instead.
 */
import { createHmac } from 'node:crypto';
import { nanoid } from 'nanoid';
import type { NextRequest } from 'next/server';
import type { AdminClient } from '@/lib/auth/ownership';
import { deleteProjectAssetObject, storeProjectAsset } from '@/lib/storage/project-assets';
import { isUUID } from '@/lib/validate';
import type { ContractPartyLink, ContractRow, PartyIdentity } from './contracts/context';
import type { Rendered } from './contracts/render';
import { documentHash, type SignatureFact } from './contract-signing';
import { feedSecret } from './feed-token';
import { orgEntitlements, type EntitlementRow } from './entitlements';
import { documentInputOf, documentOf } from './contracts-route';
import { orgAssetObjectKey } from './org-assets';
import { ReadError, pageAll } from './paged-read';

export const SIGNING_NOT_READY = 'Signing is not set up on this database yet (migration 178).';

export class SigningNotReadyError extends Error {
  constructor() {
    super('migration 178 is not applied');
  }
}

type DbError = { message: string; code?: string } | null | undefined;

/** A missing table, column or audit function of 178 — nothing else. */
export function isMissingSigning(error: DbError): boolean {
  if (!error) return false;
  if (['PGRST205', '42P01'].includes(error.code ?? '')) return /contract_sign/.test(error.message) || !error.message;
  if (error.code === '42703') return /esign_provider_url|supersed/.test(error.message);
  if (['PGRST202', '42883'].includes(error.code ?? '')) return /labelos_audit_contract_(link|sign|supersede)/.test(error.message) || /could not find the function/i.test(error.message);
  return false;
}

function check(what: string, error: DbError): void {
  if (!error) return;
  if (isMissingSigning(error)) throw new SigningNotReadyError();
  throw new Error(`${what}: ${error.message}`);
}

/** A read before any write. */
export async function assertSigningSchema(admin: AdminClient): Promise<void> {
  check('signatures probe', (await admin.from('contract_signatures').select('id').limit(1)).error);
  check('signers probe', (await admin.from('contract_signers').select('id').limit(1)).error);
}

// ── Reads ────────────────────────────────────────────────────────────────

export type SignatureRow = SignatureFact & {
  signerName: string;
  method: 'typed' | 'drawn';
  via: 'member' | 'link';
  countersign: boolean;
  hasImage: boolean;
  /** Never sent to a browser. */
  imageRef: string | null;
};

type RawSignature = {
  id: string;
  party_id: string;
  role: string;
  contract_version: number;
  document_sha256: string;
  signer_name: string;
  method: 'typed' | 'drawn';
  via: 'member' | 'link';
  countersign: boolean;
  signature_image: string | null;
  signed_at: string;
};

export async function readSignatures(admin: AdminClient, org: string, contractId: string): Promise<SignatureRow[]> {
  const rows = await pageAll<RawSignature>(
    (from, to) =>
      admin
        .from('contract_signatures')
        .select('id, party_id, role, contract_version, document_sha256, signer_name, method, via, countersign, signature_image, signed_at')
        .eq('org_id', org)
        .eq('contract_id', contractId)
        .order('signed_at')
        .order('id')
        .range(from, to),
    'contract signatures',
  ).catch((err) => {
    if (err instanceof ReadError) check(err.message, err.raw as DbError);
    throw err;
  });
  return rows.map((r) => ({
    id: r.id,
    partyId: r.party_id,
    role: r.role,
    contractVersion: r.contract_version,
    documentSha256: r.document_sha256,
    signedAt: r.signed_at,
    signerName: r.signer_name,
    method: r.method,
    via: r.via,
    countersign: r.countersign,
    hasImage: !!r.signature_image,
    imageRef: r.signature_image,
  }));
}

export type SignerLinkRow = { partyId: string; role: string; hasLink: boolean; issuedAt: string | null; expiresAt: string | null; revokedAt: string | null };

export async function readSigners(admin: AdminClient, org: string, contractId: string): Promise<SignerLinkRow[]> {
  const res = await admin
    .from('contract_signers')
    .select('party_id, role, token_hash, link_issued_at, link_expires_at, link_revoked_at')
    .eq('org_id', org)
    .eq('contract_id', contractId)
    .limit(200);
  check('contract signers', res.error);
  return ((res.data ?? []) as { party_id: string; role: string; token_hash: string | null; link_issued_at: string | null; link_expires_at: string | null; link_revoked_at: string | null }[]).map((r) => ({
    partyId: r.party_id,
    role: r.role,
    hasLink: r.token_hash !== null,
    issuedAt: r.link_issued_at,
    expiresAt: r.link_expires_at,
    revokedAt: r.link_revoked_at,
  }));
}

export async function readProviderUrl(admin: AdminClient, org: string, contractId: string): Promise<string | null> {
  const res = await admin.from('contracts').select('esign_provider_url').eq('org_id', org).eq('id', contractId).maybeSingle();
  check('provider url', res.error);
  return (res.data as { esign_provider_url: string | null } | null)?.esign_provider_url ?? null;
}

export async function writeProviderUrl(admin: AdminClient, org: string, contractId: string, url: string | null): Promise<boolean> {
  await assertSigningSchema(admin);
  const res = await admin.from('contracts').update({ esign_provider_url: url }).eq('org_id', org).eq('id', contractId).select('id');
  check('provider url write', res.error);
  return ((res.data ?? []) as unknown[]).length === 1;
}

export type SignerRef = { orgId: string; contractId: string; partyId: string; role: string; expiresAt: string | null };

/** The signer a link token (by hash) belongs to. Null for an unknown or revoked link. */
export async function signerByTokenHash(admin: AdminClient, tokenHash: string): Promise<SignerRef | null> {
  const res = await admin
    .from('contract_signers')
    .select('org_id, contract_id, party_id, role, link_expires_at')
    .eq('token_hash', tokenHash)
    .maybeSingle();
  check('signer by link', res.error);
  const r = res.data as { org_id: string; contract_id: string; party_id: string; role: string; link_expires_at: string | null } | null;
  return r ? { orgId: r.org_id, contractId: r.contract_id, partyId: r.party_id, role: r.role, expiresAt: r.link_expires_at } : null;
}

/** The party's account, when it is linked to one (parties.user_id). */
export async function partyUserId(admin: AdminClient, org: string, partyId: string): Promise<string | null> {
  const res = await admin.from('parties').select('user_id').eq('org_id', org).eq('id', partyId).maybeSingle();
  check('party account', res.error);
  return (res.data as { user_id: string | null } | null)?.user_id ?? null;
}

// ── The document ─────────────────────────────────────────────────────────

/** What the signer reads and the hash of it. The same input the PDF is made from, so the two cannot differ. */
export async function currentDocument(
  admin: AdminClient,
  org: string,
  row: ContractRow,
  links: readonly ContractPartyLink[],
  identities: ReadonlyMap<string, PartyIdentity>,
): Promise<{ rendered: Rendered; sha: string }> {
  const rendered = await documentOf(admin, org, row, links, identities);
  return { rendered, sha: documentHash(documentInputOf(row, links, identities, rendered)) };
}

// ── Drawn signature image ────────────────────────────────────────────────

/** The PNG goes to the PRIVATE bucket under the org's own prefix (purged and exported with the org). Returns the reference. */
export async function storeSignatureImage(org: string, contractId: string, bytes: Buffer): Promise<string> {
  if (!isUUID(contractId)) throw new Error('bad contract id');
  return storeProjectAsset(bytes, orgAssetObjectKey(org, contractId, nanoid(16), 'png'), 'image/png');
}

export async function removeSignatureImage(ref: string): Promise<void> {
  await deleteProjectAssetObject(ref).catch(() => {});
}

// ── The caller's address, as a hash ──────────────────────────────────────

/** One-way: 32 hex characters of a salted SHA-256. The raw address is never stored or logged. */
export function ipHashOf(req: NextRequest): string {
  const fwd = req.headers.get('x-forwarded-for') || '';
  const ip = fwd.split(',')[0].trim() || req.headers.get('x-real-ip') || 'unknown';
  // Keyed with a server-only secret: the address space is small enough that an unkeyed hash could be reversed by brute force.
  return createHmac('sha256', feedSecret()).update(`label-os.sign\0${ip}`).digest('hex').slice(0, 32);
}

// ── The public entrance ──────────────────────────────────────────────────

/** A link works only inside a live organization that is still licensed for contracts. */
export async function orgAllowsSigning(admin: AdminClient, orgId: string): Promise<boolean> {
  const org = await admin.from('organizations').select('kind, deleted_at').eq('id', orgId).maybeSingle();
  if (org.error) throw new Error(`org read: ${org.error.message}`);
  const o = org.data as { kind: string | null; deleted_at: string | null } | null;
  if (!o || o.deleted_at) return false;
  const ent = await admin.from('org_entitlements').select('modules, max_seats, max_artists, setup_done').eq('org_id', orgId).maybeSingle();
  if (ent.error && !['PGRST205', '42P01'].includes(ent.error.code ?? '')) throw new Error(`entitlements read: ${ent.error.message}`);
  return orgEntitlements(o, (ent.error ? null : ent.data) as EntitlementRow | null).modules.has('contracts');
}
