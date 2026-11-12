/**
 * The Parties page's rules (LABEL-54), pure: which parties a search finds, the
 * edit form and the request body it makes, and what to tell the person before
 * a request is sent. The server decides what a viewer MAY see and write; this
 * only works with what it sent (a party with no `legal` block has nothing to
 * search or edit there).
 */
import type { PartyView } from './credits';
import { normalizeCountry, paymentInstructionsError } from './payee';

export type ConfirmationState = 'confirmed' | 'unconfirmed' | 'unknown';

/** unknown = the viewer was not sent the legal block, so they cannot tell. */
export function confirmationState(p: PartyView): ConfirmationState {
  if (!p.legal) return 'unknown';
  return p.legal.confirmedAt ? 'confirmed' : 'unconfirmed';
}

/** Every word must appear in the name, the legal name, the PRO or the country. Tax id and payment instructions are never searched. */
export function filterParties(parties: readonly PartyView[], query: string): PartyView[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...parties];
  return parties.filter((p) => {
    const hay = [p.displayName, p.legal?.legalName, p.legal?.pro, p.legal?.country].filter(Boolean).join(' ').toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

export type PartyForm = {
  displayName: string;
  kind: 'person' | 'company';
  legalName: string;
  email: string;
  address: string;
  country: string;
  pro: string;
  proAffiliation: 'affiliated' | 'not_affiliated' | 'unknown';
  ipi: string;
  isni: string;
  publisherName: string;
  publisherIpi: string;
  taxId: string;
  paymentInstructions: string;
  /** The linked account ('' = none). */
  userId: string;
};

export const emptyForm = (): PartyForm => ({
  displayName: '', kind: 'person', legalName: '', email: '', address: '', country: '', pro: '', proAffiliation: 'unknown',
  ipi: '', isni: '', publisherName: '', publisherIpi: '', taxId: '', paymentInstructions: '', userId: '',
});

/** The linked account comes with the view only for a rights writer (`linkedUserId`); everyone else edits no link. */
export function formFromParty(p: PartyView, linkedUserId = p.linkedUserId ?? ''): PartyForm {
  const l = p.legal;
  return {
    displayName: p.displayName,
    kind: p.kind === 'company' ? 'company' : 'person',
    legalName: l?.legalName ?? '',
    email: l?.email ?? '',
    address: l?.address ?? '',
    country: l?.country ?? '',
    pro: l?.pro ?? '',
    proAffiliation: l?.proAffiliation === 'affiliated' || l?.proAffiliation === 'not_affiliated' ? l.proAffiliation : 'unknown',
    ipi: l?.ipi ?? '',
    isni: l?.isni ?? '',
    publisherName: l?.publisherName ?? '',
    publisherIpi: l?.publisherIpi ?? '',
    taxId: p.payee?.taxId ?? '',
    paymentInstructions: p.payee?.paymentInstructions ?? '',
    userId: linkedUserId,
  };
}

const FIELD_KEYS: [keyof PartyForm, string][] = [
  ['displayName', 'display_name'],
  ['kind', 'kind'],
  ['legalName', 'legal_name'],
  ['email', 'email'],
  ['address', 'address'],
  ['country', 'country'],
  ['pro', 'pro'],
  ['proAffiliation', 'pro_affiliation'],
  ['ipi', 'ipi'],
  ['isni', 'isni'],
  ['publisherName', 'publisher_name'],
  ['publisherIpi', 'publisher_ipi'],
  ['taxId', 'tax_id'],
  ['paymentInstructions', 'payment_instructions'],
];

/**
 * The request body. For a new party: what was typed. For an edit: only the
 * fields that differ from `original`, so an untouched display name never trips
 * the lock and a payee field the viewer never had is not sent as blank.
 */
export function bodyFromForm(form: PartyForm, original: PartyForm | null): Record<string, string | null> {
  const body: Record<string, string | null> = {};
  for (const [key, name] of FIELD_KEYS) {
    const value = form[key];
    if (original === null) {
      if (value !== '' && !(key === 'kind' && value === 'person') && !(key === 'proAffiliation' && value === 'unknown')) body[name] = value;
    } else if (value !== original[key]) {
      body[name] = value;
    }
  }
  if (original === null ? form.userId !== '' : form.userId !== original.userId) body.user_id = form.userId === '' ? null : form.userId;
  return body;
}

/** A plain message before the request is sent; the server checks the same things again. */
export function partyFormError(form: PartyForm): string | null {
  if (!form.displayName.trim()) return 'A party needs a name.';
  if (form.country.trim() && !normalizeCountry(form.country)) return 'Use the two-letter country code (FR, GB, US…).';
  return paymentInstructionsError(form.paymentInstructions);
}

/**
 * Who has a Parties page (nav and page agree): anyone who reads a party at all —
 * a rights reader, an own-line member (their own party) or finance (the payees).
 */
export function canSeeParties(caps: ReadonlySet<string>): boolean {
  return caps.has('rights.read') || caps.has('rights.read.own_line') || caps.has('finance.read');
}
