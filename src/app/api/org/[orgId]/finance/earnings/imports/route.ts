/**
 * /api/org/[orgId]/finance/earnings/imports (LABEL-62).
 *
 *   GET   the imported files. `finance.read`, never a roster artist, and only
 *         a whole-organization finance reader: a file is not per-artist, so a
 *         member limited to some artists gets an empty list (`scoped: true`).
 *   POST  import a distributor CSV (multipart: `file` + the fields of
 *         `OrgEarningsImportFieldsSchema`). `finance.write`, whole-org.
 *
 * The file is hashed as the exact bytes uploaded; the same file imported again
 * is a no-op that returns the original import (`created: false`, 200) and
 * records nothing. Parsing, matching, allocation and recoupment are pure
 * (`lib/labelos/finance/earnings-*.ts`); the rows are written by ONE Postgres
 * function in ONE transaction, so an import is whole or absent. All-or-nothing
 * on a bad row: the file is refused, naming the first rows.
 *
 * The module is `finance`: an org not licensed for it answers 404. Events name
 * ids and counts, never amounts or names. No FX: a file in one currency, a
 * payee paid in another → those lines wait for review.
 */
import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { requireOrgModule } from '@/lib/auth/org-access';
import { isSupabaseConfigured } from '@/lib/db';
import { OrgEarningsImportFieldsSchema } from '@/lib/contracts';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { recordEvent } from '@/lib/labelos/activity';
import { calculate, EARNINGS_NOT_READY, EarningsNotReadyError, importEarnings, listImports } from '@/lib/labelos/earnings-store';
import { CSV_FAILURE_MESSAGE, MAX_FILE_BYTES, parseCsv } from '@/lib/labelos/finance/earnings-csv';
import { buildLines, PRESETS } from '@/lib/labelos/finance/earnings-import';
import { importView } from '@/lib/labelos/finance/earnings-view';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const log = createLogger('api.org.finance.earnings.imports');
const NO_STORE = { 'Cache-Control': 'no-store' };
const json = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: NO_STORE });

/** Said whenever the same bytes come in again: the options are NOT re-applied, which is the one thing a person might expect. */
const SAME_FILE_MESSAGE =
  'This file was imported before, so nothing changed. The original import stands with the options it was made with (service, currency, income class, rounding); a change to those options does not re-import it.';

type Params = { params: Promise<{ orgId: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { orgId } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'Finance needs Supabase.' });
  const access = await requireOrgModule(orgId, 'finance', 'finance.read');
  if (!access.ok) return access.res;
  if (access.role === 'artist') return json(403, { error: 'Not allowed' });
  const canWrite = access.capabilities.has('finance.write') && access.artistScope === null;
  if (access.artistScope !== null) return json(200, { schemaReady: true, canWrite: false, scoped: true, imports: [] });
  try {
    const rows = await listImports(access.admin, access.orgId);
    return json(200, { schemaReady: true, canWrite, scoped: false, imports: rows.map(importView) });
  } catch (err) {
    if (err instanceof EarningsNotReadyError) return json(200, { schemaReady: false, canWrite: false, scoped: false, imports: [] });
    log.error('import list failed', { orgId: access.orgId, error: errorMessage(err) });
    return json(500, { error: 'Could not load the imports' });
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  const { orgId } = await params;
  if (!isSupabaseConfigured()) return json(501, { error: 'Finance needs Supabase.' });
  const access = await requireOrgModule(orgId, 'finance', 'finance.write');
  if (!access.ok) return access.res;
  if (access.role === 'artist') return json(403, { error: 'Not allowed' });
  // An import allocates across every artist's songs: a member limited to some artists cannot run one.
  if (access.artistScope !== null) return json(403, { error: 'Importing earnings needs finance access to the whole organization.' });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json(400, { error: 'Send the file as multipart form data.' });
  }
  const file = form.get('file');
  if (!(file instanceof File)) return json(400, { error: 'Choose a CSV file.' });
  if (file.size > MAX_FILE_BYTES) return json(413, { error: CSV_FAILURE_MESSAGE.too_large });

  const fields: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (k !== 'file' && typeof v === 'string') fields[k] = v;
  const parsedFields = OrgEarningsImportFieldsSchema.safeParse(fields);
  if (!parsedFields.success) return json(400, { error: parsedFields.error.issues[0]?.message ?? 'Invalid import options' });
  const options = parsedFields.data;

  const bytes = Buffer.from(await file.arrayBuffer());
  const sha = createHash('sha256').update(bytes).digest('hex');

  try {
    // Same file, same organization → the original import, nothing written, nothing recorded.
    const existing = await access.admin.from('earnings_imports').select('id').eq('org_id', access.orgId).eq('file_sha256', sha).maybeSingle();
    if (existing.error && !['PGRST205', '42P01'].includes(existing.error.code ?? '')) throw new Error(existing.error.message);
    if (existing.error) throw new EarningsNotReadyError();
    if (existing.data) return json(200, { created: false, import_id: (existing.data as { id: string }).id, message: SAME_FILE_MESSAGE });

    const csv = parseCsv(new TextDecoder('utf-8').decode(bytes), bytes.byteLength);
    if (!csv.ok) return json(422, { error: CSV_FAILURE_MESSAGE[csv.code], code: csv.code, ...(csv.line ? { line: csv.line } : {}) });
    const built = buildLines(csv.header, csv.rows, {
      preset: options.preset,
      currency: options.currency,
      incomeClass: options.income_class,
      roundFractional: options.round_fractional,
      mapping: options.mapping,
    });
    if (!built.ok) {
      const f = built.failure;
      return json(422, { error: f.message, code: f.code, ...(f.code === 'bad_rows' ? { issues: f.issues, more: f.more } : {}) });
    }

    if (options.period_id) {
      const period = await access.admin.from('finance_periods').select('id, status').eq('org_id', access.orgId).eq('id', options.period_id).maybeSingle();
      if (period.error) throw new Error(period.error.message);
      if (!period.data) return json(404, { error: 'Period not found' });
      if ((period.data as { status: string }).status !== 'open') return json(409, { error: 'That period is closed.' });
    }

    const run = await calculate(access.admin, access.orgId, built.currency, built.lines);
    const outcome = await importEarnings(
      access.admin,
      access.orgId,
      access.userId,
      {
        period_id: options.period_id ?? null,
        source: built.preset === 'generic' ? 'generic' : PRESETS[built.preset].label,
        file_name: file.name ? file.name.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 200) : null,
        file_sha256: sha,
        currency: built.currency,
        row_count: built.lines.length,
        total_minor: built.totalMinor,
      },
      built.lines,
      run,
    );
    if (!outcome.ok) return json(outcome.code === 'recoup_conflict' ? 409 : 422, { error: outcome.message, code: outcome.code });
    if (!outcome.created) return json(200, { created: false, import_id: outcome.id, message: SAME_FILE_MESSAGE });

    const waiting = run.lines.filter((l) => l.reviewReason !== null).length;
    await recordEvent(access.admin, { orgId: access.orgId, userId: access.userId }, 'earnings.imported', { type: 'earnings_import', id: outcome.id }, {
      lines: built.lines.length,
      allocated: built.lines.length - waiting,
      waiting,
      allocations: run.allocations.length,
      recoupments: run.recoups.length,
    });
    return json(201, {
      created: true,
      import_id: outcome.id,
      preset: built.preset,
      currency: built.currency,
      lines: built.lines.length,
      allocated_lines: built.lines.length - waiting,
      waiting_lines: waiting,
      rounded_lines: built.roundedLines,
      total_minor: built.totalMinor.toString(),
    });
  } catch (err) {
    if (err instanceof EarningsNotReadyError) return json(503, { error: EARNINGS_NOT_READY });
    log.error('earnings import failed', { orgId: access.orgId, error: errorMessage(err) });
    return json(500, { error: 'Could not import the file' });
  }
}
