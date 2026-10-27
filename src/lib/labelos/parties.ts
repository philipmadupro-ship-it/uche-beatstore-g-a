/**
 * Party input (LABEL-27): the rights identity of a person or company
 * (05 §3). Pure — turns a validated request body into database columns, with
 * the legal identifiers normalised to ONE stored form so the same IPI typed
 * two ways is one value, and refuses one that cannot be real.
 *
 * `display_name` is what the credits strip shows; `legal_name`, the codes and
 * the email are legal data (visible with `rights.read` only, `credits.ts`).
 * Empty strings clear a field (`null`); an omitted key keeps it.
 */
import { parseIdentifier } from './identifiers';
import { ADDRESS_MAX, normalizeCountry, paymentInstructionsError, TAX_ID_MAX } from './payee';

export const PARTY_KINDS = ['person', 'company'] as const;
export type PartyKind = (typeof PARTY_KINDS)[number];

export const PRO_AFFILIATIONS = ['affiliated', 'not_affiliated', 'unknown'] as const;
export type ProAffiliation = (typeof PRO_AFFILIATIONS)[number];

export const PARTY_COLUMNS =
  'id, kind, display_name, legal_name, email, ipi, isni, pro, pro_affiliation, publisher_name, publisher_ipi, contact_id, user_id, created_at, address, country, details_confirmed_by, details_confirmed_at';

/**
 * The same plus the payee columns. Selected only for a reader who may have
 * them (`mayReadPayee`), so a tax id never sits in memory of a route that
 * would not show it. Migration 174 also takes them out of the API roles'
 * column grants.
 */
export const PARTY_PAYEE_COLUMNS = `${PARTY_COLUMNS}, tax_id, payment_instructions`;

export type PartyInput = {
  kind?: PartyKind;
  display_name?: string;
  legal_name?: string | null;
  email?: string | null;
  ipi?: string | null;
  isni?: string | null;
  pro?: string | null;
  pro_affiliation?: ProAffiliation;
  publisher_name?: string | null;
  publisher_ipi?: string | null;
  contact_id?: string | null;
  user_id?: string | null;
  address?: string | null;
  country?: string | null;
  tax_id?: string | null;
  payment_instructions?: string | null;
};

export type PartyColumns = Record<string, string | null>;
export type PartyColumnsResult = { ok: true; columns: PartyColumns } | { ok: false; error: string };

const ISNI = /^[0-9]{15}[0-9X]$/;

export function normalizeIsni(raw: string): string | null {
  const v = raw.replace(/[\s-]/g, '').toUpperCase();
  return ISNI.test(v) ? v : null;
}

const blank = (v: string | null | undefined): string | null => {
  if (v === null || v === undefined) return null;
  const t = v.trim().replace(/\s+/g, ' ');
  return t === '' ? null : t;
};

/** Only the keys the body names; identifiers normalised; the first bad one reported. */
export function partyColumns(input: PartyInput): PartyColumnsResult {
  const out: PartyColumns = {};
  const text = (key: keyof PartyInput, column = key as string) => {
    if (input[key] !== undefined) out[column] = blank(input[key] as string | null);
  };

  if (input.kind !== undefined) out.kind = input.kind;
  if (input.display_name !== undefined) {
    const name = blank(input.display_name);
    if (!name) return { ok: false, error: 'A party needs a display name' };
    out.display_name = name;
  }
  text('legal_name');
  text('pro');
  text('publisher_name');
  if (input.pro_affiliation !== undefined) out.pro_affiliation = input.pro_affiliation;
  if (input.contact_id !== undefined) out.contact_id = input.contact_id;
  if (input.user_id !== undefined) out.user_id = input.user_id;

  if (input.email !== undefined) {
    const email = blank(input.email);
    out.email = email ? email.toLowerCase() : null;
  }
  for (const key of ['ipi', 'publisher_ipi'] as const) {
    if (input[key] === undefined) continue;
    const raw = blank(input[key]);
    if (raw === null) {
      out[key] = null;
      continue;
    }
    const parsed = parseIdentifier('ipi', raw);
    if (!parsed.ok) return { ok: false, error: key === 'ipi' ? parsed.error : `publisher_${parsed.error}` };
    out[key] = parsed.value;
  }
  if (input.address !== undefined) {
    const address = input.address === null ? null : input.address.trim().replace(/[ \t]+/g, ' ');
    if (address && address.length > ADDRESS_MAX) return { ok: false, error: `address: at most ${ADDRESS_MAX} characters` };
    out.address = address || null;
  }
  if (input.country !== undefined) {
    const raw = blank(input.country);
    if (raw === null) out.country = null;
    else {
      const country = normalizeCountry(raw);
      if (!country) return { ok: false, error: 'country: use the two-letter country code (FR, GB, US…)' };
      out.country = country;
    }
  }
  if (input.tax_id !== undefined) {
    const taxId = blank(input.tax_id);
    if (taxId && taxId.length > TAX_ID_MAX) return { ok: false, error: `tax_id: at most ${TAX_ID_MAX} characters` };
    out.tax_id = taxId;
  }
  if (input.payment_instructions !== undefined) {
    const error = paymentInstructionsError(input.payment_instructions);
    if (error) return { ok: false, error };
    out.payment_instructions = blank(input.payment_instructions);
  }
  if (input.isni !== undefined) {
    const raw = blank(input.isni);
    if (raw === null) out.isni = null;
    else {
      const isni = normalizeIsni(raw);
      if (!isni) return { ok: false, error: 'isni: not a valid ISNI (16 digits, the last may be X)' };
      out.isni = isni;
    }
  }
  return { ok: true, columns: out };
}

/** What a person is called when nothing better is known: the name in their profile, else the local part of their email. */
export function ownPartyName(identity: { name: string | null; email: string | null }): string {
  if (identity.name) return identity.name;
  const local = identity.email?.split('@')[0]?.trim();
  return local ? local : 'Member';
}

/** The columns payee data lives in: written with `rights.write`, read per `mayReadPayee`. */
export const PAYEE_FIELDS = ['tax_id', 'payment_instructions'] as const;

/** What a person may correct about THEMSELVES when they confirm their details. */
export const SELF_CORRECTABLE = [
  'legal_name',
  'ipi',
  'isni',
  'pro',
  'pro_affiliation',
  'publisher_name',
  'publisher_ipi',
  'address',
  'country',
] as const;

/**
 * Does this write change what the person confirmed (a field they can correct) or the account they
 * confirmed as? Then the "confirmed" stamp is cleared with it (migration 174's
 * `parties_confirmation_reset` is the same rule in the database).
 */
export function clearsConfirmation(columns: Record<string, unknown>): boolean {
  return [...SELF_CORRECTABLE, 'user_id', 'contact_id'].some((key) => key in columns);
}

export function pickSelfCorrections(input: PartyInput): PartyInput {
  const out: Record<string, unknown> = {};
  for (const key of SELF_CORRECTABLE) if ((input as Record<string, unknown>)[key] !== undefined) out[key] = (input as Record<string, unknown>)[key];
  return out as PartyInput;
}

const squash = (v: string) => v.trim().replace(/\s+/g, ' ');

export type PartyIdentity = { display_name: string; user_id: string | null };

/**
 * The lock (LABEL-54, review G6 D-c). Once a split sheet that is no longer a
 * draft names the party, the name on that sheet and the account that signs for
 * it must not move underneath it: `display_name` cannot change, and a linked
 * account cannot be swapped or removed. Linking an account to a party that has
 * none is allowed — it names no one new, and it is how the person gets to see
 * and acknowledge their own line. Legal name, codes and addresses stay
 * editable: they are the record's data, not its identity, and a typo in an IPI
 * must be fixable. Migration 174's `parties_identity_lock` is the same rule in
 * the database. null = allowed.
 */
export function partyLockViolation(change: { display_name?: string; user_id?: string | null }, current: PartyIdentity, onNonDraftSheet: boolean): string | null {
  if (!onNonDraftSheet) return null;
  if (change.display_name !== undefined && squash(change.display_name) !== squash(current.display_name)) {
    return 'This name is on a split sheet that has been circulated. Start a new version of the sheet with a new party instead of renaming this one.';
  }
  if (change.user_id !== undefined && current.user_id !== null && change.user_id !== current.user_id) {
    return 'This party is on a split sheet that has been circulated, so its account cannot be changed. Start a new version of the sheet with a new party.';
  }
  return null;
}
