import { describe, expect, it } from 'vitest';
import {
  applyOutreachChange, cleanHttpsUrl, embargoState, hashPressToken, isStoreStreamUrl, isWellFormedPressToken, mayReadPress, mayUseOutreach,
  mayWritePress, newPressToken, oneSheetText, outreachStage, photoVisible, publicPressView, releasePublishable, shareUsable,
  type PressKitFacts, type PressReleaseFacts,
} from './press';

const NOW = new Date('2026-11-02T12:00:00Z');
const TOKEN = newPressToken();
const REL = '70000000-0000-4000-8000-000000000001';
const ITEM = '70000000-0000-4000-8000-000000000002';

const kit = (over: Partial<PressKitFacts> = {}): PressKitFacts => ({ headline: ' Nova returns ', bio: 'Bio', pre_embargo_note: 'Coming soon', embargo_at: null, ...over });
const release = (over: Partial<PressReleaseFacts> = {}): PressReleaseFacts => ({
  title: 'Night Shift', type: 'single', label_name: 'Label L', primary_genre: 'Pop', release_date: '2026-10-01', state: 'delivered', imported_released: false, ...over,
});
const base = {
  token: TOKEN, now: NOW, artist: 'Nova',
  photos: [{ id: 'ph2', caption: null, pre_embargo: false, position: 2 }, { id: 'ph1', caption: 'Cover shoot', pre_embargo: true, position: 1 }],
  links: [{ label: 'Instagram', url: 'https://instagram.com/nova', position: 1 }],
  tracks: [{ position: 2, title: 'B', version_title: null, explicit: true }, { position: 1, title: 'A', version_title: 'Radio', explicit: false }],
  listen: [{ id: ITEM, title: 'A', audio_url: `/api/store/releases/${REL}/audio/${ITEM}`, duration_seconds: 180 }],
};

describe('permissions', () => {
  const caps = (...c: string[]) => new Set(c);
  it('reads with pr.read and writes with pr.write, never as an artist', () => {
    expect(mayReadPress(caps('pr.read'), 'member')).toBe(true);
    expect(mayReadPress(caps('catalog.read'), 'member')).toBe(false);
    expect(mayReadPress(caps('pr.read', 'pr.write'), 'artist')).toBe(false);
    expect(mayWritePress(caps('pr.read'), 'member')).toBe(false);
    expect(mayWritePress(caps('pr.read', 'pr.write'), 'member')).toBe(true);
    expect(mayWritePress(caps('pr.write'), 'artist')).toBe(false);
  });
  it('the tracker needs the whole-org view', () => {
    expect(mayUseOutreach(null)).toBe(true);
    expect(mayUseOutreach([])).toBe(false);
    expect(mayUseOutreach(['c1'])).toBe(false);
  });
});

describe('cleanHttpsUrl', () => {
  it('accepts https and refuses everything else', () => {
    expect(cleanHttpsUrl('https://example.com/a?b=1')).toBe('https://example.com/a?b=1');
    for (const bad of ['http://example.com', 'javascript:alert(1)', 'data:text/html,x', '//example.com', 'https://', 'https://u:p@example.com', 'https://a b.com', '', ' ', null, 5, `https://e.com/${'a'.repeat(500)}`]) {
      expect(cleanHttpsUrl(bad), String(bad)).toBeNull();
    }
  });
});

describe('embargo', () => {
  it('is active strictly before the moment', () => {
    expect(embargoState(null, NOW)).toBe('none');
    expect(embargoState('not a date', NOW)).toBe('none');
    expect(embargoState('2026-11-02T12:00:01Z', NOW)).toBe('active');
    expect(embargoState('2026-11-02T12:00:00Z', NOW)).toBe('lifted');
    expect(embargoState('2026-10-01T00:00:00Z', NOW)).toBe('lifted');
  });
});

describe('share token', () => {
  it('is 43 url-safe characters, hashed to 64 hex, and the hash is not the token', () => {
    expect(isWellFormedPressToken(TOKEN)).toBe(true);
    expect(hashPressToken(TOKEN)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashPressToken(TOKEN)).not.toBe(TOKEN);
    expect(hashPressToken(TOKEN)).toBe(hashPressToken(TOKEN));
    expect(newPressToken()).not.toBe(TOKEN);
    for (const bad of ['', 'abc', 'a'.repeat(44), `${'a'.repeat(42)}!`, null, 4]) expect(isWellFormedPressToken(bad)).toBe(false);
  });
  it('answers only while neither revoked nor expired', () => {
    expect(shareUsable({ revoked_at: null, expires_at: null }, NOW)).toBe(true);
    expect(shareUsable({ revoked_at: '2026-11-01T00:00:00Z', expires_at: null }, NOW)).toBe(false);
    expect(shareUsable({ revoked_at: null, expires_at: '2026-11-02T12:00:00Z' }, NOW)).toBe(false);
    expect(shareUsable({ revoked_at: null, expires_at: '2026-11-03T00:00:00Z' }, NOW)).toBe(true);
    expect(shareUsable({ revoked_at: null, expires_at: 'garbage' }, NOW)).toBe(false);
  });
});

describe('outreach', () => {
  const empty = { sent_at: null, opened_at: null, replied_at: null, coverage_url: null };
  it('derives the furthest stage', () => {
    expect(outreachStage(empty)).toBe('planned');
    expect(outreachStage({ ...empty, sent_at: 'x' })).toBe('sent');
    expect(outreachStage({ ...empty, sent_at: 'x', opened_at: 'y' })).toBe('opened');
    expect(outreachStage({ ...empty, sent_at: 'x', opened_at: 'y', replied_at: 'z' })).toBe('replied');
  });
  it('stamps once and keeps the first time', () => {
    const first = applyOutreachChange(empty, { sent: true }, NOW);
    expect(first).toEqual({ sent_at: NOW.toISOString() });
    expect(applyOutreachChange({ ...empty, sent_at: '2026-10-01T00:00:00.000Z' }, { sent: true }, NOW)).toEqual({});
  });
  it('replying or opening implies sent', () => {
    expect(applyOutreachChange(empty, { replied: true }, NOW)).toEqual({ sent_at: NOW.toISOString(), replied_at: NOW.toISOString() });
    expect(applyOutreachChange(empty, { opened: true }, NOW)).toEqual({ sent_at: NOW.toISOString(), opened_at: NOW.toISOString() });
  });
  it('clearing a step clears the steps after it, never the ones before', () => {
    const all = { sent_at: 'a', opened_at: 'b', replied_at: 'c', coverage_url: null };
    expect(applyOutreachChange(all, { sent: false }, NOW)).toEqual({ sent_at: null, opened_at: null, replied_at: null });
    expect(applyOutreachChange(all, { opened: false }, NOW)).toEqual({ opened_at: null, replied_at: null });
    expect(applyOutreachChange(all, { replied: false }, NOW)).toEqual({ replied_at: null });
  });
  it('coverage is its own fact', () => {
    expect(applyOutreachChange(empty, { coverage_url: 'https://e.com/r' }, NOW)).toEqual({ coverage_url: 'https://e.com/r' });
    expect(applyOutreachChange({ ...empty, coverage_url: 'https://e.com/r' }, { coverage_url: null }, NOW)).toEqual({ coverage_url: null });
    expect(applyOutreachChange({ ...empty, coverage_url: 'https://e.com/r' }, { coverage_url: 'https://e.com/r' }, NOW)).toEqual({});
  });
});

describe('publicPressView — embargo', () => {
  const embargoed = publicPressView({ ...base, kit: kit({ embargo_at: '2026-11-10T00:00:00Z' }), release: release({ release_date: '2026-11-20' }) });
  it('shows only the title, the artist, the note and the photos marked for it', () => {
    expect(embargoed).toEqual({
      state: 'embargoed', title: 'Night Shift', artist: 'Nova', note: 'Coming soon',
      photos: [{ id: 'ph1', url: `/api/press/${TOKEN}/assets/ph1`, caption: 'Cover shoot' }],
    });
  });
  it('carries no date, no tracklist, no bio, no audio, not even the lift moment', () => {
    const s = JSON.stringify(embargoed);
    for (const leak of ['2026-11-20', '2026-11-10', 'bio', 'Bio', 'tracklist', 'audio', 'listen', 'Radio', 'instagram', 'Label L', 'Nova returns']) expect(s, leak).not.toContain(leak);
  });
  it('lifts by itself when the moment passes, with no stored change', () => {
    const lifted = publicPressView({ ...base, now: new Date('2026-11-10T00:00:00Z'), kit: kit({ embargo_at: '2026-11-10T00:00:00Z' }), release: release({ release_date: '2026-11-20' }) });
    expect(lifted.state).toBe('live');
  });
});

describe('publicPressView — live', () => {
  it('builds every field itself and orders by position', () => {
    const v = publicPressView({ ...base, kit: kit(), release: release() });
    expect(v).toMatchObject({
      state: 'live', title: 'Night Shift', artist: 'Nova', type: 'single', label: 'Label L', genre: 'Pop', releaseDate: '2026-10-01', released: true,
      headline: 'Nova returns', bio: 'Bio', links: [{ label: 'Instagram', url: 'https://instagram.com/nova' }],
    });
    if (v.state !== 'live') throw new Error('live');
    expect(v.tracklist).toEqual([{ position: 1, title: 'A (Radio)', explicit: false }, { position: 2, title: 'B', explicit: true }]);
    expect(v.photos.map((p) => p.id)).toEqual(['ph1', 'ph2']);
    expect(Object.keys(v).sort()).toEqual(['artist', 'bio', 'genre', 'headline', 'label', 'links', 'listen', 'photos', 'releaseDate', 'released', 'state', 'title', 'tracklist', 'type']);
  });
  it('plays music only for a released release, only through store stream URLs', () => {
    const live = publicPressView({ ...base, kit: kit(), release: release() });
    expect(live.state === 'live' && live.listen?.tracks[0].audioUrl).toBe(`/api/store/releases/${REL}/audio/${ITEM}`);
    // Delivered but the date has not come; draft; withdrawn; cancelled: no audio.
    for (const r of [release({ release_date: '2026-12-01' }), release({ release_date: null }), release({ state: 'draft' }), release({ state: 'withdrawn' }), release({ state: 'cancelled' })]) {
      const v = publicPressView({ ...base, kit: kit(), release: r });
      expect(v.state === 'live' && v.listen, JSON.stringify(r)).toBeNull();
    }
    // Imported as already out counts as released.
    const imp = publicPressView({ ...base, kit: kit(), release: release({ state: 'draft', imported_released: true, release_date: null }) });
    expect(imp.state === 'live' && imp.listen?.tracks.length).toBe(1);
  });
  it('refuses any audio URL that is not a store stream', () => {
    const bad = ['r2://private/x.wav', 'https://cdn.example.com/a.mp3', `/api/audio?src=r2://x`, `/api/org/o/audio/${ITEM}`, `/api/store/releases/${REL}/audio/${ITEM}/../x`];
    for (const url of bad) {
      const v = publicPressView({ ...base, kit: kit(), release: release(), listen: [{ id: ITEM, title: 'A', audio_url: url, duration_seconds: 1 }] });
      expect(v.state === 'live' && v.listen, url).toBeNull();
      expect(isStoreStreamUrl(url)).toBe(false);
    }
  });
  it('has no listen block when the store plays nothing', () => {
    const v = publicPressView({ ...base, kit: kit(), release: release(), listen: null });
    expect(v.state === 'live' && v.listen).toBeNull();
  });
  it('never leaks a storage reference or private key from any string in the view', () => {
    const s = JSON.stringify(publicPressView({ ...base, kit: kit(), release: release() }));
    for (const leak of ['r2://', 'orgs/', 'org_id', 'user_id', 'token_hash', 'private']) expect(s, leak).not.toContain(leak);
  });
  it('a one-sheet repeats the live words and nothing else', () => {
    const v = publicPressView({ ...base, kit: kit(), release: release() });
    if (v.state !== 'live') throw new Error('live');
    const t = oneSheetText(v);
    expect(t).toContain('Nova — Night Shift');
    expect(t).toContain('1. A (Radio)');
    expect(t).toContain('2. B (explicit)');
    expect(t).toContain('Instagram: https://instagram.com/nova');
  });
});

describe('photoVisible / releasePublishable', () => {
  it('hides unmarked photos while the embargo is active', () => {
    expect(photoVisible({ pre_embargo: false }, '2026-11-10T00:00:00Z', NOW)).toBe(false);
    expect(photoVisible({ pre_embargo: true }, '2026-11-10T00:00:00Z', NOW)).toBe(true);
    expect(photoVisible({ pre_embargo: false }, null, NOW)).toBe(true);
    expect(photoVisible({ pre_embargo: false }, '2026-10-10T00:00:00Z', NOW)).toBe(true);
  });
  it('a cancelled or withdrawn release is gone', () => {
    expect(releasePublishable('draft')).toBe(true);
    expect(releasePublishable('delivered')).toBe(true);
    expect(releasePublishable('cancelled')).toBe(false);
    expect(releasePublishable('withdrawn')).toBe(false);
  });
});
