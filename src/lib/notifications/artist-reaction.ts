/**
 * The producer's notification when an artist reacts in their portal.
 *
 * "Artist #1 is interested in MIDNIGHT" is the moment the whole portal
 * exists for, so it goes to the bell (and desktop alerts, which read the same
 * rows). A pass is news too — quieter, but it tells the producer to stop
 * pitching that beat. Taking a reaction back is not news.
 *
 * `dedupe_key` is per contact, track and decision, so toggling Interested off
 * and on again does not ring the bell twice.
 */

export const ARTIST_REACTION_KIND = 'artist_reaction';

export interface ArtistReactionInput {
  ownerId: string;
  contactId: string;
  contactName: string;
  trackId: string;
  trackTitle: string;
  decision: 'interested' | 'passed';
}

export interface ArtistReactionRow {
  user_id: string;
  kind: typeof ARTIST_REACTION_KIND;
  title: string;
  body: string;
  data: { dedupe_key: string; contact_id: string; track_id: string; decision: 'interested' | 'passed' };
}

export function artistReactionDedupeKey(contactId: string, trackId: string, decision: string): string {
  return `artist_reaction_${contactId}_${trackId}_${decision}`;
}

export function buildArtistReactionNotification(input: ArtistReactionInput): ArtistReactionRow {
  const who = input.contactName.trim() || 'An artist';
  const what = input.trackTitle.trim() || 'a beat';
  return {
    user_id: input.ownerId,
    kind: ARTIST_REACTION_KIND,
    title: input.decision === 'interested' ? `${who} is interested in ${what}` : `${who} passed on ${what}`,
    body: input.decision === 'interested'
      ? 'From their portal. Move it to Selected from their workspace when it’s theirs.'
      : 'From their portal.',
    data: {
      dedupe_key: artistReactionDedupeKey(input.contactId, input.trackId, input.decision),
      contact_id: input.contactId,
      track_id: input.trackId,
      decision: input.decision,
    },
  };
}
