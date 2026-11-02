/**
 * Loads "My sessions" (LABEL-69). The caller passes the person's own live
 * external projects (`myExternalProjects`), so nothing here widens reach: every
 * query is keyed by those projects' tracks and by parties linked to THIS
 * account, and `assembleSessions` drops anything outside the project list.
 *
 * Credits and splits (153 / 155) are expected; contracts (176 / 178) may not
 * be applied on a database (production has 130–173 and 189–192 at most), so a
 * missing table there only omits contract asks, never an error. Statements
 * are a follow-up (LABEL-63 is not on this base).
 */
import { createServiceClient, type AdminClient } from '@/lib/auth/ownership';
import { createLogger } from '@/lib/log';
import { creditRoleLabel } from './credit-roles';
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

async function loadAsks(admin: AdminClient, userId: string, projects: readonly SessionProject[]): Promise<SessionAsk[]> {
  const projectIds = projects.map((p) => p.id);
  const orgIds = [...new Set(projects.map((p) => p.orgId))];

  const placements = await admin.from('project_tracks').select('project_id, track_id').in('project_id', projectIds);
  if (placements.error) throw new Error(placements.error.message);
  const trackProjects = new Map<string, string[]>();
  for (const p of (placements.data ?? []) as Row[]) {
    const t = str(p.track_id);
    const pr = str(p.project_id);
    if (!t || !pr) continue;
    trackProjects.set(t, [...(trackProjects.get(t) ?? []), pr]);
  }
  const trackIds = [...trackProjects.keys()];
  if (trackIds.length === 0) return [];

  const tracks = await admin.from('tracks').select('id, title, org_id').in('id', trackIds).in('org_id', orgIds);
  if (tracks.error) throw new Error(tracks.error.message);
  const titles = new Map<string, string | null>();
  const trackOrg = new Map<string, string>();
  for (const t of (tracks.data ?? []) as Row[]) {
    const id = str(t.id);
    if (id) {
      titles.set(id, str(t.title));
      trackOrg.set(id, str(t.org_id) ?? '');
    }
  }
  const projectOrg = new Map(projects.map((p) => [p.id, p.orgId]));
  /** The projects of the person that a track sits in, in the track's own org. */
  const projectsOf = (trackId: string) => (trackProjects.get(trackId) ?? []).filter((p) => projectOrg.get(p) === trackOrg.get(trackId));

  const mine = await admin.from('parties').select('id, org_id').eq('user_id', userId).in('org_id', orgIds);
  if (mine.error) throw new Error(mine.error.message);
  const myParties = ((mine.data ?? []) as Row[]).map((p) => str(p.id)).filter((v): v is string => !!v);
  if (myParties.length === 0) return [];

  const asks: SessionAsk[] = [];
  const push = (projectId: string, a: Omit<SessionAsk, 'projectId'>) => asks.push({ ...a, projectId });

  // Credits to confirm.
  const credits = await admin
    .from('track_collaborators')
    .select('id, track_id, role, status, created_by, party_id')
    .in('party_id', myParties)
    .eq('status', 'proposed')
    .in('track_id', [...titles.keys()]);
  if (credits.error) {
    if (!['PGRST205', '42P01', '42703'].includes(credits.error.code ?? '')) throw new Error(credits.error.message);
  } else {
    for (const c of (credits.data ?? []) as Row[]) {
      const trackId = str(c.track_id);
      const id = str(c.id);
      if (!trackId || !id) continue;
      const fact = { id, track_id: trackId, role: str(c.role) ?? '', status: str(c.status) ?? '', created_by: str(c.created_by), party_user_id: userId };
      if (!creditNeedsConfirming(fact, userId)) continue;
      for (const projectId of projectsOf(trackId)) {
        push(projectId, { key: `credit:${id}:${projectId}`, kind: 'credit', trackId, trackTitle: titles.get(trackId) ?? null, label: creditAskLabel(creditRoleLabel(fact.role)), refId: id, sheetId: null });
      }
    }
  }

  // Split lines to acknowledge: circulated sheets only.
  const lines = await admin
    .from('split_lines')
    .select('id, split_sheet_id, track_id, party_id, signed_at, split_sheets!inner(status)')
    .in('party_id', myParties)
    .in('track_id', [...titles.keys()])
    .is('signed_at', null);
  if (lines.error) {
    if (!['PGRST205', '42P01', '42703', 'PGRST200'].includes(lines.error.code ?? '')) throw new Error(lines.error.message);
  } else {
    for (const l of (lines.data ?? []) as Row[]) {
      const sheet = Array.isArray(l.split_sheets) ? (l.split_sheets[0] as Row | undefined) : (l.split_sheets as Row | null);
      const id = str(l.id);
      const trackId = str(l.track_id);
      const sheetId = str(l.split_sheet_id);
      if (!id || !trackId || !sheetId) continue;
      const fact = { id, sheet_id: sheetId, track_id: trackId, sheet_status: str(sheet?.status) ?? '', signed_at: str(l.signed_at), party_user_id: userId };
      if (!splitLineNeedsAcknowledging(fact, userId)) continue;
      for (const projectId of projectsOf(trackId)) {
        push(projectId, { key: `split:${id}:${projectId}`, kind: 'split', trackId, trackTitle: titles.get(trackId) ?? null, label: SPLIT_ASK_LABEL, refId: id, sheetId });
      }
    }
  }

  // Contracts out for signature (176 / 178) — omitted where those tables are not there.
  try {
    asks.push(...(await contractAsks(admin, userId, myParties, orgIds, titles, projectsOf)));
  } catch (err) {
    log.info('contract asks omitted', { error: err instanceof Error ? err.message : String(err) });
  }
  return asks;
}

async function contractAsks(
  admin: AdminClient,
  userId: string,
  myParties: string[],
  orgIds: string[],
  titles: Map<string, string | null>,
  projectsOf: (trackId: string) => string[],
): Promise<SessionAsk[]> {
  const links = await admin.from('contract_parties').select('contract_id, party_id').in('party_id', myParties).in('org_id', orgIds);
  if (links.error) throw new Error(links.error.message);
  const contractIds = [...new Set(((links.data ?? []) as Row[]).map((r) => str(r.contract_id)).filter((v): v is string => !!v))];
  if (contractIds.length === 0) return [];
  // Only contracts that name a song of one of the person's projects: the project is how they reach it.
  const contracts = await admin
    .from('contracts')
    .select('id, title, status, track_id, sent_document_sha256')
    .in('id', contractIds)
    .eq('status', 'sent')
    .in('track_id', [...titles.keys()]);
  if (contracts.error) throw new Error(contracts.error.message);
  const rows = (contracts.data ?? []) as Row[];
  if (rows.length === 0) return [];
  const sigs = await admin
    .from('contract_signatures')
    .select('contract_id, party_id, document_sha256')
    .in('contract_id', rows.map((r) => str(r.id)).filter((v): v is string => !!v))
    .in('party_id', myParties);
  if (sigs.error) throw new Error(sigs.error.message);
  const signed = new Set(((sigs.data ?? []) as Row[]).map((s) => `${str(s.contract_id)}:${str(s.document_sha256)}`));
  const out: SessionAsk[] = [];
  for (const r of rows) {
    const id = str(r.id);
    const trackId = str(r.track_id);
    if (!id || !trackId) continue;
    const fact = {
      id,
      title: str(r.title) ?? 'Contract',
      status: str(r.status) ?? '',
      track_id: trackId,
      party_user_id: userId,
      signedCurrent: signed.has(`${id}:${str(r.sent_document_sha256)}`),
    };
    if (!contractNeedsSigning(fact, userId)) continue;
    for (const projectId of projectsOf(trackId)) {
      out.push({ key: `contract:${id}:${projectId}`, kind: 'contract', projectId, trackId, trackTitle: titles.get(trackId) ?? null, label: contractAskLabel(fact.title), refId: id, sheetId: null });
    }
  }
  return out;
}
