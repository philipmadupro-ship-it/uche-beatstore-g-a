import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { isSupabaseConfigured, insert, getAll, createServiceClient } from '@/lib/db';
import {
  parseCSV,
  rowsToResults,
  ParsedContact,
  RowResult,
} from '@/lib/contacts/import';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { ContactImportBodySchema } from '@/lib/contracts';

const log = createLogger('api.contacts.import');

export const runtime = 'nodejs';
export const maxDuration = 60;

interface PreviewResponse {
  headers: string[];
  sampleRows: string[][];
  results: RowResult[];
  total: number;
  invalid: number;
}

async function parseFile(file: File): Promise<{ headers: string[]; rows: string[][] }> {
  const buf = Buffer.from(await file.arrayBuffer());
  const name = file.name.toLowerCase();

  if (name.endsWith('.csv') || file.type === 'text/csv' || file.type === 'text/plain') {
    const text = buf.toString('utf-8');
    const all = parseCSV(text);
    const [headers = [], ...rest] = all;
    return { headers, rows: rest };
  }
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    const XLSX = await import('xlsx');
    const wb = XLSX.read(buf, { type: 'buffer' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    // XLSX returns mixed-type cells (number | string | Date | null); coerce
    // to string here so the downstream parser doesn't have to.
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' });
    const headers = (aoa[0] || []).map((c) => String(c ?? ''));
    const rows = aoa.slice(1).map((r) => r.map((c) => (c == null ? '' : String(c))));
    return { headers, rows };
  }
  throw new Error('Unsupported file. Use .csv, .xlsx, or .xls');
}

/**
 * PUT — preview only. Parses the file, returns headers, sample rows, and
 * per-row validation results so the UI can show a confidence-aware preview.
 */
export async function PUT(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'file required' }, { status: 400 });
    }

    const { headers, rows } = await parseFile(file);
    if (rows.length === 0) {
      return NextResponse.json({ error: 'No data rows found in file' }, { status: 422 });
    }

    const results = rowsToResults(headers, rows);
    const invalid = results.filter((r) => r.errors.length > 0).length;

    const payload: PreviewResponse = {
      headers,
      sampleRows: rows.slice(0, 5).map((r) => r.map((c) => String(c ?? ''))),
      results,
      total: results.length,
      invalid,
    };
    return NextResponse.json(payload);
  } catch (error) {
    log.error('preview failed', { error: errorMessage(error) });
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}

/**
 * POST — commit. Either:
 *   { contacts: ParsedContact[] }            — confirmed list from the preview
 *   multipart/form-data with `file` field    — re-parse server-side
 */
export async function POST(req: NextRequest) {
  try {
    const ct = req.headers.get('content-type') || '';
    let parsed: ParsedContact[] = [];

    if (ct.includes('application/json')) {
      // Validate the pre-parsed list. Invalid JSON / a non-array / items
      // missing a name 400 here instead of silently importing as 0 rows.
      let raw: unknown;
      try {
        raw = await req.json();
      } catch {
        return NextResponse.json({ error: 'Body must be valid JSON' }, { status: 400 });
      }
      const result = ContactImportBodySchema.safeParse(raw);
      if (!result.success) {
        return NextResponse.json(
          { error: result.error.issues[0]?.message ?? 'Invalid contacts payload' },
          { status: 400 },
        );
      }
      parsed = result.data.contacts as ParsedContact[];
    } else {
      const form = await req.formData();
      const file = form.get('file');
      if (!(file instanceof File)) {
        return NextResponse.json({ error: 'file required' }, { status: 400 });
      }
      const { headers, rows } = await parseFile(file);
      parsed = rowsToResults(headers, rows)
        .filter((r) => r.errors.length === 0)
        .map((r) => r.contact);
    }

    if (parsed.length === 0) {
      return NextResponse.json({ error: 'No contacts to import' }, { status: 422 });
    }

    let inserted = 0;
    let skipped = 0;
    const errors: string[] = [];
    const categoryBreakdown: Record<string, number> = {};

    if (isSupabaseConfigured()) {
      const cookieClient = await createServerClient();
      const { data: { user } } = await cookieClient.auth.getUser();
      if (!user) {
        return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
      }
      const userId = user.id;

      // Service-role insert to bypass RLS — same pattern as share/playlists.
      // Now goes through the centralized createServiceClient helper instead
      // of a one-off import.
      const supabase = createServiceClient();

      // Dedupe against the importer's OWN contacts only — the previous
      // unscoped query leaked existence-of-email signal across tenants and
      // could silently skip imports because another user already had the row.
      const { data: existing } = await supabase
        .from('contacts')
        .select('name, email')
        .eq('user_id', userId);
      type ExistingContact = { name?: string | null; email?: string | null };
      const existingRows = (existing || []) as ExistingContact[];
      const existingEmails = new Set(
        existingRows.map((c) => String(c.email || '').toLowerCase()).filter(Boolean),
      );
      const existingNames = new Set(
        existingRows.map((c) => String(c.name || '').toLowerCase()).filter(Boolean),
      );

      const fresh: ParsedContact[] = [];
      for (const c of parsed) {
        const eKey = String(c.email || '').toLowerCase();
        const nKey = String(c.name || '').toLowerCase();
        if (eKey && existingEmails.has(eKey)) { skipped++; continue; }
        if (!eKey && existingNames.has(nKey)) { skipped++; continue; }
        fresh.push(c);
        if (eKey) existingEmails.add(eKey);
        else existingNames.add(nKey);
        const cat = c.category || 'other';
        categoryBreakdown[cat] = (categoryBreakdown[cat] || 0) + 1;
      }

      // Insert in chunks of 200, attributing to current user.
      for (let i = 0; i < fresh.length; i += 200) {
        const chunk = fresh.slice(i, i + 200).map((c) => ({ ...c, user_id: userId }));
        const { error } = await supabase.from('contacts').insert(chunk);
        if (error) {
          // Don't lose the rest of the import — log + continue
          errors.push(error.message);
        } else {
          inserted += chunk.length;
        }
      }
    } else {
      type LocalContact = { name?: string | null; email?: string | null };
      const all = getAll('contacts') as LocalContact[];
      const existingEmails = new Set(all.map((c) => String(c.email || '').toLowerCase()).filter(Boolean));
      const existingNames = new Set(all.map((c) => String(c.name || '').toLowerCase()).filter(Boolean));
      for (const c of parsed) {
        const eKey = String(c.email || '').toLowerCase();
        const nKey = String(c.name || '').toLowerCase();
        if (eKey && existingEmails.has(eKey)) { skipped++; continue; }
        if (!eKey && existingNames.has(nKey)) { skipped++; continue; }
        insert('contacts', c);
        inserted++;
        if (eKey) existingEmails.add(eKey);
        else existingNames.add(nKey);
        const cat = c.category || 'other';
        categoryBreakdown[cat] = (categoryBreakdown[cat] || 0) + 1;
      }
    }

    // Surface a real failure when nothing landed and at least one chunk
    // errored. Returning 200 in that case made imports look successful when
    // they weren't (e.g. missing user_id column, RLS rejection).
    if (inserted === 0 && errors.length > 0) {
      return NextResponse.json(
        {
          error: `Import failed: ${errors[0]}${errors.length > 1 ? ` (+${errors.length - 1} more)` : ''}`,
          inserted: 0,
          skipped,
          total: parsed.length,
          errors,
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      inserted,
      skipped,
      total: parsed.length,
      categoryBreakdown,
      errors: errors.length ? errors : undefined,
    });
  } catch (error) {
    log.error('import failed', { error: errorMessage(error) });
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
