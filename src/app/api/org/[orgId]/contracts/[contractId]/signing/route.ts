/**
 * /api/org/[orgId]/contracts/[contractId]/signing (LABEL-60).
 *
 *   GET   where the signatures stand: each party's status (signed / no longer
 *         counts because the document changed / pending), the signature facts,
 *         the document hash, who the CALLER may sign for, and — for
 *         `contracts.write` — whether each party's signing link is live. Anyone
 *         who may read the contract may read this (the same `mayReadContract`
 *         rule as the contract itself). `internal_note` is not here.
 *   POST  a signed-in member signs for a party: `{ party_id, version, name,
 *         drawing? }`. You sign for the party linked to YOUR account AND confirmed
 *         by that account itself (LABEL-54), or, for the label's own side (role
 *         `label`), as an owner / admin / `contracts.write` member. Anyone else
 *         signs through the party's own link; nobody signs for another's party. The rest (planSign, the split-sheet gate,
 *         the signature and the move to `signed`) is lib/labelos/
 *         contract-signing-flow, shared with the external link.
 *
 * Without migration 178: GET `{ schemaReady: false }`, POST 503 naming it.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireOrgModule } from '@/lib/auth/org-access';
import { auditRpc } from '@/lib/labelos/audit-rpc';
import { isSupabaseConfigured } from '@/lib/db';
import { OrgContractSignBodySchema } from '@/lib/contracts';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { rateLimitDurable } from '@/lib/security/rate-limit';
import { isUUID, readBody } from '@/lib/validate';
import { scopeAllowsContact } from '@/lib/labelos/artist-scope';
import { SIGN_DENIAL_MESSAGE, cleanSignerName, maySignAs, parseDrawnSignature } from '@/lib/labelos/contract-signing';
import { finishSign, prepareSign, signingGate, snapshotOf } from '@/lib/labelos/contract-signing-flow';
import {
  SIGNING_NOT_READY,
  SigningNotReadyError,
  ipHashOf,
  partyAccount,
  readProviderUrl,
  readSigners,
} from '@/lib/labelos/contract-signing-store';
import { memberIdentities, memberLabel, type IdentityAdmin } from '@/lib/labelos/member-identity';
import { buildSigningView } from '@/lib/labelos/contract-signing-view';
import { loadContractFor } from '@/lib/labelos/contracts-route';
import { ContractsNotReadyError, CONTRACTS_NOT_READY } from '@/lib/labelos/contracts-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.contracts.signing');
const NO_STORE = { 'Cache-Control': 'no-store' };
const json = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: NO_STORE });
const NOT_FOUND = () => json(404, { error: 'Contract not found' });

type Params = { params: Promise<{ orgId: string; contractId: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { orgId, contractId } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'Contracts need Supabase.' });
  const access = await requireOrgModule(orgId, 'contracts');
  if (!access.ok) return access.res;
  if (!isUUID(contractId)) return NOT_FOUND();
  try {
    const loaded = await loadContractFor(access, contractId);
    if (!loaded) return NOT_FOUND();
    const { row, links, identities } = loaded;
    const { admin, orgId: org } = access;
    const snap = await snapshotOf(admin, org, row, links, identities);
    const canManage = access.capabilities.has('contracts.write') && scopeAllowsContact(access.artistScope, row.artist_contact_id);

    // Which parties may THIS caller sign for? Only while the contract is out for signature.
    const youCanSignFor: string[] = [];
    if (row.status === 'sent') {
      for (const s of snap.states) {
        if (s.status === 'signed') continue;
        const acct = await partyAccount(admin, org, s.partyId);
        const verdict = maySignAs({ partyRole: s.role, partyUserId: acct.userId, partyConfirmedBy: acct.confirmedBy, partyLinkedBy: acct.linkedBy, userId: access.userId, memberRole: access.role, canWriteContracts: canManage });
        if (verdict.ok) youCanSignFor.push(s.partyId);
      }
    }
    const gate = row.status !== 'sent' ? { ok: true as const } : !snap.frozen ? { ok: false as const, code: 'no_frozen_copy', error: SIGN_DENIAL_MESSAGE.no_frozen_copy } : await signingGate(admin, org, row, links);
    // "Link issued by <member>" on the certificate for the signatures made through a link.
    const allSigners = await readSigners(admin, org, row.id);
    const issuerIds = [...new Set(allSigners.filter((l) => l.issuedBy && snap.signatures.some((x) => x.partyId === l.partyId && x.via === 'link')).map((l) => l.issuedBy as string))];
    const names = issuerIds.length ? await memberIdentities(admin as unknown as IdentityAdmin, org, issuerIds, { withEmail: false }) : new Map();
    const linkIssuers = new Map(allSigners.filter((l) => l.issuedBy).map((l) => [l.partyId, memberLabel(names.get(l.issuedBy as string))] as const));
    const view = buildSigningView({
      row,
      links,
      identities,
      sha: snap.sha,
      states: snap.states,
      signatures: snap.signatures,
      signerLinks: canManage ? allSigners : [],
      linkIssuers,
      progress: snap.progress,
      youCanSignFor,
      canManage,
      blocked: gate.ok ? null : { code: gate.code, error: gate.error },
      providerUrl: await readProviderUrl(admin, org, row.id),
    });
    return json(200, view);
  } catch (err) {
    if (err instanceof SigningNotReadyError || err instanceof ContractsNotReadyError) return json(200, { schemaReady: false });
    log.error('signing read failed', { orgId: access.orgId, error: errorMessage(err) });
    return json(500, { error: 'Could not load the signatures' });
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  const { orgId, contractId } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'Contracts need Supabase.' });
  const access = await requireOrgModule(orgId, 'contracts');
  if (!access.ok) return access.res;
  if (!isUUID(contractId)) return NOT_FOUND();
  const parsed = await readBody(req, OrgContractSignBodySchema);
  if (!parsed.ok) return parsed.res;
  const body = parsed.data;
  const { admin, orgId: org } = access;

  const name = cleanSignerName(body.name);
  if (!name) return json(400, { error: 'Type your full name to sign.' });
  let drawn: Buffer | null = null;
  if (body.drawing !== undefined && body.drawing !== '') {
    const png = parseDrawnSignature(body.drawing);
    if (!png.ok) return json(400, { error: png.reason === 'size' ? 'That drawn signature is too large. Clear it and draw it again.' : 'The drawn signature must be a PNG image.' });
    drawn = png.bytes;
  }
  if (!(await rateLimitDurable(`contract-sign:${org}:${access.userId}`, 60, 60 * 60 * 1000))) {
    return json(429, { error: 'Too many signing attempts. Try again later.' });
  }

  try {
    const loaded = await loadContractFor(access, contractId);
    if (!loaded) return NOT_FOUND();
    const { row, links, identities } = loaded;
    const link = links.find((l) => l.party_id === body.party_id);
    if (!link) return json(404, { error: 'That party is not on this contract.' });

    const acct = await partyAccount(admin, org, body.party_id);
    const verdict = maySignAs({
      partyRole: link.role,
      partyUserId: acct.userId,
      partyConfirmedBy: acct.confirmedBy,
      partyLinkedBy: acct.linkedBy,
      userId: access.userId,
      memberRole: access.role,
      canWriteContracts: access.capabilities.has('contracts.write') && scopeAllowsContact(access.artistScope, row.artist_contact_id),
    });
    if (!verdict.ok) return json(403, { error: 'You sign as a party only through its own signing link, or from the account the party itself confirmed. The label’s own side is signed by an owner, an admin or a member who may write contracts.', code: 'not_your_party' });

    const prepared = await prepareSign({
      admin,
      orgId: org,
      row,
      links,
      identities,
      partyId: body.party_id,
      seenVersion: body.version,
      seenSha: body.document_sha256,
      name,
      drawn,
      via: 'member',
      actorId: access.userId,
      countersign: verdict.countersign,
      ipHash: ipHashOf(req),
    });
    if (!prepared.ok) return json(prepared.status, { error: prepared.error, ...(prepared.code ? { code: prepared.code } : {}) });
    // If the function call itself throws, the drawn image already stored would be orphaned: remove it (best effort).
    const rpc = await auditRpc(admin, 'contractSign', prepared.args).catch(async (err: unknown) => {
      await prepared.cleanup().catch(() => {});
      throw err;
    });
    const result = await finishSign(prepared, rpc);
    if (!result.ok) return json(result.status, { error: result.error, ...(result.code ? { code: result.code } : {}) });
    return json(200, { ok: true, completed: result.completed, status: result.completed ? 'signed' : 'sent' });
  } catch (err) {
    if (err instanceof SigningNotReadyError || err instanceof ContractsNotReadyError) return json(503, { error: err instanceof ContractsNotReadyError ? CONTRACTS_NOT_READY : SIGNING_NOT_READY });
    log.error('contract sign failed', { orgId: org, error: errorMessage(err) });
    return json(500, { error: 'Could not record the signature' });
  }
}
