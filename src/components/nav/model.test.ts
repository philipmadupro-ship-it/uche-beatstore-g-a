import { describe, expect, it } from 'vitest';
import { ALL_CAPABILITIES } from '@/lib/labelos/capabilities';
import { NAV_GROUPS, activeGroupIn, navGroupsFor, type NavGroup } from './model';

/** Labels, hrefs and icon names: everything a hub renders. */
function shape(groups: NavGroup[]) {
  const name = (icon: NavGroup['icon']) =>
    (icon as { displayName?: string }).displayName ?? (icon as { render?: { displayName?: string } }).render?.displayName ?? '?';
  return groups.map((g) => ({
    key: g.key,
    label: g.label,
    icon: name(g.icon),
    items: g.items.map((it) => ({ label: it.label, href: it.href, icon: name(it.icon) })),
  }));
}

/**
 * The producer's hubs as they were before Label OS (LABEL-09 acceptance
 * criterion 1). If this fails, the producer's dashboard nav changed.
 */
const PRODUCER_HUBS = [
  {
    key: 'catalog',
    label: 'Catalog',
    icon: 'Library',
    items: [
      { label: 'Library', href: '/library', icon: 'House' },
      { label: 'Projects', href: '/projects', icon: 'Layers' },
      { label: 'Playlists', href: '/playlists', icon: 'ListMusic' },
      { label: 'Studio', href: '/studio', icon: 'SlidersVertical' },
      { label: 'Offline', href: '/offline', icon: 'CloudOff' },
    ],
  },
  {
    key: 'store',
    label: 'Store',
    icon: 'Store',
    items: [
      { label: 'Editor', href: '/store-editor', icon: 'Store' },
      { label: 'Cover Art', href: '/cover-art', icon: 'Palette' },
      { label: 'Sales', href: '/sales', icon: 'ShoppingBag' },
      { label: 'Analytics', href: '/analytics', icon: 'ChartColumn' },
    ],
  },
  {
    key: 'crm',
    label: 'CRM',
    icon: 'Users',
    items: [
      { label: 'Contacts', href: '/contacts', icon: 'Users' },
      { label: 'Campaigns', href: '/campaigns', icon: 'Send' },
      { label: 'Calendar', href: '/calendar', icon: 'Calendar' },
      { label: 'Links', href: '/links', icon: 'Link2' },
    ],
  },
];

describe('navGroupsFor', () => {
  it('the producer dashboard renders exactly the hubs it always had', () => {
    expect(shape(NAV_GROUPS)).toEqual(PRODUCER_HUBS);
    // The dashboard (no org shell) gets the very same objects, whatever the
    // capabilities say: nothing about it depends on Label OS.
    expect(navGroupsFor('producer', null)).toBe(NAV_GROUPS);
    expect(navGroupsFor('producer', new Set(ALL_CAPABILITIES))).toBe(NAV_GROUPS);
    expect(navGroupsFor('producer', new Set())).toBe(NAV_GROUPS);
  });

  it('a producer org opened by its producer: the same hubs, then the org’s own', () => {
    const groups = navGroupsFor('producer', new Set(ALL_CAPABILITIES), { slug: 'uche', viewerIsProducer: true });
    expect(shape(groups.slice(0, 3))).toEqual(PRODUCER_HUBS);
    expect(shape(groups.slice(3))).toEqual([
      { key: 'org', label: 'Organization', icon: 'Building2', items: [{ label: 'Members', href: '/o/uche/settings/members', icon: 'UsersRound' }] },
    ]);
  });

  it('a producer org opened by a member who is not the producer: only the org’s own pages', () => {
    // The producer hubs are producer-only routes (/library …); a member would bounce.
    const groups = navGroupsFor('producer', new Set(['catalog.read']), { slug: 'uche', viewerIsProducer: false });
    expect(groups.map((g) => g.key)).toEqual(['org']);
  });

  it('a label org lists the pages that exist for it, under its slug', () => {
    const groups = navGroupsFor('label', new Set(['catalog.read']), { slug: 'night-shift', viewerIsProducer: true });
    expect(shape(groups)).toEqual([
      { key: 'roster', label: 'Artists', icon: 'MicVocal', items: [{ label: 'Artists', href: '/o/night-shift/artists', icon: 'MicVocal' }] },
      { key: 'org', label: 'Organization', icon: 'Building2', items: [{ label: 'Members', href: '/o/night-shift/settings/members', icon: 'UsersRound' }] },
    ]);
  });

  it('the A&R inbox entry is for members who can review (LABEL-25), and only there', () => {
    const items = (caps: string[]) => navGroupsFor('label', new Set(caps), { slug: 'ns', viewerIsProducer: false }).find((g) => g.key === 'roster')?.items.map((i) => i.href);
    expect(items(['catalog.read', 'review.write'])).toEqual(['/o/ns/artists', '/o/ns/ar']);
    expect(items(['catalog.read', 'review.comment'])).toEqual(['/o/ns/artists']);
    expect(items(['catalog.read'])).toEqual(['/o/ns/artists']);
  });

  it('the Artists hub needs catalog.read, and is for label and artist orgs only (LABEL-10)', () => {
    expect(navGroupsFor('label', new Set(), { slug: 'ns', viewerIsProducer: false }).map((g) => g.key)).toEqual(['org']);
    expect(navGroupsFor('artist', new Set(['catalog.read']), { slug: 'nova', viewerIsProducer: false }).map((g) => g.key)).toEqual(['roster', 'org']);
    const producer = navGroupsFor('producer', new Set(ALL_CAPABILITIES), { slug: 'uche', viewerIsProducer: true });
    expect(producer.map((g) => g.key)).not.toContain('roster');
  });

  it('an org without its slug, or of an unknown kind, has nothing to link to', () => {
    expect(navGroupsFor('label', new Set(ALL_CAPABILITIES))).toEqual([]);
    expect(navGroupsFor('agency', new Set(ALL_CAPABILITIES), { slug: 'x', viewerIsProducer: true })).toEqual([]);
  });

  it('activeGroupIn finds the group of the current page, else the first', () => {
    const groups = navGroupsFor('label', new Set(), { slug: 'ns', viewerIsProducer: false });
    expect(activeGroupIn(groups, '/o/ns/settings/members')?.key).toBe('org');
    expect(activeGroupIn(groups, '/elsewhere')?.key).toBe('org');
    expect(activeGroupIn([], '/x')).toBeUndefined();
  });
});
