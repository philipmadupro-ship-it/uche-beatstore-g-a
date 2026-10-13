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

export const PARTY_KINDS = ['person', 'company'] as const;
export type PartyKind = (typeof PARTY_KINDS)[number];

export const PRO_AFFILIATIONS = ['affiliated', 'not_affiliated', 'unknown'] as const;
export type ProAffiliation = (typeof PRO_AFFILIATIONS)[number];

export const PARTY_COLUMNS =
  'id, kind, display_name, legal_name, email, ipi, isni, pro, pro_affiliation, publisher_name, publisher_ipi, contact_id, user_id, created_at';

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
