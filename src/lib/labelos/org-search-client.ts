/**
 * The browser side of org search (LABEL-36): one fetch and the response
 * shape. Types come from the pure module; the payload is exactly what
 * `GET /api/org/[orgId]/search` sends (hits only — there is no count to read).
 */
import { EMPTY_SEARCH, SEARCH_GROUPS, type OrgSearchResult, type SearchGroup, type SearchHit } from './org-search';

const isGroup = (g: unknown): g is SearchGroup => typeof g === 'string' && (SEARCH_GROUPS as readonly string[]).includes(g);

function toHit(raw: unknown): SearchHit | null {
  const h = raw as Partial<SearchHit> | null;
  if (!h || !isGroup(h.group) || typeof h.id !== 'string' || typeof h.title !== 'string') return null;
  return { group: h.group, id: h.id, title: h.title, sub: typeof h.sub === 'string' ? h.sub : null, projectId: typeof h.projectId === 'string' ? h.projectId : null };
}

/** The response as the palette renders it; anything malformed reads as no results. */
export function parseSearchResponse(body: unknown): OrgSearchResult {
  const b = body as { jump?: unknown; groups?: unknown } | null;
  if (!b || typeof b !== 'object') return EMPTY_SEARCH;
  const jump = toHit(b.jump);
  const groups = Array.isArray(b.groups)
    ? b.groups.flatMap((g: { group?: unknown; hits?: unknown }) => {
        if (!isGroup(g?.group) || !Array.isArray(g.hits)) return [];
        const hits = g.hits.map(toHit).filter((h): h is SearchHit => !!h && h.group === g.group);
        return hits.length ? [{ group: g.group, hits }] : [];
      })
    : [];
  return { jump, groups };
}

export async function fetchOrgSearch(orgId: string, q: string, signal?: AbortSignal): Promise<OrgSearchResult> {
  const res = await fetch(`/api/org/${encodeURIComponent(orgId)}/search?q=${encodeURIComponent(q)}`, { cache: 'no-store', signal });
  if (!res.ok) throw new Error(`search ${res.status}`);
  return parseSearchResponse(await res.json());
}
