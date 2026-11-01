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
 *         drawing? }`. You sign for the party linked to YOUR account, or — with
 *         `contracts.write` — countersign for the label's own side; nobody signs
 *         for someone else's party. The rest (planSign, the split-sheet gate,
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
import { cleanSignerName, maySignAs, parseDrawnSignature } from '@/lib/labelos/contract-signing';
import { finishSign, prepareSign, signingGate, snapshotOf } from '@/lib/labelos/contract-signing-flow';
import {
  SIGNING_NOT_READY,
  SigningNotReadyError,
  ipHashOf,
  partyUserId,
  readProviderUrl,
  readSigners,
} from '@/lib/labelos/contract-signing-store';
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
        const verdict = maySignAs({ partyRole: s.role, partyUserId: await partyUserId(admin, org, s.partyId), userId: access.userId, canWriteContracts: access.capabilities.has('contracts.write') });
        if (verdict.ok) youCanSignFor.push(s.partyId);
      }
    }
    const gate = row.status === 'sent' ? await signingGate(admin, org, row, links) : { ok: true as const };
    const view = buildSigningView({
      row,
      links,
      identities,
      sha: snap.sha,
      states: snap.states,
      signatures: snap.signatures,
      signerLinks: canManage ? await readSigners(admin, org, row.id) : [],
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

    const verdict = maySignAs({
      partyRole: link.role,
      partyUserId: await partyUserId(admin, org, body.party_id),
      userId: access.userId,
      canWriteContracts: access.capabilities.has('contracts.write') && scopeAllowsContact(access.artistScope, row.artist_contact_id),
    });
    if (!verdict.ok) return json(403, { error: 'You can only sign for yourself, or for the label if you may write contracts.', code: 'not_your_party' });

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
    const result = await finishSign(prepared, await auditRpc(admin, 'contractSign', prepared.args));
    if (!result.ok) return json(result.status, { error: result.error, ...(result.code ? { code: result.code } : {}) });
    return json(200, { ok: true, completed: result.completed, status: result.completed ? 'signed' : 'sent' });
  } catch (err) {
    if (err instanceof SigningNotReadyError || err instanceof ContractsNotReadyError) return json(503, { error: err instanceof ContractsNotReadyError ? CONTRACTS_NOT_READY : SIGNING_NOT_READY });
    log.error('contract sign failed', { orgId: org, error: errorMessage(err) });
    return json(500, { error: 'Could not record the signature' });
  }
}
