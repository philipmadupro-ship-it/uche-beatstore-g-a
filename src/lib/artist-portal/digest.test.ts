import { describe, expect, it } from 'vitest';
import { buildPortalDigest } from './digest';

const base = { artistName: 'Artist #1', producerName: 'UCHE', portalUrl: 'https://app.test/artist/tok123' };

describe('buildPortalDigest', () => {
  it('lists what is new per project and links the permanent portal', () => {
    const out = buildPortalDigest({
      ...base,
      projects: [{ name: 'New EP', isNewProject: false, trackTitles: ['MIDNIGHT', 'NIGHT DRIVE', 'DAWN'] }],
    });
    expect(out.subject).toBe('UCHE: 3 new in your library');
    expect(out.itemCount).toBe(3);
    expect(out.text).toContain('New EP — 3 new tracks');
    expect(out.text).toContain('– MIDNIGHT');
    expect(out.html).toContain('https://app.test/artist/tok123');
  });

  it('names a single newly shared project in the subject', () => {
    expect(buildPortalDigest({ ...base, projects: [{ name: 'New EP', isNewProject: true, trackTitles: ['A', 'B'] }] }).subject)
      .toBe('UCHE shared New EP with you');
  });

  it('escapes everything a producer or title could inject', () => {
    const out = buildPortalDigest({
      ...base,
      message: '<script>x</script>',
      projects: [{ name: '<b>EP</b>', isNewProject: false, trackTitles: ['"><img src=x>'] }],
    });
    expect(out.html).not.toContain('<script>');
    expect(out.html).not.toContain('<b>EP</b>');
    expect(out.html).not.toContain('<img src=x>');
  });

  it('caps the titles per project', () => {
    const titles = Array.from({ length: 12 }, (_, i) => `T${i}`);
    const out = buildPortalDigest({ ...base, projects: [{ name: 'EP', isNewProject: false, trackTitles: titles }] });
    expect(out.text).toContain('and 4 more');
    expect(out.text).not.toContain('T9');
  });

  it('drops projects with nothing new', () => {
    const out = buildPortalDigest({ ...base, projects: [{ name: 'Quiet', isNewProject: false, trackTitles: [] }] });
    expect(out.itemCount).toBe(0);
    expect(out.text).not.toContain('Quiet');
  });
});
