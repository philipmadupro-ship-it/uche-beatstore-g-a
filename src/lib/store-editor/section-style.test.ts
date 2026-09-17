import { describe, expect, it } from 'vitest';
import {
  applySectionStyle, copySectionStyle, describeStyle, styleAppliesTo,
} from './section-style';
import {
  createSection, resolveSection, sectionCapabilities, setSectionSetting,
} from './layout';

const styled = () => {
  let section = createSection('text', 'Source', {
    spacing: 7, width: 'narrow', align: 'center', columns: 3,
  });
  section = setSectionSetting(section, 'mobile', 'spacing', 2);
  section = setSectionSetting(section, 'tablet', 'columns', 2);
  return section;
};

describe('copySectionStyle', () => {
  it('lifts the presentation keys off the base', () => {
    const style = copySectionStyle(styled());
    expect(style.base).toMatchObject({ spacing: 7, width: 'narrow', align: 'center', columns: 3 });
  });

  it('carries breakpoint overrides', () => {
    const style = copySectionStyle(styled());
    expect(style.overrides.mobile).toEqual({ spacing: 2 });
    expect(style.overrides.tablet).toEqual({ columns: 2 });
  });

  it('NEVER carries visibility', () => {
    // Pasting a style must not make a section disappear. Whether a section is
    // present is a different question from how it looks.
    let section = styled();
    section = setSectionSetting(section, 'mobile', 'visible', false);
    section = setSectionSetting(section, 'desktop', 'visible', false);
    const style = copySectionStyle(section);
    expect(style.base).not.toHaveProperty('visible');
    expect(style.overrides.mobile).not.toHaveProperty('visible');
  });

  it('drops a breakpoint whose only override was visibility', () => {
    let section = createSection('text');
    section = setSectionSetting(section, 'mobile', 'visible', false);
    expect(copySectionStyle(section).overrides.mobile).toBeUndefined();
  });

  it('records where it came from, for the paste label', () => {
    const style = copySectionStyle(styled());
    expect(style.fromName).toBe('Source');
    expect(style.fromKind).toBe('text');
    expect(describeStyle(style)).toBe('Paste style from Source');
  });
});

describe('applySectionStyle', () => {
  it('applies the style to a target of the same kind', () => {
    const style = copySectionStyle(styled());
    const target = applySectionStyle(createSection('text', 'Target'), style);
    expect(resolveSection(target, 'desktop')).toMatchObject({
      spacing: 7, width: 'narrow', align: 'center', columns: 3,
    });
    expect(resolveSection(target, 'mobile').spacing).toBe(2);
  });

  it('keeps only what the TARGET honours', () => {
    // Copying from a text block onto a hero must not write a column count the
    // hero's renderer ignores — that is a value the storefront silently
    // disagrees with, the exact fake-control failure capabilities prevent.
    const style = copySectionStyle(styled());
    const hero = applySectionStyle(createSection('hero', 'Hero'), style);
    const allowed = sectionCapabilities('hero');
    expect(allowed).not.toContain('columns');
    expect(hero.base.columns).toBe(createSection('hero').base.columns);
    expect(hero.base.spacing).toBe(createSection('hero').base.spacing);
    // `variant` IS supported by hero, so a variant in the style would land —
    // but the source is a text block, which carries the default.
    expect(allowed).toContain('variant');
  });

  it('is a no-op on a target that honours nothing stylable', () => {
    const style = copySectionStyle(styled());
    const trust = createSection('trust', 'Trust');
    // countdown/trust/etc expose visibility only, and visibility is not style.
    expect(applySectionStyle(trust, style)).toBe(trust);
  });

  it('never changes the target’s visibility', () => {
    let source = styled();
    source = setSectionSetting(source, 'mobile', 'visible', false);
    let target = createSection('text', 'Target');
    target = setSectionSetting(target, 'mobile', 'visible', true);
    const pasted = applySectionStyle(target, copySectionStyle(source));
    expect(resolveSection(pasted, 'mobile').visible).toBe(true);
  });

  it('leaves a breakpoint tweak the style says nothing about', () => {
    // Replacing the overrides wholesale would wipe an alignment the target had
    // on tablet just because the style only mentioned spacing.
    let target = createSection('text', 'Target');
    target = setSectionSetting(target, 'tablet', 'align', 'right');
    let source = createSection('text', 'Source');
    source = setSectionSetting(source, 'tablet', 'spacing', 5);

    const pasted = applySectionStyle(target, copySectionStyle(source));
    expect(resolveSection(pasted, 'tablet').align).toBe('right');
    expect(resolveSection(pasted, 'tablet').spacing).toBe(5);
  });

  it('keeps the target’s own identity', () => {
    const target = createSection('text', 'Target');
    const pasted = applySectionStyle(target, copySectionStyle(styled()));
    expect(pasted.id).toBe(target.id);
    expect(pasted.name).toBe('Target');
    expect(pasted.kind).toBe('text');
  });

  it('does not mutate the target', () => {
    const target = createSection('text', 'Target');
    const before = JSON.stringify(target);
    applySectionStyle(target, copySectionStyle(styled()));
    expect(JSON.stringify(target)).toBe(before);
  });

  it('round-trips: copying then pasting onto a clone changes nothing', () => {
    const source = styled();
    const clone = { ...source, id: 'other' };
    const pasted = applySectionStyle(clone, copySectionStyle(source));
    expect(resolveSection(pasted, 'desktop')).toEqual(resolveSection(source, 'desktop'));
    expect(resolveSection(pasted, 'mobile')).toEqual(resolveSection(source, 'mobile'));
  });
});

describe('styleAppliesTo', () => {
  it('is true when the target can take something from the style', () => {
    expect(styleAppliesTo(createSection('text'), copySectionStyle(styled()))).toBe(true);
  });

  it('is false for a target that honours nothing stylable', () => {
    expect(styleAppliesTo(createSection('trust'), copySectionStyle(styled()))).toBe(false);
    expect(styleAppliesTo(createSection('spotlight'), copySectionStyle(styled()))).toBe(false);
  });

  it('is false for a style that carries nothing the target wants', () => {
    // A hero style carries only `variant`; a catalog also supports variant, so
    // use a source whose only stylable key the target lacks.
    const source = createSection('text', 'Source', { columns: 5 });
    const style = { ...copySectionStyle(source), base: { columns: 5 } };
    expect(styleAppliesTo(createSection('hero'), style)).toBe(false);
  });
});
