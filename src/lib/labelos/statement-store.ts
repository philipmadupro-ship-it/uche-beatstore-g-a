/**
 * The reads and writes behind the statement routes (LABEL-63). Rules are in `finance/statement-*`;
 * this file loads the facts they need and hands the result to the database's atomic functions
 * (migration 181). Service-role client, org filter on every query; authorisation is the route's.
 *
 * Migration 179/180/181 may not be applied: a missing table or function is
 * `StatementsNotReadyError`, which routes answer as "not set up yet" (GET: `schemaReady: false`;
 * writes: 503 naming the migration). Every write probes with a read first.
 */
import type { AdminClient } from '@/lib/auth/ownership';
import { isMissingAuditRpc, type AuditRpcArgs } from './audit-rpc';
import { isMissingFinanceSchema } from './finance-store';
import { buildStatementLines, type AllocationFact, type RecoupmentFact } from './finance/statement-calc';
import { minorFromDb } from './finance/money';
import type { PaymentFull, PeriodRow, StatementFull, StatementLineFull } from './finance/statement-view';
import { inChunks, pageAll, ReadError } from './paged-read';
import { answerableFor } from './store-consent-store';
import type { StatementReader } from './statement-access';

export const STATEMENTS_NOT_READY = 'Statements are not set up on this database yet (migrations 179, 180 and 181).';

export class StatementsNotReadyError extends Error {
  constructor() {
    super('migration 179, 180 or 181 is not applied');
  }
}

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

/** 180's allocations table is part of what a statement is made of; probe it and the statements table. */
export async function assertStatementsSchema(admin: AdminClient): Promise<void> {
  const a = await admin.from('statements').select('id').limit(1);
  check('statements probe', a.error);
  const b = await admin.from('earnings_allocations').select('id').limit(1);
  check('allocations probe', b.error);
}

// ── Periods ──────────────────────────────────────────────────────────────

const PERIOD_COLUMNS = 'id, label, starts_on, ends_on, status';

export async function listPeriods(admin: AdminClient, orgId: string): Promise<PeriodRow[]> {
  try {
    return await pageAll<PeriodRow>((from, to) => admin.from('finance_periods').select(PERIOD_COLUMNS).eq('org_id', orgId).order('starts_on', { ascending: false }).order('id').range(from, to), 'periods');
  } catch (err) {
    return rethrow(err);
  }
}

export async function insertPeriod(
  admin: AdminClient,
  orgId: string,
  userId: string,
  body: { label: string; starts_on: string; ends_on: string },
): Promise<{ period: PeriodRow } | { duplicate: true }> {
  await assertStatementsSchema(admin);
  const res = await admin
    .from('finance_periods')
    .insert({ org_id: orgId, label: body.label, starts_on: body.starts_on, ends_on: body.ends_on, created_by: userId })
    .select(PERIOD_COLUMNS)
    .single();
  if (res.error) {
    if (res.error.code === '23505') return { duplicate: true };
    check('period insert', res.error);
  }
  return { period: res.data as PeriodRow };
}

// ── Payees ───────────────────────────────────────────────────────────────

export type PayeeFacts = { id: string; party_id: string; artist_contact_id: string | null; currency: string; status: string; name: string };

export async function readPayee(admin: AdminClient, orgId: string, payeeId: string): Promise<PayeeFacts | null> {
  const res = await admin.from('payees').select('id, party_id, artist_contact_id, currency, status').eq('org_id', orgId).eq('id', payeeId).maybeSingle();
  check('payee read', res.error);
  if (!res.data) return null;
  const row = res.data as Omit<PayeeFacts, 'name'>;
  const names = await payeeNames(admin, orgId, [row.id]);
  return { ...row, currency: row.currency.trim(), name: names.get(row.id) ?? 'Payee' };
}

/** payee id → the party's display name (never the legal name: that is rights data). */
export async function payeeNames(admin: AdminClient, orgId: string, payeeIds: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (payeeIds.length === 0) return out;
  try {
    const payees = await inChunks<{ id: string; party_id: string }>(
      payeeIds,
      (part, from, to) => admin.from('payees').select('id, party_id').eq('org_id', orgId).in('id', part).order('id', { ascending: true }).range(from, to),
      'payees',
    );
    const parties = await inChunks<{ id: string; display_name: string }>(
      payees.map((p) => p.party_id),
      (part, from, to) => admin.from('parties').select('id, display_name').eq('org_id', orgId).in('id', part).order('id', { ascending: true }).range(from, to),
      'parties',
    );
    const byParty = new Map(parties.map((p) => [p.id, p.display_name]));
    for (const p of payees) out.set(p.id, byParty.get(p.party_id) ?? 'Payee');
  } catch (err) {
    rethrow(err);
  }
  return out;
}

// ── Sources, generation ──────────────────────────────────────────────────

/**
 * What a payee's statement for a period is made of: their allocations on the period's (non-void)
 * imports and the recoupments LABEL-62 already took against them. Read, never recomputed.
 */
export async function loadSources(
  admin: AdminClient,
  orgId: string,
  payeeId: string,
  periodId: string,
): Promise<{ allocations: AllocationFact[]; recoupments: RecoupmentFact[]; songIds: string[] }> {
  try {
    const imports = await pageAll<{ id: string }>(
      (from, to) => admin.from('earnings_imports').select('id').eq('org_id', orgId).eq('period_id', periodId).eq('status', 'imported').order('id').range(from, to),
      'imports',
    );
    if (imports.length === 0) return { allocations: [], recoupments: [], songIds: [] };
    const allocRows = await inChunks<{ id: string; line_id: string; song_track_id: string; units: number; payable_minor: unknown; currency: string }>(
      imports.map((i) => i.id),
      (part, from, to) =>
        admin.from('earnings_allocations').select('id, line_id, song_track_id, units, payable_minor, currency').eq('org_id', orgId).eq('payee_id', payeeId).in('import_id', part).order('id').range(from, to),
      'allocations',
    );
    const lineOf = new Map(allocRows.map((a) => [a.id, a.line_id]));
    const recRows = await inChunks<{ allocation_id: string; advance_id: string; amount_minor: unknown; currency: string }>(
      imports.map((i) => i.id),
      (part, from, to) =>
        admin.from('earnings_recoupments').select('allocation_id, advance_id, amount_minor, currency').eq('org_id', orgId).eq('payee_id', payeeId).in('import_id', part).order('id').range(from, to),
      'recoupments',
    );
    const allocations: AllocationFact[] = allocRows.map((a) => ({
      lineId: a.line_id,
      songTrackId: a.song_track_id,
      units: a.units,
      payableMinor: minorFromDb(a.payable_minor),
      currency: a.currency.trim(),
    }));
    const recoupments: RecoupmentFact[] = recRows.map((r) => ({
      lineId: lineOf.get(r.allocation_id) ?? '',
      advanceId: r.advance_id,
      amountMinor: minorFromDb(r.amount_minor),
      currency: r.currency.trim(),
    }));
    return { allocations, recoupments, songIds: [...new Set(allocRows.map((a) => a.song_track_id))] };
  } catch (err) {
    return rethrow(err);
  }
}

export async function songTitles(admin: AdminClient, orgId: string, songIds: readonly string[]): Promise<Map<string, string>> {
  if (songIds.length === 0) return new Map();
  try {
    const rows = await inChunks<{ id: string; title: string | null }>(
      songIds,
      (part, from, to) => admin.from('tracks').select('id, title').eq('org_id', orgId).in('id', part).order('id', { ascending: true }).range(from, to),
      'songs',
    );
    return new Map(rows.map((r) => [r.id, r.title ?? 'Song']));
  } catch (err) {
    return rethrow(err);
  }
}

export type GenerateOutcome =
  | { ok: true; id: string; lines: number }
  | { ok: false; code: 'not_found' | 'payee_inactive' | 'period_closed' | 'statement_exists' | 'nothing_to_include' | 'moved'; message: string; status?: string };

const GENERATE_MESSAGE: Record<string, string> = {
  not_found: 'That payee or period was not found.',
  payee_inactive: 'That payee is inactive.',
  period_closed: 'That period is closed, so it takes no new statement.',
  statement_exists: 'This payee already has an approved or issued statement for that period. Void it first to make a new one.',
  nothing_to_include: 'This payee has nothing allocated in that period.',
  moved: 'The earnings changed while this was being made. Nothing was written; try again.',
};

/**
 * The arguments of `labelos_audit_statement_generate` for one payee and period, built from the
 * allocations and recoupments LABEL-62 stored (read, never recomputed). The ROUTE makes the call
 * (`auditRpc`, so the coverage test sees the event) and hands the answer to `generateOutcome`.
 */
export async function prepareStatement(
  admin: AdminClient,
  orgId: string,
  actor: string,
  payee: PayeeFacts,
  periodId: string,
): Promise<{ empty: true } | { empty: false; args: AuditRpcArgs['statementGenerate'] }> {
  await assertStatementsSchema(admin);
  const sources = await loadSources(admin, orgId, payee.id, periodId);
  if (sources.allocations.length === 0) return { empty: true };
  const titles = await songTitles(admin, orgId, sources.songIds);
  const built = buildStatementLines(payee.currency, sources.allocations, sources.recoupments, titles);
  return {
    empty: false,
    args: {
      p_org: orgId,
      p_actor: actor,
      p_payee: payee.id,
      p_period: periodId,
      p_lines: built.lines.map((l) => ({
        kind: l.kind,
        earnings_line_id: l.earningsLineId,
        advance_id: l.advanceId,
        track_id: l.trackId,
        description: l.description,
        share_units: l.shareUnits,
        amount_minor: l.amountMinor.toString(),
        position: l.position,
      })),
      p_payload: { periodId, allocations: sources.allocations.length, recoupments: sources.recoupments.length },
    },
  };
}

export const emptyOutcome = (): GenerateOutcome => ({ ok: false, code: 'nothing_to_include', message: GENERATE_MESSAGE.nothing_to_include });

export function generateOutcome(result: { data: Record<string, unknown> | null; error: { message: string; code?: string } | null }): GenerateOutcome {
  const { data, error } = result;
  if (error) {
    if (isMissingAuditRpc(error)) throw new StatementsNotReadyError();
    if (/sources_mismatch|already_on_statement/.test(error.message) || error.code === '40001') return { ok: false, code: 'moved', message: GENERATE_MESSAGE.moved };
    throw new Error(`statement generate: ${error.message}`);
  }
  const err = typeof data?.error === 'string' ? data.error : null;
  if (err) {
    const code = (err in GENERATE_MESSAGE ? err : 'not_found') as Exclude<GenerateOutcome, { ok: true }>['code'];
    return { ok: false, code, message: GENERATE_MESSAGE[code], ...(typeof data?.status === 'string' ? { status: data.status } : {}) };
  }
  return { ok: true, id: String(data?.id), lines: Number(data?.lines ?? 0) };
}

/** The answer of any of the other atomic functions: `{ error }` is an expected refusal; a missing function is "not set up". */
export function rpcAnswer(result: { data: Record<string, unknown> | null; error: { message: string; code?: string } | null }, what: string): { error: string; data: Record<string, unknown> } | { error: null; data: Record<string, unknown> } {
  if (result.error) {
    if (isMissingAuditRpc(result.error)) throw new StatementsNotReadyError();
    // Constraint refusals the functions leave to the database (a reference that looks like an account number, a payment above the net).
    if (/exceeds_net/.test(result.error.message)) return { error: 'exceeds_net', data: {} };
    if (/has_payments/.test(result.error.message)) return { error: 'has_payments', data: {} };
    if (result.error.code === '23514') return { error: 'refused', data: {} };
    throw new Error(`${what}: ${result.error.message}`);
  }
  const data = result.data ?? {};
  return typeof data.error === 'string' ? { error: data.error, data } : { error: null, data };
}

// ── Reads ────────────────────────────────────────────────────────────────

const STATEMENT_COLUMNS =
  'id, payee_id, period_id, artist_contact_id, currency, net_minor, status, created_by, approved_by, approved_at, issued_at, voided_at, void_reason, created_at';
const LINE_COLUMNS = 'id, statement_id, kind, track_id, earnings_line_id, advance_id, description, share_units, amount_minor, currency, position';
const PAYMENT_COLUMNS = 'id, statement_id, amount_minor, currency, paid_on, reference, voided_at, recorded_by, created_at';

/** The reader the caller is: staff, or the payee's own artist. Null = neither (the route refuses). */
export async function resolveReader(
  admin: AdminClient,
  orgId: string,
  userId: string,
  access: { role: string; capabilities: ReadonlySet<string>; artistScope: ReadonlySet<string> | null },
): Promise<StatementReader | null> {
  if (access.role !== 'artist' && access.capabilities.has('finance.read')) return { kind: 'staff', artists: access.artistScope };
  const contacts = await answerableFor(admin, orgId, userId);
  if (contacts.length === 0) return null;
  try {
    const rows = await inChunks<{ id: string }>(
      contacts,
      (part, from, to) => admin.from('payees').select('id').eq('org_id', orgId).in('artist_contact_id', part).order('id', { ascending: true }).range(from, to),
      'own payees',
    );
    return { kind: 'own', payeeIds: new Set(rows.map((r) => r.id)) };
  } catch (err) {
    return rethrow(err);
  }
}

export async function readStatement(admin: AdminClient, orgId: string, id: string): Promise<StatementFull | null> {
  const res = await admin.from('statements').select(STATEMENT_COLUMNS).eq('org_id', orgId).eq('id', id).maybeSingle();
  check('statement read', res.error);
  return (res.data as StatementFull | null) ?? null;
}

export async function listStatementRows(admin: AdminClient, orgId: string, reader: StatementReader): Promise<StatementFull[]> {
  try {
    if (reader.kind === 'own') {
      return await inChunks<StatementFull>(
        [...reader.payeeIds],
        (part, from, to) => admin.from('statements').select(STATEMENT_COLUMNS).eq('org_id', orgId).eq('status', 'issued').in('payee_id', part).order('id', { ascending: true }).range(from, to),
        'statements',
      );
    }
    if (reader.artists === null) {
      return await pageAll<StatementFull>((from, to) => admin.from('statements').select(STATEMENT_COLUMNS).eq('org_id', orgId).order('created_at', { ascending: false }).order('id').range(from, to), 'statements');
    }
    return await inChunks<StatementFull>(
      [...reader.artists],
      (part, from, to) => admin.from('statements').select(STATEMENT_COLUMNS).eq('org_id', orgId).in('artist_contact_id', part).order('id', { ascending: true }).range(from, to),
      'statements',
    );
  } catch (err) {
    return rethrow(err);
  }
}

export async function readLines(admin: AdminClient, orgId: string, statementId: string): Promise<StatementLineFull[]> {
  try {
    return await pageAll<StatementLineFull>(
      (from, to) => admin.from('statement_lines').select(LINE_COLUMNS).eq('org_id', orgId).eq('statement_id', statementId).order('position', { ascending: true }).order('id').range(from, to),
      'statement lines',
    );
  } catch (err) {
    return rethrow(err);
  }
}

export async function readPayments(admin: AdminClient, orgId: string, statementIds: readonly string[]): Promise<PaymentFull[]> {
  if (statementIds.length === 0) return [];
  try {
    return await inChunks<PaymentFull>(
      statementIds,
      (part, from, to) => admin.from('payments').select(PAYMENT_COLUMNS).eq('org_id', orgId).in('statement_id', part).order('created_at', { ascending: true }).order('id').range(from, to),
      'payments',
    );
  } catch (err) {
    return rethrow(err);
  }
}

export async function readPayment(admin: AdminClient, orgId: string, id: string): Promise<(PaymentFull & { payee_id: string }) | null> {
  const res = await admin.from('payments').select(`${PAYMENT_COLUMNS}, payee_id`).eq('org_id', orgId).eq('id', id).maybeSingle();
  check('payment read', res.error);
  return (res.data as (PaymentFull & { payee_id: string }) | null) ?? null;
}

export async function periodsById(admin: AdminClient, orgId: string, ids: readonly string[]): Promise<Map<string, PeriodRow>> {
  if (ids.length === 0) return new Map();
  try {
    const rows = await inChunks<PeriodRow>(
      ids,
      (part, from, to) => admin.from('finance_periods').select(PERIOD_COLUMNS).eq('org_id', orgId).in('id', part).order('id', { ascending: true }).range(from, to),
      'periods',
    );
    return new Map(rows.map((r) => [r.id, r]));
  } catch (err) {
    return rethrow(err);
  }
}

/** Is this user an OWNER of the org (the rule's exception for the person who generated a draft)? */
export async function isOrgOwner(admin: AdminClient, orgId: string, userId: string): Promise<boolean> {
  const res = await admin.from('org_members').select('role').eq('org_id', orgId).eq('user_id', userId).maybeSingle();
  if (res.error) throw new Error(res.error.message);
  return (res.data as { role?: string } | null)?.role === 'owner';
}
