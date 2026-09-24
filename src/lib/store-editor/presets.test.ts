import { describe, expect, it } from 'vitest';
import { SECTION_PRESETS, sectionFromPreset } from './presets';
import { resolveSection, supportsSetting } from './layout';

describe('section presets', () => {
  it('each preset makes a valid, uniquely-identified section', () => {
    const a = sectionFromPreset(SECTION_PRESETS[0]);
    const b = sectionFromPreset(SECTION_PRESETS[0]);
    expect(a.id).not.toBe(b.id);
    expect(a.kind).toBe('text');
  });
  it('only sets style the section kind actually honours', () => {
    for (const preset of SECTION_PRESETS) {
      for (const key of Object.keys(preset.base ?? {})) {
        expect(supportsSetting(preset.kind, key as never), `${preset.id}.${key}`).toBe(true);
      }
    }
  });
  it('the banner preset carries its frame style', () => {
    const banner = sectionFromPreset(SECTION_PRESETS.find((p) => p.id === 'banner')!);
    expect(resolveSection(banner, 'desktop')).toMatchObject({ minHeight: 420, overlay: 40, width: 'full' });
  });
});
