import { describe, expect, it } from 'vitest';
import { pulseChanges, pulseVersions, type PulseInput } from './pulse';

const base: PulseInput = {
  links: [{ project_id: 'p1', allow_downloads: true, can_comment: true }],
  projects: [{ id: 'p1', name: 'Tape', cover_url: null }],
  projectTracks: [{ project_id: 'p1', track_id: 't1' }, { project_id: 'p1', track_id: 't2' }],
  files: [],
  states: [{ track_id: 't1', decision: 'interested' }],
  comments: [{ id: 'c1' }],
  messages: [{ id: 'm1', request_status: 'open' }],
};

describe('pulseVersions', () => {
  it('ignores row order', () => {
    const a = pulseVersions(base);
    const b = pulseVersions({ ...base, projectTracks: [...base.projectTracks].reverse() });
    expect(b).toEqual(a);
  });
  it('moves only the part that changed', () => {
    const a = pulseVersions(base);
    expect(pulseChanges(a, pulseVersions({ ...base, projectTracks: [...base.projectTracks, { project_id: 'p1', track_id: 't3' }] })))
      .toEqual({ library: true, comments: false, messages: false });
    expect(pulseChanges(a, pulseVersions({ ...base, states: [{ track_id: 't1', decision: 'selected' }] })).library).toBe(true);
    expect(pulseChanges(a, pulseVersions({ ...base, comments: [{ id: 'c1' }, { id: 'c2' }] })))
      .toEqual({ library: false, comments: true, messages: false });
    expect(pulseChanges(a, pulseVersions({ ...base, messages: [{ id: 'm1', request_status: 'done' }] })).messages).toBe(true);
  });
  it('reports nothing without a previous pulse', () => {
    expect(pulseChanges(null, pulseVersions(base))).toEqual({ library: false, comments: false, messages: false });
  });
  it('never exposes ids', () => {
    expect(JSON.stringify(pulseVersions(base))).not.toMatch(/p1|t1|m1|Tape/);
  });
});
