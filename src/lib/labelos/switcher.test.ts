import { describe, expect, it } from 'vitest';
import { currentOrg, orgHome, orgSlugFromPath, shouldShowSwitcher } from './switcher';

describe('org switcher', () => {
  it('is hidden for one org and nothing shared, shown otherwise', () => {
    expect(shouldShowSwitcher([], [])).toBe(false);
    expect(shouldShowSwitcher([{}], [])).toBe(false);
    expect(shouldShowSwitcher([{}, {}], [])).toBe(true);
    expect(shouldShowSwitcher([{}], [{}])).toBe(true);
    expect(shouldShowSwitcher([], [{}])).toBe(false);
    expect(shouldShowSwitcher([], [{}, {}])).toBe(true);
  });

  it('the producer’s own producer org is the dashboard; every other org is its shell', () => {
    expect(orgHome({ slug: 'uche', kind: 'producer', role: 'owner' }, true)).toBe('/library');
    expect(orgHome({ slug: 'uche', kind: 'producer', role: 'owner' }, false)).toBe('/o/uche');
    expect(orgHome({ slug: 'uche', kind: 'producer', role: 'member' }, true)).toBe('/o/uche');
    expect(orgHome({ slug: 'ns', kind: 'label', role: 'owner' }, true)).toBe('/o/ns');
  });

  it('the URL decides the current org', () => {
    const orgs = [
      { slug: 'uche', home: '/library' },
      { slug: 'ns', home: '/o/ns' },
    ];
    expect(orgSlugFromPath('/o/ns/settings/members')).toBe('ns');
    expect(orgSlugFromPath('/o')).toBeNull();
    expect(orgSlugFromPath('/offline')).toBeNull();
    expect(currentOrg(orgs, '/o/ns')?.slug).toBe('ns');
    expect(currentOrg(orgs, '/library')?.slug).toBe('uche');
    expect(currentOrg(orgs, '/o/elsewhere')).toBeNull();
    // LABEL-21: a shared project is someone else's org — none of mine is current there.
    expect(currentOrg(orgs, '/shared')).toBeNull();
    expect(currentOrg(orgs, '/shared/9f1c')).toBeNull();
    expect(currentOrg(orgs, '/sharedx')?.slug).toBe('uche');
    expect(currentOrg([{ slug: 'ns', home: '/o/ns' }], '/library')).toBeNull();
  });
});
