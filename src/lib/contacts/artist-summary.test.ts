import { describe, expect, it } from 'vitest';
import { describeMoving, sortArtistSummaries, summarizeArtist, type ArtistSummaryInput } from './artist-summary';

const base = (over: Partial<ArtistSummaryInput> = {}): ArtistSummaryInput => ({
  contact: { id: 'c1', name: 'Artist #1', avatar_url: null, crm_status: null },
  links: [],
  projects: [],
  portal: null,
  decisions: [],
  sends: [],
  activity: [],
  shareCount: 0,
  portalTracks: [],
  portalFiles: [],
  ...over,
});

describe('summarizeArtist', () => {
  it('uses the workspace relationship rule and picks the newest active project', () => {
    const s = summarizeArtist(base({
      links: [
        { project_id: 'old', in_portal: true, created_at: '2026-09-01T00:00:00Z', last_notified_at: '2026-09-02T00:00:00Z' },
        { project_id: 'new', in_portal: true, created_at: '2026-09-10T00:00:00Z', last_notified_at: null },
        { project_id: 'arch', in_portal: true, created_at: '2026-09-20T00:00:00Z', last_notified_at: null },
      ],
      projects: [
        { id: 'old', name: 'Old', cover_url: null, status: 'in_progress' },
        { id: 'new', name: 'New EP', cover_url: 'https://x/c.png', status: 'in_progress' },
        { id: 'arch', name: 'Shelved', cover_url: null, status: 'archived' },
      ],
      portal: { revoked_at: null, last_viewed_at: '2026-09-11T00:00:00Z' },
      decisions: ['interested', 'interested', 'recording', 'passed', 'bogus', null],
      activity: [{ kind: 'track_played' }, { kind: 'track_played' }, { kind: 'track_downloaded' }, { kind: 'file_downloaded' }, { kind: 'portal_opened' }],
      portalTracks: [
        { projectId: 'old', trackId: 't-late', addedAt: '2026-09-05T00:00:00Z' },
        { projectId: 'arch', trackId: 't-arch', addedAt: '2026-09-21T00:00:00Z' },
      ],
    }));
    expect(s.relationship).toEqual({ stage: 'working_together', parked: null });
    expect(s.activeProject).toEqual({ id: 'new', name: 'New EP', cover_url: 'https://x/c.png' });
    expect(s.projectCount).toBe(3);
    expect(s.decisions).toEqual({ interested: 2, recording: 1, passed: 1 });
    expect(s.moving).toBe(3);
    expect(s.plays).toBe(2);
    expect(s.downloads).toBe(2);
    // New EP never notified (1) + one late track on Old (1); the archived project is not news.
    expect(s.notifyCount).toBe(2);
    expect(s.portal).toEqual({ live: true, lastViewedAt: '2026-09-11T00:00:00Z' });
  });

  it('reports parking beside the stage and counts nothing to notify on a revoked portal', () => {
    const s = summarizeArtist(base({
      contact: { id: 'c1', name: 'A', avatar_url: null, crm_status: 'cold' },
      portal: { revoked_at: '2026-09-01T00:00:00Z', last_viewed_at: null },
      links: [{ project_id: 'p', in_portal: true, created_at: '2026-09-01T00:00:00Z', last_notified_at: null }],
      projects: [{ id: 'p', name: 'P', cover_url: null, status: 'archived' }],
    }));
    expect(s.relationship).toEqual({ stage: 'contacted', parked: 'cold' });
    expect(s.notifyCount).toBe(0);
    expect(s.activeProject).toBeNull();
  });
});

describe('sortArtistSummaries / describeMoving', () => {
  it('puts working artists first and parked ones last', () => {
    const mk = (name: string, stage: string, parked: 'cold' | null = null) =>
      ({ ...summarizeArtist(base({ contact: { id: name, name, avatar_url: null, crm_status: null } })), relationship: { stage, parked } }) as ReturnType<typeof summarizeArtist>;
    const out = sortArtistSummaries([mk('Zed', 'working_together', 'cold'), mk('Bee', 'new'), mk('Ann', 'working_together'), mk('Cy', 'interested')]);
    expect(out.map((a) => a.contact.name)).toEqual(['Ann', 'Cy', 'Bee', 'Zed']);
  });
  it('describes only the moving words, in order', () => {
    expect(describeMoving({ recording: 1, interested: 2, passed: 4 })).toBe('2 interested · 1 recording');
    expect(describeMoving({})).toBe('');
  });
});
