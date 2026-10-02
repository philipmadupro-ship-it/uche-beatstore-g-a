import {
  Home, Layers, ListMusic, Users, Calendar, Link2, Settings, Sliders,
  CloudOff, User, Store, ShoppingBag, Library, BarChart3, Send, Palette,
  Building2, UsersRound, Mic2,
} from 'lucide-react';
import { ORG_KINDS, type Capability } from '@/lib/labelos/capabilities';

/**
 * Navigation model — Spotify-style hubs.
 *
 * The 12+ dashboard surfaces are grouped into 3 primary HUBS (Catalog / Store
 * / CRM) plus an Account group reached via the avatar. Routes are unchanged —
 * this is purely how the nav is presented.
 *
 * Lives in its own module because both the top bar and the secondary nav
 * panel render from it. Two copies of this list would drift the moment a
 * surface is added, and the symptom — a page reachable from one nav but not
 * the other — is the kind you only notice by accident.
 */
export interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
}

export interface NavGroup {
  key: string;
  label: string;
  icon: NavItem['icon'];
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    key: 'catalog', label: 'Catalog', icon: Library,
    items: [
      { label: 'Library', href: '/library', icon: Home },
      { label: 'Projects', href: '/projects', icon: Layers },
      { label: 'Playlists', href: '/playlists', icon: ListMusic },
      { label: 'Studio', href: '/studio', icon: Sliders },
      { label: 'Offline', href: '/offline', icon: CloudOff },
    ],
  },
  {
    key: 'store', label: 'Store', icon: Store,
    items: [
      { label: 'Editor', href: '/store-editor', icon: Store },
      { label: 'Cover Art', href: '/cover-art', icon: Palette },
      { label: 'Sales', href: '/sales', icon: ShoppingBag },
      { label: 'Analytics', href: '/analytics', icon: BarChart3 },
    ],
  },
  {
    key: 'crm', label: 'CRM', icon: Users,
    items: [
      { label: 'Contacts', href: '/contacts', icon: Users },
      { label: 'Campaigns', href: '/campaigns', icon: Send },
      { label: 'Calendar', href: '/calendar', icon: Calendar },
      { label: 'Links', href: '/links', icon: Link2 },
    ],
  },
];

// Reached via the avatar rather than as a primary hub, but still a real group
// so the panel stays populated on /profile and /settings.
export const ACCOUNT_GROUP: NavGroup = {
  key: 'account', label: 'Account', icon: User,
  items: [
    { label: 'Profile', href: '/profile', icon: User },
    { label: 'Settings', href: '/settings', icon: Settings },
  ],
};

export const ALL_GROUPS = [...NAV_GROUPS, ACCOUNT_GROUP];

export function isItemActive(href: string, pathname: string): boolean {
  return pathname === href || pathname.startsWith(href + '/');
}

export function activeGroupFor(pathname: string): NavGroup {
  return ALL_GROUPS.find((g) => g.items.some((it) => isItemActive(it.href, pathname))) ?? NAV_GROUPS[0];
}

/** The group of the current page among `groups`, else the first (undefined when empty). */
export function activeGroupIn(groups: readonly NavGroup[], pathname: string): NavGroup | undefined {
  return groups.find((g) => g.items.some((it) => isItemActive(it.href, pathname))) ?? groups[0];
}

// ── Label OS (LABEL-09) ─────────────────────────────────────────────────

/** The org shell a nav is rendered in (`/o/<slug>/…`). */
export interface OrgNavContext {
  slug: string;
  /**
   * The viewer is the producer, i.e. may use the producer dashboard routes
   * (/library …). Those routes stay producer-only (06 §3.3), so a member of
   * a producer org who is not the producer is never shown links that bounce.
   */
  viewerIsProducer: boolean;
}

/**
 * The pages every org has, under its slug. Every member can see who is in
 * their org (136's RLS lets them read co-members), so Members is not gated.
 */
function orgGroup(slug: string): NavGroup {
  const base = `/o/${slug}`;
  return {
    key: 'org', label: 'Organization', icon: Building2,
    items: [{ label: 'Members', href: `${base}/settings/members`, icon: UsersRound }],
  };
}

/**
 * The roster hub (LABEL-10): the org's artists, which are its contacts
 * (17 R3). Label and artist orgs only — a producer org's people are the
 * producer's CRM, which the producer hubs already reach — and only for a
 * member who can see the catalogue (the page's own capability).
 */
function rosterGroup(slug: string): NavGroup {
  return {
    key: 'roster', label: 'Artists', icon: Mic2,
    items: [{ label: 'Artists', href: `/o/${slug}/artists`, icon: Mic2 }],
  };
}

/**
 * The hubs for an org context (07-information-architecture.md §1). One model,
 * one function, so the top bar and the org shell cannot drift.
 *
 * - The producer's dashboard (no org shell): `NAV_GROUPS`, the same objects as
 *   before Label OS, whatever the capabilities. The producer's personal org
 *   IS that dashboard.
 * - Inside an org shell: a producer org shows the producer hubs to its
 *   producer, then the org's own pages; a label or artist org shows the pages
 *   that exist for it: Artists (LABEL-10, catalog.read), then the org's own
 *   pages. The IA's other label hubs (Overview, Releases, A&R, Rights) are
 *   added here by the tasks that build those pages (LABEL-17, 18, 24, 29,
 *   31), each gated on its capability in `caps`; a hub that pointed at a
 *   page not yet built would be a dead link.
 * - Anything unknown: no hubs.
 */
export function navGroupsFor(
  orgKind: string,
  caps: ReadonlySet<Capability | string> | null,
  org?: OrgNavContext,
): NavGroup[] {
  if (!(ORG_KINDS as readonly string[]).includes(orgKind)) return [];
  if (!org) return orgKind === 'producer' ? NAV_GROUPS : [];
  const producerHubs = orgKind === 'producer' && org.viewerIsProducer ? NAV_GROUPS : [];
  const roster = orgKind !== 'producer' && caps?.has('catalog.read') ? [rosterGroup(org.slug)] : [];
  return [...producerHubs, ...roster, orgGroup(org.slug)];
}
