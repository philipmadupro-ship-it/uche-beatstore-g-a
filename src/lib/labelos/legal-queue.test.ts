import { describe, expect, it } from 'vitest';
import { canExportLegalPack, canSeeLegalQueue, isQueueable, sortLegalQueue, type LegalQueueItem } from './legal-queue';

const item = (over: Partial<LegalQueueItem>): LegalQueueItem => ({
  kind: 'song',
  id: 'a',
  title: 'T',
  artist: null,
  requestedAt: '2026-10-01T00:00:00Z',
  requestedBy: null,
  askedOfMe: false,
  ready: false,
  blockers: 1,
  ...over,
});

describe('sortLegalQueue', () => {
  it('puts a subject with no blockers first, whatever its age', () => {
    const out = sortLegalQueue([
      item({ id: 'old', requestedAt: '2026-01-01T00:00:00Z', blockers: 4 }),
      item({ id: 'ready', requestedAt: '2026-10-09T00:00:00Z', ready: true, blockers: 0 }),
    ]);
    expect(out.map((i) => i.id)).toEqual(['ready', 'old']);
  });

  it('orders the not-ready by blockers, then oldest first, then id', () => {
    const out = sortLegalQueue([
      item({ id: 'c', blockers: 2, requestedAt: '2026-02-01T00:00:00Z' }),
      item({ id: 'b', blockers: 1, requestedAt: '2026-03-01T00:00:00Z' }),
      item({ id: 'a', blockers: 1, requestedAt: '2026-03-01T00:00:00Z' }),
      item({ id: 'd', blockers: 1, requestedAt: '2026-01-15T00:00:00Z' }),
    ]);
    expect(out.map((i) => i.id)).toEqual(['d', 'a', 'b', 'c']);
  });

  it('is oldest first among the ready, and does not change its input', () => {
    const input = [
      item({ id: 'n', ready: true, blockers: 0, requestedAt: '2026-05-02T00:00:00Z' }),
      item({ id: 'o', ready: true, blockers: 0, requestedAt: '2026-05-01T00:00:00Z' }),
    ];
    const copy = [...input];
    expect(sortLegalQueue(input).map((i) => i.id)).toEqual(['o', 'n']);
    expect(input).toEqual(copy);
  });

  it('never reads a percentage: the type has no score to sort by', () => {
    expect(Object.keys(item({}))).not.toContain('score');
  });
});

describe('who sees the queue and the pack', () => {
  const caps = (...c: string[]) => new Set(c);
  it('needs the catalogue, approval reading and the legal gate or contracts', () => {
    expect(canSeeLegalQueue(caps('catalog.read', 'release.approve.legal'))).toBe(true);
    expect(canSeeLegalQueue(caps('catalog.read', 'release.write', 'contracts.read'))).toBe(true);
    expect(canSeeLegalQueue(caps('release.approve.legal'))).toBe(false);
    expect(canSeeLegalQueue(caps('catalog.read', 'contracts.read'))).toBe(false);
    expect(canSeeLegalQueue(caps('catalog.read', 'release.approve.marketing'))).toBe(false);
  });
  it('the pack needs contracts.read AND rights.read', () => {
    expect(canExportLegalPack(caps('contracts.read', 'rights.read'))).toBe(true);
    expect(canExportLegalPack(caps('contracts.read'))).toBe(false);
    expect(canExportLegalPack(caps('rights.read'))).toBe(false);
  });
});

describe('isQueueable (doc 21 #13)', () => {
  it('a song on a live release is approved at the release, so it is not queued; everything else is', () => {
    expect(isQueueable('song', true)).toBe(false);
    expect(isQueueable('song', false)).toBe(true);
    expect(isQueueable('release', true)).toBe(true);
    expect(isQueueable('release', false)).toBe(true);
  });
});
