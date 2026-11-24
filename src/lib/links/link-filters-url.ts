/**
 * The /links view as a query string: `?status=&kind=&to=&opt=&sort=&q=`.
 *
 * Same rules as `lib/library/view-state`: only non-defaults are written,
 * multi-value facets repeat the key, and decoding drops anything unknown so a
 * stale or hand-edited URL cannot produce a filter that matches nothing.
 */
import {
  DEFAULT_LINK_SORT,
  LINK_KIND_FACETS,
  LINK_OPTION_FACETS,
  LINK_RECIPIENT_FACETS,
  LINK_SORTS,
  LINK_STATUS_FACETS,
  emptyLinkFacets,
  type LinkFacets,
  type LinkSort,
} from './share-link';

export interface LinkViewState {
  facets: LinkFacets;
  sort: LinkSort;
  search: string;
}

export const LINK_VIEW_PARAMS = ['status', 'kind', 'to', 'opt', 'sort', 'q'] as const;

function pick<T extends string>(params: URLSearchParams, key: string, allowed: readonly T[]): Set<T> {
  const out = new Set<T>();
  for (const v of params.getAll(key)) {
    if ((allowed as readonly string[]).includes(v)) out.add(v as T);
  }
  return out;
}

function inOrder<T extends string>(set: ReadonlySet<T>, order: readonly T[]): T[] {
  return order.filter((v) => set.has(v));
}

export function hasLinkViewParams(search: string): boolean {
  const p = new URLSearchParams(search);
  return LINK_VIEW_PARAMS.some((k) => p.has(k));
}

export function decodeLinkView(search: string): LinkViewState {
  const p = new URLSearchParams(search);
  const sort = p.get('sort');
  return {
    facets: {
      ...emptyLinkFacets(),
      status: pick(p, 'status', LINK_STATUS_FACETS),
      kind: pick(p, 'kind', LINK_KIND_FACETS),
      recipient: pick(p, 'to', LINK_RECIPIENT_FACETS),
      options: pick(p, 'opt', LINK_OPTION_FACETS),
    },
    sort: (LINK_SORTS as readonly string[]).includes(sort ?? '') ? (sort as LinkSort) : DEFAULT_LINK_SORT,
    search: (p.get('q') ?? '').slice(0, 200),
  };
}

/** Query string without the leading `?`; '' for the default view. */
export function encodeLinkView(state: LinkViewState): string {
  const p = new URLSearchParams();
  for (const v of inOrder(state.facets.status, LINK_STATUS_FACETS)) p.append('status', v);
  for (const v of inOrder(state.facets.kind, LINK_KIND_FACETS)) p.append('kind', v);
  for (const v of inOrder(state.facets.recipient, LINK_RECIPIENT_FACETS)) p.append('to', v);
  for (const v of inOrder(state.facets.options, LINK_OPTION_FACETS)) p.append('opt', v);
  if (state.sort !== DEFAULT_LINK_SORT) p.set('sort', state.sort);
  const q = state.search.trim();
  if (q) p.set('q', q);
  return p.toString();
}
