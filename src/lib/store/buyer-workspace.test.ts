import { describe, it, expect } from 'vitest';
import {
  BUYER_PROJECT_MAX_TRACKS,
  beatToPlayerTrack,
  buildBuyerBeats,
  describeOwnedSound,
  filterBuyerBeats,
  ownedSound,
  projectTrackIds,
  sortBuyerBeats,
  type BuyerBeatTrackRow,
} from './buyer-workspace';

const track = (id: string, over: Partial<BuyerBeatTrackRow> = {}): BuyerBeatTrackRow => ({
  id, title: `Beat ${id}`, cover_url: null, type: 'beat', bpm: 140, key: 'F', scale: 'minor',
  duration_seconds: 120, store_listed: true, ...over,
});

const license = (ids: string[], over: Record<string, unknown> = {}) => ({
  created_at: '2026-09-10T00:00:00Z',
  access_revoked: false,
  download_url: '/store/download?session_id=cs_1',
  items: ids.map((track_id) => ({ track_id, license_type: 'Lease' })),
  ...over,
});

const offer = (track_id: string, over: Record<string, unknown> = {}) => ({
  id: `o-${track_id}`, track_id, track_title: `Beat ${track_id}`, offered_price_usd: 500,
  status: 'pending', created_at: '2026-09-12T00:00:00Z', ...over,
});

const build = (over: Partial<Parameters<typeof buildBuyerBeats>[0]> = {}) =>
  buildBuyerBeats({ licenses: [], bundles: [], bundleTracks: [], offers: [], tracks: [], ...over });

describe('buildBuyerBeats', () => {
  it('lists a license purchase as owned with its tier and delivery link', () => {
    const [b] = build({ licenses: [license(['a'])], tracks: [track('a')] });
    expect(b).toMatchObject({ id: 'a', status: 'owned', license: 'Lease', openUrl: '/store/download?session_id=cs_1', canAddToProject: true });
  });

  it('counts the tracks of a bought bundle as owned, with the bundle link', () => {
    const beats = build({
      bundles: [{ project_id: 'p', created_at: '2026-09-01T00:00:00Z', download_url: '/store/projects/access/tok' }],
      bundleTracks: [{ project_id: 'p', track_id: 'a' }, { project_id: 'p', track_id: 'b' }],
      tracks: [track('a'), track('b', { store_listed: false })],
    });
    expect(beats.map((b) => [b.id, b.status, b.openUrl])).toEqual(
      expect.arrayContaining([['a', 'owned', '/store/projects/access/tok'], ['b', 'owned', '/store/projects/access/tok']]),
    );
  });

  it('a refunded purchase or revoked bundle owns nothing', () => {
    const beats = build({
      licenses: [license(['a'], { access_revoked: true })],
      bundles: [{ project_id: 'p', created_at: null, access_revoked: true, download_url: null }],
      bundleTracks: [{ project_id: 'p', track_id: 'b' }],
      tracks: [track('a'), track('b')],
    });
    expect(beats).toEqual([]);
  });

  it('an offer on a beat the buyer does not own is requested, carrying the offer', () => {
    const [b] = build({ offers: [offer('a')], tracks: [track('a')] });
    expect(b).toMatchObject({ status: 'requested', offer: { status: 'pending', price_usd: 500 }, openUrl: null, canAddToProject: true, playable: true });
  });

  it('owned wins over requested, and the offer still rides along', () => {
    const beats = build({ licenses: [license(['a'])], offers: [offer('a', { status: 'accepted' })], tracks: [track('a')] });
    expect(beats).toHaveLength(1);
    expect(beats[0]).toMatchObject({ status: 'owned', offer: { status: 'accepted' } });
  });

  it('keeps only the latest offer per beat', () => {
    const [b] = build({
      offers: [offer('a', { id: 'old', created_at: '2026-09-01T00:00:00Z', status: 'declined' }), offer('a', { id: 'new', status: 'countered' })],
      tracks: [track('a')],
    });
    expect(b.offer?.status).toBe('countered');
  });

  it('a delisted beat the buyer owns keeps its metadata and still plays', () => {
    const [b] = build({ licenses: [license(['a'])], tracks: [track('a', { store_listed: false })] });
    expect(b).toMatchObject({ available: true, playable: true, canAddToProject: true, title: 'Beat a', bpm: 140 });
    expect(beatToPlayerTrack(b)?.audio_url).toBe('/api/store/me/preview/a?session=1');
  });

  it('a revoked exclusive no longer plays', () => {
    const beats = build({
      licenses: [license(['a'], { access_revoked: true })],
      offers: [offer('a')],
      tracks: [track('a', { store_listed: false })],
    });
    expect(beats[0]).toMatchObject({ status: 'requested', playable: false });
    expect(beatToPlayerTrack(beats[0])).toBeNull();
  });

  it('a delisted beat that is only requested shows the stored title and nothing else', () => {
    const [b] = build({
      offers: [offer('a', { track_title: 'Stored Title' })],
      tracks: [track('a', { store_listed: false, title: 'Secret', cover_url: 'https://x/c.jpg', bpm: 99 })],
    });
    expect(b).toMatchObject({ title: 'Stored Title', available: false, playable: false, canAddToProject: false, bpm: null, cover_url: null });
  });

  it('never carries a media field', () => {
    const [b] = build({ licenses: [license(['a'])], tracks: [{ ...track('a'), wav_url: 'r2://private/a.wav', audio_url: 'r2://x' } as BuyerBeatTrackRow] });
    expect(Object.keys(b)).not.toEqual(expect.arrayContaining(['wav_url']));
    expect(JSON.stringify(b)).not.toContain('r2://');
  });

  it('uses the newest purchase for tier and date', () => {
    const [b] = build({
      licenses: [
        license(['a'], { created_at: '2026-08-01T00:00:00Z', items: [{ track_id: 'a', license_type: 'Lease' }] }),
        license(['a'], { created_at: '2026-09-20T00:00:00Z', items: [{ track_id: 'a', license_type: 'Exclusive' }] }),
      ],
      tracks: [track('a')],
    });
    expect(b).toMatchObject({ license: 'Exclusive', since: '2026-09-20T00:00:00Z' });
  });
});

describe('filter and sort', () => {
  const beats = build({
    licenses: [license(['a', 'b'])],
    offers: [offer('c')],
    tracks: [
      track('a', { title: 'Night Shift', bpm: 140, key: 'F', scale: 'minor' }),
      track('b', { title: 'Cold Front', bpm: 92, key: 'C', scale: 'major', type: 'loop' }),
      track('c', { title: 'Alpha', bpm: null, key: null, scale: null }),
    ],
  });

  it('filters by status', () => {
    expect(filterBuyerBeats(beats, { status: 'owned' }).map((b) => b.id).sort()).toEqual(['a', 'b']);
    expect(filterBuyerBeats(beats, { status: 'requested' }).map((b) => b.id)).toEqual(['c']);
  });

  it('search needs every word, across title, key, bpm and type', () => {
    expect(filterBuyerBeats(beats, { query: 'night' }).map((b) => b.id)).toEqual(['a']);
    expect(filterBuyerBeats(beats, { query: 'fm' }).map((b) => b.id)).toEqual(['a']);
    expect(filterBuyerBeats(beats, { query: '92 loop' }).map((b) => b.id)).toEqual(['b']);
    expect(filterBuyerBeats(beats, { query: 'night loop' })).toEqual([]);
  });

  it('sorts by title, bpm and key with missing values last, without mutating', () => {
    const before = beats.map((b) => b.id);
    expect(sortBuyerBeats(beats, 'title').map((b) => b.id)).toEqual(['c', 'b', 'a']);
    expect(sortBuyerBeats(beats, 'bpm').map((b) => b.id)).toEqual(['b', 'a', 'c']);
    expect(sortBuyerBeats(beats, 'key').map((b) => b.id)).toEqual(['b', 'a', 'c']);
    expect(beats.map((b) => b.id)).toEqual(before);
  });

  it('newest first by purchase / offer date', () => {
    expect(sortBuyerBeats(beats, 'recent')[0].id).toBe('c'); // offer on 09-12 beats purchase on 09-10
  });
});

describe('ownedSound', () => {
  it('is null with nothing owned (a request says nothing about taste yet)', () => {
    expect(ownedSound(build({ offers: [offer('a')], tracks: [track('a')] }))).toBeNull();
    expect(describeOwnedSound(null)).toBeNull();
  });

  it('summarises tempo range, most common key and type from owned beats only', () => {
    const beats = build({
      licenses: [license(['a', 'b', 'c'])],
      offers: [offer('d')],
      tracks: [
        track('a', { bpm: 140 }), track('b', { bpm: 150 }), track('c', { bpm: 145, key: 'C', scale: 'major' }),
        track('d', { bpm: 60 }),
      ],
    });
    const sound = ownedSound(beats)!;
    expect(sound).toMatchObject({ count: 3, bpmRange: [140, 150], topKey: 'Fm', topType: 'beat' });
    expect(describeOwnedSound(sound)).toBe('140–150 BPM · mostly Fm · beats');
  });

  it('says nothing when the owned beats carry no metadata', () => {
    const beats = build({ licenses: [license(['a'])], tracks: [track('a', { bpm: null, key: null, scale: null, type: null })] });
    expect(describeOwnedSound(ownedSound(beats))).toBeNull();
  });
});

describe('projectTrackIds', () => {
  it('keeps selected, addable rows once each and drops a delisted request', () => {
    const beats = build({
      licenses: [license(['a'])],
      offers: [offer('b'), offer('c')],
      tracks: [track('a'), track('b'), track('c', { store_listed: false })],
    });
    expect(projectTrackIds(beats, new Set(['a', 'b', 'c', 'zzz'])).sort()).toEqual(['a', 'b']);
  });

  it('caps at the project limit', () => {
    const ids = Array.from({ length: BUYER_PROJECT_MAX_TRACKS + 5 }, (_, i) => `t${i}`);
    const beats = build({ licenses: [license(ids)], tracks: ids.map((id) => track(id)) });
    expect(projectTrackIds(beats, new Set(ids))).toHaveLength(BUYER_PROJECT_MAX_TRACKS);
  });
});

describe('beatToPlayerTrack', () => {
  it("streams the buyer's preview route, never a master", () => {
    const [b] = build({ licenses: [license(['a'])], tracks: [track('a')] });
    const t = beatToPlayerTrack(b)!;
    expect(t.audio_url).toBe('/api/store/me/preview/a?session=1');
    expect(t.preview_url).toBeNull();
    expect(t).toMatchObject({ id: 'a', title: 'Beat a', bpm: 140 });
  });
});
