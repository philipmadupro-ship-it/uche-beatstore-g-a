/**
 * Income against cost per release (LABEL-64). Pure.
 *
 * INCOME is the gross on earnings lines (LABEL-62), attributed to a release in this order:
 *   1. the line's UPC equals the UPC of exactly one release of the org;
 *   2. otherwise the line's song is on exactly one non-cancelled release;
 *   3. otherwise it is NOT attributed — a song on two releases (a single and its album) is not
 *      split by a guess. Such lines are reported as `ambiguous`, lines that name no release as
 *      `unmatched`, and only a whole-organization reader sees those totals.
 *
 * COST is what the label shows it spent on the release. The only cost the system records today
 * is the release's marketing plan: budget lines of status `spent` (and, shown separately,
 * `committed`). Royalties payable (Σ allocations of the release's lines) are shown beside it,
 * because they are money the label owes out of that income. Nothing else is invented as a cost
 * (recording, advances to artists are not release costs).
 *
 *   margin = gross − royalties − marketing spent
 *
 * Every figure is per currency: a release with income in two currencies has two rows.
 * `visible` limits which releases are returned (the viewer's artist scope); a release the viewer
 * cannot see contributes to no row and no total.
 */
import { minorFromDb } from './money';

const ZERO = BigInt(0);

export type ReleaseFact = { id: string; title: string; state: string; upc: string | null; release_date: string | null; contact_id: string | null };
export type ItemFact = { release_id: string; song_track_id: string };
export type LineFact = { id: string; upc: string | null; song_track_id: string | null; gross_minor: unknown; currency: string };
export type SpendFact = { release_id: string; status: string; amount_minor: unknown; currency: string };

export type ReleaseIncomeRow = {
  releaseId: string;
  title: string;
  state: string;
  releaseDate: string | null;
  currency: string;
  gross: bigint;
  royalties: bigint;
  spent: bigint;
  committed: bigint;
  margin: bigint;
  lines: number;
};

export type UnattributedRow = { currency: string; kind: 'ambiguous' | 'unmatched'; gross: bigint; lines: number };

export const normalizeUpc = (v: string | null | undefined): string => (v ?? '').replace(/[^0-9]/g, '').replace(/^0+/, '');

type Acc = { gross: bigint; royalties: bigint; spent: bigint; committed: bigint; lines: number };
const blank = (): Acc => ({ gross: ZERO, royalties: ZERO, spent: ZERO, committed: ZERO, lines: 0 });

export function releaseIncome(input: {
  releases: readonly ReleaseFact[];
  items: readonly ItemFact[];
  lines: readonly LineFact[];
  royaltiesByLine: ReadonlyMap<string, bigint>;
  spend: readonly SpendFact[];
  /** null = every release (whole-organization reader). */
  visible: ReadonlySet<string> | null;
}): { rows: ReleaseIncomeRow[]; unattributed: UnattributedRow[] } {
  const live = input.releases.filter((r) => r.state !== 'cancelled');
  const byUpc = new Map<string, string[]>();
  for (const r of live) {
    const u = normalizeUpc(r.upc);
    if (u) byUpc.set(u, [...(byUpc.get(u) ?? []), r.id]);
  }
  const bySong = new Map<string, Set<string>>();
  const liveIds = new Set(live.map((r) => r.id));
  for (const it of input.items) {
    if (!liveIds.has(it.release_id)) continue;
    const s = bySong.get(it.song_track_id) ?? new Set<string>();
    s.add(it.release_id);
    bySong.set(it.song_track_id, s);
  }

  const acc = new Map<string, Acc>(); // `${release}|${currency}`
  const un = new Map<string, UnattributedRow>();
  const bump = (release: string, currency: string): Acc => {
    const k = `${release}|${currency}`;
    let a = acc.get(k);
    if (!a) {
      a = blank();
      acc.set(k, a);
    }
    return a;
  };
  const note = (kind: UnattributedRow['kind'], currency: string, gross: bigint) => {
    const k = `${kind}|${currency}`;
    const u = un.get(k) ?? { currency, kind, gross: ZERO, lines: 0 };
    u.gross += gross;
    u.lines += 1;
    un.set(k, u);
  };

  for (const l of input.lines) {
    const currency = l.currency.trim();
    const gross = minorFromDb(l.gross_minor);
    let target: string | null = null;
    let ambiguous = false;
    const upc = normalizeUpc(l.upc);
    const viaUpc = upc ? byUpc.get(upc) : undefined;
    if (viaUpc && viaUpc.length === 1) target = viaUpc[0];
    else if (viaUpc && viaUpc.length > 1) ambiguous = true;
    else if (l.song_track_id) {
      const rel = bySong.get(l.song_track_id);
      if (rel && rel.size === 1) target = [...rel][0];
      else if (rel && rel.size > 1) ambiguous = true;
    }
    if (!target) {
      if (input.visible === null) note(ambiguous ? 'ambiguous' : 'unmatched', currency, gross);
      continue;
    }
    if (input.visible !== null && !input.visible.has(target)) continue;
    const a = bump(target, currency);
    a.gross += gross;
    a.royalties += input.royaltiesByLine.get(l.id) ?? ZERO;
    a.lines += 1;
  }

  for (const s of input.spend) {
    if (!liveIds.has(s.release_id)) continue;
    if (input.visible !== null && !input.visible.has(s.release_id)) continue;
    const amt = minorFromDb(s.amount_minor);
    if (s.status === 'spent') bump(s.release_id, s.currency.trim()).spent += amt;
    else if (s.status === 'committed') bump(s.release_id, s.currency.trim()).committed += amt;
  }

  const byId = new Map(live.map((r) => [r.id, r]));
  const rows: ReleaseIncomeRow[] = [];
  for (const [k, a] of acc) {
    const [releaseId, currency] = k.split('|');
    const r = byId.get(releaseId);
    if (!r) continue;
    rows.push({
      releaseId, title: r.title, state: r.state, releaseDate: r.release_date, currency,
      gross: a.gross, royalties: a.royalties, spent: a.spent, committed: a.committed, margin: a.gross - a.royalties - a.spent, lines: a.lines,
    });
  }
  rows.sort((x, y) => (y.gross === x.gross ? x.title.localeCompare(y.title) || x.currency.localeCompare(y.currency) : y.gross > x.gross ? 1 : -1));
  const unattributed = [...un.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.currency.localeCompare(b.currency));
  return { rows, unattributed };
}

export function releaseIncomeView(r: ReleaseIncomeRow) {
  const s = (n: bigint) => n.toString();
  return {
    releaseId: r.releaseId, title: r.title, state: r.state, releaseDate: r.releaseDate, currency: r.currency,
    grossMinor: s(r.gross), royaltiesMinor: s(r.royalties), spentMinor: s(r.spent), committedMinor: s(r.committed), marginMinor: s(r.margin), lines: r.lines,
  };
}
export type ReleaseIncomeView = ReturnType<typeof releaseIncomeView>;

export function unattributedView(u: UnattributedRow) {
  return { currency: u.currency, kind: u.kind, grossMinor: u.gross.toString(), lines: u.lines };
}
