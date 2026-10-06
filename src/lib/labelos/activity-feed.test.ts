import { describe, expect, it } from 'vitest';
import { capabilitiesFor } from './capabilities';
import { toArtistScope } from './artist-scope';
import {
  eventVisibleTo,
  projectArtistsFor,
  toFeedEvent,
  withholdHiddenSongs,
  type ActivityRow,
  type FeedViewer,
} from './activity-feed';

const U = '00000000-0000-4000-8000-0000000000a1';
const NOVA = '00000000-0000-4000-8000-0000000000c1';
const KILO = '00000000-0000-4000-8000-0000000000c2';
const P1 = '00000000-0000-4000-8000-0000000000d1';
const P2 = '00000000-0000-4000-8000-0000000000d2';
const S1 = '00000000-0000-4000-8000-0000000000f1';
const S2 = '00000000-0000-4000-8000-0000000000f2';

function row(over: Partial<ActivityRow> = {}): ActivityRow {
  return {
    id: 'e1',
    verb: 'song.created',
    actor_id: U,
    artist_id: null,
    project_id: null,
    song_id: null,
    release_id: null,
    subject_type: 'track',
    subject_id: S1,
    payload: {},
    visibility: 'artist',
    created_at: '2026-10-05T10:00:00.000Z',
    ...over,
  };
}

describe('toFeedEvent', () => {
  it('maps a row field by field', () => {
    const e = toFeedEvent(row({ artist_id: NOVA, project_id: P1, song_id: S1, release_id: null }));
    expect(e).toEqual({
      id: 'e1',
      verb: 'song.created',
      at: '2026-10-05T10:00:00.000Z',
      actorId: U,
      artistId: NOVA,
      projectId: P1,
      songId: S1,
      releaseId: null,
      subjectType: 'track',
      subjectId: S1,
      visibility: 'artist',
      summary: {},
    });
  });

  it('carries only the whitelisted payload fields, never the rest of the payload', () => {
    const e = toFeedEvent(
      row({
        verb: 'invitation.created',
        payload: { email: 'someone@example.com', token_hash: 'abc', role: 'member', title: 'T', items: 'reordered', state: { from: 'draft', to: 'cancelled', secret: 'x' }, song_stage: 'inbox', fields: ['a'] },
      }),
    );
    expect(e.summary).toEqual({ title: 'T', items: 'reordered', state: { from: 'draft', to: 'cancelled' }, stage: 'inbox' });
    expect(JSON.stringify(e)).not.toMatch(/someone@example|token_hash|secret|member/);
  });

  it('drops values of the wrong type or outside the vocabulary', () => {
    const e = toFeedEvent(row({ payload: { title: 42, items: 'shuffled', state: 'cancelled', song_stage: { x: 1 } } }));
    expect(e.summary).toEqual({});
  });

  it('reads a stage move from { from, to } when both are real stages', () => {
    expect(toFeedEvent(row({ verb: 'song.stage_changed', payload: { from: 'inbox', to: 'in_review', note: 'x' } })).summary).toEqual({ move: { from: 'inbox', to: 'in_review' } });
    expect(toFeedEvent(row({ verb: 'song.stage_changed', payload: { from: 'inbox', to: 'released' } })).summary).toEqual({});
    expect(toFeedEvent(row({ verb: 'song.stage_changed', payload: { from: 'inbox' } })).summary).toEqual({});
    // Only that verb: another verb's payload with from/to is not a stage move.
    expect(toFeedEvent(row({ verb: 'release.updated', payload: { from: 'inbox', to: 'in_review' } })).summary).toEqual({});
  });

  it('trims long titles', () => {
    const e = toFeedEvent(row({ payload: { title: 'x'.repeat(500) } }));
    expect(e.summary.title).toHaveLength(120);
  });

  it('reads a null or non-object payload as empty', () => {
    expect(toFeedEvent(row({ payload: null as never })).summary).toEqual({});
    expect(toFeedEvent(row({ payload: [] as never })).summary).toEqual({});
  });

  it('lowercases ids so a scope check cannot miss on case', () => {
    const e = toFeedEvent(row({ artist_id: NOVA.toUpperCase() }));
    expect(e.artistId).toBe(NOVA);
  });
});

function viewer(role: 'owner' | 'member' | 'artist', functions: string[], scopeColumn: 'org' | 'artists', contacts: string[] = [], projects: string[] = []): FeedViewer {
  const artistScope = toArtistScope(role, scopeColumn, contacts);
  return {
    capabilities: capabilitiesFor('label', role, functions as never[]),
    artistScope,
    projectsInScope: artistScope === null ? null : new Set(projects),
  };
}

describe('eventVisibleTo — the TS twin of the activity_events policy (migration 147)', () => {
  const owner = viewer('owner', [], 'org');
  const ar = viewer('member', ['a_and_r'], 'org');
  const scoped = viewer('member', ['a_and_r'], 'artists', [NOVA], [P1]);
  const artist = viewer('artist', [], 'artists', [NOVA], [P1]);

  const nova = { visibility: 'artist' as const, artistId: NOVA, projectId: null };
  const kilo = { visibility: 'artist' as const, artistId: KILO, projectId: null };

  it('a whole-org member with business.read.internal reads everything, orgwide events included', () => {
    expect(eventVisibleTo(owner, nova)).toBe(true);
    expect(eventVisibleTo(owner, { visibility: 'internal', artistId: null, projectId: null })).toBe(true);
  });

  it('an internal event needs business.read.internal: A&R and the artist do not read it', () => {
    const internal = { ...nova, visibility: 'internal' as const };
    expect(eventVisibleTo(owner, internal)).toBe(true);
    expect(eventVisibleTo(ar, internal)).toBe(false);
    expect(eventVisibleTo(scoped, internal)).toBe(false);
    expect(eventVisibleTo(artist, internal)).toBe(false);
  });

  it('a whole-org A&R reads artist events of every artist, and none of the organization’s own business', () => {
    expect(eventVisibleTo(ar, nova)).toBe(true);
    expect(eventVisibleTo(ar, kilo)).toBe(true);
    expect(eventVisibleTo(ar, { visibility: 'artist', artistId: null, projectId: null })).toBe(true);
  });

  it('a scoped member reads only the artists they hold', () => {
    expect(eventVisibleTo(scoped, nova)).toBe(true);
    expect(eventVisibleTo(scoped, kilo)).toBe(false);
    expect(eventVisibleTo(artist, nova)).toBe(true);
    expect(eventVisibleTo(artist, kilo)).toBe(false);
  });

  it('an event with only a project is visible when that project is in scope', () => {
    expect(eventVisibleTo(scoped, { visibility: 'artist', artistId: null, projectId: P1 })).toBe(true);
    expect(eventVisibleTo(scoped, { visibility: 'artist', artistId: null, projectId: P2 })).toBe(false);
  });

  it('when an event names an artist, the artist decides — a visible project does not widen it', () => {
    expect(eventVisibleTo(scoped, { visibility: 'artist', artistId: KILO, projectId: P1 })).toBe(false);
    expect(eventVisibleTo(scoped, { visibility: 'artist', artistId: NOVA, projectId: P2 })).toBe(true);
  });

  it('an event with neither artist nor project is organization-level: whole-org members only', () => {
    const orgLevel = { visibility: 'artist' as const, artistId: null, projectId: null };
    expect(eventVisibleTo(scoped, orgLevel)).toBe(false);
    expect(eventVisibleTo(artist, orgLevel)).toBe(false);
  });

  it('a scoped member with nothing in scope reads nothing', () => {
    const none = viewer('member', ['a_and_r'], 'artists', [], []);
    expect(eventVisibleTo(none, nova)).toBe(false);
    expect(eventVisibleTo(none, { visibility: 'artist', artistId: null, projectId: P1 })).toBe(false);
  });

  it('needs catalog.read whatever the scope', () => {
    const blind = { ...owner, capabilities: new Set<string>() as never };
    expect(eventVisibleTo(blind, nova)).toBe(false);
  });

  it('an unknown visibility value is treated as internal', () => {
    expect(eventVisibleTo(ar, { visibility: 'whatever' as never, artistId: NOVA, projectId: null })).toBe(false);
  });
});

describe('projectArtistsFor', () => {
  const projects = [
    { id: P1, inbox_for_contact_id: NOVA },
    { id: P2, inbox_for_contact_id: null },
  ];
  const links = [
    { project_id: P1, contact_id: KILO },
    { project_id: P2, contact_id: KILO },
    { project_id: P2, contact_id: NOVA },
  ];

  it('lists the inbox artist first, then the linked ones', () => {
    const m = projectArtistsFor(projects, links, null);
    expect(m.get(P1)).toEqual([NOVA, KILO]);
    expect(m.get(P2)).toEqual([KILO, NOVA]);
  });

  it('keeps only the artists a scoped member holds, so a heading never names another artist', () => {
    const m = projectArtistsFor(projects, links, new Set([NOVA]));
    expect(m.get(P1)).toEqual([NOVA]);
    expect(m.get(P2)).toEqual([NOVA]);
    const kilo = projectArtistsFor(projects, links, new Set([KILO]));
    expect(kilo.get(P1)).toEqual([KILO]);
  });

  it('gives a project with nobody in scope an empty list', () => {
    const m = projectArtistsFor([{ id: P1, inbox_for_contact_id: NOVA }], [], new Set([KILO]));
    expect(m.get(P1)).toEqual([]);
  });
});

describe('withholdHiddenSongs (D4)', () => {
  const ev = (id: string, songId: string | null) => toFeedEvent(row({ id, song_id: songId }));
  it('drops events about songs the member may not see, and counts them', () => {
    const { kept, withheld } = withholdHiddenSongs([ev('a', S1), ev('b', S2), ev('c', null)], new Set([S1]));
    expect(kept.map((e) => e.id)).toEqual(['a', 'c']);
    expect(withheld).toBe(1);
  });

  it('treats a song nobody could read (unknown) as hidden: fail closed', () => {
    const { kept, withheld } = withholdHiddenSongs([ev('a', S2)], new Set());
    expect(kept).toEqual([]);
    expect(withheld).toBe(1);
  });
});
