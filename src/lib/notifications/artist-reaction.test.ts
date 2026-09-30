import { describe, expect, it } from 'vitest';
import { buildArtistReactionNotification } from './artist-reaction';

const base = { ownerId: 'o1', contactId: 'c1', contactName: 'Artist #1', trackId: 't1', trackTitle: 'MIDNIGHT' };

describe('buildArtistReactionNotification', () => {
  it('announces interest', () => {
    expect(buildArtistReactionNotification({ ...base, decision: 'interested' })).toMatchObject({
      user_id: 'o1',
      kind: 'artist_reaction',
      title: 'Artist #1 is interested in MIDNIGHT',
      data: { dedupe_key: 'artist_reaction_c1_t1_interested', contact_id: 'c1', track_id: 't1', decision: 'interested' },
    });
  });

  it('announces a pass under its own dedupe key', () => {
    const row = buildArtistReactionNotification({ ...base, decision: 'passed' });
    expect(row.title).toBe('Artist #1 passed on MIDNIGHT');
    expect(row.data.dedupe_key).toBe('artist_reaction_c1_t1_passed');
  });

  it('falls back for blank names', () => {
    expect(buildArtistReactionNotification({ ...base, contactName: ' ', trackTitle: '', decision: 'interested' }).title)
      .toBe('An artist is interested in a beat');
  });
});
