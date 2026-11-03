/**
 * Role views (LABEL-70): which pages and which home an org member gets,
 * decided by ONE table from the org's face (its kind), the member's role,
 * their capabilities and the modules the org is licensed for.
 *
 * Pure, and fail-closed: an unknown kind or role opens nothing. The nav
 * (`components/nav/model.ts`), the page guards that differ by face, and the
 * home tiles all ask `pageAllowed`, so an entry can never point at a page that
 * answers 404 for that person — the persona-matrix test holds them together.
 *
 * Faces (doc 22 §8, LABEL-47): the `artist` kind is the independent artist /
 * producer; the `label` kind is the label. A label's roster artist is role
 * `artist`; a label's staff are owner / admin / member (departments come from
 * functions, i.e. capabilities).
 */
import { canSeeLegalQueue } from './legal-queue';
import { canSeeParties } from './parties-view';
import { canSeeContracts } from './contracts-nav';

export type RoleView = 'independent' | 'label' | 'department' | 'roster_artist' | 'producer';

export type ViewInput = {
  kind: string;
  role: string;
  capabilities: ReadonlySet<string>;
  /** Licensed modules; absent = the default licence (every module). */
  modules?: ReadonlySet<string> | readonly string[];
};

export const ORG_PAGES = [
  'overview', 'members', 'artists', 'music', 'ar', 'releases', 'parties', 'contracts', 'legal', 'earnings', 'store_listings', 'connections',
] as const;
export type OrgPage = (typeof ORG_PAGES)[number];

/** Where each page lives under `/o/<slug>`. */
export const PAGE_PATH: Readonly<Record<OrgPage, string>> = {
  overview: '',
  members: '/settings/members',
  artists: '/artists',
  music: '/music',
  ar: '/ar',
  releases: '/releases',
  parties: '/rights/parties',
  contracts: '/rights/contracts',
  legal: '/rights/legal',
  earnings: '/finance/earnings',
  store_listings: '/releases/store',
  connections: '/settings/connections',
};

const FACES = ['artist', 'label'];

function licensed(modules: ViewInput['modules'], module: string): boolean {
  if (!modules) return true;
  return Array.isArray(modules) ? modules.includes(module) : (modules as ReadonlySet<string>).has(module);
}

export function roleViewFor(i: ViewInput): RoleView | null {
  if (i.kind === 'producer') return 'producer';
  if (i.kind === 'artist') return 'independent';
  if (i.kind === 'label') {
    if (i.role === 'artist') return 'roster_artist';
    return i.role === 'member' ? 'department' : 'label';
  }
  return null;
}

/** May this person open this page? `false` is a 404 (settings may explain instead). */
export function pageAllowed(page: OrgPage, i: ViewInput): boolean {
  const known = i.kind === 'producer' || FACES.includes(i.kind);
  if (!known) return false;
  const caps = i.capabilities;
  const face = FACES.includes(i.kind);
  switch (page) {
    case 'overview':
    case 'members':
      return true;
    // Every member may open it (it shows each of them only what is theirs); owner/admin acts are the route's own rule.
    case 'store_listings':
      return licensed(i.modules, 'store');
    case 'artists':
    case 'music':
    case 'releases':
      return face && caps.has('catalog.read');
    // The reviewers' queue is a label's tool: an independent artist has no roster to triage.
    // A roster artist reads the reviews of their own songs on the song page (doc 21 §5.2 #18: pages are 404).
    case 'ar':
      return i.kind === 'label' && i.role !== 'artist' && caps.has('catalog.read');
    case 'parties':
      return face && canSeeParties(caps);
    case 'contracts':
      return face && canSeeContracts(caps) && licensed(i.modules, 'contracts');
    case 'legal':
      return i.kind === 'label' && canSeeLegalQueue(caps) && licensed(i.modules, 'contracts');
    case 'earnings':
      return face && i.role !== 'artist' && caps.has('finance.read') && licensed(i.modules, 'finance');
    case 'connections':
      return face && caps.has('org.manage');
  }
}

export type HomeTile = { page: OrgPage; label: string; href: string; hint: string };

const TILES: ReadonlyArray<{ page: OrgPage; label: string; hint: string }> = [
  { page: 'music', label: 'My music', hint: 'Your songs, demos and masters' },
  { page: 'releases', label: 'My releases', hint: 'What is out and what is coming' },
  { page: 'earnings', label: 'My money', hint: 'Earnings and what you are owed' },
  { page: 'contracts', label: 'My contracts', hint: 'What you have signed and what waits for you' },
];

/**
 * The tiles of the artist-shaped homes (the independent artist / producer and
 * the label's roster artist). A tile is only a link, drawn only for a page the
 * person can open: it carries no count or title of its own, so it cannot show
 * what they could not open themselves. Label staff and the producer keep the
 * Overview they have.
 */
export function homeTiles(slug: string, i: ViewInput): HomeTile[] {
  const view = roleViewFor(i);
  if (view !== 'independent' && view !== 'roster_artist') return [];
  return TILES.filter((t) => pageAllowed(t.page, i)).map((t) => ({ ...t, href: `/o/${slug}${PAGE_PATH[t.page]}` }));
}

/** A page's view of the shell it was resolved from (`orgShellFor`): the same input the nav and the tiles use. */
export function viewInputOf(shell: { org: { kind: string }; role: string; capabilities: readonly string[]; modules?: readonly string[] }): ViewInput {
  return { kind: shell.org.kind, role: shell.role, capabilities: new Set(shell.capabilities), modules: shell.modules };
}
