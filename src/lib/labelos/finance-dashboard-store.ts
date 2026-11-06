/**
 * The reads behind the finance dashboard, advances ledger and period close (LABEL-64).
 * Rules live in `finance/{advances,position,release-income,period-close,summary}.ts`; this file
 * only loads the facts they need. Service-role client, org filter on every query; authorisation
 * (module, capability, artist scope) is the route's, and the scope is applied HERE too so a
 * scoped member's read never loads another artist's rows into memory.
 *
 * Migrations 179–181 (and 182 for the writes) may not be applied: a missing relation is
 * `StatementsNotReadyError` (the same "not set up yet" the statement routes use). The marketing
 * budget (183) is optional — without it a release simply has no recorded cost.
 */
import type { AdminClient } from '@/lib/auth/ownership';
import { scopeAllowsContact, type ArtistScope } from './artist-scope';
import type { AdvanceFacts, AdvanceRow } from './finance/advances';
import { minorFromDb } from './finance/money';
import type { PeriodOverview } from './finance/period-close';
import type { PositionFacts, PositionPayee } from './finance/position';
import type { ItemFact, LineFact, ReleaseFact, SpendFact } from './finance/release-income';
import { listPayees, isMissingFinanceSchema } from './finance-store';
import { inChunks, pageAll, ReadError } from './paged-read';
import { payeeNames, StatementsNotReadyError } from './statement-store';

type DbError = { message: string; code?: string } | null | undefined;

function check(what: string, error: DbError): void {
  if (!error) return;
  if (isMissingFinanceSchema(error)) throw new StatementsNotReadyError();
  throw new Error(`${what}: ${error.message}`);
}

function rethrow(err: unknown): never {
  if (err instanceof ReadError) check(err.message, err.raw as DbError);
  throw err;
}

/**
 * Probes the ledger's table (179) before a write. It does NOT detect a missing 182: the 182 functions are called
 * through `auditRpc`, and a missing one answers PGRST202, which `rpcAnswer` turns into `StatementsNotReadyError` (503).
 */
export async function assertAdvancesSchema(admin: AdminClient): Promise<void> {
  const res = await admin.from('advances').select('id').limit(1);
  check('advances probe', res.error);
}

const ADVANCE_COLUMNS = 'id, payee_id, kind, amount_minor, currency, paid_on, note, voided_at, created_at';
const ZERO = BigInt(0);

export type AdvanceWithFacts = AdvanceRow & { artist_contact_id: string | null; facts: AdvanceFacts };

/** Recouped sum and "referenced?" for the given advances (180's recoupments, 181's statement lines). */
async function advanceFacts(admin: AdminClient, orgId: string, ids: readonly string[]): Promise<Map<string, AdvanceFacts>> {
  const out = new Map<string, AdvanceFacts>(ids.map((id) => [id, { recouped: ZERO, referenced: false }]));
  if (ids.length === 0) return out;
  const recs = await inChunks<{ advance_id: string; amount_minor: unknown }>(
    ids,
    (part, from, to) => admin.from('earnings_recoupments').select('advance_id, amount_minor').eq('org_id', orgId).in('advance_id', part).order('id').range(from, to),
    'recoupments',
  );
  for (const r of recs) {
    const f = out.get(r.advance_id);
    if (f) {
      f.recouped += minorFromDb(r.amount_minor);
      f.referenced = true;
    }
  }
  // A line of a VOID statement no longer references the advance (the database says the same: labelos_advance_referenced).
  const lines = await inChunks<{ advance_id: string; statement_id: string }>(
    ids,
    (part, from, to) => admin.from('statement_lines').select('advance_id, statement_id').eq('org_id', orgId).in('advance_id', part).order('id').range(from, to),
    'statement lines',
  );
  const live = new Set(
    (
      await inChunks<{ id: string; status: string }>(
        lines.map((l) => l.statement_id),
        (part, from, to) => admin.from('statements').select('id, status').eq('org_id', orgId).in('id', part).order('id').range(from, to),
        'statements',
      )
    )
      .filter((s) => s.status !== 'void')
      .map((s) => s.id),
  );
  for (const l of lines) {
    const f = out.get(l.advance_id);
    if (f && live.has(l.statement_id)) f.referenced = true;
  }
  return out;
}

/** The advances a reader may see, with their recoupment facts. `payeeId` narrows to one payee. */
export async function listAdvances(admin: AdminClient, orgId: string, scope: ArtistScope, opts: { payeeId?: string } = {}): Promise<AdvanceWithFacts[]> {
  try {
    let rows: (AdvanceRow & { artist_contact_id: string | null })[];
    const cols = `${ADVANCE_COLUMNS}, artist_contact_id`;
    const read = (extra: (q: any) => any) => // eslint-disable-line @typescript-eslint/no-explicit-any
      (from: number, to: number) => extra(admin.from('advances').select(cols).eq('org_id', orgId)).order('created_at').order('id').range(from, to);
    const narrow = (q: any) => (opts.payeeId ? q.eq('payee_id', opts.payeeId) : q); // eslint-disable-line @typescript-eslint/no-explicit-any
    if (scope === null) {
      rows = await pageAll(read(narrow), 'advances');
    } else {
      rows = await inChunks([...scope], (part, from, to) => narrow(admin.from('advances').select(cols).eq('org_id', orgId).in('artist_contact_id', part)).order('id').range(from, to), 'advances');
      rows.sort((a, b) => (a.created_at === b.created_at ? a.id.localeCompare(b.id) : a.created_at.localeCompare(b.created_at)));
    }
    const facts = await advanceFacts(admin, orgId, rows.map((r) => r.id));
    return rows.map((r) => ({ ...r, facts: facts.get(r.id) ?? { recouped: ZERO, referenced: false } }));
  } catch (err) {
    return rethrow(err);
  }
}

/** One advance of the org, only if the reader's scope reaches it. */
export async function readAdvance(admin: AdminClient, orgId: string, id: string, scope: ArtistScope): Promise<AdvanceWithFacts | null> {
  const res = await admin.from('advances').select(`${ADVANCE_COLUMNS}, artist_contact_id`).eq('org_id', orgId).eq('id', id).maybeSingle();
  check('advance read', res.error);
  if (!res.data) return null;
  const row = res.data as AdvanceRow & { artist_contact_id: string | null };
  if (!scopeAllowsContact(scope, row.artist_contact_id)) return null;
  const facts = await advanceFacts(admin, orgId, [row.id]);
  return { ...row, facts: facts.get(row.id)! };
}

export type PayeeChoice = { id: string; name: string | null; currency: string; status: string; artistContactId: string | null };

export async function payeeChoices(admin: AdminClient, orgId: string, scope: ArtistScope): Promise<PayeeChoice[]> {
  const rows = await listPayees(admin, orgId, scope, { reference: false });
  const names = await payeeNames(admin, orgId, rows.map((r) => r.id));
  return rows
    .map((r) => ({ id: r.id, name: names.get(r.id) ?? null, currency: r.currency.trim(), status: r.status, artistContactId: r.artist_contact_id }))
    .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '') || a.id.localeCompare(b.id));
}

/** Everything `payeePositions` needs, for the payees a reader may see. */
export async function loadPositionFacts(admin: AdminClient, orgId: string, scope: ArtistScope): Promise<PositionFacts> {
  const choices = await payeeChoices(admin, orgId, scope);
  const payees: PositionPayee[] = choices.map((c) => ({ id: c.id, name: c.name, currency: c.currency, artistContactId: c.artistContactId, status: c.status }));
  const ids = payees.map((p) => p.id);
  try {
    const [advances, allocs, recoups, statements, payments] = await Promise.all([
      scope === null ? listAdvances(admin, orgId, null) : listAdvances(admin, orgId, scope),
      inChunks<{ payee_id: string; payable_minor: unknown }>(
        ids,
        (part, from, to) => admin.from('earnings_allocations').select('payee_id, payable_minor').eq('org_id', orgId).in('payee_id', part).order('id').range(from, to),
        'allocations',
      ),
      inChunks<{ payee_id: string; amount_minor: unknown }>(
        ids,
        (part, from, to) => admin.from('earnings_recoupments').select('payee_id, amount_minor').eq('org_id', orgId).in('payee_id', part).order('id').range(from, to),
        'recoupments',
      ),
      inChunks<{ payee_id: string; status: string; net_minor: unknown }>(
        ids,
        (part, from, to) => admin.from('statements').select('payee_id, status, net_minor').eq('org_id', orgId).in('payee_id', part).order('id').range(from, to),
        'statements',
      ),
      inChunks<{ payee_id: string; amount_minor: unknown; voided_at: string | null }>(
        ids,
        (part, from, to) => admin.from('payments').select('payee_id, amount_minor, voided_at').eq('org_id', orgId).in('payee_id', part).order('id').range(from, to),
        'payments',
      ),
    ]);
    const sumBy = (rows: { payee_id: string; payable_minor?: unknown; amount_minor?: unknown }[], col: 'payable_minor' | 'amount_minor') => {
      const m = new Map<string, bigint>();
      for (const r of rows) m.set(r.payee_id, (m.get(r.payee_id) ?? ZERO) + minorFromDb(r[col]));
      return m;
    };
    return {
      payees,
      advances,
      earnedByPayee: sumBy(allocs, 'payable_minor'),
      recoupedByPayee: sumBy(recoups, 'amount_minor'),
      statements,
      payments,
    };
  } catch (err) {
    return rethrow(err);
  }
}

/** The releases of the org (every one: attribution needs them all), their items, and their live earnings lines. */
/**
 * `payeeIds` limits the royalties summed per line to those payees (a scoped reader sees their own payees' share only,
 * never another payee's); null = every payee.
 */
export async function loadReleaseFacts(admin: AdminClient, orgId: string, payeeIds: ReadonlySet<string> | null = null): Promise<{ releases: ReleaseFact[]; items: ItemFact[]; lines: LineFact[]; royaltiesByLine: Map<string, bigint>; spend: SpendFact[] }> {
  try {
    const releases = await pageAll<ReleaseFact>(
      (from, to) => admin.from('releases').select('id, title, state, upc, release_date, contact_id').eq('org_id', orgId).order('id').range(from, to),
      'releases',
    );
    const items = await inChunks<ItemFact>(
      releases.map((r) => r.id),
      (part, from, to) => admin.from('release_items').select('release_id, song_track_id').eq('org_id', orgId).in('release_id', part).order('id').range(from, to),
      'release items',
    );
    const imports = await pageAll<{ id: string }>(
      (from, to) => admin.from('earnings_imports').select('id').eq('org_id', orgId).eq('status', 'imported').order('id').range(from, to),
      'imports',
    );
    const importIds = imports.map((i) => i.id);
    const lines = await inChunks<LineFact>(
      importIds,
      (part, from, to) => admin.from('earnings_lines').select('id, upc, song_track_id, gross_minor, currency').eq('org_id', orgId).in('import_id', part).order('id').range(from, to),
      'earnings lines',
    );
    const allocs = await inChunks<{ line_id: string; payee_id: string; payable_minor: unknown }>(
      importIds,
      (part, from, to) => admin.from('earnings_allocations').select('line_id, payee_id, payable_minor').eq('org_id', orgId).in('import_id', part).order('id').range(from, to),
      'allocations',
    );
    const royaltiesByLine = new Map<string, bigint>();
    for (const a of allocs.filter((x) => payeeIds === null || payeeIds.has(x.payee_id))) royaltiesByLine.set(a.line_id, (royaltiesByLine.get(a.line_id) ?? ZERO) + minorFromDb(a.payable_minor));
    return { releases, items, lines, royaltiesByLine, spend: await loadSpend(admin, orgId) };
  } catch (err) {
    return rethrow(err);
  }
}

/** Marketing budget lines (183) with their release. Absent table = no recorded cost, not an error. */
async function loadSpend(admin: AdminClient, orgId: string): Promise<SpendFact[]> {
  try {
    const plans = await pageAll<{ id: string; release_id: string }>(
      (from, to) => admin.from('marketing_plans').select('id, release_id').eq('org_id', orgId).order('id').range(from, to),
      'marketing plans',
    );
    if (plans.length === 0) return [];
    const releaseOf = new Map(plans.map((p) => [p.id, p.release_id]));
    const lines = await inChunks<{ plan_id: string; status: string; amount_minor: unknown; currency: string }>(
      plans.map((p) => p.id),
      (part, from, to) => admin.from('marketing_budget_lines').select('plan_id, status, amount_minor, currency').eq('org_id', orgId).in('plan_id', part).order('id').range(from, to),
      'budget lines',
    );
    return lines.flatMap((l) => {
      const release_id = releaseOf.get(l.plan_id);
      return release_id ? [{ release_id, status: l.status, amount_minor: l.amount_minor, currency: l.currency }] : [];
    });
  } catch (err) {
    if (err instanceof ReadError && isMissingFinanceSchema(err.raw as DbError)) return [];
    throw err;
  }
}

/** Releases the reader's artist scope reaches (null = all). */
export function visibleReleaseIds(releases: readonly ReleaseFact[], scope: ArtistScope): Set<string> | null {
  if (scope === null) return null;
  return new Set(releases.filter((r) => scopeAllowsContact(scope, r.contact_id)).map((r) => r.id));
}

/** Periods with the counts the close decision needs. Whole-organization readers only. */
export async function loadPeriodOverviews(admin: AdminClient, orgId: string): Promise<PeriodOverview[]> {
  try {
    const periods = await pageAll<{ id: string; label: string; starts_on: string; ends_on: string; status: string; closed_at: string | null }>(
      (from, to) => admin.from('finance_periods').select('id, label, starts_on, ends_on, status, closed_at').eq('org_id', orgId).order('starts_on', { ascending: false }).order('id').range(from, to),
      'periods',
    );
    if (periods.length === 0) return [];
    const ids = periods.map((p) => p.id);
    const imports = await inChunks<{ id: string; period_id: string }>(
      ids,
      (part, from, to) => admin.from('earnings_imports').select('id, period_id').eq('org_id', orgId).eq('status', 'imported').in('period_id', part).order('id').range(from, to),
      'imports',
    );
    const statements = await inChunks<{ payee_id: string; period_id: string; status: string }>(
      ids,
      (part, from, to) => admin.from('statements').select('payee_id, period_id, status').eq('org_id', orgId).in('period_id', part).order('id').range(from, to),
      'statements',
    );
    const importPeriod = new Map(imports.map((i) => [i.id, i.period_id]));
    const waiting = await inChunks<{ import_id: string }>(
      imports.map((i) => i.id),
      (part, from, to) => admin.from('earnings_lines').select('import_id').eq('org_id', orgId).not('review_reason', 'is', null).in('import_id', part).order('id').range(from, to),
      'waiting lines',
    );
    const waitingBy = new Map<string, number>();
    for (const w of waiting) {
      const p = importPeriod.get(w.import_id);
      if (p) waitingBy.set(p, (waitingBy.get(p) ?? 0) + 1);
    }
    const allocs = await inChunks<{ payee_id: string; import_id: string }>(
      imports.map((i) => i.id),
      (part, from, to) => admin.from('earnings_allocations').select('payee_id, import_id').eq('org_id', orgId).in('import_id', part).order('id').range(from, to),
      'allocations',
    );
    const earning = new Map<string, Set<string>>(); // period → payees with an allocation
    for (const a of allocs) {
      const p = importPeriod.get(a.import_id);
      if (!p) continue;
      const s = earning.get(p) ?? new Set<string>();
      s.add(a.payee_id);
      earning.set(p, s);
    }
    const stated = new Map<string, Set<string>>();
    const drafts = new Map<string, number>();
    for (const s of statements) {
      if (s.status === 'void') continue;
      const set = stated.get(s.period_id) ?? new Set<string>();
      set.add(s.payee_id);
      stated.set(s.period_id, set);
      if (s.status === 'draft') drafts.set(s.period_id, (drafts.get(s.period_id) ?? 0) + 1);
    }
    return periods.map((p) => {
      const payees = earning.get(p.id) ?? new Set<string>();
      const have = stated.get(p.id) ?? new Set<string>();
      return {
        id: p.id, label: p.label, startsOn: p.starts_on, endsOn: p.ends_on, status: p.status, closedAt: p.closed_at,
        draftStatements: drafts.get(p.id) ?? 0,
        linesWaiting: waitingBy.get(p.id) ?? 0,
        payeesWithoutStatement: [...payees].filter((x) => !have.has(x)).length,
        imports: imports.filter((i) => i.period_id === p.id).length,
      };
    });
  } catch (err) {
    return rethrow(err);
  }
}

export async function periodExists(admin: AdminClient, orgId: string, periodId: string): Promise<boolean> {
  const res = await admin.from('finance_periods').select('id').eq('org_id', orgId).eq('id', periodId).maybeSingle();
  check('period read', res.error);
  return !!res.data;
}
