/**
 * The org switcher in the top bar (LABEL-09, 07-information-architecture.md
 * §1). Pure: which entries it lists, where each goes, which one is current,
 * and whether it shows at all.
 *
 *  - Hidden when the user has exactly one org and nothing shared with them
 *    (14, LABEL-09 UX): the producer who never joins anything sees the top
 *    bar they always had. "Shared with me" is LABEL-21's; until then it is
 *    always empty.
 *  - The producer's own producer org IS the dashboard, so its entry goes to
 *    /library. Every other org goes to its shell, /o/<slug>.
 *  - The URL decides which org is current, never a stored choice: every
 *    request carries the org in its path and is re-authorised there, so a
 *    per-device "last org" would only be a second, stale answer.
 */
import type { OrgKind, Role } from './capabilities';

export type SwitcherOrg = { id: string; name: string; slug: string; kind: OrgKind; role: Role };
export type SharedProject = { id: string; name: string; href: string };

/** What `GET /api/org` answers. */
export type MyOrgsResponse = {
  orgs: (SwitcherOrg & { home: string })[];
  shared: SharedProject[];
};

export const DASHBOARD_HOME = '/library';

export const ORG_KIND_LABELS: Readonly<Record<OrgKind, string>> = { producer: 'Studio', label: 'Label', artist: 'Artist' };

export function orgHome(org: Pick<SwitcherOrg, 'slug' | 'kind' | 'role'>, isProducer: boolean): string {
  if (org.kind === 'producer' && org.role === 'owner' && isProducer) return DASHBOARD_HOME;
  return `/o/${org.slug}`;
}

export function shouldShowSwitcher(orgs: readonly unknown[], shared: readonly unknown[]): boolean {
  return orgs.length + shared.length > 1 || (orgs.length >= 1 && shared.length >= 1);
}

/** The slug in `/o/<slug>/…`, or null outside an org shell. */
export function orgSlugFromPath(pathname: string): string | null {
  const m = /^\/o\/([^/?#]+)/.exec(pathname);
  return m ? decodeURIComponent(m[1]) : null;
}

/**
 * The entry the switcher shows as current: the org in the URL inside a
 * shell; on the dashboard, the org whose home is the dashboard. Null when
 * neither (e.g. a shared project, LABEL-21).
 */
export function currentOrg<T extends { slug: string; home: string }>(orgs: readonly T[], pathname: string): T | null {
  const slug = orgSlugFromPath(pathname);
  if (slug) return orgs.find((o) => o.slug === slug) ?? null;
  return orgs.find((o) => o.home === DASHBOARD_HOME) ?? null;
}
