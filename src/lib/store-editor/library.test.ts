import { describe, expect, it } from 'vitest';
import {
  fromSavedSection, isSavedSection, sortSaved, toLibrarySummary, toSavedSection,
  uniqueLibraryName,
} from './library';
import { createSection, resolveSection, setSectionSetting } from './layout';

const source = () => {
  let section = createSection('text', 'Promo block', { spacing: 6, width: 'narrow' });
  section = setSectionSetting(section, 'mobile', 'spacing', 2);
  return { ...section, content: { heading: 'Hi', body: 'Body copy' } };
};

describe('toSavedSection', () => {
  it('keeps everything about the section except its identity', () => {
    const saved = toSavedSection(source());
    expect(saved.section.kind).toBe('text');
    expect(saved.section.base.spacing).toBe(6);
    expect(saved.section.overrides.mobile).toEqual({ spacing: 2 });
    expect(saved.section.content).toEqual({ heading: 'Hi', body: 'Body copy' });
    expect(saved.section).not.toHaveProperty('id');
  });

  it('clears the lock', () => {
    // A saved block arriving locked is one the producer cannot move or delete
    // without first working out why.
    const locked = { ...source(), locked: true };
    expect(toSavedSection(locked).section.locked).toBe(false);
  });

  it('takes the section name by default and an override when given', () => {
    expect(toSavedSection(source()).name).toBe('Promo block');
    expect(toSavedSection(source(), 'My block').name).toBe('My block');
  });

  it('falls back to the kind rather than storing a blank name', () => {
    expect(toSavedSection({ ...source(), name: '   ' }).name).toBe('text');
  });

  it('gives every save a unique id, even within one millisecond', () => {
    const at = new Date('2026-08-22T10:00:00Z');
    const ids = [
      toSavedSection(source(), undefined, at).id,
      toSavedSection(source(), undefined, at).id,
      toSavedSection(source(), undefined, at).id,
    ];
    expect(new Set(ids).size).toBe(3);
  });

  it('produces a record its own validator accepts', () => {
    expect(isSavedSection(toSavedSection(source()))).toBe(true);
  });
});

describe('fromSavedSection', () => {
  it('mints a fresh id each time', () => {
    // Reusing the stored id would mean two sections claiming one key: the
    // second insert shadows the first in every lookup, and updateSection
    // would edit both.
    const saved = toSavedSection(source());
    const a = fromSavedSection(saved);
    const b = fromSavedSection(saved);
    expect(a.id).not.toBe(b.id);
    expect(a.id).toBeTruthy();
  });

  it('restores the section faithfully', () => {
    const original = source();
    const restored = fromSavedSection(toSavedSection(original));
    expect(restored.kind).toBe(original.kind);
    expect(restored.name).toBe(original.name);
    expect(resolveSection(restored, 'desktop')).toEqual(resolveSection(original, 'desktop'));
    expect(resolveSection(restored, 'mobile')).toEqual(resolveSection(original, 'mobile'));
    expect(restored.content).toEqual(original.content);
  });

  it('round-trips through JSON, as IndexedDB stores it', () => {
    const saved = JSON.parse(JSON.stringify(toSavedSection(source())));
    expect(isSavedSection(saved)).toBe(true);
    expect(fromSavedSection(saved).content).toEqual({ heading: 'Hi', body: 'Body copy' });
  });
});

describe('isSavedSection', () => {
  it('rejects junk rather than letting it reach the builder', () => {
    expect(isSavedSection(null)).toBe(false);
    expect(isSavedSection({})).toBe(false);
    expect(isSavedSection({ id: 'a', savedAt: 'x' })).toBe(false);
    expect(isSavedSection({ id: '', savedAt: 'x', section: { kind: 'text', base: {} } })).toBe(false);
    expect(isSavedSection({ id: 'a', savedAt: 'x', section: { kind: 'text' } })).toBe(false);
  });
});

describe('uniqueLibraryName', () => {
  it('keeps a free name', () => {
    expect(uniqueLibraryName('Hero', ['Other'])).toBe('Hero');
  });

  it('numbers a collision', () => {
    expect(uniqueLibraryName('Hero', ['Hero'])).toBe('Hero 2');
    expect(uniqueLibraryName('Hero', ['Hero', 'Hero 2'])).toBe('Hero 3');
  });

  it('continues an existing suffix rather than stacking them', () => {
    // "Hero 2" saved again is "Hero 3", not "Hero 2 2".
    expect(uniqueLibraryName('Hero 2', ['Hero 2'])).toBe('Hero 3');
    expect(uniqueLibraryName('Hero 2', ['Hero 2', 'Hero 3'])).toBe('Hero 4');
  });

  it('falls back for a blank name', () => {
    expect(uniqueLibraryName('   ', [])).toBe('Saved section');
  });
});

describe('sortSaved', () => {
  it('puts the newest first without mutating the input', () => {
    const items = [
      { savedAt: '2026-08-20T10:00:00Z' },
      { savedAt: '2026-08-22T10:00:00Z' },
    ];
    expect(sortSaved(items)[0].savedAt).toBe('2026-08-22T10:00:00Z');
    expect(items[0].savedAt).toBe('2026-08-20T10:00:00Z');
  });
});

describe('toLibrarySummary', () => {
  it('drops the section body but keeps what the list shows', () => {
    const summary = toLibrarySummary(toSavedSection(source()));
    expect(summary).not.toHaveProperty('section');
    expect(summary.kind).toBe('text');
    expect(summary.name).toBe('Promo block');
  });
});
