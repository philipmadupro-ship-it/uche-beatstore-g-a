import {
  Home, Layers, ListMusic, Users, Calendar, Link2, Settings, Sliders,
  CloudOff, User, Store, ShoppingBag, Library, BarChart3, Send, Palette,
} from 'lucide-react';

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
