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
 *   1. THE DOCUMENT IS ITS HASH. `documentHash` is the SHA-256 of a canonical
 *      rendering of what the signer reads: title, type, version, every party's
 *      role / name / address and the merged clauses. It is built from the same
 *      `ContractDocumentInput` the PDF is, minus the date it was made on, so
 *      the file and the hash cannot describe different texts, and so it does
 *      not move every day the way PDF bytes do.
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
 * Also here, because the contract store needs them: the end date of a term
 * (`contractEnd`), its expiry state, and the store's search.
 */
import { createHash, randomBytes } from 'node:crypto';
import type { ContractDocumentInput } from './contracts/document';
import { CONTRACT_STATUS_LABELS, TEMPLATE_TYPE_LABELS, type ContractStatus, type PartyRole, type TemplateTypeId } from './contracts/types';

// ── The document and its hash ────────────────────────────────────────────

/** Bump if the canonical form ever changes: an old hash must not silently match a new form. */
export const DOCUMENT_HASH_VERSION = 1;

/** What the signer reads, in a form that does not depend on JS key order or on the day it was rendered. */
export function canonicalDocument(input: Pick<ContractDocumentInput, 'title' | 'typeLabel' | 'version' | 'parties' | 'clauses'>): string {
  return JSON.stringify({
    v: DOCUMENT_HASH_VERSION,
    title: input.title,
    type: input.typeLabel,
    version: input.version,
    parties: input.parties.map((p) => [p.roleLabel, p.name]),
    clauses: input.clauses.map((c) => [c.id, c.heading, c.body]),
  });
}

export function documentHash(input: Parameters<typeof canonicalDocument>[0]): string {
  return createHash('sha256').update(canonicalDocument(input), 'utf8').digest('hex');
}

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
  | 'changed'; // the signer read another version

export const SIGN_DENIAL_MESSAGE: Readonly<Record<SignDenial, string>> = {
  not_sent: 'This contract has not been sent for signature.',
  void: 'This contract was voided.',
  already_signed: 'This contract is already fully signed.',
  not_a_party: 'That party is not on this contract.',
  already_signed_by: 'This party has already signed this version.',
  not_your_party: 'You can only sign for yourself, or for the label if you may write contracts.',
  changed: 'The contract changed after you opened it. Reload it and read the new version.',
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
 * Whether a signed-in member may sign for this party: it is linked to their own
 * account (`parties.user_id`), or it is the label's own side and they may write
 * contracts (the countersignature). Nobody signs for another person's party,
 * whatever their role or capabilities.
 */
export function maySignAs(input: {
  partyRole: PartyRole;
  partyUserId: string | null;
  userId: string;
  canWriteContracts: boolean;
}): { ok: true; countersign: boolean } | { ok: false } {
  if (input.partyUserId && input.partyUserId === input.userId) return { ok: true, countersign: false };
  if (input.partyRole === 'label' && input.canWriteContracts) return { ok: true, countersign: true };
  return { ok: false };
}

// ── The signature itself ─────────────────────────────────────────────────

export const MAX_SIGNER_NAME = 200;
export const MAX_DRAWN_BYTES = 200 * 1024;

export function cleanSignerName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.normalize('NFC').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
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

/** A link works while its contract is out for signature and it is neither revoked nor expired. */
export function linkUsable(row: LinkRow, now: Date = new Date()): boolean {
  if (row.contractStatus !== 'sent' || row.tokenRevoked) return false;
  return row.expiresAt === null || new Date(row.expiresAt).getTime() > now.getTime();
}

/** Only the address of a hosted e-signature, https, no credentials, no control characters. */
export function cleanProviderUrl(raw: unknown): string | null | 'invalid' {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'string') return 'invalid';
  const text = raw.trim();
  if (text === '') return null;
  if (text.length > 500 || /[\u0000- \u007f]/.test(text)) return 'invalid';
  try {
    const u = new URL(text);
    if (u.protocol !== 'https:' || u.username || u.password || !u.hostname.includes('.')) return 'invalid';
    return u.toString();
  } catch {
    return 'invalid';
  }
}

// ── Terms, expiry and the contract store ─────────────────────────────────

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The day a term ends (the last day it runs): effective date plus term months, minus one day. */
export function contractEnd(effectiveDate: string | null, termMonths: number | null): string | null {
  const hit = effectiveDate ? DAY.exec(effectiveDate) : null;
  if (!hit || !termMonths || !Number.isInteger(termMonths) || termMonths < 1) return null;
  const [y, m, d] = [Number(hit[1]), Number(hit[2]), Number(hit[3])];
  const start = new Date(Date.UTC(y, m - 1, d));
  if (start.getUTCFullYear() !== y || start.getUTCMonth() !== m - 1 || start.getUTCDate() !== d) return null;
  const total = m - 1 + termMonths;
  const ty = y + Math.floor(total / 12);
  const tm = total % 12;
  // Clamp 31 Jan + 1 month to the last day of February.
  const last = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  const end = new Date(Date.UTC(ty, tm, Math.min(d, last) - 1));
  return end.toISOString().slice(0, 10);
}

export type ExpiryState = { kind: 'none' } | { kind: 'ok'; days: number } | { kind: 'soon'; days: number } | { kind: 'expired'; days: number };

export const EXPIRY_SOON_DAYS = 60;

/** Void and draft contracts do not expire; a sent or signed one does when its term runs out. */
export function expiryState(c: { status: ContractStatus; effective_date: string | null; term_months: number | null }, today: string): ExpiryState {
  if (c.status !== 'sent' && c.status !== 'signed') return { kind: 'none' };
  const end = contractEnd(c.effective_date, c.term_months);
  if (!end || !DAY.test(today)) return { kind: 'none' };
  const days = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (days < 0) return { kind: 'expired', days: -days };
  return days <= EXPIRY_SOON_DAYS ? { kind: 'soon', days } : { kind: 'ok', days };
}

export type StoreRow = {
  id: string;
  type: TemplateTypeId;
  title: string;
  status: ContractStatus;
  effective_date: string | null;
  term_months: number | null;
  parties: readonly { name: string }[];
};

export type StoreQuery = { q?: string; status?: ContractStatus | 'all'; type?: TemplateTypeId | 'all'; expiring?: boolean };

const fold = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * The contract store's filter. Every word of `q` must appear in the title, the
 * type's name, a party's name or the status word (so "nova recording signed"
 * finds Nova's signed recording agreement). `expiring` keeps the contracts
 * whose term ends within the soon window or already has.
 */
export function filterStore<T extends StoreRow>(rows: readonly T[], query: StoreQuery, today: string): T[] {
  const words = fold(query.q ?? '').split(/\s+/).filter(Boolean).slice(0, 8);
  return rows.filter((r) => {
    if (query.status && query.status !== 'all' && r.status !== query.status) return false;
    if (query.type && query.type !== 'all' && r.type !== query.type) return false;
    if (query.expiring) {
      const e = expiryState(r, today);
      if (e.kind !== 'soon' && e.kind !== 'expired') return false;
    }
    if (words.length === 0) return true;
    const hay = fold([r.title, TEMPLATE_TYPE_LABELS[r.type], CONTRACT_STATUS_LABELS[r.status], ...r.parties.map((p) => p.name)].join(' \n '));
    return words.every((w) => hay.includes(w));
  });
}
