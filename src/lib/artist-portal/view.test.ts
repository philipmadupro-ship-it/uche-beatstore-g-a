import { describe, expect, it } from 'vitest';
import { toPortalFile, publicUrlOrNull, toPortalArtworkTheme, toPortalProject, toPortalTrack } from './view';

const hostileTrack = {
  id: 't1',
  title: 'MIDNIGHT',
  type: 'beat',
  bpm: 140,
  key: 'F',
  scale: 'minor',
  duration_seconds: 180,
  cover_url: 'r2://private-bucket/covers/t1.png',
  audio_url: 'r2://private-bucket/masters/t1.wav',
  wav_url: 'r2://private-bucket/masters/t1.wav',
  preview_url: 'https://cdn.example.com/p/t1.mp3',
  notes: 'CRM: artist owes me a verse',
  user_id: 'owner-1',
  lease_price_usd: 50,
};

describe('toPortalTrack', () => {
  it('emits only the listed fields and never a private reference', () => {
    const out = toPortalTrack(hostileTrack, {
      projectIds: ['p1'], isNew: true, decision: 'interested', decisionSetBy: 'artist', canDownload: false,
      builtOn: [], streamUrl: '/api/share/tok/preview/t1?expires=1&sig=x', peaksUrl: null,
    });
    const json = JSON.stringify(out);
    expect(json).not.toContain('r2://');
    expect(json).not.toContain('CRM');
    expect(json).not.toContain('owner-1');
    expect(json).not.toContain('cdn.example.com');
    expect(Object.keys(out).sort()).toEqual([
      'bpm', 'builtOn', 'builtOnOthers', 'canDownload', 'cover_url', 'decision', 'decisionSetBy', 'duration_seconds', 'id', 'isNew',
      'key', 'peaksUrl', 'projectIds', 'scale', 'streamUrl', 'title', 'type',
    ]);
    expect(out.cover_url).toBeNull();
  });

  it('drops who set a decision when there is no decision', () => {
    const out = toPortalTrack(hostileTrack, {
      projectIds: ['p1'], isNew: false, decision: null, decisionSetBy: 'producer', canDownload: true,
      builtOn: [], streamUrl: null, peaksUrl: null,
    });
    expect(out.decisionSetBy).toBeNull();
  });
});

describe('toPortalProject', () => {
  it('builds a project card from listed fields only', () => {
    const out = toPortalProject(
      { id: 'p1', name: 'New EP', cover_url: 'https://cdn.example.com/c.png', description: 'Six tracks', user_id: 'owner-1', price_usd: 99 },
      { isNew: true, newCount: 3, beats: 5, songs: 1, files: 2, allowDownloads: false, canComment: true },
    );
    expect(out).toEqual({
      id: 'p1', name: 'New EP', cover_url: 'https://cdn.example.com/c.png', description: 'Six tracks',
      isNew: true, newCount: 3, beats: 5, songs: 1, files: 2, allowDownloads: false, canComment: true,
    });
  });
});

describe('toPortalFile', () => {
  it('emits the portal route, never the storage reference', () => {
    const hostile = { id: 'f1', project_id: 'p1', kind: 'lyrics', label: '', file_name: 'C:\\x\\Lyrics.pdf', mime: 'application/pdf', size_bytes: '2048', url: 'r2://private/project-assets/p1/abc.pdf', user_id: 'owner-1' };
    const out = toPortalFile(hostile, { token: 'tok', isNew: true });
    expect(out).toEqual({
      id: 'f1', projectId: 'p1', kind: 'lyrics', label: 'C:\\x\\Lyrics.pdf', fileName: 'Lyrics.pdf', mime: 'application/pdf',
      sizeBytes: 2048, isNew: true, url: '/api/portal/tok/files/f1',
    });
    expect(JSON.stringify(out)).not.toContain('r2://');
    expect(JSON.stringify(out)).not.toContain('owner-1');
  });
  it('coerces an unknown kind to other', () => {
    expect(toPortalFile({ id: 'f', project_id: 'p', kind: 'contract', label: 'x', file_name: 'x.pdf', mime: null, size_bytes: null }, { token: 't', isNew: false }).kind).toBe('other');
  });
});

describe('publicUrlOrNull', () => {
  it('allows http(s) and app paths, refuses everything else', () => {
    expect(publicUrlOrNull('https://x.test/a.png')).toBe('https://x.test/a.png');
    expect(publicUrlOrNull('/api/brand/logo')).toBe('/api/brand/logo');
    expect(publicUrlOrNull('r2://bucket/key')).toBeNull();
    expect(publicUrlOrNull('javascript:alert(1)')).toBeNull();
    expect(publicUrlOrNull('//evil.test/x')).toBeNull();
    expect(publicUrlOrNull(null)).toBeNull();
  });
});

describe('toPortalArtworkTheme', () => {
  it('drops private references from the producer theme', () => {
    const out = toPortalArtworkTheme({
      logo_url: 'r2://private/logo.png',
      artwork: {
        track: { url: 'https://cdn.test/a.png', palette: ['#111111'] },
        project: { url: 'r2://private/p.png', palette: [] },
        playlist: { url: null, palette: [] },
      },
      tag_colors: { trap: '#ff0000' },
    });
    expect(JSON.stringify(out)).not.toContain('r2://');
    expect(out.artwork.track.url).toBe('https://cdn.test/a.png');
    expect(out.tag_colors).toEqual({ trap: '#ff0000' });
  });
});
