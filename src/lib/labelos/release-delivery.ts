/**
 * Delivering a release (LABEL-33, 09 §4). Pure: `POST …/releases/[id]/deliver`
 * reads the row, the member and the derived readiness, and this module decides
 * what the request may do. No distributor API is called (out of scope): a
 * delivery is the producer's statement that the release went to a distributor
 * on a date, recorded with the audit event that proves who said so.
 *
 *  - Only a DRAFT is delivered. A delivered release is 409 (never a second
 *    event); a cancelled one is 409 too.
 *  - Ready = `readyToDeliver` from LABEL-32, which is blockers only.
 *  - An OVERRIDE delivers a release whose gates are not all satisfied. It is
 *    owner-only (role `owner`, not a capability) and needs a written reason:
 *    a non-owner who asks for one is 403 whatever else the body holds, an
 *    owner without a note is 400.
 *  - An override on a release that is ready is not an override: it delivers
 *    normally and the note is not recorded (nothing was overridden).
 */
import type { ReleaseGate } from './release-readiness';

export const DELIVERY_NOTE_MAX = 1000;
export const DISTRIBUTOR_MAX = 120;

export type DeliveryFacts = {
  state: string;
  readyToDeliver: boolean;
  /** Gates not satisfied right now, for the override record. */
  openGates: readonly ReleaseGate[];
};

export type DeliveryRequest = {
  distributor: string;
  /** `YYYY-MM-DD`, or null for "now". */
  deliveredOn: string | null;
  override: boolean;
  note: string | null;
};

export type DeliveryPlan =
  | { ok: true; override: boolean; note: string | null; deliveredAt: string; openGates: readonly ReleaseGate[] }
  | { ok: false; status: 400 | 403 | 409 | 422; error: string; field?: string };

/** The instant a date means: noon UTC of that day, so every timezone reads the same calendar day. */
export function deliveredAtFor(deliveredOn: string | null, now: Date): string {
  return deliveredOn ? `${deliveredOn}T12:00:00.000Z` : now.toISOString();
}

/** A delivery is dated today or earlier; tomorrow (UTC) is allowed so a far-east producer's "today" is not refused. */
export function deliveryDateProblem(deliveredOn: string, now: Date): string | null {
  const t = Date.parse(`${deliveredOn}T12:00:00.000Z`);
  if (Number.isNaN(t)) return 'Pick a real date';
  if (t > now.getTime() + 36 * 3600 * 1000) return 'A delivery cannot be dated in the future';
  return null;
}

export function planDelivery(facts: DeliveryFacts, req: DeliveryRequest, isOwner: boolean, now: Date): DeliveryPlan {
  // Who may override is judged before anything about the release is said.
  if (req.override && !isOwner) {
    return { ok: false, status: 403, error: 'Only an owner can deliver a release that is not ready', field: 'override' };
  }
  const note = req.note?.trim() ? req.note.trim() : null;
  if (req.override && !note) {
    return { ok: false, status: 400, error: 'Say why the release is delivered before it is ready', field: 'override_note' };
  }
  if (req.deliveredOn) {
    const problem = deliveryDateProblem(req.deliveredOn, now);
    if (problem) return { ok: false, status: 400, error: problem, field: 'delivered_on' };
  }
  if (facts.state !== 'draft') {
    return { ok: false, status: 409, error: facts.state === 'delivered' ? 'This release was already delivered' : `A ${facts.state} release cannot be delivered`, field: 'state' };
  }
  const deliveredAt = deliveredAtFor(req.deliveredOn, now);
  if (facts.readyToDeliver) return { ok: true, override: false, note: null, deliveredAt, openGates: [] };
  if (!req.override) {
    return { ok: false, status: 422, error: 'Some gates are not satisfied yet', field: 'gates' };
  }
  return { ok: true, override: true, note, deliveredAt, openGates: facts.openGates };
}
