import { describe, expect, it } from 'vitest';
import { masterChoice, type MasterCandidate } from './master-choice';

const SONG = 's1';
const link = (to: string, relation: string) => ({ from_track_id: SONG, to_track_id: to, relation });

describe('masterChoice', () => {
  it('defaults to the single linked master', () => {
    const c = masterChoice(SONG, [link('m1', 'master'), link('i1', 'instrumental')]);
    expect(c.defaultId).toBe('m1');
    expect(c.ask).toBe(false);
    expect(c.options.map((o) => [o.id, o.relation])).toEqual([['m1', 'master'], [SONG, 'self'], ['i1', 'instrumental']]);
  });
  it('asks when there is no linked master — the song’s own mix is an option, never a silent default', () => {
    const c = masterChoice(SONG, []);
    expect(c).toMatchObject({ defaultId: null, ask: true });
    expect(c.options).toEqual([{ id: SONG, relation: 'self' }]);
  });
  it('asks when there are several masters', () => {
    const c = masterChoice(SONG, [link('m1', 'master'), link('m2', 'master')]);
    expect(c).toMatchObject({ defaultId: null, ask: true });
    expect(c.options.map((o) => o.id)).toEqual(['m1', 'm2', SONG]);
  });
  it('ignores links that are not release relations or not from this song, and repeated rows', () => {
    const c = masterChoice(SONG, [
      link('d1', 'demo'),
      link('l1', 'loop'),
      { from_track_id: 'other', to_track_id: 'x', relation: 'master' },
      link('m1', 'master'),
      link('M1', 'master'),
    ]);
    expect(c.options.map((o) => o.id)).toEqual(['m1', SONG]);
    expect(c.defaultId).toBe('m1');
  });
  it('compares ids without case', () => {
    expect(masterChoice('ABC', [{ from_track_id: 'abc', to_track_id: 'm1', relation: 'master' }]).defaultId).toBe('m1');
  });
});

describe('MasterCandidate type', () => {
  it('is what the options route returns once titled', () => {
    const o: MasterCandidate = { id: 'm1', relation: 'master', title: 'Song (master)' };
    expect(o.title).toBe('Song (master)');
  });
});
