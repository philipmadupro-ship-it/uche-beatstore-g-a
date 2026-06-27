/**
 * Stems / exclusive-deliverable readiness — pure predicates.
 *
 * Whether an exclusive purchase has something real to deliver drives money +
 * fulfillment decisions in several routes (checkout's deliverable gate, the
 * offer-accept flow, the webhook's needs_stems_upload flag, the /sales
 * "Awaiting stems" badge). The `ready | done | complete` status set was
 * duplicated inline in each, which is exactly how these drift. Centralised here
 * and unit-tested so the predicate has one definition.
 */

/** A track as far as deliverable-readiness cares. */
export interface DeliverableLike {
  wav_url?: string | null;
  stems_status?: string | null;
}

const READY_STATES = new Set(['ready', 'done', 'complete']);

/** True when the track's stem split has finished and is downloadable. */
export function stemsReady(status: string | null | undefined): boolean {
  return !!status && READY_STATES.has(status);
}

/**
 * True when an exclusive purchase of this track can actually be fulfilled —
 * there's either a mastered WAV or a finished stem split to hand over.
 */
export function isExclusiveDeliverable(track: DeliverableLike): boolean {
  return !!track.wav_url || stemsReady(track.stems_status);
}

/**
 * True when an exclusive sale would leave us with nothing to deliver yet, so
 * the producer must upload stems/WAV after the sale (webhook sets
 * needs_stems_upload; /sales shows the "Awaiting stems" badge).
 */
export function needsStemsUpload(track: DeliverableLike): boolean {
  return !isExclusiveDeliverable(track);
}
