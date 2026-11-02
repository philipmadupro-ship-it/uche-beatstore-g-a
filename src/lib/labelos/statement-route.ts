/**
 * Shared plumbing of the statement routes (LABEL-63): the JSON helper, and the one place a route
 * resolves "this statement, for this caller, with this capability".
 *
 * Reads need no capability beyond the finance module: staff (`finance.read`) read what their artist
 * scope reaches, the payee's own artist reads their ISSUED statements, and everyone else is refused.
 * A statement the caller cannot read is 404, never 403 — the route does not confirm it exists.
 * Mutations ask for their capability first (403 / 404 as `requireOrgModule`), then require the
 * statement to be in the caller's artist scope.
 */
import { NextResponse } from 'next/server';
import { requireOrgModule, type OrgAccessOk } from '@/lib/auth/org-access';
import type { Capability } from '@/lib/labelos/capabilities';
import { isUUID } from '@/lib/validate';
import type { StatementFull } from './finance/statement-view';
import { mayReadStatement, type StatementReader } from './statement-access';
import { readStatement, resolveReader } from './statement-store';

export const NO_STORE = { 'Cache-Control': 'no-store' };
export const json = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: NO_STORE });

export type StatementContext = { access: OrgAccessOk; reader: StatementReader; row: StatementFull };

export async function resolveStatement(orgId: string, statementId: string, cap?: Capability): Promise<{ ok: true; ctx: StatementContext } | { ok: false; res: NextResponse }> {
  const access = await requireOrgModule(orgId, 'finance', cap);
  if (!access.ok) return { ok: false, res: access.res };
  if (!isUUID(statementId)) return { ok: false, res: json(404, { error: 'Statement not found' }) };
  const reader = await resolveReader(access.admin, access.orgId, access.userId, access);
  if (!reader) return { ok: false, res: json(404, { error: 'Statement not found' }) };
  // A mutation is a staff act: the payee's own artist only ever reads.
  if (cap && reader.kind !== 'staff') return { ok: false, res: json(403, { error: 'Not allowed' }) };
  const row = await readStatement(access.admin, access.orgId, statementId);
  if (!row || !mayReadStatement(reader, row)) return { ok: false, res: json(404, { error: 'Statement not found' }) };
  return { ok: true, ctx: { access, reader, row } };
}
