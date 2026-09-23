import { describe, it, expect } from 'vitest';
import {
  resolveSections,
  flattenActions,
  nextEnabledIndex,
  firstEnabledIndex,
  indexForShortcutKey,
  type MenuSection,
} from './action-menu';

const item = (id: string, extra: Partial<MenuSection['items'][number]> = {}) => ({
  id,
  label: id,
  onSelect: () => {},
  ...extra,
});

describe('resolveSections', () => {
  it('pins danger sections last regardless of where the caller put them', () => {
    const out = resolveSections([
      { id: 'danger', danger: true, items: [item('delete')] },
      { id: 'primary', items: [item('rename')] },
      { id: 'project', items: [item('archive')] },
    ]);
    expect(out.map((s) => s.id)).toEqual(['primary', 'project', 'danger']);
  });

  it('drops hidden items and the sections they empty', () => {
    const out = resolveSections([
      { id: 'a', items: [item('x', { hidden: true })] },
      { id: 'b', items: [item('y', { hidden: true }), item('z')] },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].items.map((i) => i.id)).toEqual(['z']);
  });

  it('keeps relative order among multiple danger sections', () => {
    const out = resolveSections([
      { id: 'd1', danger: true, items: [item('a')] },
      { id: 'safe', items: [item('b')] },
      { id: 'd2', danger: true, items: [item('c')] },
    ]);
    expect(out.map((s) => s.id)).toEqual(['safe', 'd1', 'd2']);
  });
});

describe('flattenActions', () => {
  it('addresses only visible items, in resolved order', () => {
    const flat = flattenActions([
      { id: 'danger', danger: true, items: [item('delete')] },
      { id: 'primary', items: [item('rename'), item('ghost', { hidden: true })] },
    ]);
    expect(flat.map((i) => i.id)).toEqual(['rename', 'delete']);
  });
});

describe('nextEnabledIndex', () => {
  const items = [item('a'), item('b', { disabled: true }), item('c', { busy: true }), item('d')];

  it('skips disabled and busy rows going down', () => {
    expect(nextEnabledIndex(items, 0, 1)).toBe(3);
  });

  it('skips disabled and busy rows going up', () => {
    expect(nextEnabledIndex(items, 3, -1)).toBe(0);
  });

  it('wraps at both ends', () => {
    expect(nextEnabledIndex(items, 3, 1)).toBe(0);
    expect(nextEnabledIndex(items, 0, -1)).toBe(3);
  });

  it('returns -1 when nothing is selectable', () => {
    expect(nextEnabledIndex([item('a', { disabled: true })], 0, 1)).toBe(-1);
    expect(nextEnabledIndex([], 0, 1)).toBe(-1);
  });

  it('opens on the first selectable row, not blindly on index 0', () => {
    expect(firstEnabledIndex([item('a', { disabled: true }), item('b')])).toBe(1);
  });
});

describe('indexForShortcutKey', () => {
  const items = [item('rename', { shortcutKey: 'R' }), item('tags', { shortcutKey: 't' })];

  it('matches case-insensitively', () => {
    expect(indexForShortcutKey(items, 'r')).toBe(0);
    expect(indexForShortcutKey(items, 'T')).toBe(1);
  });

  it('ignores unbound keys and disabled rows', () => {
    expect(indexForShortcutKey(items, 'z')).toBe(-1);
    expect(indexForShortcutKey([item('x', { shortcutKey: 'x', disabled: true })], 'x')).toBe(-1);
  });
});
