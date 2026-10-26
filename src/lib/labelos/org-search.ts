/**
 * Org search (LABEL-36, 08 §A3): the pure half — how a typed query becomes a
 * safe tsquery, when it is an identifier that jumps straight to an object,
 * and how hits are ranked, capped and grouped. The reads and the scope / D4
 * filtering are `org-search-store.ts`; the route is `GET /api/org/[orgId]/search`.
 *
 * The query never reaches PostgREST or Postgres as typed. It is reduced to
 * words (letters, combining marks and digits of any script — nothing else
 * survives, so no
 * tsquery operator, quote, comma or parenthesis can be smuggled in), each
 * word becomes a prefix term, and the terms are ANDed: `runn hom` is
 * `runn:* & hom:*`, the shape that makes search-as-you-type work with the
 * `simple` configuration (no stemming: "Runnin" is "Runnin").
 *
 * No count anywhere: a result says what it is, never how many others exist
 * or were left out (a hidden-row count is a leak, 06 §2.5 / D4).
 */
import { normalizeIpi, normalizeIsrc, normalizeIswc, normalizeUpc, type IdentifierKind } from './identifiers';

/** The longest query read; the rest is ignored. */
export const MAX_QUERY_CHARS = 100;
/** The most words searched; a longer query is trimmed to its first words. */
export const MAX_QUERY_TERMS = 6;
/** The longest single word (a longer one is cut — it cannot be a name or title word). */
export const MAX_TERM_CHARS = 40;
/** Hits returned per group. */
export const HITS_PER_GROUP = 6;
/** Rows read per table before the scope / D4 filter runs; never raised by a request. */
export const CANDIDATES_PER_TABLE = 40;
/**
 * Further pages read per table when a page held too few rows the caller may
 * see (LABEL-45, G8 F3). Every source's first page is always read; this caps
 * what comes after, so a query is at most `1 + MAX_EXTRA_PAGES` reads of
 * `CANDIDATES_PER_TABLE` rows per source however much of the table is hidden.
 */
export const MAX_EXTRA_PAGES = 5;

/** Group order = display order (08 §A3: Artists · Songs · Releases · People · Projects; Files last). */
export const SEARCH_GROUPS = ['artists', 'songs', 'releases', 'people', 'projects', 'files'] as const;
export type SearchGroup = (typeof SEARCH_GROUPS)[number];

export const SEARCH_GROUP_LABEL: Record<SearchGroup, string> = {
  artists: 'Artists',
  songs: 'Songs',
  releases: 'Releases',
  people: 'People',
  projects: 'Projects',
  files: 'Files',
};

export type SearchHit = {
  group: SearchGroup;
  id: string;
  title: string;
  /** One short line (stage, state, kind); never a count, never an email. */
  sub: string | null;
  /** The project a file or a recording belongs to, for the link. */
  projectId?: string | null;
};

export type SearchGroupResult = { group: SearchGroup; hits: SearchHit[] };

export type OrgSearchResult = {
  /** An identifier query that matched an object the caller may open: go there. */
  jump: SearchHit | null;
  groups: SearchGroupResult[];
};

export const EMPTY_SEARCH: OrgSearchResult = Object.freeze({ jump: null, groups: [] }) as OrgSearchResult;

// ── Query ───────────────────────────────────────────────────────────────

export type ParsedQuery = {
  /** The cleaned text, for ranking and display. */
  text: string;
  /** Lower-cased words, at most MAX_QUERY_TERMS. */
  terms: string[];
  /** The tsquery to send (`a:* & b:*`), or null when there is nothing to search. */
  tsquery: string | null;
};

/**
 * A word is letters, digits and the combining marks that belong to them: Hindi
 * vowel signs and the virama, Thai tone and vowel marks, an accent written as
 * a separate code point (\p{M}). A word starts on a letter or digit, so a stray
 * mark is not one. Without \p{M} 'हिन्दी' broke into 'हिन' + 'दी'.
 * The index side is the same rule: migration 168 turns `_ . - @ /` into spaces
 * and Postgres' `simple` parser keeps the rest of a word together.
 */
const WORD = /[\p{L}\p{N}][\p{L}\p{M}\p{N}]*/gu;

export function parseSearchQuery(raw: unknown): ParsedQuery {
  const text = typeof raw === 'string' ? raw.normalize('NFKC').slice(0, MAX_QUERY_CHARS) : '';
  const terms = (text.match(WORD) ?? [])
    .map((w) => w.toLowerCase().slice(0, MAX_TERM_CHARS))
    .slice(0, MAX_QUERY_TERMS);
  return {
    text: terms.join(' '),
    terms,
    // Every term is letters / digits only, so this string holds no operator but ours.
    tsquery: terms.length > 0 ? terms.map((t) => `${t}:*`).join(' & ') : null,
  };
}

// ── Paging past hidden rows (LABEL-45, G8 F3) ───────────────────────────

/** One page of candidate rows, `from`..`to` inclusive, in a stable order (the caller orders by a unique key). */
export type PageSource<Row> = (from: number, to: number) => Promise<Row[]>;

/**
 * Collect the hits a caller may see, paging a source until `enough` or it runs
 * out. Reading a fixed 40 candidates and filtering afterwards starved a
 * member who may see few of a common word's matches (the other 40 sorted
 * first and were all hidden); here a page that yields too little just asks
 * for the next one.
 *
 * Bounded, and nothing a caller could rely on is skipped: the FIRST page of
 * every source is always read (a scope split into id chunks loses no chunk,
 * and a single source's first page is ranked whole, as before); a source goes
 * on to further pages only while `enough` does not hold and `maxExtraPages`
 * lasts in total; a short page ends its source. `keep` is the scope / D4
 * filter; whatever it drops is dropped without trace (no count of the hidden
 * anywhere).
 */
export async function collectVisible<Row, Hit>(
  sources: readonly PageSource<Row>[],
  keep: (rows: Row[]) => Promise<Hit[]>,
  enough: (hits: readonly Hit[]) => boolean,
  opts: { pageSize?: number; maxExtraPages?: number } = {},
): Promise<Hit[]> {
  const pageSize = opts.pageSize ?? CANDIDATES_PER_TABLE;
  let extra = opts.maxExtraPages ?? MAX_EXTRA_PAGES;
  const hits: Hit[] = [];
  for (const read of sources) {
    for (let page = 0; ; page += 1) {
      if (page > 0) {
        if (enough(hits) || extra <= 0) break;
        extra -= 1;
      }
      const rows = await read(page * pageSize, page * pageSize + pageSize - 1);
      hits.push(...(await keep(rows)));
      if (rows.length < pageSize) break;
    }
  }
  return hits;
}

// ── Identifiers (R1: identifiers.ts is the one place that knows their shape) ──

export type IdentifierQuery = { kind: IdentifierKind; value: string };

/** Only a query that is nothing but a code (separators allowed) is an identifier. */
const CODE_SHAPE = /^[A-Za-z0-9\s.\-]{9,24}$/;

/**
 * `GB-AYE-06-01498`, `T-345.246.800-1`, `602537915467`, `00123456789`. Order
 * matters where shapes overlap: ISWC starts with T and ISRC with two letters,
 * so neither is a number; a 12–13 digit code is a UPC (its check digit must
 * hold) and a 9–11 digit one an IPI.
 */
export function detectIdentifier(raw: unknown): IdentifierQuery | null {
  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  if (!CODE_SHAPE.test(text) || !/[0-9]/.test(text)) return null;
  const iswc = normalizeIswc(text);
  if (iswc) return { kind: 'iswc', value: iswc };
  const isrc = normalizeIsrc(text);
  if (isrc) return { kind: 'isrc', value: isrc };
  const upc = normalizeUpc(text);
  if (upc) return { kind: 'upc', value: upc };
  const ipi = normalizeIpi(text);
  if (ipi) return { kind: 'ipi', value: ipi };
  return null;
}

// ── Ranking, capping, grouping ──────────────────────────────────────────

const lower = (s: string) => s.normalize('NFKC').toLowerCase();

/** 0 exact title · 1 title starts with the query · 2 a title word starts with a term · 3 anything else. */
export function matchRank(query: ParsedQuery, title: string): number {
  const t = lower(title).trim();
  if (query.text && t === query.text) return 0;
  if (query.text && t.startsWith(query.text)) return 1;
  const words = t.match(WORD) ?? [];
  if (query.terms.length > 0 && query.terms.every((term) => words.some((w) => w.startsWith(term)))) return 2;
  return 3;
}

/** Best match first, then alphabetical, then id: the order never depends on how the rows arrived. */
export function rankHits(query: ParsedQuery, hits: readonly SearchHit[]): SearchHit[] {
  return [...hits]
    .map((hit) => ({ hit, rank: matchRank(query, hit.title) }))
    .sort((a, b) => a.rank - b.rank || a.hit.title.localeCompare(b.hit.title) || a.hit.id.localeCompare(b.hit.id))
    .map((r) => r.hit);
}

/** Rank each group, cap it, drop empty groups, and put the groups in display order. */
export function groupHits(query: ParsedQuery, hits: readonly SearchHit[], perGroup = HITS_PER_GROUP): SearchGroupResult[] {
  const out: SearchGroupResult[] = [];
  for (const group of SEARCH_GROUPS) {
    const own = hits.filter((h) => h.group === group);
    if (own.length === 0) continue;
    out.push({ group, hits: rankHits(query, own).slice(0, perGroup) });
  }
  return out;
}

// ── Links ───────────────────────────────────────────────────────────────

/**
 * The org page a hit opens, or null when there is none yet. A non-roster
 * contact and a party have no page of their own in the org shell; they are
 * shown but not navigable (the palette skips them in keyboard order).
 */
export function searchHitHref(orgSlug: string, hit: Pick<SearchHit, 'group' | 'id' | 'projectId'>): string | null {
  const base = `/o/${encodeURIComponent(orgSlug)}`;
  switch (hit.group) {
    case 'artists':
      return `${base}/artists/${hit.id}`;
    case 'songs':
      return `${base}/songs/${hit.id}`;
    case 'releases':
      return `${base}/releases/${hit.id}`;
    case 'projects':
      return `${base}/projects/${hit.id}`;
    case 'files':
      return hit.projectId ? `${base}/projects/${hit.projectId}` : null;
    default:
      return null;
  }
}

/** The hits as the keyboard walks them: display order, navigable ones only. */
export function navigableHits(result: OrgSearchResult, orgSlug: string): SearchHit[] {
  const list: SearchHit[] = [];
  if (result.jump) list.push(result.jump);
  for (const g of result.groups) for (const h of g.hits) if (searchHitHref(orgSlug, h)) list.push(h);
  return list;
}
