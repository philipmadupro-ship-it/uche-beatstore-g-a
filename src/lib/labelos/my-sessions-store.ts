/**
 * Loads "My sessions" (LABEL-69). The caller passes the person's own live
 * external projects (`myExternalProjects`), so nothing here widens reach: every
 * query is keyed by those projects' tracks and by parties linked to THIS
 * account, and `assembleSessions` drops anything outside the project list.
 *
 * Reads are chunked and paged (`inChunks`, `pageAll`): a project can hold
 * hundreds of songs, and PostgREST cuts a response at `max-rows` without an
 * error. Credits and splits (153 / 155) are expected; contracts (176 / 178)
 * may not be applied on a database (production has 130–173 and 189–192 at
 * most), so a missing table there only omits contract asks, never an error.
 * Statements are a follow-up (LABEL-63 is not on this base).
 */
import { createServiceClient, type AdminClient } from '@/lib/auth/ownership';
import { createLogger } from '@/lib/log';
import { creditRoleLabel } from './credit-roles';
import { orgEntitlements, type EntitlementRow } from './entitlements';
import { ReadError, inChunks, pageAll } from './paged-read';
import {
  SPLIT_ASK_LABEL,
  assembleSessions,
  contractAskLabel,
  contractNeedsSigning,
  creditAskLabel,
  creditNeedsConfirming,
  splitLineNeedsAcknowledging,
  type OrgSession,
  type SessionAsk,
  type SessionProject,
} from './my-sessions';

const log = createLogger('labelos.my-sessions');

type Row = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' ? v : null);
const MISSING = new Set(['PGRST205', '42P01', '42703', 'PGRST200']);

/** A table or column that is not there yet: the one failure that only omits a section. */
function isMissing(err: unknown): boolean {
  const code = err instanceof ReadError ? (err.raw as { code?: string }).code : undefined;
  return !!code && MISSING.has(code);
}

export async function loadMySessions(userId: string, projects: readonly SessionProject[], admin: AdminClient = createServiceClient()): Promise<OrgSession[]> {
  if (projects.length === 0) return [];
  let asks: SessionAsk[] = [];
  try {
    asks = await loadAsks(admin, userId, projects);
  } catch (err) {
    // The project list still renders; the asks are the optional part.
    log.error('asks unavailable', { error: err instanceof Error ? err.message : String(err) });
  }
  return assembleSessions(projects, asks);
}

async function optional<T>(read: Promise<T[]>): Promise<T[]> {
  try {
    return await read;
  } catch (err) {
    if (isMissing(err)) return [];
    throw err;
  }
}

async function loadAsks(admin: AdminClient, userId: string, projects: readonly SessionProject[]): Promise<SessionAsk[]> {
  const projectIds = projects.map((p) => p.id);
  const orgIds = [...new Set(projects.map((p) => p.orgId))];

  const [placements, mine] = await Promise.all([
    inChunks<Row>(projectIds, (part, from, to) => admin.from('project_tracks').select('project_id, track_id').in('project_id', part).order('project_id').order('track_id').range(from, to), 'project track read'),
    inChunks<Row>(orgIds, (part, from, to) => admin.from('parties').select('id, org_id').eq('user_id', userId).in('org_id', part).order('id').range(from, to), 'own party read'),
  ]);
  const myParties = mine.map((p) => str(p.id)).filter((v): v is string => !!v);
  if (myParties.length === 0) return [];

  const trackProjects = new Map<string, string[]>();
  for (const p of placements) {
    const t = str(p.track_id);
    const pr = str(p.project_id);
    if (t && pr) trackProjects.set(t, [...(trackProjects.get(t) ?? []), pr]);
  }
  const placed = [...trackProjects.keys()];
  if (placed.length === 0) return [];

  const tracks = await inChunks<Row>(placed, (part, from, to) => admin.from('tracks').select('id, title, org_id').in('id', part).in('org_id', orgIds).order('id').range(from, to), 'track read');
  const titles = new Map<string, string | null>();
  const trackOrg = new Map<string, string>();
  for (const t of tracks) {
    const id = str(t.id);
    if (id) {
      titles.set(id, str(t.title));
      trackOrg.set(id, str(t.org_id) ?? '');
    }
  }
  const trackIds = [...titles.keys()];
  if (trackIds.length === 0) return [];
  const projectOrg = new Map(projects.map((p) => [p.id, p.orgId]));
  /** The person's projects a track sits in, in the track's own org; sorted so a repeated ask has one stable home. */
  const projectsOf = (trackId: string) => (trackProjects.get(trackId) ?? []).filter((p) => projectOrg.get(p) === trackOrg.get(trackId)).sort();

  // Credits, split lines and contracts are independent reads.
  const [credits, lines, contracts] = await Promise.all([
    optional(
      inChunks<Row>(trackIds, (part, from, to) =>
        admin.from('track_collaborators').select('id, track_id, role, status, created_by, party_id').in('party_id', myParties).eq('status', 'proposed').in('track_id', part).order('id').range(from, to), 'credit read'),
    ),
    optional(
      inChunks<Row>(trackIds, (part, from, to) =>
        admin.from('split_lines').select('id, split_sheet_id, track_id, party_id, signed_at, split_sheets!inner(status)').in('party_id', myParties).in('track_id', part).is('signed_at', null).order('id').range(from, to), 'split line read'),
    ),
    contractAsks(admin, userId, myParties, orgIds, trackIds, titles).catch((err) => {
      log.info('contract asks omitted', { error: err instanceof Error ? err.message : String(err) });
      return [] as ContractCandidate[];
    }),
  ]);

  const asks: SessionAsk[] = [];
  /** One ask per row (credit / line / contract), filed under the song's first project — never once per project. */
  const push = (kind: SessionAsk['kind'], refId: string, trackId: string, a: Omit<SessionAsk, 'projectId' | 'key' | 'kind' | 'refId' | 'trackId' | 'trackTitle'>) => {
    const projectId = projectsOf(trackId)[0];
    if (!projectId) return;
    asks.push({ ...a, key: `${kind}:${refId}`, kind, refId, projectId, trackId, trackTitle: titles.get(trackId) ?? null });
  };

  for (const c of credits) {
    const trackId = str(c.track_id);
    const id = str(c.id);
    if (!trackId || !id) continue;
    const fact = { id, track_id: trackId, role: str(c.role) ?? '', status: str(c.status) ?? '', created_by: str(c.created_by), party_user_id: userId };
    if (creditNeedsConfirming(fact, userId)) push('credit', id, trackId, { label: creditAskLabel(creditRoleLabel(fact.role)), sheetId: null });
  }
  for (const l of lines) {
    const sheet = Array.isArray(l.split_sheets) ? (l.split_sheets[0] as Row | undefined) : (l.split_sheets as Row | null);
    const id = str(l.id);
    const trackId = str(l.track_id);
    const sheetId = str(l.split_sheet_id);
    if (!id || !trackId || !sheetId) continue;
    const fact = { id, sheet_id: sheetId, track_id: trackId, sheet_status: str(sheet?.status) ?? '', signed_at: str(l.signed_at), party_user_id: userId };
    if (splitLineNeedsAcknowledging(fact, userId)) push('split', id, trackId, { label: SPLIT_ASK_LABEL, sheetId });
  }
  for (const c of contracts) push('contract', c.id, c.trackId, { label: contractAskLabel(c.title), sheetId: null });
  return asks;
}

type ContractCandidate = { id: string; title: string; trackId: string };

/**
 * Contracts out for signature that name the person's party and a song of one
 * of their projects (176 / 178). Only where the org's licence includes the
 * contracts module (LABEL-47: otherwise contract capabilities are 404), and
 * only a contract with a frozen sent copy — one sent before 178 cannot be
 * signed, so it must not read as waiting forever.
 */
async function contractAsks(
  admin: AdminClient,
  userId: string,
  myParties: string[],
  orgIds: string[],
  trackIds: string[],
  titles: Map<string, string | null>,
): Promise<ContractCandidate[]> {
  const links = await inChunks<Row>(myParties, (part, from, to) => admin.from('contract_parties').select('contract_id, party_id').in('party_id', part).in('org_id', orgIds).order('contract_id').order('party_id').range(from, to), 'contract link read');
  // Which of the person's parties they ARE for signing purposes (`maySignAs`): confirmed by them, linked by someone else.
  const partyRows = await inChunks<Row>(myParties, (part, from, to) => admin.from('parties').select('id, details_confirmed_by, user_linked_by').eq('user_id', userId).in('id', part).order('id').range(from, to), 'party identity read');
  const identity = new Map(partyRows.map((r) => [str(r.id) ?? '', { confirmedBy: str(r.details_confirmed_by), linkedBy: str(r.user_linked_by) }]));
  const contractIds = [...new Set(links.map((r) => str(r.contract_id)).filter((v): v is string => !!v))];
  if (contractIds.length === 0) return [];

  // Orgs whose licence includes contracts.
  const [orgRows, entRows] = await Promise.all([
    inChunks<Row>(orgIds, (part, from, to) => admin.from('organizations').select('id, kind').in('id', part).order('id').range(from, to), 'org read'),
    optional(inChunks<Row>(orgIds, (part, from, to) => admin.from('org_entitlements').select('org_id, modules, max_seats, max_artists, setup_done').in('org_id', part).order('org_id').range(from, to), 'entitlement read')),
  ]);
  const entByOrg = new Map(entRows.map((r) => [str(r.org_id) ?? '', r as unknown as EntitlementRow]));
  const licensed = new Set<string>();
  for (const o of orgRows) {
    const id = str(o.id);
    if (id && orgEntitlements({ kind: str(o.kind) }, entByOrg.get(id) ?? null).modules.has('contracts')) licensed.add(id);
  }
  if (licensed.size === 0) return [];

  const rows = (
    await inChunks<Row>(contractIds, (part, from, to) =>
      admin.from('contracts').select('id, org_id, title, status, track_id, sent_document_sha256').in('id', part).eq('status', 'sent').order('id').range(from, to), 'contract read')
  ).filter((r) => {
    const t = str(r.track_id);
    return !!str(r.sent_document_sha256) && !!t && titles.has(t) && licensed.has(str(r.org_id) ?? '');
  });
  if (rows.length === 0) return [];
  const sigs = await pageAll<Row>(
    (from, to) => admin.from('contract_signatures').select('contract_id, party_id, document_sha256').in('contract_id', rows.map((r) => str(r.id)).filter((v): v is string => !!v)).in('party_id', myParties).order('contract_id').order('party_id').range(from, to),
    'contract signature read',
  );
  const signed = new Set(sigs.map((s) => `${str(s.contract_id)}:${str(s.document_sha256)}`));
  const out: ContractCandidate[] = [];
  for (const r of rows) {
    const id = str(r.id);
    const trackId = str(r.track_id);
    if (!id || !trackId) continue;
    const partyIds = links.filter((l) => str(l.contract_id) === id).map((l) => str(l.party_id) ?? '');
    const ids = partyIds.map((p) => identity.get(p)).filter((v): v is { confirmedBy: string | null; linkedBy: string | null } => !!v);
    const mine = ids.find((v) => v.confirmedBy === userId && !!v.linkedBy && v.linkedBy !== userId) ?? ids[0];
    const fact = {
      id,
      title: str(r.title) ?? 'Contract',
      status: str(r.status) ?? '',
      track_id: trackId,
      party_user_id: userId,
      party_confirmed_by: mine?.confirmedBy ?? null,
      party_linked_by: mine?.linkedBy ?? null,
      signedCurrent: signed.has(`${id}:${str(r.sent_document_sha256)}`),
    };
    if (contractNeedsSigning(fact, userId)) out.push({ id, title: fact.title, trackId });
  }
  return out;
}
