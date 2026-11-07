/**
 * The contract form's pure half (LABEL-57): the screen's state to the request
 * body, and the problems to show before sending. Pure so it is tested; the
 * server validates again (`cleanFields`, the Zod schemas).
 */
import { cleanFields, mergeField } from './contracts/merge-fields';
import type { PartySlot } from './contracts/templates';
import type { PartyRole } from './contracts/types';

export type ContractForm = {
  title: string;
  artistId: string;
  trackId: string;
  releaseId: string;
  effectiveDate: string;
  termMonths: string;
  territories: string;
  fields: Record<string, string>;
  /** role → party ids (one for a single slot, several for a `many` slot). */
  parties: Partial<Record<PartyRole, string[]>>;
  note: string;
};

export const emptyContractForm = (): ContractForm => ({
  title: '', artistId: '', trackId: '', releaseId: '', effectiveDate: '', termMonths: '', territories: '', fields: {}, parties: {}, note: '',
});

/** "WW", "gb, fr" → ['WW'] / ['GB','FR']; blank → null (not stated). */
export function parseTerritories(text: string): string[] | null {
  const parts = text.split(/[\s,;]+/).map((p) => p.trim().toUpperCase()).filter(Boolean);
  return parts.length === 0 ? null : parts;
}

export function contractFormError(form: ContractForm, slots: readonly PartySlot[]): string | null {
  if (!form.title.trim()) return 'Give the contract a title';
  if (form.termMonths.trim() && !/^\d{1,4}$/.test(form.termMonths.trim())) return 'The term is a number of months';
  const t = parseTerritories(form.territories);
  if (t && !t.every((c) => /^[A-Z]{2}$/.test(c))) return 'Territories are two-letter country codes, or WW for worldwide';
  if (t && t.includes('WW') && t.length > 1) return 'WW means worldwide on its own';
  if (form.effectiveDate && !/^\d{4}-\d{2}-\d{2}$/.test(form.effectiveDate)) return 'The start date looks like 2027-03-01';
  const fields = cleanFields(form.fields);
  if (!fields.ok) return fields.error;
  for (const slot of slots) {
    if (!slot.many && (form.parties[slot.role]?.length ?? 0) > 1) return `Pick one ${slot.label.toLowerCase()}`;
  }
  return null;
}

/** The request body for create (`type`/`source` added by the caller) and for editing a draft. */
export function bodyFromContractForm(form: ContractForm): Record<string, unknown> {
  const cleaned = cleanFields(form.fields);
  const term = form.termMonths.trim();
  return {
    title: form.title.trim(),
    artist_contact_id: form.artistId || null,
    track_id: form.trackId || null,
    release_id: form.releaseId || null,
    effective_date: form.effectiveDate || null,
    term_months: term ? Number(term) : null,
    territories: parseTerritories(form.territories),
    fields: cleaned.ok ? cleaned.fields : {},
    parties: Object.entries(form.parties).flatMap(([role, ids]) => (ids ?? []).filter(Boolean).map((party_id) => ({ party_id, role }))),
    internal_note: form.note.trim() || null,
  };
}

export function formFromContract(c: {
  title: string; artist_contact_id: string | null; track_id: string | null; release_id: string | null; effective_date: string | null;
  term_months: number | null; territories: string[] | null; fields: Record<string, string>; parties: { party_id: string; role: PartyRole }[]; internal_note?: string | null;
}): ContractForm {
  const parties: Partial<Record<PartyRole, string[]>> = {};
  for (const p of c.parties) (parties[p.role] ??= []).push(p.party_id);
  return {
    title: c.title,
    artistId: c.artist_contact_id ?? '',
    trackId: c.track_id ?? '',
    releaseId: c.release_id ?? '',
    effectiveDate: c.effective_date ?? '',
    termMonths: c.term_months === null ? '' : String(c.term_months),
    territories: c.territories?.join(', ') ?? '',
    fields: { ...c.fields },
    parties,
    note: c.internal_note ?? '',
  };
}

/** Field input hint: what the kind accepts. */
export const fieldHint = (key: string): string | undefined => mergeField(key)?.hint;
