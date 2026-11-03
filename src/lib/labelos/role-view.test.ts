import { describe, expect, it } from 'vitest';
import { capabilitiesFor } from './capabilities';
import { ORG_PAGES, homeTiles, pageAllowed, roleViewFor, type ViewInput } from './role-view';
import { navGroupsFor } from '@/components/nav/model';

type Persona = { name: string; kind: 'artist' | 'label'; role: string; fns?: string[] };

/** The G10-style matrix: every role × face. */
const PERSONAS: Persona[] = [
  { name: 'independent owner', kind: 'artist', role: 'owner' },
  { name: 'independent admin', kind: 'artist', role: 'admin' },
  { name: 'independent manager', kind: 'artist', role: 'member', fns: ['artist_manager'] },
  { name: 'label owner', kind: 'label', role: 'owner' },
  { name: 'label admin', kind: 'label', role: 'admin' },
  { name: 'label A&R', kind: 'label', role: 'member', fns: ['a_and_r'] },
  { name: 'label finance', kind: 'label', role: 'member', fns: ['finance'] },
  { name: 'label marketing', kind: 'label', role: 'member', fns: ['marketing'] },
  { name: 'label legal', kind: 'label', role: 'member', fns: ['legal'] },
  { name: 'label producer', kind: 'label', role: 'member', fns: ['producer'] },
  { name: 'label executive', kind: 'label', role: 'member', fns: ['executive'] },
  { name: 'roster artist', kind: 'label', role: 'artist' },
];

function input(p: Persona, modules?: string[]): ViewInput {
  return { kind: p.kind, role: p.role, capabilities: new Set(capabilitiesFor(p.kind, p.role, p.fns ?? [])), modules };
}

/** What each persona may open. A page not listed is a 404. */
const EXPECT: Record<string, string[]> = {
  'independent owner': ['artists', 'music', 'releases', 'parties', 'contracts', 'earnings', 'store_listings', 'connections'],
  'independent admin': ['artists', 'music', 'releases', 'parties', 'contracts', 'earnings', 'store_listings', 'connections'],
  'independent manager': ['artists', 'music', 'releases', 'parties', 'contracts', 'store_listings'],
  'label owner': ['artists', 'music', 'ar', 'releases', 'parties', 'contracts', 'legal', 'earnings', 'store_listings', 'connections'],
  'label admin': ['artists', 'music', 'ar', 'releases', 'parties', 'contracts', 'legal', 'earnings', 'store_listings', 'connections'],
  'label A&R': ['artists', 'music', 'ar', 'releases', 'parties', 'contracts', 'store_listings'],
  'label finance': ['artists', 'music', 'ar', 'releases', 'parties', 'earnings', 'store_listings'],
  'label marketing': ['artists', 'music', 'ar', 'releases', 'store_listings'],
  'label legal': ['artists', 'music', 'ar', 'releases', 'parties', 'contracts', 'legal', 'store_listings'],
  'label producer': ['artists', 'music', 'ar', 'releases', 'parties', 'contracts', 'store_listings'],
  'label executive': ['artists', 'music', 'ar', 'releases', 'parties', 'contracts', 'earnings', 'store_listings'],
  'roster artist': ['artists', 'music', 'releases', 'parties', 'contracts', 'store_listings'],
};

describe('persona matrix: pageAllowed (role × face)', () => {
  for (const p of PERSONAS) {
    it(`${p.name}: opens exactly its pages, every other page is a 404`, () => {
      const open = ORG_PAGES.filter((pg) => pageAllowed(pg, input(p)));
      const want = (EXPECT[p.name] ?? []).slice().sort();
      expect(open.filter((x) => x !== 'overview' && x !== 'members').sort()).toEqual(want);
      // Independent artists have no roster to triage: the label's A&R queue is not theirs.
      if (p.kind === 'artist') expect(open).not.toContain('ar');
    });
  }

  it('a module the org is not licensed for closes its pages whatever the role', () => {
    const owner = PERSONAS[3];
    expect(pageAllowed('earnings', input(owner, ['catalog']))).toBe(false);
    expect(pageAllowed('contracts', input(owner, ['catalog']))).toBe(false);
    expect(pageAllowed('legal', input(owner, ['catalog']))).toBe(false);
  });

  it('a producer org has none of the label pages; unknown kind or role opens nothing', () => {
    const caps = new Set(capabilitiesFor('producer', 'owner', []));
    for (const pg of ORG_PAGES) if (!['members', 'overview', 'store_listings'].includes(pg)) expect(pageAllowed(pg, { kind: 'producer', role: 'owner', capabilities: caps })).toBe(false);
    for (const pg of ORG_PAGES) if (pg !== 'overview' && pg !== 'members') expect(pageAllowed(pg, { kind: 'nope', role: 'owner', capabilities: new Set() })).toBe(false);
  });
});

describe('roleViewFor', () => {
  it('names the view each persona gets', () => {
    const view = (n: string) => roleViewFor(input(PERSONAS.find((p) => p.name === n)!));
    expect(view('independent owner')).toBe('independent');
    expect(view('independent manager')).toBe('independent');
    expect(view('label owner')).toBe('label');
    expect(view('label finance')).toBe('department');
    expect(view('roster artist')).toBe('roster_artist');
    expect(roleViewFor({ kind: 'producer', role: 'owner', capabilities: new Set() })).toBe('producer');
  });
});

describe('nav is a subset of the pages a persona may open', () => {
  const hrefToPage = (slug: string, href: string) => {
    const rest = href.replace(`/o/${slug}`, '');
    const map: Record<string, string> = {
      '/artists': 'artists', '/music': 'music', '/ar': 'ar', '/releases': 'releases', '/rights/parties': 'parties',
      '/rights/contracts': 'contracts', '/rights/legal': 'legal', '/finance/earnings': 'earnings', '/releases/store': 'store_listings',
      '/settings/connections': 'connections',
    };
    return map[rest] ?? null;
  };
  for (const p of PERSONAS) {
    it(`${p.name}: no nav entry leads to a 404`, () => {
      const i = input(p);
      const groups = navGroupsFor(p.kind, i.capabilities, { slug: 's', viewerIsProducer: false, role: p.role, isOwner: p.role === 'owner' });
      for (const it of groups.flatMap((g) => g.items)) {
        const page = hrefToPage('s', it.href);
        if (page) expect(pageAllowed(page as never, i), `${it.href}`).toBe(true);
      }
    });
  }
});

describe('artist-org owners lose the label wording', () => {
  it('no A&R inbox, no Legal queue, no "Artists" roster group', () => {
    const owner = PERSONAS[0];
    const i = input(owner);
    const groups = navGroupsFor('artist', i.capabilities, { slug: 's', viewerIsProducer: false, role: 'owner', isOwner: true });
    const labels = groups.flatMap((g) => g.items.map((x) => x.label));
    expect(labels).not.toContain('A&R inbox');
    expect(labels).not.toContain('Legal queue');
    expect(groups.find((g) => g.key === 'roster')?.label).toBe('My music');
  });
  it('the label shell is unchanged', () => {
    const i = input(PERSONAS[3]);
    const groups = navGroupsFor('label', i.capabilities, { slug: 's', viewerIsProducer: false, role: 'owner', isOwner: true });
    expect(groups.find((g) => g.key === 'roster')?.label).toBe('Artists');
    expect(groups.flatMap((g) => g.items.map((x) => x.label))).toEqual(expect.arrayContaining(['A&R inbox', 'Legal queue']));
  });
  it('a roster artist gets "My music"', () => {
    const i = input(PERSONAS[11]);
    const groups = navGroupsFor('label', i.capabilities, { slug: 's', viewerIsProducer: false, role: 'artist' });
    expect(groups.find((g) => g.key === 'roster')?.label).toBe('My music');
    expect(groups.flatMap((g) => g.items.map((x) => x.label))).not.toContain('A&R inbox');
  });
});

describe('home tiles never point where the persona cannot go', () => {
  for (const p of PERSONAS) {
    it(`${p.name}: every tile is an allowed page`, () => {
      const i = input(p);
      for (const t of homeTiles('s', i)) expect(pageAllowed(t.page, i), t.label).toBe(true);
    });
  }
  it('the independent home says my music / releases / money / contracts', () => {
    expect(homeTiles('s', input(PERSONAS[0])).map((t) => t.label)).toEqual(['My music', 'My releases', 'My money', 'My contracts']);
  });
  it('a roster artist home has no money tile (statements are not built) and a label has no tiles', () => {
    expect(homeTiles('s', input(PERSONAS[11])).map((t) => t.label)).toEqual(['My music', 'My releases', 'My contracts']);
    expect(homeTiles('s', input(PERSONAS[3]))).toEqual([]);
  });
});
