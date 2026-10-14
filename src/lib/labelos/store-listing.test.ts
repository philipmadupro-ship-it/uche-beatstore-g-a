import { describe, expect, it } from 'vitest';
import {
  boundedPut,
  isPubliclyVisible,
  isReleasedForStore,
  orgMayListOnStore,
  planList,
  planUnlist,
  publicPreviewKey,
  publicReleasePrefix,
  publicReleaseView,
  publicStreamPlan,
  releasedPublicly,
  type ListingFacts,
  type PublicReleaseRow,
} from './store-listing';

const NOW = new Date('2026-10-13T10:00:00Z');
const R = '11111111-1111-4111-8111-111111111111';
const T = '22222222-2222-4222-8222-222222222222';
const ORG = '33333333-3333-4333-8333-333333333333';
const OTHER = '44444444-4444-4444-8444-444444444444';

const facts = (over: Partial<ListingFacts> = {}): ListingFacts => ({
  state: 'draft',
  imported_released: false,
  release_date: null,
  store_listed: false,
  ...over,
});
const owner = { producerOrgId: ORG, connectedArtistOrgIds: [] as string[] };
const input = (over: Partial<Parameters<typeof planList>[0]> = {}) => ({
  release: facts({ state: 'delivered', release_date: '2024-02-02' }),
  itemCount: 3,
  orgId: ORG,
  owner,
  currentPlayback: 'preview' as const,
  ...over,
});

describe('isReleasedForStore', () => {
  it('a draft is not released, however dated', () => {
    expect(isReleasedForStore(facts({ release_date: '2020-01-01' }), NOW)).toBe(false);
  });
  it('a cancelled release is never released, even imported', () => {
    expect(isReleasedForStore(facts({ state: 'cancelled', imported_released: true }), NOW)).toBe(false);
  });
  it('an import is released without a delivery', () => {
    expect(isReleasedForStore(facts({ imported_released: true, release_date: '2019-05-01' }), NOW)).toBe(true);
  });
  it('a delivery is released from its date, or at once without one', () => {
    // No release date is not out: a target date is a plan, and a delivery that never said when it comes out has not said it is.
    expect(isReleasedForStore(facts({ state: 'delivered' }), NOW)).toBe(false);
    expect(isReleasedForStore(facts({ state: 'delivered', release_date: null }), NOW)).toBe(false);
    expect(isReleasedForStore(facts({ state: 'delivered', release_date: '2026-10-13' }), NOW)).toBe(true);
    expect(isReleasedForStore(facts({ state: 'delivered', release_date: '2026-10-14' }), NOW)).toBe(false);
  });
});

describe('orgMayListOnStore', () => {
  it('the producer org and its connected artist orgs only', () => {
    const o = { producerOrgId: ORG, connectedArtistOrgIds: [OTHER] };
    expect(orgMayListOnStore(ORG.toUpperCase(), o)).toBe(true);
    expect(orgMayListOnStore(OTHER, o)).toBe(true);
    expect(orgMayListOnStore('55555555-5555-4555-8555-555555555555', o)).toBe(false);
    expect(orgMayListOnStore(ORG, { producerOrgId: null, connectedArtistOrgIds: [] })).toBe(false);
  });
});

describe('planList', () => {
  it('lists a delivered release with songs', () => {
    expect(planList(input(), NOW)).toEqual({ ok: true, playback: 'preview', alreadyListed: false });
  });
  it('an unreleased (draft) release is 409', () => {
    const plan = planList(input({ release: facts() }), NOW);
    expect(plan).toMatchObject({ ok: false, status: 409, field: 'state' });
  });
  it('a delivered release before its date is 409 and says when', () => {
    const plan = planList(input({ release: facts({ state: 'delivered', release_date: '2027-01-01' }) }), NOW);
    expect(plan).toMatchObject({ ok: false, status: 409 });
    expect((plan as { error: string }).error).toMatch(/not out yet/);
  });
  it('an imported already-released album lists without a delivery', () => {
    expect(planList(input({ release: facts({ imported_released: true, release_date: '2018-03-02' }) }), NOW)).toMatchObject({ ok: true });
  });
  it('a cancelled release is 409', () => {
    expect(planList(input({ release: facts({ state: 'cancelled', imported_released: true }) }), NOW)).toMatchObject({ ok: false, field: 'state' });
  });
  it('a release of another org, or with no store owner, is 409', () => {
    expect(planList(input({ orgId: OTHER }), NOW)).toMatchObject({ ok: false, status: 409, field: 'org' });
    expect(planList(input({ owner: null }), NOW)).toMatchObject({ ok: false, field: 'org' });
  });
  it('a release with no songs is 409', () => {
    expect(planList(input({ itemCount: 0 }), NOW)).toMatchObject({ ok: false, field: 'items' });
  });
  it('playback: requested wins, else the current one; relisting reports alreadyListed', () => {
    expect(planList(input({ playback: 'full' }), NOW)).toMatchObject({ playback: 'full' });
    expect(planList(input({ currentPlayback: 'full', release: facts({ state: 'delivered', store_listed: true, release_date: '2024-02-02' }) }), NOW)).toEqual({
      ok: true,
      playback: 'full',
      alreadyListed: true,
    });
  });
});

describe('review fixes (LABEL-42)', () => {
  it('any unfinished item blocks the listing and is named', () => {
    const plan = planList(input({ blockedItems: [{ id: 'i1', title: 'Demo' }, { id: 'i2', title: 'Sketch' }] }), NOW);
    expect(plan).toMatchObject({ ok: false, status: 409, field: 'items' });
    expect((plan as { error: string }).error).toMatch(/“Demo”, “Sketch” are not finished/);
    expect(planList(input({ blockedItems: [] }), NOW)).toMatchObject({ ok: true });
  });
  it('releasedPublicly is conservative: released now, or listed while released, is publicly out', () => {
    const base = { state: 'delivered', imported_released: false, store_listed: true };
    expect(releasedPublicly({ ...base, release_date: '2026-10-01', store_listed_at: null }, NOW)).toBe(true);
    // Date now reads as future, but it was listed on a day it was out.
    expect(releasedPublicly({ ...base, release_date: '2026-11-01', store_listed_at: '2026-11-02T00:00:00Z' }, NOW)).toBe(true);
    // Listed before its date: never out.
    expect(releasedPublicly({ ...base, release_date: '2026-11-01', store_listed_at: '2026-10-10T00:00:00Z' }, NOW)).toBe(false);
    expect(releasedPublicly({ ...base, release_date: '2026-11-01', store_listed_at: null }, NOW)).toBe(false);
  });
});

describe('planUnlist', () => {
  it('a release that is not listed is 409', () => {
    expect(planUnlist(facts({ state: 'delivered' }), true, NOW)).toMatchObject({ ok: false, status: 409 });
  });
  it('music that was publicly out never has its previews deleted, whatever was asked, and the owner is not asked', () => {
    const r = facts({ state: 'delivered', store_listed: true, release_date: '2025-01-01' });
    expect(releasedPublicly(r, NOW)).toBe(true);
    expect(planUnlist(r, true, NOW)).toEqual({ ok: true, deletePreviews: false, askToDeletePreviews: false });
  });
  it('an import is publicly out', () => {
    expect(planUnlist(facts({ imported_released: true, store_listed: true }), true, NOW)).toMatchObject({ deletePreviews: false, askToDeletePreviews: false });
  });
  it('a release whose date moved into the future: the owner is asked, and only a yes deletes', () => {
    const r = facts({ state: 'delivered', store_listed: true, release_date: '2027-01-01' });
    expect(planUnlist(r, false, NOW)).toEqual({ ok: true, deletePreviews: false, askToDeletePreviews: true });
    expect(planUnlist(r, true, NOW)).toEqual({ ok: true, deletePreviews: true, askToDeletePreviews: true });
  });
});

describe('isPubliclyVisible', () => {
  it('needs the listing AND the release to still hold', () => {
    expect(isPubliclyVisible(facts({ state: 'delivered', store_listed: true, release_date: '2024-02-02' }), NOW)).toBe(true);
    expect(isPubliclyVisible(facts({ state: 'delivered', release_date: '2024-02-02' }), NOW)).toBe(false);
    expect(isPubliclyVisible(facts({ state: 'delivered', store_listed: true, release_date: '2027-01-01' }), NOW)).toBe(false);
  });
});

describe('public keys', () => {
  it('are built from UUIDs only and lower-cased', () => {
    expect(publicPreviewKey(R.toUpperCase(), T)).toBe(`store-releases/${R}/${T}`);
    expect(publicPreviewKey('../x', T)).toBeNull();
    expect(publicPreviewKey(R, 'a/b')).toBeNull();
    expect(publicReleasePrefix(R)).toBe(`store-releases/${R}/`);
    expect(publicReleasePrefix('nope')).toBeNull();
  });
  it('preview streams the promoted copy; full streams the master through the server; nothing to play is null', () => {
    const item = { master_track_id: T, master_audio_ref: 'r2://private/orgs/x/tracks/a.wav' };
    expect(publicStreamPlan('preview', R, item)).toEqual({ kind: 'public-preview', key: `store-releases/${R}/${T}` });
    expect(publicStreamPlan('full', R, item)).toEqual({ kind: 'private-master', ref: item.master_audio_ref });
    expect(publicStreamPlan('full', R, { ...item, master_audio_ref: null })).toBeNull();
  });
});

describe('publicReleaseView', () => {
  const row: PublicReleaseRow = {
    id: R,
    title: 'Night Shift',
    type: 'album',
    label_name: 'U2C',
    primary_genre: 'Hip-hop',
    release_date: '2024-02-02',
    imported_released: true,
    store_listed_at: '2026-10-13T00:00:00Z',
    store_playback: 'full',
    has_artwork: true,
    artist_name: 'Nova',
  };
  it('is built field by field: playable tracks in order, same-origin streams, nothing private', () => {
    const view = publicReleaseView(row, [
      { id: 'i2', position: 2, title: 'Two', version_title: 'Radio', explicit: true, duration_seconds: 120 },
      { id: 'i1', position: 1, title: 'One', version_title: null, explicit: false, duration_seconds: 90 },
    ]);
    expect(view.tracks.map((t) => t.title)).toEqual(['One', 'Two (Radio)']);
    expect(view.tracks[0].audio_url).toBe(`/api/store/releases/${R}/audio/i1`);
    expect(view.release).toMatchObject({ already_out: true, track_count: 2, playback: 'full', cover_url: `/api/store/releases/${R}/cover` });
    const json = JSON.stringify(view);
    expect(json).not.toMatch(/r2:\/\/|org_id|orgId|master|user_id|store_listed_at/);
  });
  it('no artwork: no cover url', () => {
    expect(publicReleaseView({ ...row, has_artwork: false }, []).release.cover_url).toBeNull();
  });
});

describe('boundedPut (LABEL-42 round 3)', () => {
  it('evicts the oldest entries one at a time, never the whole cache, and refreshes a re-put key', () => {
    const c = new Map<string, number>();
    for (let i = 0; i < 3; i += 1) boundedPut(c, `k${i}`, i, 3);
    expect([...c.keys()]).toEqual(['k0', 'k1', 'k2']);
    expect(boundedPut(c, 'k3', 3, 3)).toBe(1);
    expect([...c.keys()]).toEqual(['k1', 'k2', 'k3']);
    expect(boundedPut(c, 'k1', 9, 3)).toBe(0); // refreshed, now the newest
    expect([...c.keys()]).toEqual(['k2', 'k3', 'k1']);
    for (let i = 10; i < 20; i += 1) boundedPut(c, `x${i}`, i, 3);
    expect(c.size).toBe(3);
  });
});
