/**
 * The signing view and the certificate (LABEL-60), built FIELD BY FIELD: a row
 * is never spread into a response. What a reader gets:
 *
 *   everyone who can read the contract   each party's name, role and where they
 *                                        stand, and the signatures' times,
 *                                        method, name typed and hash;
 *   `canManage` (contracts.write)        whether a signing link exists, and
 *                                        when it ends — never the link itself,
 *                                        which exists only in the response that
 *                                        issues it;
 *   nobody                               the token hash, the drawn image's
 *                                        reference, the address hash.
 *
 * The certificate wording says what this is, plainly, because the label owns
 * that claim: an in-app signature, not a qualified electronic signature.
 */
import type { ContractPartyLink, ContractRow, PartyIdentity } from './contracts/context';
import { partyName } from './contracts/context';
import { CONTRACT_STATUS_LABELS, PARTY_ROLE_LABELS, TEMPLATE_TYPE_LABELS, type PartyRole } from './contracts/types';
import type { SignerRow } from './contract-signing';
import type { SignatureRow, SignerLinkRow } from './contract-signing-store';

export const CERTIFICATE_STATEMENT =
  'This is an in-app signature. Each signer typed or drew their name on a page of this application after reading the contract text identified by the hash below. It is not a qualified or advanced electronic signature (for example under eIDAS or the US ESIGN Act). If the parties need one, they sign with an external provider and record its address on the contract.';

export type SignerView = {
  partyId: string;
  role: PartyRole;
  roleLabel: string;
  name: string;
  status: 'signed' | 'stale' | 'pending';
  signature: null | {
    id: string;
    signedAt: string;
    method: 'typed' | 'drawn';
    via: 'member' | 'link';
    countersign: boolean;
    signerName: string;
    contractVersion: number;
    documentSha256: string;
    hasImage: boolean;
    /** For a link signature: the member who issued the link ("link issued by …" on the certificate). */
    linkIssuedBy: string | null;
  };
  /** `canManage` only. */
  link?: { active: boolean; expiresAt: string | null; issuedAt: string | null };
};

export type SigningView = {
  schemaReady: true;
  contract: { id: string; title: string; typeLabel: string; status: string; statusLabel: string; version: number };
  documentSha256: string;
  signers: SignerView[];
  progress: { total: number; signed: number; stale: number; pending: number; complete: boolean };
  /** Parties this caller may sign for right now. */
  youCanSignFor: string[];
  canManage: boolean;
  /** Set when signing is blocked by the split-sheet rules, so the page can say why before anyone tries. */
  blocked: null | { code: string; error: string };
  providerUrl: string | null;
  /** Every signature row, oldest first, including the ones that no longer count. */
  history: { id: string; partyId: string; name: string; signedAt: string; contractVersion: number; documentSha256: string; current: boolean }[];
  statement: string;
};

export function buildSigningView(input: {
  row: Pick<ContractRow, 'id' | 'title' | 'type' | 'status' | 'version'>;
  links: readonly ContractPartyLink[];
  identities: ReadonlyMap<string, PartyIdentity>;
  sha: string;
  states: readonly SignerRow[];
  signatures: readonly SignatureRow[];
  signerLinks: readonly SignerLinkRow[];
  /** partyId → name of the member who issued that party's link. */
  linkIssuers?: ReadonlyMap<string, string>;
  progress: SigningView['progress'];
  youCanSignFor: readonly string[];
  canManage: boolean;
  blocked: SigningView['blocked'];
  providerUrl: string | null;
  now?: Date;
}): SigningView {
  const now = input.now ?? new Date();
  const nameOf = (partyId: string) => {
    const id = input.identities.get(partyId);
    return id ? partyName(id) : 'Unknown party';
  };
  const full = new Map(input.signatures.map((s) => [s.id, s]));
  const signers: SignerView[] = input.states.map((s) => {
    const sig = s.status === 'pending' ? null : full.get(s.signature.id) ?? null;
    const view: SignerView = {
      partyId: s.partyId,
      role: s.role,
      roleLabel: PARTY_ROLE_LABELS[s.role],
      name: nameOf(s.partyId),
      status: s.status,
      signature: sig
        ? {
            id: sig.id,
            signedAt: sig.signedAt,
            method: sig.method,
            via: sig.via,
            countersign: sig.countersign,
            signerName: sig.signerName,
            contractVersion: sig.contractVersion,
            documentSha256: sig.documentSha256,
            hasImage: sig.hasImage,
            linkIssuedBy: sig.via === 'link' ? input.linkIssuers?.get(s.partyId) ?? null : null,
          }
        : null,
    };
    if (input.canManage) {
      const l = input.signerLinks.find((x) => x.partyId === s.partyId);
      view.link = {
        active: !!l && l.hasLink && (l.expiresAt === null || new Date(l.expiresAt).getTime() > now.getTime()),
        expiresAt: l?.hasLink ? l.expiresAt : null,
        issuedAt: l?.issuedAt ?? null,
      };
    }
    return view;
  });
  return {
    schemaReady: true,
    contract: {
      id: input.row.id,
      title: input.row.title,
      typeLabel: TEMPLATE_TYPE_LABELS[input.row.type],
      status: input.row.status,
      statusLabel: CONTRACT_STATUS_LABELS[input.row.status],
      version: input.row.version,
    },
    documentSha256: input.sha,
    signers,
    progress: input.progress,
    youCanSignFor: [...input.youCanSignFor],
    canManage: input.canManage,
    blocked: input.blocked,
    providerUrl: input.providerUrl,
    history: input.signatures.map((s) => ({
      id: s.id,
      partyId: s.partyId,
      name: nameOf(s.partyId),
      signedAt: s.signedAt,
      contractVersion: s.contractVersion,
      documentSha256: s.documentSha256,
      current: s.documentSha256 === input.sha,
    })),
    statement: CERTIFICATE_STATEMENT,
  };
}
