/**
 * The reads behind the executive dashboard (LABEL-67). Called by `GET /api/org/[orgId]/exec` and the
 * `/o/<slug>/exec` page after `exec.read` (module `executive`) authorised the member. The rules are the
 * pure `exec-dashboard.ts`; this file only reads, and applies the member's scope and D4 first:
 *
 *   releases   LABEL-33's `loadReleaseBoard` (artist scope through the projects, gate statuses, no blocker text)
 *   pipeline   every song in the member's artist scope counted by stage, whatever its audio class (numbers only:
 *              no title or link, so nothing D4 protects leaves); top songs stay D4-filtered (`partitionSongs`)
 *   money      LABEL-64's `financeSummary` + per-song gross: a WHOLE-organization reader holding `finance.read`
 *              in an org licensed for finance only (margins and royalties of a few artists would leak the rest)
 *   tasks      counts per department, whole-organization readers only; no title, assignee name or note leaves
 *
 * Read only; no audio is touched. A source whose migration is not applied contributes nothing.
 */
import type { OrgAccessOk } from '@/lib/auth/org-access';
import { orgProjectIdsInScope } from '@/lib/auth/org-access';
import { isMissingSchema } from '@/lib/artists/workspace-load';
import { releaseIncome } from './finance/release-income';
import { minorFromDb } from './finance/money';
import { payeePositions } from './finance/position';
import { financeSummary, financeSummaryView } from './finance/summary';
import { loadPositionFacts, loadReleaseFacts } from './finance-dashboard-store';
import { StatementsNotReadyError } from './statement-store';
import { blockedReleases, pipelineCounts, releasesByMonth, taskLoadByDepartment, topSongsByGross, waitingApprovals, type ExecMember, type ExecSection, type ExecView } from './exec-dashboard';
import { isWorkspaceSong, partitionSongs, type OrgTrackFacts } from './org-workspace';
import { orgTrackFacts } from './org-workspace-store';
import { chunks, inChunks, pageAll, ReadError } from './overview-store';
import { loadReleaseBoard } from './release-board-store';

type Admin = OrgAccessOk['admin'];

type SongRow = { id: string; title: string | null; type: string | null; song_stage: string | null };

async function readSongs(access: OrgAccessOk, scoped: string[] | null): Promise<{ all: SongRow[]; visible: SongRow[] }> {
  const { admin, orgId } = access;
  let tracks: SongRow[];
  if (scoped === null) {
    // A whole-organization reader counts every song of the org, including one that sits in no project yet.
    tracks = await pageAll<SongRow>((from, to) => admin.from('tracks').select('id, title, type, song_stage').eq('org_id', orgId).eq('type', 'song').not('song_stage', 'is', null).order('id').range(from, to), 'track read');
  } else {
    if (scoped.length === 0) return { all: [], visible: [] };
    const placements = await inChunks<{ track_id: string }>(scoped, (part, from, to) => admin.from('project_tracks').select('track_id').in('project_id', part).order('project_id').order('track_id').range(from, to), 'project track read');
    const ids = [...new Set(placements.map((p) => p.track_id))];
    tracks = await inChunks<SongRow>(ids, (part, from, to) => admin.from('tracks').select('id, title, type, song_stage').in('id', part).eq('org_id', orgId).order('id').range(from, to), 'track read');
  }
  const songs = tracks.filter(isWorkspaceSong);
  const facts = new Map<string, OrgTrackFacts>();
  for (const part of await Promise.all(chunks(songs.map((t) => t.id)).map((c) => orgTrackFacts(admin, orgId, c)))) for (const [id, f] of part) facts.set(id, f);
  return { all: songs, visible: partitionSongs(songs, facts, access.capabilities).visible };
}

async function readMembers(admin: Admin, orgId: string): Promise<ExecMember[]> {
  const rows = await pageAll<{ user_id: string; role: string; functions: string[] | null }>(
    (from, to) => admin.from('org_members').select('user_id, role, functions').eq('org_id', orgId).order('user_id').range(from, to),
    'member read',
  );
  return rows.map((r) => ({ userId: r.user_id, role: r.role, functions: r.functions ?? [] }));
}

async function readOpenTasks(admin: Admin, orgId: string): Promise<{ assigneeId: string | null; dueAt: string | null }[] | null> {
  try {
    const rows = await pageAll<{ assignee_id: string | null; due_at: string | null }>(
      (from, to) => admin.from('tasks').select('assignee_id, due_at').eq('org_id', orgId).is('done_at', null).order('id').range(from, to),
      'task read',
    );
    return rows.map((r) => ({ assigneeId: r.assignee_id, dueAt: r.due_at }));
  } catch (err) {
    if (err instanceof ReadError && isMissingSchema(err.raw)) return [];
    throw err;
  }
}

export async function loadExecDashboard(access: OrgAccessOk, now: Date = new Date()): Promise<ExecView> {
  const { admin, orgId } = access;
  const whole = access.artistScope === null;
  const scoped = await orgProjectIdsInScope(admin, access);
  const withheld: ExecSection[] = [];

  const [board, songs] = await Promise.all([loadReleaseBoard(access), readSongs(access, scoped)]);

  let money: ExecView['money'] = null;
  let topSongs: ExecView['topSongs'] = null;
  const mayReadMoney = whole && access.capabilities.has('finance.read') && access.role !== 'artist';
  if (mayReadMoney) {
    try {
      const [facts, rel] = await Promise.all([loadPositionFacts(admin, orgId, null), loadReleaseFacts(admin, orgId, null)]);
      const income = releaseIncome({ releases: rel.releases, items: rel.items, lines: rel.lines, royaltiesByLine: rel.royaltiesByLine, spend: rel.spend, visible: null });
      const summary = financeSummaryView(financeSummary({ positions: payeePositions(facts), releaseRows: income.rows }));
      money = summary.currencies.map((c) => ({ currency: c.currency, income: c.earnings.gross, royalties: c.earnings.royalties, spent: c.earnings.spent, margin: c.earnings.margin, unrecouped: c.advances.unrecouped }));
      const artistOfRelease = new Map(board.releases.map((r) => [r.id, r.artistName]));
      const releaseOfSong = new Map(rel.items.map((i) => [i.song_track_id, i.release_id]));
      const readable = new Map(songs.visible.map((s) => [s.id, { title: s.title ?? 'Untitled', artistName: artistOfRelease.get(releaseOfSong.get(s.id) ?? '') ?? null }]));
      topSongs = topSongsByGross(rel.lines.map((l) => ({ song_track_id: l.song_track_id, gross_minor: minorFromDb(l.gross_minor), currency: l.currency })), readable);
    } catch (err) {
      if (!(err instanceof StatementsNotReadyError)) throw err;
      money = [];
      topSongs = [];
    }
  }
  if (money === null) withheld.push('money', 'topSongs');

  let tasks: ExecView['tasks'] = null;
  if (whole) {
    const [open, members] = await Promise.all([readOpenTasks(admin, orgId), readMembers(admin, orgId)]);
    tasks = taskLoadByDepartment(open ?? [], members, now);
  } else {
    withheld.push('tasks');
  }

  return {
    schemaReady: board.schemaReady,
    scoped: !whole,
    pipeline: pipelineCounts(songs.all.map((s) => ({ stage: s.song_stage }))),
    months: releasesByMonth(board.releases),
    blocked: blockedReleases(board.releases),
    waiting: waitingApprovals(board.releases),
    tasks,
    money,
    topSongs,
    withheld,
  };
}
