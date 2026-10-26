import { describe, it, expect } from 'vitest';
import { needsPreview, isPreviewableMaster, canTruncateWithoutFfmpeg, pickPreviewBatch } from './preview-candidates';

const row = (id: string, o: Record<string, unknown> = {}) => ({
  id, audio_url: `r2://priv/tracks/${id}.wav`, preview_url: null, preview_status: 'none',
  peaks_url: 'p', store_listed: true, created_at: `2026-01-0${id.length}`, ...o,
});

describe('needsPreview', () => {
  it("treats 'ready' with no preview_url as missing — the stranded case", () => {
    expect(needsPreview({ id: 'a', preview_status: 'ready', preview_url: null })).toBe(true);
  });
  it('is satisfied only by ready + url', () => {
    expect(needsPreview({ id: 'a', preview_status: 'ready', preview_url: 'https://x/p.mp3' })).toBe(false);
  });
});

describe('formats', () => {
  it('accepts every uploadable format', () => {
    for (const e of ['mp3', 'wav', 'flac', 'aiff', 'aif', 'm4a', 'ogg']) expect(isPreviewableMaster(`r2://b/t.${e}`)).toBe(true);
    expect(isPreviewableMaster('r2://b/t')).toBe(false);
  });
  it('only byte-truncates mp3/wav', () => {
    expect(canTruncateWithoutFfmpeg('r2://b/t.wav')).toBe(true);
    expect(canTruncateWithoutFfmpeg('r2://b/t.flac')).toBe(false);
  });
});

describe('pickPreviewBatch', () => {
  it('never picks an org master: its preview is private and made by the org path (LABEL-14, R-05)', () => {
    const orgRow = row('org', { audio_url: 'r2://priv/orgs/b1410000-0000-4000-8000-000000000001/tracks/x.wav' });
    expect(pickPreviewBatch([orgRow, row('mine')], 8).map((r) => r.id)).toEqual(['mine']);
  });

  it('filters unusable rows BEFORE cutting the batch, so they cannot starve it', () => {
    const junk = Array.from({ length: 10 }, (_, i) => row(`j${i}`, { audio_url: 'https://elsewhere/no-ext', created_at: '2000-01-01' }));
    const want = row('want', { created_at: '2026-09-01' });
    expect(pickPreviewBatch([...junk, want], 8).map((r) => r.id)).toEqual(['want']);
  });
  it('puts missing previews ahead of peaks-only rows, and listed ahead of unlisted', () => {
    const peaksOnly = row('peaks', { preview_url: 'u', preview_status: 'ready', peaks_url: null, created_at: '2000' });
    const unlisted = row('unl', { store_listed: false, created_at: '2001' });
    const listed = row('lst', { created_at: '2026' });
    expect(pickPreviewBatch([peaksOnly, unlisted, listed], 3).map((r) => r.id)).toEqual(['lst', 'unl', 'peaks']);
  });
  it('picks up a flac master and a ready-but-urlless row', () => {
    const flac = row('flac', { audio_url: 'r2://b/x.flac' });
    const stranded = row('str', { preview_status: 'ready' });
    expect(pickPreviewBatch([flac, stranded], 8).map((r) => r.id).sort()).toEqual(['flac', 'str']);
  });
});

describe('pickPreviewBatch — earlier failures go last', () => {
  it('puts a track whose clip failed before behind ones that can still succeed', () => {
    const rows = [
      { id: 'failed-old', audio_url: 'r2://p/a.wav', preview_url: null, preview_status: 'failed', store_listed: true, created_at: '2020-01-01' },
      { id: 'fresh-new', audio_url: 'r2://p/b.wav', preview_url: null, preview_status: 'none', store_listed: false, created_at: '2026-09-01' },
    ];
    expect(pickPreviewBatch(rows, 1).map((r) => r.id)).toEqual(['fresh-new']);
    // Still a candidate: retried once nothing else is waiting.
    expect(pickPreviewBatch(rows, 5).map((r) => r.id)).toEqual(['fresh-new', 'failed-old']);
  });
});
