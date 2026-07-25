import { describe, expect, it } from 'vitest';
import { tagNamesFromRows } from './rows';

describe('tagNamesFromRows', () => {
  it('extracts string tags from API rows', () => {
    expect(tagNamesFromRows([
      { tag: 'priority' },
      { tag: 'warm lead', category: 'crm' },
    ])).toEqual(['priority', 'warm lead']);
  });

  it('ignores malformed rows and non-array payloads', () => {
    expect(tagNamesFromRows([{ tag: null }, { tag: 123 }, {}, null])).toEqual([]);
    expect(tagNamesFromRows({ tag: 'not-an-array' })).toEqual([]);
  });
});
