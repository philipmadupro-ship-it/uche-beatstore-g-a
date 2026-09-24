import { describe, expect, it } from 'vitest';
import { folderCounts, withFolder, withoutFolder } from './folders';

describe('folder membership', () => {
  it('filing adds to the existing set rather than replacing it', () => {
    expect(withFolder(['a'], 'b')).toEqual(['a', 'b']);
    expect(withFolder(['a'], 'a')).toEqual(['a']);
    expect(withFolder(null, 'a')).toEqual(['a']);
  });
  it('removing leaves the other folders', () => {
    expect(withoutFolder(['a', 'b'], 'a')).toEqual(['b']);
  });
  it('counts per folder and unfiled', () => {
    const { byFolder, unfiled } = folderCounts([
      { folder_ids: ['a', 'b'] }, { folder_ids: ['a'] }, { folder_ids: [] }, {},
    ]);
    expect(byFolder.get('a')).toBe(2);
    expect(byFolder.get('b')).toBe(1);
    expect(unfiled).toBe(2);
  });
});
