import { describe, expect, it } from 'vitest';
import { loadShareTrackTags, withShareTags } from './track-tags';

function client(result: { data?: unknown; error?: unknown } | Error) {
  return {
    from: () => ({
      select: () => ({
        in: async () => {
          if (result instanceof Error) throw result;
          return result;
        },
      }),
    }),
  };
}

describe('loadShareTrackTags', () => {
  it('groups tags by track and drops rows that are not usable', async () => {
    const map = await loadShareTrackTags(client({ data: [
      { track_id: 'a', tag: 'Trap', category: 'genre' },
      { track_id: 'a', tag: 'Dark', category: 'mood' },
      { track_id: 'b', tag: '  ', category: 'mood' },
      { track_id: 7, tag: 'x', category: 'mood' },
    ] }), ['a', 'b']);
    expect(map.get('a')).toEqual([{ tag: 'Trap', category: 'genre' }, { tag: 'Dark', category: 'mood' }]);
    expect(map.has('b')).toBe(false);
  });

  it('never fails the share: an error or a throw means no tags', async () => {
    expect((await loadShareTrackTags(client({ error: { message: 'no table' } }), ['a'])).size).toBe(0);
    expect((await loadShareTrackTags(client(new Error('boom')), ['a'])).size).toBe(0);
  });

  it('does not query for an empty share', async () => {
    expect((await loadShareTrackTags(client(new Error('should not run')), [])).size).toBe(0);
  });

  it('withShareTags gives every track a list', () => {
    const out = withShareTags([{ id: 'a' }, { id: 'b' }], new Map([['a', [{ tag: 'Trap', category: 'genre' }]]]));
    expect(out[0].tags).toHaveLength(1);
    expect(out[1].tags).toEqual([]);
  });
});
