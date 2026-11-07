/**
 * In-app signatures on a contract (LABEL-60, doc 23 §D). Pure.
 *
 * What a signature is HERE, said plainly (the certificate says it too): the
 * signer typed or drew their name on a page of this app, after reading the
 * contract. We record who (the party), when, how, a one-way hash of the
 * address, and the SHA-256 of the exact text that was on the screen. It is an
 * in-app signature, NOT a qualified or advanced electronic signature (eIDAS,
 * ESIGN/UETA "advanced" tiers). A label that needs one attaches the provider
 * URL (`esign_provider_url`) and signs there; no provider is integrated.
 *
 * Four rules live here, none of them stored:
 *
 *   1. THE DOCUMENT IS THE FROZEN SENT COPY. When a contract is sent, its PDF
 *      is made once, stored, and the SHA-256 of those BYTES is written on the
 *      contract (`sent_document_sha256`, migration 178) with the text it was
 *      made from (`sent_snapshot`). That is what every signature is recorded
 *      against; renaming a party or a song later changes none of it.
 *   2. A CHANGED HASH INVALIDATES. Signatures are append-only rows carrying the
 *      hash they were made against. Whether one still counts is DERIVED on
 *      every read (`signerStates`): the hash the document has NOW against the
 *      hash on the row. Nothing is updated or deleted.
 *   3. COMPLETE = EVERY PARTY HAS A VALID SIGNATURE. `signingProgress`. The
 *      database moves sent → signed in the same transaction as the last
 *      signature (migration 178), so there is no window with all signatures in
 *      and the contract still "sent".
 *   4. WHO MAY SIGN FOR A PARTY. `planSign`: the person the party is linked to
 *      (parties.user_id), or — for the label's own side — a member who may
 *      write contracts (the countersignature). A person with only a link signs
 *      through the link and for that party alone.
 *
 * The contract store's own rules (the end date of a term, its expiry state and
 * the search) are in `contract-store-model.ts`, re-exported here.
 */
import { createHash, randomBytes } from 'node:crypto';
import type { ContractDocumentInput } from './contracts/document';
import type { ContractStatus, PartyRole } from './contracts/types';

// ── The document and its hash ────────────────────────────────────────────

/**
 * The text the contract was SENT with, frozen on the contract at the moment it left draft (migration 178,
 * `sent_snapshot`): the same input the sent PDF was made from, minus its date. A signer reads this, never a live
 * merge, so renaming a party or a song afterwards changes nothing they signed.
 */
export type SentSnapshot = {
  title: string;
  typeLabel: string;
  version: number;
  parties: { roleLabel: string; name: string }[];
  clauses: { id: string; heading: string; body: string }[];
  /**
   * The address each party's signing link may go to: the one on file when the contract was SENT (party id → lower-cased
   * address). Never shown to a signer. Absent on a contract sent before review G14.
   */
  signerEmails?: Record<string, string>;
};

export function sentSnapshotOf(input: Pick<ContractDocumentInput, 'title' | 'typeLabel' | 'version' | 'parties' | 'clauses'>, signerEmails?: Record<string, string>): SentSnapshot {
  return {
    ...(signerEmails ? { signerEmails } : {}),
    title: input.title,
    typeLabel: input.typeLabel,
    version: input.version,
    parties: input.parties.map((p) => ({ roleLabel: p.roleLabel, name: p.name })),
    clauses: input.clauses.map((c) => ({ id: c.id, heading: c.heading, body: c.body })),
  };
}

/** A stored value read back as a snapshot, or null when it is not one (never trust jsonb shape). */
export function parseSentSnapshot(raw: unknown): SentSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const str = (v: unknown): v is string => typeof v === 'string';
  if (!str(r.title) || !str(r.typeLabel) || typeof r.version !== 'number' || !Array.isArray(r.parties) || !Array.isArray(r.clauses)) return null;
  const parties = r.parties.filter((p): p is { roleLabel: string; name: string } => !!p && str((p as Record<string, unknown>).roleLabel) && str((p as Record<string, unknown>).name));
  const clauses = r.clauses.filter((c): c is { id: string; heading: string; body: string } => !!c && str((c as Record<string, unknown>).id) && str((c as Record<string, unknown>).heading) && str((c as Record<string, unknown>).body));
  const emails =
    r.signerEmails && typeof r.signerEmails === 'object' && !Array.isArray(r.signerEmails)
      ? Object.fromEntries(Object.entries(r.signerEmails as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === 'string'))
      : null;
  return { title: r.title, typeLabel: r.typeLabel, version: r.version, parties, clauses, ...(emails ? { signerEmails: emails } : {}) };
}

/** SHA-256 (hex) of the stored BYTES of the sent PDF. This is what a signature is recorded against. */
export const bytesSha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

export const isSha256 = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);

// ── Signers and where they stand ─────────────────────────────────────────

export type RequiredSigner = { partyId: string; role: PartyRole };

export type SignatureFact = {
  id: string;
  partyId: string;
  role: string;
  documentSha256: string;
  contractVersion: number;
  signedAt: string;
};

export type SignerState =
  /** A signature made against the document as it is now. */
  | { status: 'signed'; signature: SignatureFact }
  /** A signature exists but the document has changed since: it no longer counts. */
  | { status: 'stale'; signature: SignatureFact }
  | { status: 'pending' };

export type SignerRow = RequiredSigner & SignerState;

/**
 * Per required signer: valid, stale or pending. When a party signed the same
 * document twice (impossible by the unique key, but the function is total) the
 * newest valid one is reported; when there is no valid one, the newest stale.
 */
export function signerStates(required: readonly RequiredSigner[], signatures: readonly SignatureFact[], currentSha: string): SignerRow[] {
  return required.map((r) => {
    const mine = signatures.filter((s) => s.partyId === r.partyId).sort((a, b) => b.signedAt.localeCompare(a.signedAt) || b.id.localeCompare(a.id));
    const valid = mine.find((s) => s.documentSha256 === currentSha);
    if (valid) return { ...r, status: 'signed', signature: valid };
    if (mine.length > 0) return { ...r, status: 'stale', signature: mine[0] };
    return { ...r, status: 'pending' };
  });
}

export type SigningProgress = { total: number; signed: number; stale: number; pending: number; complete: boolean };

export function signingProgress(states: readonly SignerState[]): SigningProgress {
  const signed = states.filter((s) => s.status === 'signed').length;
  const stale = states.filter((s) => s.status === 'stale').length;
  const pending = states.length - signed - stale;
  return { total: states.length, signed, stale, pending, complete: states.length > 0 && signed === states.length };
}

/** The distinct parties of a contract, each with the role it first appears in. */
export function requiredSigners(links: readonly { party_id: string; role: PartyRole; position: number }[]): RequiredSigner[] {
  const seen = new Set<string>();
  const out: RequiredSigner[] = [];
  for (const l of [...links].sort((a, b) => a.position - b.position || a.party_id.localeCompare(b.party_id))) {
    if (seen.has(l.party_id)) continue;
    seen.add(l.party_id);
    out.push({ partyId: l.party_id, role: l.role });
  }
  return out;
}

// ── Who may sign, and when ───────────────────────────────────────────────

export type SignDenial =
  | 'not_sent' // only a contract that was sent for signature can be signed
  | 'void'
  | 'already_signed' // the contract is complete
  | 'not_a_party' // the party is not on this contract
  | 'already_signed_by' // this party already has a valid signature on this document
  | 'not_your_party' // the caller is neither that party nor allowed to countersign for the label
  | 'changed' // the signer read another version
  | 'no_frozen_copy'; // sent before signing existed: there is no frozen text to sign

export const SIGN_DENIAL_MESSAGE: Readonly<Record<SignDenial, string>> = {
  not_sent: 'This contract has not been sent for signature.',
  void: 'This contract was voided.',
  already_signed: 'This contract is already fully signed.',
  not_a_party: 'That party is not on this contract.',
  already_signed_by: 'This party has already signed this version.',
  not_your_party: 'You can only sign for yourself, or for the label if you may write contracts.',
  changed: 'The contract changed after you opened it. Reload it and read the new version.',
  no_frozen_copy: 'This contract was sent before signing was set up, so there is no frozen copy to sign. Replace it with a new draft and send that.',
};

export type SignContext = {
  contractStatus: ContractStatus;
  contractVersion: number;
  /** The version the signer reviewed. */
  seenVersion: number;
  required: readonly RequiredSigner[];
  states: readonly SignerRow[];
  partyId: string;
};

/** Does this contract accept a signature from this party right now? (Who the caller is comes next.) */
export function planSign(ctx: SignContext): { ok: true; role: PartyRole } | { ok: false; code: SignDenial } {
  if (ctx.contractStatus === 'void') return { ok: false, code: 'void' };
  if (ctx.contractStatus === 'signed') return { ok: false, code: 'already_signed' };
  if (ctx.contractStatus !== 'sent') return { ok: false, code: 'not_sent' };
  const signer = ctx.states.find((s) => s.partyId === ctx.partyId);
  if (!signer) return { ok: false, code: 'not_a_party' };
  if (ctx.seenVersion !== ctx.contractVersion) return { ok: false, code: 'changed' };
  if (signer.status === 'signed') return { ok: false, code: 'already_signed_by' };
  return { ok: true, role: signer.role };
}

/**
 * Whether a signed-in member may sign for this party. Two ways, and only two:
 *
 *  1. THEIR OWN party: `parties.user_id` is their account AND the account itself confirmed the party's details
 *     (`details_confirmed_by` = the same account, LABEL-54's party confirmation, which a re-link or an edit of the
 *     details clears). A rights writer who merely sets `user_id` to their own account — or to a colleague's — is not
 *     the party and cannot sign as it (the LABEL-71 H1 hole). Nor can someone who linked their OWN account to the
 *     party and then confirmed it (`user_linked_by` is the caller, or unknown): the link must be someone else's act.
 *  2. THE LABEL'S side: the party in role `label`, countersigned by an owner or admin, or a member who may write
 *     contracts.
 *
 * Everyone else signs through the party's own signing link. Nobody ever signs for another person's party.
 */
export function maySignAs(input: {
  partyRole: PartyRole;
  partyUserId: string | null;
  /** The account that confirmed the party's details (`details_confirmed_by`), when it has. */
  partyConfirmedBy: string | null;
  /** Who made the account link (`parties.user_linked_by`); null = unknown. */
  partyLinkedBy: string | null;
  userId: string;
  memberRole: string;
  canWriteContracts: boolean;
}): { ok: true; countersign: boolean } | { ok: false } {
  if (input.partyUserId && input.partyUserId === input.userId && input.partyConfirmedBy === input.userId && input.partyLinkedBy && input.partyLinkedBy !== input.userId) return { ok: true, countersign: false };
  if (input.partyRole === 'label' && (input.memberRole === 'owner' || input.memberRole === 'admin' || input.canWriteContracts)) return { ok: true, countersign: true };
  return { ok: false };
}

// ── The signature itself ─────────────────────────────────────────────────

export const MAX_SIGNER_NAME = 200;
export const MAX_DRAWN_BYTES = 200 * 1024;

export function cleanSignerName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  // Line separators become spaces; bidi overrides/isolates and zero-width marks are dropped (they make a legal name read
  // differently from what was typed). ZWNJ/ZWJ stay: Persian and Indic names need them.
  const name = raw
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f\u0085\u2028\u2029]/g, ' ')
    .replace(/[\u200b\u2060\ufeff\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return name.length >= 2 && name.length <= MAX_SIGNER_NAME ? name : null;
}

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** A drawn signature arrives as a PNG data URL. Anything else, or anything too large, is refused. */
export function parseDrawnSignature(dataUrl: unknown): { ok: true; bytes: Buffer } | { ok: false; reason: 'format' | 'size' } {
  if (typeof dataUrl !== 'string') return { ok: false, reason: 'format' };
  const hit = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!hit) return { ok: false, reason: 'format' };
  if (hit[1].length > Math.ceil((MAX_DRAWN_BYTES * 4) / 3) + 4) return { ok: false, reason: 'size' };
  const bytes = Buffer.from(hit[1], 'base64');
  if (bytes.length > MAX_DRAWN_BYTES) return { ok: false, reason: 'size' };
  if (bytes.length < PNG_MAGIC.length || !PNG_MAGIC.every((b, i) => bytes[i] === b)) return { ok: false, reason: 'format' };
  return { ok: true, bytes };
}

// ── Signer links (external signers) ──────────────────────────────────────

export const SIGN_LINK_DAYS = 30;

/** A fresh opaque token: 256 bits, URL-safe. Only its hash is stored. */
export function newSignToken(): string {
  return randomBytes(32).toString('base64url');
}

export const isWellFormedSignToken = (t: unknown): t is string => typeof t === 'string' && /^[A-Za-z0-9_-]{43}$/.test(t);

export const hashSignToken = (token: string): string => createHash('sha256').update(`label-os.sign-link.v1\0${token}`).digest('hex');

export const signLinkExpiry = (from: Date = new Date()): string => new Date(from.getTime() + SIGN_LINK_DAYS * 86_400_000).toISOString();

export const signLinkPath = (token: string): string => `/sign/${token}`;

export type LinkRow = { contractStatus: ContractStatus; tokenRevoked: boolean; expiresAt: string | null };

const notExpired = (row: LinkRow, now: Date) => row.expiresAt === null || new Date(row.expiresAt).getTime() > now.getTime();

/** A link SIGNS while its contract is out for signature and it is neither revoked nor expired. */
export function linkUsable(row: LinkRow, now: Date = new Date()): boolean {
  return row.contractStatus === 'sent' && !row.tokenRevoked && notExpired(row, now);
}

/**
 * A link can still be OPENED once the contract is fully signed (the signer wants their receipt), until it expires or
 * is revoked. A void contract, a draft or a stranger's guess is not readable.
 */
export function linkReadable(row: LinkRow, now: Date = new Date()): boolean {
  return (row.contractStatus === 'sent' || row.contractStatus === 'signed') && !row.tokenRevoked && notExpired(row, now);
}

/** Only the address of a hosted e-signature, https, no credentials, no control characters. */
export function cleanProviderUrl(raw: unknown): string | null | 'invalid' {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'string') return 'invalid';
  const text = raw.trim();
  if (text === '') return null;
  if (text.length > 500 || /[\u0000- \u007f@]/.test(text)) return 'invalid';
  try {
    const u = new URL(text);
    if (u.protocol !== 'https:' || u.username || u.password || !u.hostname.includes('.')) return 'invalid';
    // The database CHECK measures what is stored: the normalized form, which can be longer than what was typed.
    const normal = u.toString();
    return normal.length <= 500 ? normal : 'invalid';
  } catch {
    return 'invalid';
  }
}

// The term, expiry and the contract store's search live in contract-store-model.ts (no Node imports, so the page can use them).
export { EXPIRY_SOON_DAYS, contractEnd, expiryState, filterStore } from './contract-store-model';
export type { ExpiryState, StoreQuery, StoreRow } from './contract-store-model';
