/**
 * The reads behind the approval routes (LABEL-30). The rules are
 * `approvals.ts` (pure); this file only touches the database. Service-role
 * client, org filter on every query: authorisation is the route's
 * (`requireObjectAccess`, `objectAccessFor` for the approver), and rows go
 * out only through `approvalView`.
 *
 * The WRITES are not here: a request and a decision are audit functions
 * (migration 157, `auditRpc`), so the row and its event commit together.
 *
 * Migration 157 may not be applied: a missing table or function is
 * `ApprovalsNotReadyError`, which the routes answer as "not set up yet" (GET:
 * `schemaReady: false`; writes: 503), never a raw 500.
 */
import { RELEASE_STATES_NOT_GOING_OUT } from './releases';
import { capabilitiesFor } from './capabilities';
import { objectAccessFor } from '@/lib/auth/org-access';
import type { AdminClient } from '@/lib/auth/ownership';
import { isMissingSchema } from '@/lib/artists/workspace-load';
import { isUUID } from '@/lib/validate';
import {
  APPROVAL_COLUMNS,
  buildSnapshot,
  gateCapability,
  songSnapshotFacts,
  type ApprovalRow,
  type Gate,
  type Snapshot,
  type SnapshotFacts,
  type SnapshotSong,
  type SubjectKind,
} from './approvals';
import { listCredits } from './credits-store';
import { evaluateLegalReadiness, isReady } from './legal-readiness';
import { loadLegalFacts, readReadinessSong } from './legal-readiness-store';
import { memberIdentities, type IdentityAdmin } from './member-identity';
import { songEventSubject } from './song-stage-store';
import { listSheets } from './splits-store';

export class ApprovalsNotReadyError extends Error {
  constructor() {
    super('migration 157 is not applied');
  }
}

type DbError = { message: string; code?: string } | null | undefined;

/** The table or one of its functions is not there (157 not applied). */
export function isMissingApprovalsSchema(error: DbError): boolean {
  if (!error) return false;
  if (error.code === 'PGRST205' || error.code === '42P01') return /approvals/.test(error.message);
  if (!/approvals|labelos_audit_approval_/.test(error.message)) return false;
  return error.code === 'PGRST202' || error.code === '42883' || /could not find (the function|the table)|does not exist/i.test(error.message);
}

function check(what: string, error: DbError): void {
  if (!error) return;
  if (isMissingApprovalsSchema(error)) throw new ApprovalsNotReadyError();
  throw new Error(`${what}: ${error.message}`);
}

export type Subject = { kind: SubjectKind; id: string };

/** Every row of one subject (all gates), oldest first. */
export async function listApprovals(admin: AdminClient, org: string, subject: Subject): Promise<ApprovalRow[]> {
  const col = subject.kind === 'song' ? 'song_id' : 'release_id';
  const res = await admin.from('approvals').select(APPROVAL_COLUMNS).eq('org_id', org).eq(col, subject.id).order('created_at', { ascending: true });
  check('approval list', res.error);
  return (res.data ?? []) as unknown as ApprovalRow[];
}

// ── The facts a snapshot is built from ──────────────────────────────────

type ReleaseFacts = {
  id: string;
  contactId: string;
  projectId: string;
  artworkAssetId: string | null;
  fields: Record<string, string | null>;
  items: { songId: string; masterId: string; explicit: boolean; versionTitle: string | null }[];
};

const RELEASE_FIELDS = ['title', 'type', 'upc', 'label_name', 'c_line', 'p_line', 'primary_genre', 'target_date', 'release_date'] as const;
/** Migration 175's details: part of what the metadata approval covers, so changing one stales it. `territories` is held as one comma-joined string. */
const RELEASE_DETAIL_FIELDS = ['distributor', 'language', 'territories'] as const;

/** One release and its tracklist in order. Null when it is not a release of `org`. */
export async function readReleaseFacts(admin: AdminClient, org: string, releaseId: string): Promise<ReleaseFacts | null> {
  if (!isUUID(releaseId)) return null;
  const read = (fields: readonly string[]) =>
    admin.from('releases').select(`id, contact_id, project_id, artwork_asset_id, ${fields.join(', ')}`).eq('id', releaseId).eq('org_id', org).maybeSingle();
  let rel = await read([...RELEASE_FIELDS, ...RELEASE_DETAIL_FIELDS]);
  // Before 175 the three details do not exist: the snapshot is taken without them, as before.
  const withoutDetails = !!rel.error && /\b(distributor|territories|language)\b/.test(rel.error.message ?? '');
  if (withoutDetails) rel = await read(RELEASE_FIELDS);
  if (rel.error) throw new Error(`release read: ${rel.error.message}`);
  const row = rel.data as unknown as Record<string, string | null> | null;
  if (!row) return null;
  const items = await admin.from('release_items').select('position, song_track_id, master_track_id, explicit, version_title').eq('release_id', releaseId).eq('org_id', org).order('position', { ascending: true });
  if (items.error) throw new Error(`release items read: ${items.error.message}`);
  return {
    id: releaseId,
    contactId: String(row.contact_id),
    projectId: String(row.project_id),
    artworkAssetId: row.artwork_asset_id ?? null,
    fields: {
      ...Object.fromEntries(RELEASE_FIELDS.map((f) => [f, row[f] ?? null])),
      ...(withoutDetails
        ? {}
        : {
            distributor: row.distributor ?? null,
            language: row.language ?? null,
            territories: Array.isArray(row.territories) ? (row.territories as unknown as string[]).join(',') : null,
          }),
    },
    items: ((items.data ?? []) as unknown as { song_track_id: string; master_track_id: string; explicit: boolean | null; version_title: string | null }[]).map((i) => ({
      songId: i.song_track_id,
      masterId: i.master_track_id,
      explicit: i.explicit === true,
      versionTitle: i.version_title ?? null,
    })),
  };
}

/** One song's split sheets in force and credits, as the snapshot holds them. */
async function songFacts(admin: AdminClient, org: string, songId: string): Promise<SnapshotSong> {
  const [sheets, credits] = await Promise.all([listSheets(admin, org, songId), listCredits(admin, org, songId)]);
  return songSnapshotFacts(songId, sheets, credits);
}

async function masterIsrcs(admin: AdminClient, org: string, masterIds: readonly string[]): Promise<Map<string, string | null>> {
  const ids = [...new Set(masterIds)];
  const out = new Map<string, string | null>();
  if (ids.length === 0) return out;
  const res = await admin.from('tracks').select('id, isrc').eq('org_id', org).in('id', ids);
  check('master isrc read', res.error);
  for (const t of (res.data ?? []) as { id: string; isrc: string | null }[]) out.set(t.id.toLowerCase(), t.isrc ?? null);
  return out;
}

async function primaryArtistName(admin: AdminClient, org: string, contactId: string): Promise<string | null> {
  const res = await admin.from('contacts').select('name').eq('id', contactId).eq('org_id', org).maybeSingle();
  check('primary artist read', res.error);
  return (res.data as { name: string | null } | null)?.name ?? null;
}

/**
 * The snapshot of what a gate covers, as of NOW. Stored with a decision; built
 * again on every read to compare with it. Throws `SplitsNotReadyError` /
 * `CreditsNotReadyError` when 153 or 155 are missing (legal only), which the
 * routes map to "not set up".
 */
export async function currentSnapshot(admin: AdminClient, org: string, subject: Subject, gate: Gate, release?: ReleaseFacts | null): Promise<Snapshot> {
  const facts: SnapshotFacts = {};
  if (subject.kind === 'song') {
    if (gate === 'legal') facts.songs = [await songFacts(admin, org, subject.id)];
    return buildSnapshot(gate, facts);
  }
  const rel = release ?? (await readReleaseFacts(admin, org, subject.id));
  if (!rel) return buildSnapshot(gate, facts);
  facts.artworkAssetId = rel.artworkAssetId;
  facts.items = rel.items.map((i) => ({ songId: i.songId, masterId: i.masterId }));
  facts.release = rel.fields;
  if (gate === 'metadata') {
    // What the distributor is sent beyond the release row: each track's ISRC (read off the recording that goes out),
    // its explicit flag and version title, and the primary artist's name. Read only for this gate.
    const [isrcs, artist] = await Promise.all([masterIsrcs(admin, org, rel.items.map((i) => i.masterId)), primaryArtistName(admin, org, rel.contactId)]);
    facts.details = rel.items.map((i) => ({ songId: i.songId, isrc: isrcs.get(i.masterId.toLowerCase()) ?? null, explicit: i.explicit, versionTitle: i.versionTitle }));
    facts.release = { ...rel.fields, primary_artist: artist };
  }
  if (gate === 'legal') {
    const ids = [...new Set(rel.items.map((i) => i.songId))].sort();
    facts.songs = await Promise.all(ids.map((id) => songFacts(admin, org, id)));
  }
  return buildSnapshot(gate, facts);
}

/**
 * Legal readiness of every song the gate covers: ready only if all are, with
 * the blockers of all of them counted. `ready` is `isReady` — the blockers,
 * never the score (09 §2).
 */
export async function legalGateReadiness(admin: AdminClient, org: string, subject: Subject, release?: ReleaseFacts | null): Promise<{ ready: boolean; blockers: number; codes: string[] }> {
  const songIds = subject.kind === 'song' ? [subject.id] : [...new Set(((release ?? (await readReleaseFacts(admin, org, subject.id)))?.items ?? []).map((i) => i.songId))];
  let blockers = 0;
  const codes = new Set<string>();
  let ready = true;
  for (const id of songIds) {
    const song = await readReadinessSong(admin, org, id);
    if (!song) continue;
    const r = evaluateLegalReadiness(await loadLegalFacts(admin, org, song));
    if (!isReady(r)) ready = false;
    blockers += r.blockers.length;
    for (const b of r.blockers) codes.add(b.code);
  }
  return { ready, blockers, codes: [...codes].sort() };
}

/** The context keys the event is filed under: the artist, project, song and release it concerns. */
export async function approvalContext(
  admin: AdminClient,
  org: string,
  subject: Subject,
  release?: ReleaseFacts | null,
): Promise<{ artist_id: string | null; project_id: string | null; song_id: string | null; release_id: string | null }> {
  if (subject.kind === 'song') {
    const s = await songEventSubject(admin, org, subject.id);
    return { artist_id: s.artistId ?? null, project_id: s.projectId ?? null, song_id: subject.id, release_id: null };
  }
  const rel = release ?? (await readReleaseFacts(admin, org, subject.id));
  return { artist_id: rel?.contactId ?? null, project_id: rel?.projectId ?? null, song_id: null, release_id: subject.id };
}

/**
 * The live releases a song is on (doc 21 #13): a tracklist row of a release
 * that is not cancelled. A song on one has its legal approval given on the
 * release, so its own Approve is withdrawn. Org-filtered on both tables; a
 * missing releases schema (migration 144) reads as "on none".
 */
export async function releasesOfSong(admin: AdminClient, org: string, songId: string): Promise<{ id: string; title: string; contactId: string | null }[]> {
  const items = await admin.from('release_items').select('release_id').eq('org_id', org).eq('song_track_id', songId);
  if (items.error) {
    if (isMissingSchema(items.error)) return [];
    throw new Error(`release items read: ${items.error.message}`);
  }
  const ids = [...new Set(((items.data ?? []) as { release_id: string }[]).map((r) => r.release_id))];
  if (ids.length === 0) return [];
  const rels = await admin.from('releases').select('id, title, state, contact_id').eq('org_id', org).in('id', ids.slice(0, 50));
  if (rels.error) throw new Error(`releases read: ${rels.error.message}`);
  return ((rels.data ?? []) as { id: string; title: string | null; state: string; contact_id: string | null }[])
    .filter((r) => !RELEASE_STATES_NOT_GOING_OUT.includes(r.state))
    .map((r) => ({ id: r.id, title: r.title ?? 'Untitled release', contactId: r.contact_id }));
}

// ── People ──────────────────────────────────────────────────────────────

export async function namesOf(admin: AdminClient, org: string, userIds: readonly (string | null)[]): Promise<Map<string, string>> {
  const ids = [...new Set(userIds.filter((u): u is string => !!u))];
  const out = new Map<string, string>();
  if (ids.length === 0) return out;
  const found = await memberIdentities(admin as unknown as IdentityAdmin, org, ids, { withEmail: false });
  for (const id of ids) out.set(id, found.get(id)?.name ?? 'Member');
  return out;
}

/**
 * The members who may be asked to decide a gate on this subject: live members
 * of the org holding `release.approve.<gate>` who can also see the subject
 * (scope and capability, through `objectAccessFor`, the same helper the
 * requester went through). Names only; no emails.
 */
export async function approverCandidates(
  admin: AdminClient,
  org: string,
  subject: Subject,
  gate: Gate,
  orgObject: { table: 'tracks' | 'releases'; id: string },
): Promise<{ userId: string; name: string }[]> {
  const res = await admin.from('org_members').select('user_id, role, functions, cap_grants, cap_revokes, organizations!inner(kind)').eq('org_id', org);
  check('member list', res.error);
  type Row = { user_id: string; role: string; functions: string[] | null; cap_grants: string[] | null; cap_revokes: string[] | null; organizations: { kind: string } | { kind: string }[] };
  const need = gateCapability(gate);
  const holders = ((res.data ?? []) as unknown as Row[]).filter((m) => {
    const kind = Array.isArray(m.organizations) ? m.organizations[0]?.kind : m.organizations?.kind;
    return !!kind && capabilitiesFor(kind, m.role, m.functions, { grant: m.cap_grants, revoke: m.cap_revokes }).has(need);
  });
  const allowed: string[] = [];
  for (const m of holders) {
    const access = await objectAccessFor(m.user_id, { table: orgObject.table, id: orgObject.id, cap: need, orgId: org });
    if (access.ok) allowed.push(m.user_id);
  }
  const names = await namesOf(admin, org, allowed);
  return allowed.map((userId) => ({ userId, name: names.get(userId) ?? 'Member' })).sort((a, b) => a.name.localeCompare(b.name) || a.userId.localeCompare(b.userId));
}

// ── Views ───────────────────────────────────────────────────────────────

export type ApprovalView = {
  id: string;
  gate: string;
  decision: string;
  note: string | null;
  at: string;
  by: string | null;
  /** On a request: who was asked. */
  approver: string | null;
  approverId: string | null;
};

/** A row for the browser: names, never emails; the snapshot stays on the server. */
export function approvalView(row: ApprovalRow, names: ReadonlyMap<string, string>): ApprovalView {
  return {
    id: row.id,
    gate: row.gate,
    decision: row.decision,
    note: row.note,
    at: row.created_at,
    by: row.actor_id ? (names.get(row.actor_id) ?? 'Member') : null,
    approver: row.approver_id ? (names.get(row.approver_id) ?? 'Member') : null,
    approverId: row.approver_id,
  };
}
