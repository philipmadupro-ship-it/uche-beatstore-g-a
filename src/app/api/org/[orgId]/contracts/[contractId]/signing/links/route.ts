/**
 * /api/org/[orgId]/contracts/[contractId]/signing/links (LABEL-60) — the
 * signing link of ONE external party. `contracts.write`, inside the caller's
 * artist scope.
 *
 *   POST    `{ party_id }` issues the link, or issues a NEW one (the old stops
 *           working). The token is EMAILED to the party's address on file and
 *           appears in no response (review M1: whoever issues a link must not
 *           be able to sign with it); only its hash is stored. A party with no
 *           usable address is 409 before anything is issued. A link exists only
 *           for a contract that is out for signature (409 otherwise) and a
 *           party that is on it.
 *   DELETE  `{ party_id }` revokes it.
 *
 * Both write through an audit function (migration 178): the change and its
 * `contract.signer_link_*` event commit together. A link also stops working
 * the moment its contract is voided or superseded.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireOrgModule } from '@/lib/auth/org-access';
import { isSupabaseConfigured } from '@/lib/db';
import { OrgContractLinkBodySchema } from '@/lib/contracts';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { isUUID, readBody } from '@/lib/validate';
import { auditRpc, isMissingAuditRpc } from '@/lib/labelos/audit-rpc';
import { scopeAllowsContact } from '@/lib/labelos/artist-scope';
import { hashSignToken, newSignToken, signLinkExpiry, signLinkPath } from '@/lib/labelos/contract-signing';
import { sendSignLinkEmail, signLinkUrl, usableEmail } from '@/lib/labelos/contract-signing-email';
import { SIGNING_NOT_READY, SigningNotReadyError, assertSigningSchema, isMissingSigning } from '@/lib/labelos/contract-signing-store';
import { loadContractFor } from '@/lib/labelos/contracts-route';
import { CONTRACTS_NOT_READY, ContractsNotReadyError } from '@/lib/labelos/contracts-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api.org.contracts.signing.links');
const NO_STORE = { 'Cache-Control': 'no-store' };
const json = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: NO_STORE });
const NOT_FOUND = () => json(404, { error: 'Contract not found' });

type Params = { params: Promise<{ orgId: string; contractId: string }> };

async function prelude(req: NextRequest, params: Params['params']) {
  const { orgId, contractId } = await params;
  if (!isSupabaseConfigured()) return { res: json(501, { error: 'Contracts need Supabase.' }) } as const;
  const access = await requireOrgModule(orgId, 'contracts', 'contracts.write');
  if (!access.ok) return { res: access.res } as const;
  if (!isUUID(contractId)) return { res: NOT_FOUND() } as const;
  const parsed = await readBody(req, OrgContractLinkBodySchema);
  if (!parsed.ok) return { res: parsed.res } as const;
  const loaded = await loadContractFor(access, contractId);
  if (!loaded || !scopeAllowsContact(access.artistScope, loaded.row.artist_contact_id)) return { res: NOT_FOUND() } as const;
  if (!loaded.links.some((l) => l.party_id === parsed.data.party_id)) return { res: json(404, { error: 'That party is not on this contract.' }) } as const;
  return { access, loaded, partyId: parsed.data.party_id } as const;
}

/** `jo***@example.com` — enough to recognise, not enough to harvest. */
function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  return `${local.slice(0, 2)}***@${domain}`;
}

const notReady = (err: unknown) => (err instanceof ContractsNotReadyError ? json(503, { error: CONTRACTS_NOT_READY }) : err instanceof SigningNotReadyError ? json(503, { error: SIGNING_NOT_READY }) : null);

export async function POST(req: NextRequest, { params }: Params) {
  const p = await prelude(req, params);
  if ('res' in p) return p.res;
  const { access, loaded, partyId } = p;
  try {
    await assertSigningSchema(access.admin);
    // The link is emailed to the party; with no address there is nobody to give it to, and nothing is issued.
    const partyRes = await access.admin.from('parties').select('email').eq('org_id', access.orgId).eq('id', partyId).maybeSingle();
    if (partyRes.error) throw new Error(`party email: ${partyRes.error.message}`);
    const to = usableEmail((partyRes.data as { email: string | null } | null)?.email);
    if (!to) return json(409, { error: 'This party has no email address on file, so there is nowhere to send their signing link. Add one to the party first.', code: 'no_party_email' });
    const token = newSignToken();
    const expiresAt = signLinkExpiry();
    const { data, error } = await auditRpc(access.admin, 'contractLinkIssue', {
      p_org: access.orgId,
      p_actor: access.userId,
      p_contract: loaded.row.id,
      p_party: partyId,
      p_token_hash: hashSignToken(token),
      p_expires_at: expiresAt,
      p_payload: { version: loaded.row.version },
    });
    if (error) {
      if (isMissingAuditRpc(error) || isMissingSigning(error)) return json(503, { error: SIGNING_NOT_READY });
      throw new Error(`signer link issue: ${error.message}`);
    }
    if (data?.error === 'not_sent') return json(409, { error: 'Signing links exist only while a contract is out for signature. Send it for signature first.' });
    if (data?.error === 'not_party') return json(404, { error: 'That party is not on this contract.' });
    if (data?.error === 'not_found') return NOT_FOUND();
    const orgRes = await access.admin.from('organizations').select('name').eq('id', access.orgId).maybeSingle();
    const orgName = (orgRes.data as { name: string | null } | null)?.name?.trim() || 'Your label';
    const sent = await sendSignLinkEmail({ to, contractTitle: loaded.row.title, orgName, link: signLinkUrl(signLinkPath(token)), expiresAt });
    if (!sent.ok) {
      // Undo the issue: a link nobody received is not left live.
      log.warn('signing link email failed', { orgId: access.orgId, error: sent.error });
      await auditRpc(access.admin, 'contractLinkRevoke', { p_org: access.orgId, p_actor: access.userId, p_contract: loaded.row.id, p_party: partyId, p_payload: { version: loaded.row.version, undo: true } });
      return json(502, { error: 'Could not send the email. Try again shortly.' });
    }
    return json(200, { ok: true, sentTo: maskEmail(to), expiresAt });
  } catch (err) {
    const nr = notReady(err);
    if (nr) return nr;
    log.error('signer link issue failed', { orgId: access.orgId, error: errorMessage(err) });
    return json(500, { error: 'Could not create the signing link' });
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const p = await prelude(req, params);
  if ('res' in p) return p.res;
  const { access, loaded, partyId } = p;
  try {
    await assertSigningSchema(access.admin);
    const { data, error } = await auditRpc(access.admin, 'contractLinkRevoke', {
      p_org: access.orgId,
      p_actor: access.userId,
      p_contract: loaded.row.id,
      p_party: partyId,
      p_payload: { version: loaded.row.version },
    });
    if (error) {
      if (isMissingAuditRpc(error) || isMissingSigning(error)) return json(503, { error: SIGNING_NOT_READY });
      throw new Error(`signer link revoke: ${error.message}`);
    }
    if (data?.error === 'no_link') return json(409, { error: 'That party has no active signing link.' });
    if (data?.error === 'not_found') return NOT_FOUND();
    return json(200, { ok: true });
  } catch (err) {
    const nr = notReady(err);
    if (nr) return nr;
    log.error('signer link revoke failed', { orgId: access.orgId, error: errorMessage(err) });
    return json(500, { error: 'Could not revoke the signing link' });
  }
}
