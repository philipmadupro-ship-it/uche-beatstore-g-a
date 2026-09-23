/**
 * Derived activity tone — the read-only pulse shown next to a contact.
 *
 * Distinct from the editable `crm_status` stage: the tone answers "is this
 * relationship warm right now", the stage answers "where have I put them".
 *
 * This used to be computed inline, twice (the list and the detail page), from
 * send recency alone: `if (sends.length === 0) return 'cold'`. That labelled a
 * customer who had spent $2,000 as **Cold**, purely because they had never been
 * DM'd a beat — the single most visibly wrong thing in the CRM. Buying is the
 * strongest engagement signal there is; it cannot produce a cold reading.
 *
 * Pure and injectable-clock so the thresholds are unit-tested rather than
 * asserted inside a component — the same reason filterAndSortTracks and
 * scoreLead live in lib/. Two inline copies of a rule is exactly how it
 * silently drifts back.
 */

export type ActivityTone = 'active' | 'engaged' | 'cold';

/** A send within this window means the conversation is live. */
const ACTIVE_SEND_DAYS = 30;

export interface ToneInput {
  /** ISO timestamp of the most recent beat send, or null if never sent to. */
  lastSentAt?: string | null;
  /** Count of completed purchases. Any purchase rules out a cold reading. */
  purchases?: number;
  /** Injectable clock for tests (ms). */
  now?: number;
}

export function deriveActivityTone(input: ToneInput): ActivityTone {
  const now = input.now ?? Date.now();
  const hasBought = (input.purchases ?? 0) > 0;

  if (input.lastSentAt) {
    const days = (now - Date.parse(input.lastSentAt)) / 86_400_000;
    if (Number.isFinite(days) && days <= ACTIVE_SEND_DAYS) return 'active';
    return 'engaged';
  }

  // No sends. A buyer is still engaged — they just aren't mid-conversation.
  return hasBought ? 'engaged' : 'cold';
}
