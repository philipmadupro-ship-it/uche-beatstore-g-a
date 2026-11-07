/**
 * The executive (CEO) dashboard's rules (LABEL-67). Pure: the store reads what the viewer may see
 * (artist scope and D4 already applied) and this folds it into the sections of the page and the CSV.
 * Nothing here is stored, so there is nothing to go stale, and no audio is involved.
 *
 *   pipeline    songs per A&R stage, every song in the viewer's artist scope (counts only, so D4 hides nothing)
 *   months      releases per month and where each stands (the board's derived stage)
 *   blocked     draft releases with a blocked gate, nearest date first
 *   waiting     release gates waiting for somebody's approval
 *   tasks       open and overdue tasks per department (counts only, never a title)
 *   money       LABEL-64's `financeSummary()` per currency (whole-organization readers with finance.read only)
 *   topSongs    songs by gross income (same readers as money; a song the viewer may not open is left out)
 */
import { boardStage, type BoardRelease } from './release-board';
import { csvCell } from './metadata-export';
import { ORG_FUNCTIONS } from './capabilities';
import { SONG_STAGES } from './song-stage';


/** Sections that may be withheld from a viewer, named so the page says why instead of drawing zeros. */
export type ExecSection = 'money' | 'topSongs' | 'tasks';

export type ExecSong = { stage: string | null };
export type ExecTask = { assigneeId: string | null; dueAt: string | null };
export type ExecMember = { userId: string; role: string; functions: readonly string[] };

export type MonthRow = { month: string; ready: number; inProgress: number; delivered: number; total: number };
export type BlockedRelease = { id: string; title: string; artistName: string | null; date: string | null; gates: string[] };
export type WaitingApproval = { releaseId: string; title: string; artistName: string | null; gates: string[] };
export type DepartmentLoad = { department: string; open: number; overdue: number };
export type MoneyRow = { currency: string; income: string; royalties: string; spent: string; margin: string; unrecouped: string };
export type TopSong = { id: string; title: string; artistName: string | null; currency: string; gross: string };

export type ExecView = {
  schemaReady: boolean;
  scoped: boolean;
  /** Releases beyond the board's newest hundred: the release sections cover only those, and say so. */
  moreReleases: number;
  pipeline: { stage: string; count: number }[];
  months: MonthRow[];
  blocked: BlockedRelease[];
  waiting: WaitingApproval[];
  tasks: DepartmentLoad[] | null;
  money: MoneyRow[] | null;
  topSongs: TopSong[] | null;
  withheld: ExecSection[];
};

/** The stage order of the pipeline; an unknown stage is kept after the known ones rather than dropped. */
export function pipelineCounts(songs: readonly ExecSong[]): { stage: string; count: number }[] {
  const counts = new Map<string, number>(SONG_STAGES.map((s) => [s, 0]));
  for (const s of songs) {
    const stage = s.stage ?? 'inbox';
    counts.set(stage, (counts.get(stage) ?? 0) + 1);
  }
  return [...counts.entries()].map(([stage, count]) => ({ stage, count }));
}

/** `YYYY-MM` of the date a release goes (or went) out: its release date, else its target. Undated releases are left out. */
export function monthOf(r: Pick<BoardRelease, 'releaseDate' | 'targetDate' | 'deliveredAt'>): string | null {
  const d = r.releaseDate ?? r.targetDate;
  return d && /^\d{4}-\d{2}/.test(d) ? d.slice(0, 7) : null;
}

export function releasesByMonth(releases: readonly BoardRelease[]): MonthRow[] {
  const map = new Map<string, MonthRow>();
  for (const r of releases) {
    const stage = boardStage(r);
    if (stage === 'cancelled' || stage === 'withdrawn') continue;
    const month = monthOf(r);
    if (!month) continue;
    const row = map.get(month) ?? { month, ready: 0, inProgress: 0, delivered: 0, total: 0 };
    if (stage === 'ready') row.ready += 1;
    else if (stage === 'in_progress') row.inProgress += 1;
    else row.delivered += 1;
    row.total += 1;
    map.set(month, row);
  }
  return [...map.values()].sort((a, b) => a.month.localeCompare(b.month));
}

const dateKey = (r: BoardRelease) => r.releaseDate ?? r.targetDate ?? '9999-12-31';
const byDate = (a: BoardRelease, b: BoardRelease) => dateKey(a).localeCompare(dateKey(b)) || a.id.localeCompare(b.id);

export function blockedReleases(releases: readonly BoardRelease[]): BlockedRelease[] {
  return releases
    .filter((r) => r.state === 'draft' && r.gates.some((g) => g.status === 'blocked'))
    .sort(byDate)
    .map((r) => ({ id: r.id, title: r.title, artistName: r.artistName, date: r.releaseDate ?? r.targetDate, gates: r.gates.filter((g) => g.status === 'blocked').map((g) => g.gate) }));
}

export function waitingApprovals(releases: readonly BoardRelease[]): WaitingApproval[] {
  return releases
    .filter((r) => r.state === 'draft' && r.gates.some((g) => g.status === 'awaiting_approval'))
    .sort(byDate)
    .map((r) => ({ releaseId: r.id, title: r.title, artistName: r.artistName, gates: r.gates.filter((g) => g.status === 'awaiting_approval').map((g) => g.gate) }));
}

const DEPARTMENT_LABEL: Record<string, string> = {
  a_and_r: 'A&R',
  project_manager: 'Project management',
  marketing: 'Marketing',
  legal: 'Legal',
  finance: 'Finance',
  artist_manager: 'Artist management',
  producer: 'Production',
  engineer: 'Engineering',
  operations: 'Operations',
  pr: 'PR',
  executive: 'Executive',
  artistic_director: 'Artistic direction',
  contracts: 'Contracts',
};

/** One department per person: their first function in the canonical order; owner/admin with none are Management. */
export function departmentOf(m: Pick<ExecMember, 'role' | 'functions'> | undefined): string {
  if (!m) return 'Unassigned';
  const fn = ORG_FUNCTIONS.find((f) => m.functions.includes(f));
  if (fn) return DEPARTMENT_LABEL[fn];
  return m.role === 'owner' || m.role === 'admin' ? 'Management' : 'No department';
}

export function taskLoadByDepartment(tasks: readonly ExecTask[], members: readonly ExecMember[], now: Date): DepartmentLoad[] {
  const byUser = new Map(members.map((m) => [m.userId.toLowerCase(), m]));
  const map = new Map<string, DepartmentLoad>();
  for (const t of tasks) {
    const department = t.assigneeId ? departmentOf(byUser.get(t.assigneeId.toLowerCase())) : 'Unassigned';
    const row = map.get(department) ?? { department, open: 0, overdue: 0 };
    row.open += 1;
    if (t.dueAt && new Date(t.dueAt).getTime() < now.getTime()) row.overdue += 1;
    map.set(department, row);
  }
  return [...map.values()].sort((a, b) => b.open - a.open || a.department.localeCompare(b.department));
}

/** The N songs with the most gross income per currency (a song earning in two currencies appears in both). */
export function topSongsByGross(
  lines: readonly { song_track_id: string | null; gross_minor: bigint; currency: string }[],
  songs: ReadonlyMap<string, { title: string; artistName: string | null }>,
  limit = 5,
): TopSong[] {
  const sums = new Map<string, bigint>();
  for (const l of lines) {
    if (!l.song_track_id || !songs.has(l.song_track_id)) continue;
    const key = `${l.currency}\u0000${l.song_track_id}`;
    sums.set(key, (sums.get(key) ?? BigInt(0)) + l.gross_minor);
  }
  const rows = [...sums.entries()].map(([key, gross]) => {
    const [currency, id] = key.split('\u0000');
    const s = songs.get(id)!;
    return { id, title: s.title, artistName: s.artistName, currency, gross };
  });
  rows.sort((a, b) => (a.gross === b.gross ? a.id.localeCompare(b.id) : a.gross > b.gross ? -1 : 1));
  return rows.slice(0, limit).map((r) => ({ ...r, gross: r.gross.toString() }));
}

// ── CSV ─────────────────────────────────────────────────────────────────

/** One flat file: a `section` column tells the rows apart so a spreadsheet can filter. Every text cell is formula-guarded. */
export function execCsv(v: ExecView): string {
  const rows: (string | number | null)[][] = [['section', 'name', 'detail', 'count', 'amount_minor', 'currency']];
  // The release sections below cover the newest releases only; a file that hid that would read as the whole roster.
  if (v.moreReleases > 0) rows.push(['releases_not_counted', 'Releases beyond the newest 100', 'not in the release sections', v.moreReleases, null, '']);
  for (const p of v.pipeline) rows.push(['pipeline', p.stage, '', p.count, null, '']);
  for (const m of v.months) rows.push(['releases_by_month', m.month, `ready ${m.ready}; in progress ${m.inProgress}; delivered ${m.delivered}`, m.total, null, '']);
  for (const b of v.blocked) rows.push(['blocked_release', b.title, [b.artistName, b.date, b.gates.join('/')].filter(Boolean).join(' · '), b.gates.length, null, '']);
  for (const w of v.waiting) rows.push(['approval_waiting', w.title, [w.artistName, w.gates.join('/')].filter(Boolean).join(' · '), w.gates.length, null, '']);
  for (const t of v.tasks ?? []) rows.push(['tasks', t.department, `${t.overdue} overdue`, t.open, null, '']);
  for (const m of v.money ?? []) {
    rows.push(['income', 'Income', '', null, m.income, m.currency]);
    rows.push(['cost', 'Marketing spent', '', null, m.spent, m.currency]);
    rows.push(['margin', 'Margin', '', null, m.margin, m.currency]);
    rows.push(['unrecouped', 'Unrecouped advances', '', null, m.unrecouped, m.currency]);
  }
  for (const s of v.topSongs ?? []) rows.push(['top_song', s.title, s.artistName ?? '', null, s.gross, s.currency]);
  // A minor-unit amount is a decimal string and may be negative (a margin): it is a number, not text to guard.
  const cell = (c: string | number | null) => (typeof c === 'string' && /^-?\d+$/.test(c) ? `"${c}"` : csvCell(c));
  return rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

export function execFileName(slug: string, now: Date): string {
  const safe = slug.replace(/[^a-z0-9-]/gi, '-').slice(0, 40) || 'org';
  return `${safe}-executive-${now.toISOString().slice(0, 10)}.csv`;
}
