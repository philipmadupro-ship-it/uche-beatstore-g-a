/**
 * An artist's decision on a beat — the STORED axis of the artist ↔ beat
 * relationship (`contact_track_states.decision`, migration 123).
 *
 * The other axis, engagement (sent → opened → played → downloaded), is never
 * stored; see `track-engagement.ts`. Keeping them apart is the point: the old
 * `beat_sends.status` mixed "they opened the email" with "they're recording
 * it" in one list, and it belonged to a send rather than to a beat, so one
 * artist's "interested in MIDNIGHT, pass on the other 7" could not be written.
 *
 * Available / archived describe the beat itself (store_listed, tracks.status),
 * purchased is derived from license_purchases, and versions are
 * track_versions — none of them are decisions.
 */

export const DECISIONS = ['interested', 'selected', 'recording', 'recorded', 'released', 'passed'] as const;
export type Decision = (typeof DECISIONS)[number];

export type DecisionSetBy = 'producer' | 'artist';

export function isDecision(value: unknown): value is Decision {
  return typeof value === 'string' && (DECISIONS as readonly string[]).includes(value);
}

export const DECISION_META: Record<Decision, { label: string; tone: 'positive' | 'progress' | 'done' | 'muted' }> = {
  interested: { label: 'Interested', tone: 'positive' },
  selected:   { label: 'Selected',   tone: 'progress' },
  recording:  { label: 'Recording',  tone: 'progress' },
  recorded:   { label: 'Recorded',   tone: 'progress' },
  released:   { label: 'Released',   tone: 'done' },
  passed:     { label: 'Passed',     tone: 'muted' },
};

/** Decisions that mean the beat is moving with this artist (Overview's "What's moving"). */
export const MOVING_DECISIONS: readonly Decision[] = ['interested', 'selected', 'recording', 'recorded'];

/** The two words an artist can say from the portal. */
export const ARTIST_DECISIONS: readonly Decision[] = ['interested', 'passed'];

/**
 * May the ARTIST change `current` to `next` (null = clear their reaction)?
 *
 * The artist says Interested / Pass, or takes it back. Once the producer has
 * moved the beat past interested (selected, recording, …) that is a working
 * decision the two of them made, and a tap in the portal must not undo it —
 * the route answers 409 and the portal shows the producer's word instead.
 */
export function canArtistSetDecision(current: Decision | null, next: Decision | null): boolean {
  if (next !== null && !ARTIST_DECISIONS.includes(next)) return false;
  return current === null || ARTIST_DECISIONS.includes(current);
}

/**
 * The one-time copy of `beat_sends.status` (migration 123), mirrored here so
 * the mapping is documented and tested where code can see it. `sent` and
 * `opened` are engagement and map to no decision.
 */
export function decisionFromLegacySendStatus(status: string | null | undefined): Decision | null {
  switch (status) {
    case 'interested': return 'interested';
    case 'negotiating': return 'selected';
    case 'placed': return 'released';
    case 'pass': return 'passed';
    default: return null;
  }
}

/** Human line for the timeline: "Artist #1 marked MIDNIGHT Interested". */
export function describeDecisionChange(opts: {
  contactName: string;
  trackTitle: string;
  decision: Decision | null;
  setBy: DecisionSetBy;
}): string {
  const who = opts.setBy === 'artist' ? opts.contactName : 'You';
  if (opts.decision === null) {
    return opts.setBy === 'artist'
      ? `${opts.contactName} took back their reaction to ${opts.trackTitle}`
      : `You cleared the decision on ${opts.trackTitle}`;
  }
  if (opts.decision === 'passed') return `${who} passed on ${opts.trackTitle}`;
  return `${who} marked ${opts.trackTitle} ${DECISION_META[opts.decision].label}`;
}
