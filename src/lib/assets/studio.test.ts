import { describe, expect, it } from 'vitest';
import {
  STUDIO_DECODE_MAX_BYTES,
  assetsOfProject,
  assetsOfTrack,
  parseAssetId,
  shouldDecodeWaveform,
  studioHref,
  studioHrefForCacheId,
  studioPlayable,
  studioSourceOf,
} from './index';
import type { ProjectAssetView } from '@/lib/projects/asset-view';

const P = '40000000-0000-4000-8000-0000000000a1';
const F = '60000000-0000-4000-8000-000000000001';
const T = '70000000-0000-4000-8000-000000000001';

const view = (over: Partial<ProjectAssetView> = {}): ProjectAssetView => ({
  id: F, project_id: P, kind: 'audio', label: 'Vocal reference', file_name: 'ref.wav', mime: 'audio/wav', size_bytes: 5_242_880,
  position: 0, in_portal: false, portal_at: null, created_at: '2026-11-01T00:00:00Z', downloadUrl: `/api/projects/${P}/assets/${F}/download`, ...over,
});

describe('parseAssetId', () => {
  it('accepts exactly the ids AUDIO-01 mints', () => {
    expect(parseAssetId(`project:${P}:file:${F}`)).toEqual({ source: 'project_file', projectId: P, fileId: F });
    expect(parseAssetId(`track:${T}:audio`)).toEqual({ source: 'track_audio', trackId: T });
    expect(parseAssetId(`track:${T}:wav`)).toEqual({ source: 'track_wav', trackId: T });
    for (const stem of ['vocals', 'drums', 'bass', 'other']) {
      expect(parseAssetId(`track:${T}:stem:${stem}`)).toEqual({ source: 'track_stem', trackId: T, stem });
    }
  });
  it('rejects anything that is not the exact pattern', () => {
    const bad: unknown[] = [
      undefined, null, 42, {}, [], '', 'nope',
      `project:${P}`, `project:${P}:file:`, `project:${P}:file:${F}:extra`, `xproject:${P}:file:${F}`, ` project:${P}:file:${F}`,
      `project:${P}:file:${F}\n`, `project:${P}:file:${F} `, `project:${P}:files:${F}`,
      `track:${T}`, `track:${T}:mp3`, `track:${T}:stem:`, `track:${T}:stem:drum`, `track:${T}:stem:vocals:more`, `track:${T}:audio\n`,
      `track:../../etc/passwd:audio`, `track:${T}/../x:audio`, `project:${P}:file:${F}?x=1`, `project:${P}:file:${F}#h`,
      encodeURIComponent(`project:${P}:file:${F}`),
      `project:${P.slice(0, -1)}:file:${F}`, `track:${T}0:audio`,
      'track:' + 'a'.repeat(300) + ':audio',
    ];
    for (const id of bad) expect(parseAssetId(id), String(id)).toBeNull();
  });
  it('rejects uppercase uuids (ids are lowercase)', () => {
    const withLetters = 'abcdef00-aaaa-4bbb-8ccc-ddddeeeeffff'; // uppercasing changes it (the ids above have no letters)
    expect(parseAssetId(`project:${withLetters}:file:${F}`)).not.toBeNull();
    expect(parseAssetId(`project:${withLetters.toUpperCase()}:file:${F}`)).toBeNull();
    expect(parseAssetId(`project:${P}:file:${withLetters.toUpperCase()}`)).toBeNull();
    expect(parseAssetId(`track:${withLetters.toUpperCase()}:wav`)).toBeNull();
    expect(parseAssetId(`track:${withLetters}:wav`)).not.toBeNull();
    expect(parseAssetId(`track:${T}:stem:VOCALS`)).toBeNull();
    expect(parseAssetId(`TRACK:${T}:audio`)).toBeNull();
  });
});

describe('studioPlayable', () => {
  it('audio and stems yes', () => {
    expect(studioPlayable(assetsOfProject([view()])[0])).toEqual({ ok: true });
    expect(studioPlayable(assetsOfTrack({ id: T, audio_url: 'r2://p/a.wav' }, { vocals: 'r2://p/v.wav' })[1])).toEqual({ ok: true });
  });
  it('a DAW session, a document and an image say why not', () => {
    expect(studioPlayable(assetsOfProject([view({ kind: 'other', file_name: 'a.flp', mime: 'application/octet-stream' })])[0])).toMatchObject({ ok: false });
    expect(studioPlayable({ kind: 'project' as unknown as 'other', playable: false, openUrl: '/x' })).toEqual({ ok: false, reason: 'Open it in your DAW.' });
    expect(studioPlayable(assetsOfProject([view({ kind: 'document', file_name: 'a.pdf', mime: 'application/pdf' })])[0])).toEqual({ ok: false, reason: 'The Studio only opens audio.' });
    expect(studioPlayable(assetsOfProject([view({ kind: 'artwork', file_name: 'a.png', mime: 'image/png' })])[0])).toMatchObject({ ok: false });
  });
  it('audio with no openUrl cannot be opened', () => {
    expect(studioPlayable({ kind: 'audio', playable: true, openUrl: null })).toMatchObject({ ok: false });
  });
});

describe('studioSourceOf / studioHref', () => {
  it('a project audio file: owner download route, its own cache id, fingerprint and size', () => {
    const asset = assetsOfProject([view()])[0];
    const src = studioSourceOf(asset, { from: 'Night Drive EP' });
    expect(src).toMatchObject({
      id: `project:${P}:file:${F}`, kind: 'project_file', title: 'Vocal reference', from: 'Night Drive EP',
      src: `/api/projects/${P}/assets/${F}/download`, cacheId: `project:${P}:file:${F}`, contentKey: asset.contentKey, sizeBytes: 5_242_880, offlineOnly: false,
    });
    expect(studioHref(asset)).toBe(`/studio?asset=${encodeURIComponent(`project:${P}:file:${F}`)}`);
  });
  it('a track master keeps the existing ?track= link; WAV and stems use ?asset=', () => {
    const [master, wav, vocals] = assetsOfTrack({ id: T, title: 'N', audio_url: 'r2://p/a.mp3', wav_url: 'r2://p/a.wav' }, { vocals: 'r2://p/v.wav' });
    expect(studioHref(master)).toBe(`/studio?track=${T}`);
    expect(studioHref(wav)).toBe(`/studio?asset=${encodeURIComponent(`track:${T}:wav`)}`);
    expect(studioSourceOf(wav)).toMatchObject({ kind: 'wav', cacheId: `track:${T}:wav` });
    expect(studioSourceOf(vocals)).toMatchObject({ kind: 'stem', cacheId: `track:${T}:stem:vocals` });
  });
  it('no link and no source for a session or a document', () => {
    const doc = assetsOfProject([view({ kind: 'document', file_name: 'a.pdf', mime: 'application/pdf' })])[0];
    expect(studioHref(doc)).toBeNull();
    expect(studioSourceOf(doc)).toBeNull();
  });
  it('never outputs a stored reference, only the owner-gated routes', () => {
    const rows = [
      ...assetsOfTrack({ id: T, audio_url: 'r2://priv/secret/a.mp3', wav_url: 'local://project-assets/x.wav' }, { vocals: 'r2://priv/stem.wav' }),
      ...assetsOfProject([view()]),
    ];
    const text = JSON.stringify(rows.map((a) => [studioSourceOf(a), studioHref(a)]));
    expect(text).not.toMatch(/r2:\/\/|local:\/\//);
    for (const a of rows) {
      const s = studioSourceOf(a);
      if (s) expect(s.src).toMatch(/^\/api\/(audio\?src=|projects\/)/);
    }
  });
});

describe('studioHrefForCacheId (the offline page)', () => {
  it('a bare track id is a master; asset ids go through ?asset=; junk has no link', () => {
    expect(studioHrefForCacheId(T)).toBe(`/studio?track=${T}`);
    expect(studioHrefForCacheId(`track:${T}:audio`)).toBe(`/studio?track=${T}`);
    expect(studioHrefForCacheId(`project:${P}:file:${F}`)).toBe(`/studio?asset=${encodeURIComponent(`project:${P}:file:${F}`)}`);
    expect(studioHrefForCacheId(`track:${T}:stem:bass`)).toContain('/studio?asset=');
    expect(studioHrefForCacheId('t0')).toBeNull();
    expect(studioHrefForCacheId(`track:${T}:mp3`)).toBeNull();
  });
});

describe('shouldDecodeWaveform', () => {
  it('64 MB is the cap; unknown sizes decode as tracks always did', () => {
    expect(STUDIO_DECODE_MAX_BYTES).toBe(64 * 1024 * 1024);
    expect(shouldDecodeWaveform(null)).toBe(true);
    expect(shouldDecodeWaveform(STUDIO_DECODE_MAX_BYTES)).toBe(true);
    expect(shouldDecodeWaveform(STUDIO_DECODE_MAX_BYTES + 1)).toBe(false);
  });
});
