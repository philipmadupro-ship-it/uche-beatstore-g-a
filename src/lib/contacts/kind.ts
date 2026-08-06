/**
 * Contact kind — "is this someone I send beats to, or someone who bought
 * from me?" derived from behavior, not from free text.
 *
 * THE GAP THIS CLOSES. `role`, `label`, and `category` are all free-text
 * columns different code paths have written inconsistently over time (the
 * table falls back through `role || label || category`) — none of them
 * reliably answer the one question a producer actually asks when scanning
 * the CRM: what IS this person to me? Meanwhile the signals that would
 * answer it precisely already exist and are already fetched for lead
 * scoring: purchases, beat_sends, and buyer-account favorites.
 *
 * Purchases outrank everything — money changing hands is a stronger,
 * less ambiguous signal than a role field a producer typed in once and
 * never revisited. Pure and tested, same convention as scoring.ts.
 */

export type ContactKind = 'buyer' | 'artist' | 'lead' | 'contact';

export interface KindInput {
  purchases: number;
  sends: number;
  favorites: number;
  crmStatus?: string | null;
}

export function deriveContactKind(input: KindInput): ContactKind {
  if (input.purchases > 0) return 'buyer';
  if (input.sends > 0) return 'artist';
  if (input.favorites > 0 || input.crmStatus === 'prospect') return 'lead';
  return 'contact';
}

export const KIND_META: Record<ContactKind, { label: string; color: string }> = {
  buyer:   { label: 'Buyer',   color: '#6DC6A4' },
  artist:  { label: 'Artist',  color: '#c8a47a' },
  lead:    { label: 'Lead',    color: '#c8a84b' },
  contact: { label: 'Contact', color: 'rgba(255,255,255,0.4)' },
};
