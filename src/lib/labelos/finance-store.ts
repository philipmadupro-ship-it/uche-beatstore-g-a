/**
 * The reads and writes behind the finance routes (LABEL-61). Rules are in
 * `finance/*`; this file only touches the database. Service-role client, org
 * filter on every query; authorisation is the route's.
 *
 * Migration 179 may not be applied: a missing table is `FinanceNotReadyError`,
 * which routes answer as "not set up yet" (GET: `schemaReady: false`; writes:
 * 503 naming 179). PostgREST answers an INSERT into a missing table with an
 * empty 404 that carries no code, so every write probes with a read first
 * (`assertFinanceSchema`).
 */
import type { AdminClient } from '@/lib/auth/ownership';
import type { ArtistScope } from './artist-scope';
import type { PayeeRow, StatementLineRow, StatementRow } from './finance/view';
import { answerableFor } from './store-consent-store';
import { inChunks, pageAll, ReadError } from './paged-read';

export const FINANCE_NOT_READY = 'Finance is not set up on this database yet (migration 179).';

export class FinanceNotReadyError extends Error {
  constructor() {
    super('migration 179 is not applied');
  }
}

type DbError = { message: string; code?: string } | null | undefined;

export function isMissingFinanceSchema(error: DbError): boolean {
  if (!error) return false;
  // A missing relation only: a missing COLUMN is a bug (or another migration), never "not set up".
  return ['PGRST205', '42P01'].includes(error.code ?? '');
}

function check(what: string, error: DbError): void {
  if (!error) return;
  if (isMissingFinanceSchema(error)) throw new FinanceNotReadyError();
  throw new Error(`${what}: ${error.message}`);
}

function rethrowRead(err: unknown): never {
  if (err instanceof ReadError) check(err.message, err.raw as DbError);
  throw err;
}

export async function assertFinanceSchema(admin: AdminClient): Promise<void> {
  const res = await admin.from('payees').select('id').limit(1);
  check('payees probe', res.error);
}

const PAYEE_COLUMNS = 'id, party_id, artist_contact_id, currency, status, created_at';
const STATEMENT_COLUMNS = 'id, payee_id, period_id, currency, net_minor, status, approved_at, issued_at, created_at';
const LINE_COLUMNS = 'id, statement_id, kind, track_id, description, share_units, amount_minor, currency, position';

/**
 * Payees a staff reader may see: the whole org, or — for a member limited to
 * some artists — the payees of those artists (a payee with no roster artist is
 * whole-org only, like the database says).
 */
export async function listPayees(admin: AdminClient, orgId: string, scope: ArtistScope, opts: { reference: boolean }): Promise<PayeeRow[]> {
  const cols = opts.reference ? `${PAYEE_COLUMNS}, payment_reference` : PAYEE_COLUMNS;
  try {
    if (scope === null) {
      return await pageAll<PayeeRow>((from, to) => admin.from('payees').select(cols).eq('org_id', orgId).order('id', { ascending: true }).range(from, to), 'payees');
    }
    return await inChunks<PayeeRow>(
      [...scope],
      (part, from, to) => admin.from('payees').select(cols).eq('org_id', orgId).in('artist_contact_id', part).order('id', { ascending: true }).range(from, to),
      'payees',
    );
  } catch (err) {
    return rethrowRead(err);
  }
}

/** The payees that ARE this account (the TS twin of labelos_my_payees()). */
export async function ownPayeeIds(admin: AdminClient, orgId: string, userId: string): Promise<string[]> {
  const contacts = await answerableFor(admin, orgId, userId);
  if (contacts.length === 0) return [];
  try {
    const rows = await inChunks<{ id: string }>(
      contacts,
      (part, from, to) => admin.from('payees').select('id').eq('org_id', orgId).in('artist_contact_id', part).order('id', { ascending: true }).range(from, to),
      'own payees',
    );
    return rows.map((r) => r.id);
  } catch (err) {
    return rethrowRead(err);
  }
}

export type StatementReadScope = { kind: 'staff'; artists: ArtistScope } | { kind: 'own'; payeeIds: string[] };

export async function listStatements(admin: AdminClient, orgId: string, scope: StatementReadScope): Promise<{ statements: StatementRow[]; lines: StatementLineRow[] }> {
  try {
    let statements: StatementRow[];
    if (scope.kind === 'own') {
      statements = await inChunks<StatementRow>(
        scope.payeeIds,
        (part, from, to) =>
          admin.from('statements').select(STATEMENT_COLUMNS).eq('org_id', orgId).eq('status', 'issued').in('payee_id', part).order('id', { ascending: true }).range(from, to),
        'statements',
      );
    } else if (scope.artists === null) {
      statements = await pageAll<StatementRow>(
        (from, to) => admin.from('statements').select(STATEMENT_COLUMNS).eq('org_id', orgId).order('id', { ascending: true }).range(from, to),
        'statements',
      );
    } else {
      statements = await inChunks<StatementRow>(
        [...scope.artists],
        (part, from, to) =>
          admin.from('statements').select(STATEMENT_COLUMNS).eq('org_id', orgId).in('artist_contact_id', part).order('id', { ascending: true }).range(from, to),
        'statements',
      );
    }
    const lines = await inChunks<StatementLineRow>(
      statements.map((s) => s.id),
      (part, from, to) =>
        admin.from('statement_lines').select(LINE_COLUMNS).eq('org_id', orgId).in('statement_id', part).order('statement_id', { ascending: true }).order('position', { ascending: true }).order('id', { ascending: true }).range(from, to),
      'statement lines',
    );
    return { statements, lines };
  } catch (err) {
    return rethrowRead(err);
  }
}

/** The party a payee would be made from: its id and the roster contact it names (null = none). */
export async function partyForPayee(admin: AdminClient, orgId: string, partyId: string): Promise<{ id: string; contact_id: string | null } | null> {
  const res = await admin.from('parties').select('id, contact_id').eq('org_id', orgId).eq('id', partyId).maybeSingle();
  if (res.error) throw new Error(`party read: ${res.error.message}`);
  return (res.data as { id: string; contact_id: string | null } | null) ?? null;
}

export async function insertPayee(
  admin: AdminClient,
  orgId: string,
  userId: string,
  body: { party_id: string; currency: string; payment_reference?: string },
  /** The party's roster contact. The database trigger sets the same value itself and ignores what is sent; sending it keeps the row honest in a test double. */
  partyContactId: string | null,
): Promise<{ payee: PayeeRow } | { duplicate: true } | { invalid: true }> {
  await assertFinanceSchema(admin);
  const res = await admin
    .from('payees')
    .insert({ org_id: orgId, party_id: body.party_id, artist_contact_id: partyContactId, currency: body.currency, payment_reference: body.payment_reference ?? null, created_by: userId })
    .select(`${PAYEE_COLUMNS}, payment_reference`)
    .single();
  if (res.error) {
    if (res.error.code === '23505') return { duplicate: true };
    if (res.error.code === '23514') return { invalid: true };
    check('payee insert', res.error);
  }
  return { payee: res.data as PayeeRow };
}

