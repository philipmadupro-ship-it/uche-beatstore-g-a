import { describe, expect, it } from 'vitest';
import {
  HISTORY_LIMIT, SNAPSHOT_MIN_GAP_MS, createSnapshot, describeLayout, formatSnapshotAge,
  isLayoutSnapshot, pruneSnapshots, sameLayout, shouldSnapshot, sortSnapshots, toSummary,
} from './history';
import {
  createSection, defaultStoreLayout, setSectionSetting, updateSection,
} from './layout';

const at = (iso: string) => new Date(iso);

describe('createSnapshot', () => {
  it('captures the layout with a timestamp and a label', () => {
    const snapshot = createSnapshot(defaultStoreLayout(), at('2026-08-22T10:00:00Z'));
    expect(snapshot.takenAt).toBe('2026-08-22T10:00:00.000Z');
    expect(snapshot.label).toContain('section');
    expect(snapshot.layout.sections.length).toBeGreaterThan(0);
  });

  it('gives every snapshot a unique id', () => {
    const layout = defaultStoreLayout();
    const ids = [
      createSnapshot(layout, at('2026-08-22T10:00:00Z')).id,
      createSnapshot(layout, at('2026-08-22T10:00:00Z')).id,
      createSnapshot(layout, at('2026-08-22T10:00:00Z')).id,
    ];
    // Same millisecond on purpose: two autosaves can land in one tick, and a
    // colliding id would overwrite the earlier snapshot instead of adding one.
    expect(new Set(ids).size).toBe(3);
  });

  it('produces a snapshot its own validator accepts', () => {
    expect(isLayoutSnapshot(createSnapshot(defaultStoreLayout()))).toBe(true);
  });
});

describe('describeLayout', () => {
  it('counts sections', () => {
    expect(describeLayout(defaultStoreLayout())).toMatch(/^\d+ sections/);
  });

  it('mentions device overrides that hide something', () => {
    let layout = defaultStoreLayout();
    const id = layout.sections[2].id;
    layout = updateSection(layout, id, (section) => setSectionSetting(section, 'mobile', 'visible', false));
    expect(describeLayout(layout)).toContain('device override');
  });

  it('says nothing about overrides when there are none', () => {
    expect(describeLayout(defaultStoreLayout())).not.toContain('override');
  });

  it('uses a singular for one section', () => {
    const layout = { ...defaultStoreLayout(), sections: [createSection('text')] };
    expect(describeLayout(layout)).toBe('1 section');
  });
});

describe('sameLayout', () => {
  it('ignores updatedAt, which changes on every keystroke', () => {
    // Comparing it would report "different" for a layout nobody altered and
    // defeat deduplication entirely.
    const a = defaultStoreLayout();
    const b = { ...a, updatedAt: new Date(Date.now() + 90000).toISOString() };
    expect(sameLayout(a, b)).toBe(true);
  });

  it('sees a section change', () => {
    const a = defaultStoreLayout();
    const b = updateSection(a, a.sections[0].id, (section) => ({ ...section, name: 'Renamed' }));
    expect(sameLayout(a, b)).toBe(false);
  });

  it('sees a theme change', () => {
    const a = defaultStoreLayout();
    const b = { ...a, theme: { ...a.theme, accent: '#FF0000' } };
    expect(sameLayout(a, b)).toBe(false);
  });

  it('sees a breakpoint override', () => {
    const a = defaultStoreLayout();
    const b = updateSection(a, a.sections[1].id, (s) => setSectionSetting(s, 'mobile', 'columns', 1));
    expect(sameLayout(a, b)).toBe(false);
  });
});

describe('shouldSnapshot', () => {
  const layout = defaultStoreLayout();
  const now = Date.parse('2026-08-22T12:00:00Z');

  it('always records the first one', () => {
    expect(shouldSnapshot(layout, null, now)).toBe(true);
  });

  it('declines when nothing changed', () => {
    const latest = createSnapshot(layout, new Date(now - SNAPSHOT_MIN_GAP_MS * 5));
    expect(shouldSnapshot(layout, latest, now)).toBe(false);
  });

  it('declines a change that is too soon after the last one', () => {
    // The failure this prevents: autosave every 900ms during a slider drag
    // filling the history with near-identical entries and evicting everything
    // worth restoring — the feature destroying its own usefulness.
    const changed = updateSection(layout, layout.sections[0].id, (s) => ({ ...s, name: 'X' }));
    const latest = createSnapshot(layout, new Date(now - 1000));
    expect(shouldSnapshot(changed, latest, now)).toBe(false);
  });

  it('records a change once enough time has passed', () => {
    const changed = updateSection(layout, layout.sections[0].id, (s) => ({ ...s, name: 'X' }));
    const latest = createSnapshot(layout, new Date(now - SNAPSHOT_MIN_GAP_MS - 1));
    expect(shouldSnapshot(changed, latest, now)).toBe(true);
  });

  it('declines an unchanged layout however long it has been', () => {
    const latest = createSnapshot(layout, new Date(now - SNAPSHOT_MIN_GAP_MS * 100));
    expect(shouldSnapshot(layout, latest, now)).toBe(false);
  });
});

describe('sortSnapshots', () => {
  it('puts the newest first', () => {
    const items = [
      { takenAt: '2026-08-20T10:00:00Z' },
      { takenAt: '2026-08-22T10:00:00Z' },
      { takenAt: '2026-08-21T10:00:00Z' },
    ];
    expect(sortSnapshots(items).map((i) => i.takenAt)).toEqual([
      '2026-08-22T10:00:00Z',
      '2026-08-21T10:00:00Z',
      '2026-08-20T10:00:00Z',
    ]);
  });

  it('does not mutate its input', () => {
    const items = [{ takenAt: '2026-08-20T10:00:00Z' }, { takenAt: '2026-08-22T10:00:00Z' }];
    const before = items.map((i) => i.takenAt);
    sortSnapshots(items);
    expect(items.map((i) => i.takenAt)).toEqual(before);
  });
});

describe('pruneSnapshots', () => {
  const many = Array.from({ length: HISTORY_LIMIT + 15 }, (_, index) => ({
    takenAt: new Date(Date.parse('2026-08-01T00:00:00Z') + index * 60000).toISOString(),
  }));

  it('keeps the limit', () => {
    expect(pruneSnapshots(many)).toHaveLength(HISTORY_LIMIT);
  });

  it('keeps the NEWEST, not the first it happened to see', () => {
    const kept = pruneSnapshots(many);
    expect(kept[0].takenAt).toBe(many[many.length - 1].takenAt);
    expect(kept).not.toContainEqual(many[0]);
  });

  it('leaves a short list alone', () => {
    const few = many.slice(0, 3);
    expect(pruneSnapshots(few)).toHaveLength(3);
  });

  it('handles a zero limit without returning junk', () => {
    expect(pruneSnapshots(many, 0)).toEqual([]);
    expect(pruneSnapshots(many, -5)).toEqual([]);
  });
});

describe('isLayoutSnapshot', () => {
  it('rejects junk rather than letting it reach the builder', () => {
    expect(isLayoutSnapshot(null)).toBe(false);
    expect(isLayoutSnapshot('a string')).toBe(false);
    expect(isLayoutSnapshot({})).toBe(false);
    expect(isLayoutSnapshot({ id: 'a', takenAt: 'x' })).toBe(false);
  });

  it('rejects a record whose layout has no sections array', () => {
    expect(isLayoutSnapshot({
      id: 'a', takenAt: 'x', label: 'y', layout: { sections: 'nope' },
    })).toBe(false);
  });

  it('rejects an empty id, which would collide as an IndexedDB key', () => {
    expect(isLayoutSnapshot({
      id: '', takenAt: 'x', label: 'y', layout: defaultStoreLayout(),
    })).toBe(false);
  });
});

describe('toSummary', () => {
  it('drops the layout but keeps what the list shows', () => {
    const summary = toSummary(createSnapshot(defaultStoreLayout()));
    expect(summary).not.toHaveProperty('layout');
    expect(summary.sectionCount).toBeGreaterThan(0);
    expect(summary.label).toBeTruthy();
  });
});

describe('formatSnapshotAge', () => {
  const now = Date.parse('2026-08-22T12:00:00Z');
  const ago = (ms: number) => new Date(now - ms).toISOString();

  it('reads naturally across the ranges', () => {
    expect(formatSnapshotAge(ago(10_000), now)).toBe('just now');
    expect(formatSnapshotAge(ago(12 * 60_000), now)).toBe('12m ago');
    expect(formatSnapshotAge(ago(3 * 3_600_000), now)).toBe('3h ago');
    expect(formatSnapshotAge(ago(2 * 86_400_000), now)).toBe('2d ago');
  });

  it('does not say "-3m ago" for a clock that jumped', () => {
    expect(formatSnapshotAge(new Date(now + 60_000).toISOString(), now)).toBe('just now');
  });

  it('survives an unparseable timestamp', () => {
    expect(formatSnapshotAge('not a date', now)).toBe('just now');
  });
});
