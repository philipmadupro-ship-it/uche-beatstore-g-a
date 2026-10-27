/**
 * "Send for signature" (LABEL-58). Pure. The last edit a contract gets: after
 * it the database refuses any change to its content (migration 176), so the
 * rules for sending are checked here first and the answer says what is
 * missing instead of letting a half-filled agreement go out.
 */
import { PARTY_ROLE_LABELS, type ContractStatus, type PartyRole } from './types';
import type { PartySlot } from './templates';

export type SendFacts = {
  status: ContractStatus;
  /** Merge values still empty (`Rendered.missing`). */
  missing: readonly string[];
  slots: readonly PartySlot[];
  /** Roles that have at least one party. */
  filledRoles: ReadonlySet<PartyRole>;
};

export type SendPlan = { ok: true } | { ok: false; status: 409 | 422; error: string; missing?: string[] };

export function planSend(f: SendFacts): SendPlan {
  if (f.status !== 'draft') {
    return { ok: false, status: 409, error: f.status === 'void' ? 'A void contract cannot be sent' : 'Only a draft can be sent for signature' };
  }
  const slot = f.slots.find((s) => s.required && !f.filledRoles.has(s.role));
  if (slot) return { ok: false, status: 422, error: `Choose the ${PARTY_ROLE_LABELS[slot.role].toLowerCase()} before sending` };
  if (f.missing.length > 0) {
    return { ok: false, status: 422, error: `${f.missing.length} value${f.missing.length === 1 ? ' is' : 's are'} still empty. Fill ${f.missing.length === 1 ? 'it' : 'them'} in before sending.`, missing: [...f.missing] };
  }
  return { ok: true };
}
