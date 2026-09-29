import { describe, expect, it } from 'vitest';
import {
  engagementByTrack,
  signalsFromActivity,
  signalsFromPortal,
  signalsFromSends,
} from './track-engagement';

describe('engagementByTrack', () => {
  it('reports the furthest step reached, with when it was first reached', () => {
    const map = engagementByTrack([
      { trackId: 't1', step: 'sent', at: '2026-09-01T00:00:00Z' },
      { trackId: 't1', step: 'played', at: '2026-09-03T00:00:00Z' },
      { trackId: 't1', step: 'opened', at: '2026-09-02T00:00:00Z' },
      { trackId: 't1', step: 'played', at: '2026-09-02T12:00:00Z' },
    ]);
    expect(map.get('t1')).toEqual({
      step: 'played',
      at: '2026-09-02T12:00:00Z',
      plays: 2,
      downloads: 0,
      lastPlayedAt: '2026-09-03T00:00:00Z',
    });
  });

  it('ranks a download above a play', () => {
    const map = engagementByTrack([
      { trackId: 't1', step: 'downloaded', at: '2026-09-01T00:00:00Z' },
      { trackId: 't1', step: 'played', at: '2026-09-05T00:00:00Z' },
    ]);
    expect(map.get('t1')?.step).toBe('downloaded');
    expect(map.get('t1')?.downloads).toBe(1);
  });

  it('ignores signals with no track or no valid time', () => {
    expect(engagementByTrack([
      { trackId: '', step: 'sent', at: '2026-09-01T00:00:00Z' },
      { trackId: 't1', step: 'sent', at: 'not a date' },
    ]).size).toBe(0);
  });
});

describe('signalsFromSends', () => {
  it('turns a send into sent + opened per track; a click also counts as opened', () => {
    const signals = signalsFromSends([
      { track_ids: ['a', 'b'], sent_at: '2026-09-01T00:00:00Z', link_clicked_at: '2026-09-02T00:00:00Z' },
    ]);
    expect(signals).toEqual([
      { trackId: 'a', step: 'sent', at: '2026-09-01T00:00:00Z' },
      { trackId: 'a', step: 'opened', at: '2026-09-02T00:00:00Z' },
      { trackId: 'b', step: 'sent', at: '2026-09-01T00:00:00Z' },
      { trackId: 'b', step: 'opened', at: '2026-09-02T00:00:00Z' },
    ]);
  });
});

describe('signalsFromPortal', () => {
  it('counts a portal track as opened at the first visit on or after it appeared', () => {
    const signals = signalsFromPortal(
      [{ trackId: 'a', availableAt: '2026-09-05T00:00:00Z' }, { trackId: 'b', availableAt: '2026-09-10T00:00:00Z' }],
      ['2026-09-07T00:00:00Z', '2026-09-01T00:00:00Z'],
    );
    expect(signals).toEqual([
      { trackId: 'a', step: 'sent', at: '2026-09-05T00:00:00Z' },
      { trackId: 'a', step: 'opened', at: '2026-09-07T00:00:00Z' },
      { trackId: 'b', step: 'sent', at: '2026-09-10T00:00:00Z' },
    ]);
  });
});

describe('signalsFromActivity', () => {
  it('reads portal plays and downloads from contact_activity rows', () => {
    expect(signalsFromActivity([
      { kind: 'track_played', occurred_at: '2026-09-01T00:00:00Z', metadata: { track_id: 'a' } },
      { kind: 'track_downloaded', occurred_at: '2026-09-02T00:00:00Z', metadata: { track_id: 'a' } },
      { kind: 'note', occurred_at: '2026-09-03T00:00:00Z', metadata: { track_id: 'a' } },
      { kind: 'track_played', occurred_at: '2026-09-03T00:00:00Z', metadata: {} },
    ])).toEqual([
      { trackId: 'a', step: 'played', at: '2026-09-01T00:00:00Z' },
      { trackId: 'a', step: 'downloaded', at: '2026-09-02T00:00:00Z' },
    ]);
  });
});
