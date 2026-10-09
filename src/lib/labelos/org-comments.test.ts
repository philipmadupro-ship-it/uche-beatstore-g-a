import { describe, expect, it } from 'vitest';
import { capabilitiesFor, externalCapabilities } from './capabilities';
import {
  canChangeVisibility,
  canComment,
  canDeleteComment,
  canEditComment,
  canPostInternal,
  canReadInternal,
  canResolveThread,
  carryForward,
  commentsForView,
  mixLabel,
  normalizeRegion,
  resolveNewVisibility,
  repliesOf,
  toOrgComment,
  versionChain,
  visibleToActor,
  type CommentActor,
  type OrgCommentRow,
} from './org-comments';

const org = (role: string, functions: string[] = [], id = 'u-' + role): CommentActor => ({
  kind: 'org',
  userId: id,
  role,
  capabilities: capabilitiesFor('label', role, functions),
});
const ext = (role: string): CommentActor => ({ kind: 'external', userId: 'u-ext-' + role, role });

const OWNER = org('owner');
const ADMIN = org('admin');
const AR = org('member', ['a_and_r']);
const ENGINEER = org('member', ['engineer']);
const MARKETING = org('member', ['marketing']);
const ARTIST = org('artist');
// A roster artist who has been GRANTED business.read.internal as an override
// is still refused it (NEVER_GRANTABLE) — and this module keys on the role anyway.
const ARTIST_WITH_OVERRIDE: CommentActor = {
  kind: 'org', userId: 'u-art2', role: 'artist',
  capabilities: capabilitiesFor('label', 'artist', [], { grant: ['business.read.internal'] }),
};

describe('internal comments: who reads them', () => {
  it('the team does; a roster artist and every external member never do', () => {
    for (const a of [OWNER, ADMIN, AR, ENGINEER, MARKETING]) expect(canReadInternal(a), a.userId).toBe(true);
    expect(canReadInternal(ARTIST)).toBe(false);
    expect(canReadInternal(ARTIST_WITH_OVERRIDE)).toBe(false);
    for (const r of ['viewer', 'commenter', 'contributor', 'editor']) expect(canReadInternal(ext(r)), r).toBe(false);
  });

  it('an unknown role reads nothing', () => {
    expect(canReadInternal({ kind: 'org', userId: 'x', role: 'superuser', capabilities: new Set(['business.read.internal']) })).toBe(false);
    expect(canReadInternal({ kind: 'external', userId: 'x', role: 'owner' })).toBe(false);
  });

  it('visibleToActor: artist-visible to all, internal to the team only; missing visibility (pre-150) is artist', () => {
    expect(visibleToActor({ visibility: 'artist' }, ARTIST)).toBe(true);
    expect(visibleToActor({}, ext('viewer'))).toBe(true);
    expect(visibleToActor({ visibility: null }, ARTIST)).toBe(true);
    expect(visibleToActor({ visibility: 'internal' }, ARTIST)).toBe(false);
    expect(visibleToActor({ visibility: 'internal' }, ext('editor'))).toBe(false);
    expect(visibleToActor({ visibility: 'internal' }, AR)).toBe(true);
    // Anything that is not exactly 'artist' is treated as the stricter class by the reader's check.
    expect(visibleToActor({ visibility: 'internal' }, ARTIST_WITH_OVERRIDE)).toBe(false);
  });
});

describe('who may comment', () => {
  it('org: review.comment (artist, A&R) or catalog.write (engineer); marketing cannot', () => {
    for (const a of [OWNER, ADMIN, AR, ENGINEER, ARTIST]) expect(canComment(a), a.userId).toBe(true);
    expect(canComment(MARKETING)).toBe(false);
  });

  it('external: the §2.6 comment column — commenter and above, never a viewer', () => {
    expect(canComment(ext('viewer'))).toBe(false);
    for (const r of ['commenter', 'contributor', 'editor']) expect(canComment(ext(r)), r).toBe(true);
    expect(canComment(ext('nope'))).toBe(false);
  });

  it('agrees with externalCapabilities().review.comment', () => {
    for (const r of ['viewer', 'commenter', 'contributor', 'editor']) {
      expect(canComment(ext(r))).toBe(externalCapabilities(r).has('review.comment'));
    }
  });

  it('only a team member who may comment can post or flip to internal', () => {
    for (const a of [OWNER, ADMIN, AR, ENGINEER]) expect(canPostInternal(a), a.userId).toBe(true);
    expect(canPostInternal(MARKETING)).toBe(false); // cannot comment at all
    expect(canPostInternal(ARTIST)).toBe(false);
    expect(canPostInternal(ext('editor'))).toBe(false);
  });
});

describe('edit, delete, resolve, change visibility', () => {
  const mine = { user_id: AR.userId };
  const theirs = { user_id: 'someone-else' };

  it('edit: the author only', () => {
    expect(canEditComment(mine, AR)).toBe(true);
    expect(canEditComment(theirs, AR)).toBe(false);
    expect(canEditComment(theirs, OWNER)).toBe(false);
    expect(canEditComment({ user_id: null }, AR)).toBe(false);
    // an author who lost the ability to comment cannot edit
    expect(canEditComment({ user_id: MARKETING.userId }, MARKETING)).toBe(false);
  });

  it('delete: the author, or the org owner / admin as moderation', () => {
    expect(canDeleteComment(mine, AR)).toBe(true);
    expect(canDeleteComment(theirs, AR)).toBe(false);
    expect(canDeleteComment(theirs, OWNER)).toBe(true);
    expect(canDeleteComment(theirs, ADMIN)).toBe(true);
    expect(canDeleteComment(theirs, ext('editor'))).toBe(false);
    expect(canDeleteComment({ user_id: ext('editor').userId }, ext('editor'))).toBe(true);
  });

  it('resolve: whoever may comment', () => {
    expect(canResolveThread(AR)).toBe(true);
    expect(canResolveThread(ARTIST)).toBe(true);
    expect(canResolveThread(ext('commenter'))).toBe(true);
    expect(canResolveThread(ext('viewer'))).toBe(false);
    expect(canResolveThread(MARKETING)).toBe(false);
  });

  it('visibility: the author or owner/admin, team only', () => {
    expect(canChangeVisibility(mine, AR)).toBe(true);
    expect(canChangeVisibility(theirs, AR)).toBe(false);
    expect(canChangeVisibility(theirs, OWNER)).toBe(true);
    expect(canChangeVisibility({ user_id: ARTIST.userId }, ARTIST)).toBe(false);
    expect(canChangeVisibility({ user_id: ext('editor').userId }, ext('editor'))).toBe(false);
  });
});

describe('resolveNewVisibility', () => {
  it('defaults to artist', () => {
    expect(resolveNewVisibility(undefined, AR, null)).toBe('artist');
    expect(resolveNewVisibility(undefined, ARTIST, null)).toBe('artist');
    expect(resolveNewVisibility(undefined, ext('commenter'), null)).toBe('artist');
  });
  it('internal only for the team; an artist or external member asking for it is refused', () => {
    expect(resolveNewVisibility('internal', AR, null)).toBe('internal');
    expect(resolveNewVisibility('internal', ARTIST, null)).toBeNull();
    expect(resolveNewVisibility('internal', ARTIST_WITH_OVERRIDE, null)).toBeNull();
    expect(resolveNewVisibility('internal', ext('editor'), null)).toBeNull();
    expect(resolveNewVisibility('internal', MARKETING, null)).toBeNull();
  });
  it('a reply under an internal comment is internal, whatever was asked; for a non-team actor that is a refusal', () => {
    expect(resolveNewVisibility('artist', AR, { visibility: 'internal' })).toBe('internal');
    expect(resolveNewVisibility(undefined, OWNER, { visibility: 'internal' })).toBe('internal');
    expect(resolveNewVisibility(undefined, ARTIST, { visibility: 'internal' })).toBeNull();
    expect(resolveNewVisibility(undefined, ext('commenter'), { visibility: 'internal' })).toBeNull();
  });
  it('an internal reply under an artist-visible comment is allowed (the team talking)', () => {
    expect(resolveNewVisibility('internal', AR, { visibility: 'artist' })).toBe('internal');
  });
});

describe('toOrgComment: built field by field', () => {
  const row = {
    id: 'c1', project_id: 'p1', track_id: 't1', user_id: 'u-1', author_name: ' Dana ', body: 'too bright',
    parent_id: null, region_start: '12.5', region_end: 20, visibility: 'internal', resolved_at: null, edited_at: null,
    created_at: '2026-10-01T10:00:00Z',
    // not selected by the route, but if a caller ever passes them they must not come out:
    share_token: 'secret-token', contact_id: 'contact-1', org_id: 'org-1', resolved_by: 'u-9',
  } as OrgCommentRow;

  it('keeps what a reader needs and nothing the row stores for the server', () => {
    const c = toOrgComment(row, { ...AR, userId: 'u-1' });
    expect(c).toEqual({
      id: 'c1', projectId: 'p1', trackId: 't1', parentId: null, body: 'too bright', authorName: 'Dana', mine: true,
      regionStart: 12.5, regionEnd: 20, visibility: 'internal', resolvedAt: null, editedAt: null,
      createdAt: '2026-10-01T10:00:00Z', can: { edit: true, delete: true, changeVisibility: true }, carriedFrom: null,
    });
    const text = JSON.stringify(c);
    for (const leak of ['secret-token', 'contact-1', 'org-1', 'u-9', 'u-1"', 'share_token', 'user_id']) expect(text, leak).not.toContain(leak);
  });

  it('mine is false for someone else; a half-set or inverted region is dropped; unknown visibility reads as artist', () => {
    expect(toOrgComment(row, { ...AR, userId: 'u-2' }).mine).toBe(false);
    expect(toOrgComment({ ...row, region_end: null }, AR).regionStart).toBeNull();
    expect(toOrgComment({ ...row, region_start: 30, region_end: 20 }, AR).regionEnd).toBeNull();
    expect(toOrgComment({ ...row, visibility: 'weird' }, AR).visibility).toBe('artist');
    expect(toOrgComment({ ...row, visibility: undefined }, AR).visibility).toBe('artist');
    expect(toOrgComment({ ...row, author_name: '  ' }, AR).authorName).toBe('Member');
  });
});

describe('normalizeRegion', () => {
  it('both or neither, end after start', () => {
    expect(normalizeRegion(1, 5)).toEqual({ region_start: 1, region_end: 5 });
    expect(normalizeRegion(1, null)).toEqual({ region_start: null, region_end: null });
    expect(normalizeRegion(undefined, 5)).toEqual({ region_start: null, region_end: null });
    expect(normalizeRegion(5, 5)).toEqual({ region_start: null, region_end: null });
    expect(normalizeRegion(-1, 5)).toEqual({ region_start: null, region_end: null });
    expect(normalizeRegion(NaN, 5)).toEqual({ region_start: null, region_end: null });
  });
});

describe('versionChain', () => {
  const links = [
    { from_track_id: 'S', to_track_id: 'V3', relation: 'version', created_at: '2026-10-03' },
    { from_track_id: 'S', to_track_id: 'V2', relation: 'version', created_at: '2026-10-02' },
    { from_track_id: 'S', to_track_id: 'M', relation: 'master', created_at: '2026-10-04' },
    { from_track_id: 'OTHER', to_track_id: 'X2', relation: 'version', created_at: '2026-10-02' },
  ];

  it('the song is mix v1; versions follow in the order they were added; other relations and songs do not count', () => {
    const expected = [
      { trackId: 'S', label: 'mix v1' },
      { trackId: 'V2', label: 'mix v2' },
      { trackId: 'V3', label: 'mix v3' },
    ];
    expect(versionChain('S', links)).toEqual(expected);
    // Asking from a version gives the same chain.
    expect(versionChain('V2', links)).toEqual(expected);
    expect(versionChain('V3', links)).toEqual(expected);
  });

  it('a track in no chain is a chain of one; a master is not a version', () => {
    expect(versionChain('Z', links)).toEqual([{ trackId: 'Z', label: 'mix v1' }]);
    expect(versionChain('M', links)).toEqual([{ trackId: 'M', label: 'mix v1' }]);
  });

  it('ties on created_at break on position, then id (stable)', () => {
    const tie = [
      { from_track_id: 'S', to_track_id: 'B', relation: 'version', created_at: 't', position: 2 },
      { from_track_id: 'S', to_track_id: 'A', relation: 'version', created_at: 't', position: 2 },
      { from_track_id: 'S', to_track_id: 'C', relation: 'version', created_at: 't', position: 1 },
    ];
    expect(versionChain('S', tie).map((v) => v.trackId)).toEqual(['S', 'C', 'A', 'B']);
  });

  it('survives a cycle in bad data', () => {
    const cyc = [
      { from_track_id: 'A', to_track_id: 'B', relation: 'version', created_at: '1' },
      { from_track_id: 'B', to_track_id: 'A', relation: 'version', created_at: '2' },
    ];
    expect(versionChain('A', cyc).length).toBeGreaterThan(0);
  });

  it('mixLabel', () => expect(mixLabel(2)).toBe('mix v2'));
});

describe('carryForward: exactly the unresolved roots on superseded versions', () => {
  const chain = versionChain('S', [
    { from_track_id: 'S', to_track_id: 'V2', relation: 'version', created_at: '2' },
    { from_track_id: 'S', to_track_id: 'V3', relation: 'version', created_at: '3' },
  ]);
  const row = (id: string, track: string | null, extra: Partial<OrgCommentRow> = {}): OrgCommentRow => ({
    id, project_id: 'p', track_id: track, user_id: 'u', author_name: 'A', body: id, parent_id: null,
    region_start: null, region_end: null, visibility: 'artist', resolved_at: null, created_at: `2026-10-0${id.length}T00:00:00Z`, ...extra,
  });

  it('carries the unresolved roots of v1 and v2 onto v3, labelled, and nothing else', () => {
    const comments = [
      row('a', 'S'), // unresolved on mix v1 → carried
      row('bb', 'V2'), // unresolved on mix v2 → carried
      row('ccc', 'S', { resolved_at: '2026-10-05' }), // resolved → stays where it is
      row('dddd', 'V3'), // native on the current mix → not carried
      row('eeeee', null), // project-level → not carried
      row('ffffff', 'OTHER_SONG'), // another song → not carried
      row('ggggggg', 'S', { deleted_at: '2026-10-06' }), // deleted
      row('hhhhhhhh', 'S', { parent_id: 'a' }), // a reply → travels with its thread, not on its own
    ];
    const { carried } = carryForward({ chain, currentTrackId: 'V3', comments });
    expect(carried.map((c) => [c.comment.id, c.from.label])).toEqual([['a', 'mix v1'], ['bb', 'mix v2']]);
  });

  it('only the current (newest) version carries', () => {
    const comments = [row('a', 'S')];
    expect(carryForward({ chain, currentTrackId: 'V2', comments }).carried).toEqual([]);
    expect(carryForward({ chain, currentTrackId: 'S', comments }).carried).toEqual([]);
    expect(carryForward({ chain: [], currentTrackId: 'S', comments }).carried).toEqual([]);
    expect(carryForward({ chain: [{ trackId: 'S', label: 'mix v1' }], currentTrackId: 'S', comments }).carried).toEqual([]);
  });

  it('repliesOf: replies at any depth, oldest first, deleted ones dropped', () => {
    const all = [
      row('a', 'S'),
      row('r1', 'S', { parent_id: 'a', created_at: '2026-10-02T00:00:00Z' }),
      row('r22', 'S', { parent_id: 'r1', created_at: '2026-10-03T00:00:00Z' }),
      row('r3', 'S', { parent_id: 'a', created_at: '2026-10-04T00:00:00Z', deleted_at: 'x' }),
      row('unrelated', 'S'),
    ];
    expect(repliesOf(new Set(['a']), all).map((r) => r.id)).toEqual(['r1', 'r22']);
  });
});

describe('commentsForView', () => {
  const chain = versionChain('S', [{ from_track_id: 'S', to_track_id: 'V2', relation: 'version', created_at: '2' }]);
  const mk = (id: string, track: string | null, at: string, extra: Partial<OrgCommentRow> = {}): OrgCommentRow => ({
    id, project_id: 'p', track_id: track, user_id: 'u', author_name: 'A', body: id, parent_id: null,
    region_start: null, region_end: null, visibility: 'artist', resolved_at: null, created_at: at, ...extra,
  });
  const rows = [
    mk('old-open', 'S', '2026-10-01T00:00:00Z', { region_start: 3, region_end: 8 }),
    mk('old-open-reply', 'S', '2026-10-01T01:00:00Z', { parent_id: 'old-open' }),
    mk('old-done', 'S', '2026-10-01T02:00:00Z', { resolved_at: '2026-10-02' }),
    mk('old-internal', 'S', '2026-10-01T03:00:00Z', { visibility: 'internal' }),
    mk('now', 'V2', '2026-10-03T00:00:00Z'),
    mk('project-level', null, '2026-10-03T01:00:00Z'),
  ];

  it('the current mix shows its own comments plus the carried open thread (with its reply), labelled', () => {
    const view = commentsForView({ rows, actor: AR, trackId: 'V2', chain });
    expect(view.map((c) => [c.id, c.carriedFrom?.label ?? null])).toEqual([
      ['old-open', 'mix v1'],
      ['old-open-reply', 'mix v1'],
      ['old-internal', 'mix v1'],
      ['now', null],
    ]);
    expect(view.find((c) => c.id === 'old-open')).toMatchObject({ regionStart: 3, regionEnd: 8, carriedFrom: { trackId: 'S', label: 'mix v1' } });
  });

  it('an artist never gets the internal comment, native or carried', () => {
    for (const actor of [ARTIST, ARTIST_WITH_OVERRIDE, ext('editor'), ext('commenter')]) {
      const ids = commentsForView({ rows, actor, trackId: 'V2', chain }).map((c) => c.id);
      expect(ids, JSON.stringify(actor.kind)).not.toContain('old-internal');
      expect(ids).toContain('old-open');
    }
    const all = commentsForView({ rows, actor: ARTIST }).map((c) => c.id);
    expect(all).not.toContain('old-internal');
    expect(all).toContain('project-level');
  });

  it('the older mix shows only its own, resolved ones included, nothing carried', () => {
    const ids = commentsForView({ rows, actor: AR, trackId: 'S', chain }).map((c) => c.id);
    expect(ids).toEqual(['old-open', 'old-open-reply', 'old-done', 'old-internal']);
  });

  it('without a track: every visible comment of the project, nothing labelled', () => {
    const view = commentsForView({ rows, actor: AR });
    expect(view).toHaveLength(6);
    expect(view.every((c) => c.carriedFrom === null)).toBe(true);
  });

  it('deleted comments are never listed', () => {
    const view = commentsForView({ rows: [...rows, mk('gone', 'V2', '2026-10-04T00:00:00Z', { deleted_at: 'x' })], actor: AR, trackId: 'V2', chain });
    expect(view.map((c) => c.id)).not.toContain('gone');
  });
});
