import { describe, expect, it } from 'vitest';
import { attachContactTags } from './attach-tags';

describe('attachContactTags', () => {
  it('groups tag rows onto their contacts; untagged get []', () => {
    const out = attachContactTags([{ id: 'a' }, { id: 'b' }], [
      { contact_id: 'a', tag: 'vip', category: 'custom' },
      { contact_id: 'a', tag: 'drill' },
    ]);
    expect(out[0].tags).toEqual([{ tag: 'vip', category: 'custom' }, { tag: 'drill', category: null }]);
    expect(out[1].tags).toEqual([]);
  });
});
