/**
 * The signing flow both entrances share (LABEL-60): a signed-in member signs
 * through `/api/org/[orgId]/contracts/[id]/signing`, an external signer through
 * `/api/sign/[token]`. They differ in how the caller was identified and which
 * party they may sign for (the entrance decides); everything after that is
 * here, once, so the two cannot drift apart.
 *
 *   1. the document as it is now and its SHA-256;
 *   2. `planSign` (pure): sent, not void, the version the signer read, a party
 *      of the contract that has no valid signature yet;
 *   3. the split-sheet gate (below): LABEL-59's `assertCanSign`, and — decided
 *      here, listed in the PR — a SIGNED master or composition sheet that
 *      disagrees with this contract blocks signing too;
 *   4. the drawn image, if any, to the private bucket;
 *   5. ONE audit function (migration 178): the signature, its event, and when
 *      it is the last party's, sent → signed with `contract.signed`. `prepareSign`
 *      builds its arguments and the route calls `auditRpc(…, 'contractSign', …)`
 *      itself, then `finishSign` reads the answer.
 *
 * Why drift against a signed sheet BLOCKS: two signed documents that state
 * different shares for the same song are a dispute waiting for a payout. A
 * sheet that is merely circulated can still be amended, so it does not block
 * (the drift warning on both documents already shows).
 */
import type { AdminClient } from '@/lib/auth/ownership';
import { isMissingAuditRpc, type AuditRpcArgs } from './audit-rpc';
import { contractFacts, assertCanSign, driftOfContract, sheetFactsOfSong } from './contract-splits-store';
import { hasDrift } from './contract-splits';
import { SIGN_DENIAL_MESSAGE, planSign, requiredSigners, signerStates, signingProgress, type SignDenial, type SignerRow } from './contract-signing';
import {
  SigningNotReadyError,
  readFrozen,
  isMissingSigning,
  readSignatures,
  removeSignatureImage,
  storeSignatureImage,
  type SignatureRow,
} from './contract-signing-store';
import type { ContractPartyLink, ContractRow, PartyIdentity } from './contracts/context';
import { isUUID } from '@/lib/validate';

export type SigningSnapshot = {
  sha: string;
  frozen: Awaited<ReturnType<typeof readFrozen>>;
  signatures: SignatureRow[];
  states: SignerRow[];
  progress: ReturnType<typeof signingProgress>;
};

/** Where the document and its signatures stand right now. */
export async function snapshotOf(
  admin: AdminClient,
  org: string,
  row: ContractRow,
  links: readonly ContractPartyLink[],
  identities: ReadonlyMap<string, PartyIdentity>,
): Promise<SigningSnapshot> {
  const [frozen, signatures] = await Promise.all([readFrozen(admin, org, row.id), readSignatures(admin, org, row.id)]);
  // No frozen copy (a contract sent before migration 178): nothing can be valid, and nothing can be signed.
  const sha = frozen?.sha ?? '';
  const states = signerStates(requiredSigners(links), signatures, sha);
  return { sha, frozen, signatures, states, progress: signingProgress(states) };
}

export type GateResult = { ok: true } | { ok: false; code: 'master_split_not_signed' | 'split_drift'; error: string };

/** The split-sheet conditions on signing. Never reads a sheet for a contract with no song. */
export async function signingGate(admin: AdminClient, org: string, row: ContractRow, links: readonly ContractPartyLink[]): Promise<GateResult> {
  const required = await assertCanSign(admin, org, row);
  if (!required.ok) return required;
  if (!row.track_id || !isUUID(row.track_id)) return { ok: true };
  const { facts } = await sheetFactsOfSong(admin, org, row.track_id);
  const signedOnly = facts.filter((f) => f.status === 'signed');
  if (signedOnly.length === 0) return { ok: true };
  const drift = driftOfContract(contractFacts(row, links), signedOnly).filter((d) => hasDrift(d));
  if (drift.length === 0) return { ok: true };
  const kinds = [...new Set(drift.map((d) => (d.kind === 'master' ? 'master' : 'composition')))].join(' and ');
  return {
    ok: false,
    code: 'split_drift',
    error: `The signed ${kinds} split sheet for this song states different shares from this contract. Supersede the sheet or correct the contract before it is signed.`,
  };
}

export type SignInput = {
  admin: AdminClient;
  orgId: string;
  row: ContractRow;
  links: readonly ContractPartyLink[];
  identities: ReadonlyMap<string, PartyIdentity>;
  partyId: string;
  /** The version the signer read. */
  seenVersion: number;
  /** The document hash the signer's page showed; a different one now means the text moved under them. */
  seenSha: string;
  /** For a link signer: the hash of the token they came with, re-checked by the database under its lock. */
  linkHash?: string | null;
  name: string;
  /** A PNG, for a drawn signature. */
  drawn: Buffer | null;
  via: 'member' | 'link';
  /** The signing account; null through a link. */
  actorId: string | null;
  countersign: boolean;
  ipHash: string | null;
};

export type SignResult =
  | { ok: true; completed: boolean; sha: string }
  | { ok: false; status: 404 | 409 | 503; error: string; code?: string };

const DENIAL_STATUS: Readonly<Record<SignDenial, 404 | 409>> = {
  not_sent: 409,
  void: 409,
  already_signed: 409,
  not_a_party: 404,
  already_signed_by: 409,
  not_your_party: 409,
  changed: 409,
  no_frozen_copy: 409,
};

const RPC_ERRORS: Readonly<Record<string, { status: 404 | 409; code: SignDenial | 'duplicate' }>> = {
  not_found: { status: 404, code: 'not_a_party' },
  not_party: { status: 404, code: 'not_a_party' },
  void: { status: 409, code: 'void' },
  already_signed: { status: 409, code: 'already_signed' },
  not_sent: { status: 409, code: 'not_sent' },
  changed: { status: 409, code: 'changed' },
  duplicate: { status: 409, code: 'duplicate' },
  link_gone: { status: 404, code: 'not_a_party' },
};

export type PreparedSign = {
  ok: true;
  /** The arguments of the ONE audit function that records the signature. The route calls it (`auditRpc(…, 'contractSign', args)`). */
  args: AuditRpcArgs['contractSign'];
  sha: string;
  /** Removes a stored drawn image again when the function did not record the signature. */
  cleanup: () => Promise<void>;
};

/**
 * Everything up to the write: plan, gate, store the drawn image, build the audit
 * function's arguments. The ROUTE makes the call itself, so each mutating handler
 * visibly writes through `auditRpc(` (the coverage test reads exactly that), then
 * hands the answer to `finishSign`.
 */
export async function prepareSign(input: SignInput): Promise<PreparedSign | Extract<SignResult, { ok: false }>> {
  const { admin, orgId, row, links, identities } = input;
  const snap = await snapshotOf(admin, orgId, row, links, identities);
  if (!snap.frozen) return { ok: false, status: 409, error: SIGN_DENIAL_MESSAGE.no_frozen_copy, code: 'no_frozen_copy' };
  const plan = planSign({
    contractStatus: row.status,
    contractVersion: row.version,
    seenVersion: input.seenVersion,
    required: requiredSigners(links),
    states: snap.states,
    partyId: input.partyId,
  });
  if (!plan.ok) return { ok: false, status: DENIAL_STATUS[plan.code], error: SIGN_DENIAL_MESSAGE[plan.code], code: plan.code };
  if (input.seenSha !== snap.sha) return { ok: false, status: 409, error: SIGN_DENIAL_MESSAGE.changed, code: 'changed' };

  const gate = await signingGate(admin, orgId, row, links);
  if (!gate.ok) return { ok: false, status: 409, error: gate.error, code: gate.code };

  const imageRef = input.drawn ? await storeSignatureImage(orgId, row.id, input.drawn) : null;
  return {
    ok: true,
    sha: snap.sha,
    cleanup: async () => {
      if (imageRef) await removeSignatureImage(imageRef);
    },
    args: {
      p_org: orgId,
      p_actor: input.actorId,
      p_contract: row.id,
      p_party: input.partyId,
      p_role: plan.role,
      p_version: row.version,
      p_sha: snap.sha,
      p_name: input.name,
      p_method: input.drawn ? 'drawn' : 'typed',
      p_image: imageRef,
      p_via: input.via,
      p_countersign: input.countersign,
      p_ip_hash: input.ipHash,
      p_link_hash: input.linkHash ?? null,
      p_payload: { version: row.version, type: row.type },
    },
  };
}

/** The audit function's answer, as a result. Throws for a missing migration or a real failure (the route maps those). */
export async function finishSign(prepared: PreparedSign, rpc: { data: Record<string, unknown> | null; error: { message: string; code?: string } | null }): Promise<SignResult> {
  const { data, error } = rpc;
  if (!error && data && !data.error) return { ok: true, completed: data.completed === true, sha: prepared.sha };
  await prepared.cleanup();
  if (error) {
    if (isMissingAuditRpc(error) || isMissingSigning(error)) throw new SigningNotReadyError();
    throw new Error(`contract sign: ${error.message}`);
  }
  const known = RPC_ERRORS[String(data?.error)];
  if (!known) throw new Error(`contract sign: ${String(data?.error ?? 'no answer')}`);
  const message = known.code === 'duplicate' ? SIGN_DENIAL_MESSAGE.already_signed_by : SIGN_DENIAL_MESSAGE[known.code];
  return { ok: false, status: known.status, error: message, code: known.code };
}
