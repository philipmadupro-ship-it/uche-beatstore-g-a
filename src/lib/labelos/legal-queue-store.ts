/**
 * The reads behind `GET /api/org/[orgId]/legal/queue` (LABEL-31). The rules
 * are `legal-queue.ts` (pure order, capability) and `approvals.ts` (where a
 * gate stands); this file only touches the database, with the service role and
 * an org filter on every query.
 *
 * A request is listed only when THIS member can open its subject exactly as
 * the song or release page would — membership, artist scope (404 outside it),
 * and for a song D4's row rule. What they cannot open is counted in
 * `restricted`, never titled. Migration 157 (approvals) may not be applied:
 * that is `schemaReady: false`, as the approvals route answers it.
 */
import { restrictedCountFor } from './restricted-counts';
import { objectAccessFor, type OrgAccessOk } from '@/lib/auth/org-access';
import type { AdminClient } from '@/lib/auth/ownership';
import { currentDecision, type ApprovalRow } from './approvals';
import { approvalContext, isMissingApprovalsSchema, legalGateReadiness, namesOf, readReleaseFacts, releasesOfSong, type Subject } from './approvals-store';
import { LegalReadinessNotReadyError, readReadinessSong } from './legal-readiness-store';
import { isQueueable, sortLegalQueue, type LegalQueueItem } from './legal-queue';
import { memberMayReadSongRow } from './song-stage-store';

const COLUMNS = 'id, org_id, song_id, release_id, gate, decision, note, actor_id, approver_id, request_id, created_at';

/** More than this many open requests is a backlog, not a queue: the oldest are listed. */
export const QUEUE_LIMIT = 200;
const CHUNK = 8;

export type LegalQueue = {
  schemaReady: boolean;
  items: LegalQueueItem[];
  /** Open requests the member may not open (scope, D4): counted, never named. */
  restricted: number;
  /** More open requests exist than `QUEUE_LIMIT`. */
  truncated: boolean;
};

const EMPTY: LegalQueue = { schemaReady: true, items: [], restricted: 0, truncated: false };

type Pending = { subject: Subject; request: ApprovalRow };

/** The open legal requests of the org, oldest first. */
async function openRequests(admin: AdminClient, org: string): Promise<Pending[] | null> {
  const res = await admin.from('approvals').select(COLUMNS).eq('org_id', org).eq('gate', 'legal').order('created_at', { ascending: true });
  if (res.error) {
    if (isMissingApprovalsSchema(res.error)) return null;
    throw new Error(`approval list: ${res.error.message}`);
  }
  const rows = ((res.data ?? []) as unknown as Omit<ApprovalRow, 'subject_snapshot'>[]).map((r) => ({ ...r, subject_snapshot: null }) as ApprovalRow);
  const bySubject = new Map<string, { subject: Subject; rows: ApprovalRow[] }>();
  for (const r of rows) {
    const subject: Subject | null = r.song_id ? { kind: 'song', id: r.song_id } : r.release_id ? { kind: 'release', id: r.release_id } : null;
    if (!subject) continue;
    const key = `${subject.kind}:${subject.id}`;
    const entry = bySubject.get(key) ?? { subject, rows: [] };
    entry.rows.push(r);
    bySubject.set(key, entry);
  }
  const out: Pending[] = [];
  for (const { subject, rows: list } of bySubject.values()) {
    const current = currentDecision(list);
    if (current.status === 'requested' && current.pending) out.push({ subject, request: current.pending });
  }
  return out.sort((a, b) => a.request.created_at.localeCompare(b.request.created_at) || a.subject.id.localeCompare(b.subject.id));
}

/** May this member open the subject (catalogue read, scope, and for a song D4's row rule)? */
async function mayOpen(access: OrgAccessOk, subject: Subject): Promise<boolean> {
  const table = subject.kind === 'song' ? 'tracks' : 'releases';
  const reach = await objectAccessFor(access.userId, { table, id: subject.id, cap: 'catalog.read', orgId: access.orgId });
  if (!reach.ok) return false;
  if (subject.kind === 'release') return true;
  const song = await readReadinessSong(access.admin, access.orgId, subject.id);
  return !!song && song.type === 'song' && (await memberMayReadSongRow(access.admin, access.orgId, subject.id, access.capabilities));
}

async function inChunks<T, R>(list: readonly T[], fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < list.length; i += CHUNK) out.push(...(await Promise.all(list.slice(i, i + CHUNK).map(fn))));
  return out;
}

export async function loadLegalQueue(access: OrgAccessOk): Promise<LegalQueue> {
  const { admin, orgId: org } = access;
  const open = await openRequests(admin, org);
  if (open === null) return { ...EMPTY, schemaReady: false };
  if (open.length === 0) return EMPTY;

  const truncated = open.length > QUEUE_LIMIT;
  const window = open.slice(0, QUEUE_LIMIT);

  type Built = Omit<LegalQueueItem, 'artist' | 'requestedBy'> & { artistId: string | null; requestedById: string | null };
  let restricted = 0;
  const built = (
    await inChunks(window, async ({ subject, request }): Promise<Built | null> => {
      let title: string | null = null;
      let release = null;
      if (subject.kind === 'release') {
        const rel = await admin.from('releases').select('title, state').eq('id', subject.id).eq('org_id', org).maybeSingle();
        if (rel.error) throw new Error(`release read: ${rel.error.message}`);
        const row = rel.data as { title: string; state: string } | null;
        // A cancelled release is not going out, and a missing one is gone: nobody needs to clear either, so neither is counted.
        if (!row || row.state === 'cancelled') return null;
        title = row.title;
      }
      // A song on a live release is approved at the release (doc 21 #13): it is not this queue's to list, nor counted.
      if (subject.kind === 'song' && !isQueueable('song', (await releasesOfSong(admin, org, subject.id)).length > 0)) return null;
      if (!(await mayOpen(access, subject))) {
        restricted += 1;
        return null;
      }
      if (subject.kind === 'song') title = (await readReadinessSong(admin, org, subject.id))?.title ?? null;
      else release = await readReleaseFacts(admin, org, subject.id);
      const readiness = await legalGateReadiness(admin, org, subject, release);
      const ctx = await approvalContext(admin, org, subject, release);
      return {
        kind: subject.kind,
        id: subject.id,
        title,
        artistId: ctx.artist_id,
        requestedAt: request.created_at,
        requestedById: request.actor_id,
        askedOfMe: request.approver_id?.toLowerCase() === access.userId.toLowerCase(),
        ready: readiness.ready,
        blockers: readiness.blockers,
      };
    })
  ).filter((b): b is Built => b !== null);

  const artistIds = [...new Set(built.map((b) => b.artistId).filter((a): a is string => !!a))];
  const contacts = artistIds.length ? await admin.from('contacts').select('id, name').in('id', artistIds).eq('org_id', org) : { data: [], error: null };
  if (contacts.error) throw new Error(`contact read: ${contacts.error.message}`);
  const artistName = new Map(((contacts.data ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name]));
  const people = await namesOf(admin, org, built.map((b) => b.requestedById));

  const items = built.map(({ artistId, requestedById, ...rest }): LegalQueueItem => ({
    ...rest,
    artist: artistId && artistName.has(artistId) ? { id: artistId, name: artistName.get(artistId)! } : null,
    requestedBy: requestedById ? (people.get(requestedById) ?? 'Member') : null,
  }));
  return { schemaReady: true, items: sortLegalQueue(items), restricted: restrictedCountFor(restricted, access), truncated };
}

export { LegalReadinessNotReadyError };
