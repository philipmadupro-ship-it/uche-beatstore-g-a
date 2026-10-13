/**
 * The reads behind the release board (LABEL-33): ONE server-side pass over
 * the org's releases, so the page does not make a client request per release.
 * Authorised like `GET /api/org/[orgId]/releases` — the member's artist scope
 * narrows the list through the releases' PROJECTS (migration 144's policy) —
 * and each draft's gates come from LABEL-32's `loadReleaseReadinessFacts` /
 * `evaluateReleaseReadiness`. A delivered or cancelled release has nothing
 * left to gate and is not evaluated.
 *
 * What a row carries is counts and statuses only: blocker TEXT (which may name
 * a party or a legal identifier) is the detail page's, behind `rights.read`.
 */
import { orgProjectIdsInScope, type OrgAccessOk } from '@/lib/auth/org-access';
import { isMissingSchema } from '@/lib/artists/workspace-load';
import { boardGates, type BoardRelease } from './release-board';
import { evaluateReleaseReadiness, releaseReadinessView } from './release-readiness';
import { loadReleaseReadinessFacts, ReleaseReadinessNotReadyError } from './release-readiness-store';
import { RELEASE_COLUMNS, type ReleaseRow } from './releases';

/** Most recent releases the board shows; the rest are counted, not silently dropped. */
export const BOARD_LIMIT = 100;
/** Releases evaluated at once. */
const CONCURRENCY = 5;

export type ReleaseBoard = {
  /** False before migration 144 (or 153 / 155 / 157 for the gates): the page says so. */
  schemaReady: boolean;
  releases: BoardRelease[];
  /** Releases beyond `BOARD_LIMIT`. */
  more: number;
};

async function inChunks<T, R>(list: readonly T[], size: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < list.length; i += size) out.push(...(await Promise.all(list.slice(i, i + size).map(fn))));
  return out;
}

export async function loadReleaseBoard(access: OrgAccessOk): Promise<ReleaseBoard> {
  const { admin } = access;
  const org = access.orgId;
  const projectIds = await orgProjectIdsInScope(admin, access);
  if (projectIds !== null && projectIds.length === 0) return { schemaReady: true, releases: [], more: 0 };

  let query = admin.from('releases').select(RELEASE_COLUMNS, { count: 'exact' }).eq('org_id', org);
  if (projectIds !== null) query = query.in('project_id', projectIds);
  const res = await query.order('created_at', { ascending: false }).limit(BOARD_LIMIT);
  if (res.error) {
    if (isMissingSchema(res.error)) return { schemaReady: false, releases: [], more: 0 };
    throw new Error(`release list: ${res.error.message}`);
  }
  const rows = (res.data ?? []) as unknown as ReleaseRow[];
  const more = Math.max(0, (res.count ?? rows.length) - rows.length);
  if (rows.length === 0) return { schemaReady: true, releases: [], more };

  const ids = rows.map((r) => r.id);
  const contactIds = [...new Set(rows.map((r) => r.contact_id))];
  const [items, contacts] = await Promise.all([
    admin.from('release_items').select('release_id').eq('org_id', org).in('release_id', ids),
    admin.from('contacts').select('id, name').eq('org_id', org).in('id', contactIds),
  ]);
  if (items.error) throw new Error(`release items: ${items.error.message}`);
  if (contacts.error) throw new Error(`release artists: ${contacts.error.message}`);
  const counts = new Map<string, number>();
  for (const i of (items.data ?? []) as { release_id: string }[]) counts.set(i.release_id, (counts.get(i.release_id) ?? 0) + 1);
  const names = new Map(((contacts.data ?? []) as { id: string; name: string | null }[]).map((c) => [c.id, c.name]));

  let schemaReady = true;
  const mayReadRights = access.capabilities.has('rights.read');
  const out = await inChunks(rows, CONCURRENCY, async (row): Promise<BoardRelease> => {
    const base: BoardRelease = {
      id: row.id,
      title: row.title,
      type: row.type,
      state: row.state,
      artistId: row.contact_id,
      artistName: names.get(row.contact_id) ?? null,
      targetDate: row.target_date,
      releaseDate: row.release_date,
      deliveredAt: row.delivered_at,
      deliveredTo: row.delivered_to,
      itemCount: counts.get(row.id) ?? 0,
      gates: [],
      readyToDeliver: false,
      createdAt: row.created_at,
    };
    if (row.state !== 'draft') return base;
    try {
      const facts = await loadReleaseReadinessFacts(admin, org, row.id);
      if (!facts) return base;
      const view = releaseReadinessView(evaluateReleaseReadiness(facts), mayReadRights);
      return { ...base, gates: boardGates(view.gates), readyToDeliver: view.readyToDeliver };
    } catch (err) {
      if (err instanceof ReleaseReadinessNotReadyError) {
        schemaReady = false;
        return base;
      }
      throw err;
    }
  });
  return { schemaReady, releases: out, more };
}
