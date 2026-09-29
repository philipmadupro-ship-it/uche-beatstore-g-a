import { describe, expect, it } from 'vitest';
import { availableAt, countUnnotified, isNewSince, nextVisitWatermarks } from './new-items';

const project = { projectId: 'p1', linkedAt: '2026-09-10T00:00:00Z', lastNotifiedAt: '2026-09-12T00:00:00Z' };

describe('availableAt', () => {
  it('is the later of the add and the project going into the portal', () => {
    expect(availableAt({ projectId: 'p1', trackId: 't', addedAt: '2026-03-01T00:00:00Z' }, project)).toBe('2026-09-10T00:00:00Z');
    expect(availableAt({ projectId: 'p1', trackId: 't', addedAt: '2026-09-15T00:00:00Z' }, project)).toBe('2026-09-15T00:00:00Z');
  });
});

describe('isNewSince', () => {
  it('marks what appeared after the previous visit, and everything on a first visit', () => {
    expect(isNewSince('2026-09-15T00:00:00Z', '2026-09-14T00:00:00Z')).toBe(true);
    expect(isNewSince('2026-09-13T00:00:00Z', '2026-09-14T00:00:00Z')).toBe(false);
    expect(isNewSince('2026-09-13T00:00:00Z', null)).toBe(true);
  });
});

describe('countUnnotified', () => {
  it('counts tracks added since the last notify, once each', () => {
    const out = countUnnotified([project], [
      { projectId: 'p1', trackId: 'old', addedAt: '2026-09-11T00:00:00Z' },
      { projectId: 'p1', trackId: 'new', addedAt: '2026-09-13T00:00:00Z' },
      { projectId: 'p1', trackId: 'new', addedAt: '2026-09-13T00:00:00Z' },
    ]);
    expect(out).toEqual({ newProjects: [], newTracks: [{ projectId: 'p1', trackId: 'new' }], newFiles: [], total: 1 });
  });

  it('counts a never-notified project once, not once per track', () => {
    const out = countUnnotified([{ ...project, lastNotifiedAt: null }], [
      { projectId: 'p1', trackId: 'a', addedAt: '2026-09-13T00:00:00Z' },
      { projectId: 'p1', trackId: 'b', addedAt: '2026-09-13T00:00:00Z' },
    ]);
    expect(out.total).toBe(1);
    expect(out.newProjects).toEqual(['p1']);
  });

  it('counts files put in the portal since the last notify, including old files shared late', () => {
    const out = countUnnotified([project], [], [
      { projectId: 'p1', fileId: 'before', portalAt: '2026-09-11T00:00:00Z' },
      { projectId: 'p1', fileId: 'after', portalAt: '2026-09-14T00:00:00Z' },
      { projectId: 'p2', fileId: 'elsewhere', portalAt: '2026-09-14T00:00:00Z' },
    ]);
    expect(out.newFiles).toEqual([{ projectId: 'p1', fileId: 'after' }]);
    expect(out.total).toBe(1);
  });

  it('does not count files of a never-notified project on top of the project', () => {
    const out = countUnnotified([{ ...project, lastNotifiedAt: null }], [], [{ projectId: 'p1', fileId: 'f', portalAt: '2026-09-14T00:00:00Z' }]);
    expect(out.total).toBe(1);
    expect(out.newFiles).toEqual([]);
  });

  it('ignores tracks of projects outside the portal', () => {
    expect(countUnnotified([project], [{ projectId: 'p2', trackId: 'x', addedAt: '2026-09-20T00:00:00Z' }]).total).toBe(0);
  });
});

describe('nextVisitWatermarks', () => {
  it('moves the last visit into previous on a new visit', () => {
    expect(nextVisitWatermarks(
      { last_viewed_at: '2026-09-01T00:00:00Z', previous_viewed_at: '2026-08-01T00:00:00Z' },
      '2026-09-05T00:00:00Z',
    )).toEqual({ last_viewed_at: '2026-09-05T00:00:00Z', previous_viewed_at: '2026-09-01T00:00:00Z', isNewVisit: true });
  });

  it('keeps the NEW markers through a reload within the same session', () => {
    expect(nextVisitWatermarks(
      { last_viewed_at: '2026-09-05T00:00:00Z', previous_viewed_at: '2026-09-01T00:00:00Z' },
      '2026-09-05T00:10:00Z',
    )).toEqual({ last_viewed_at: '2026-09-05T00:10:00Z', previous_viewed_at: '2026-09-01T00:00:00Z', isNewVisit: false });
  });

  it('treats the first ever visit as new with no previous watermark', () => {
    expect(nextVisitWatermarks({ last_viewed_at: null, previous_viewed_at: null }, '2026-09-05T00:00:00Z'))
      .toEqual({ last_viewed_at: '2026-09-05T00:00:00Z', previous_viewed_at: null, isNewVisit: true });
  });
});
