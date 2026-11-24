// Bundled and run by backfill-waveform-models.mjs — see that file. Not part of the app build.
import { createClient } from '@supabase/supabase-js';
import { ensureWaveformModelFile } from '@/lib/audio/waveform-model.server';
import { waveModelFileExists } from '@/lib/storage/upload';
import { runWaveBackfill, type WaveBackfillRow } from '@/lib/audio/waveform-backfill';

export async function main(opts: { apply: boolean; limit: number | null }): Promise<number> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { console.error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.'); return 2; }
  const db = createClient(url, key, { auth: { persistSession: false } });

  // Every producer track with a public preview (org tracks are excluded by `org_id IS NULL`).
  const rows: WaveBackfillRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from('tracks')
      .select('id, preview_url, store_listed, created_at, org_id')
      .not('preview_url', 'is', null)
      .is('org_id', null)
      .order('created_at', { ascending: true })
      .range(from, from + 999);
    if (error) { console.error(`tracks query failed: ${error.message}`); return 1; }
    rows.push(...((data ?? []) as WaveBackfillRow[]));
    if (!data || data.length < 1000) break;
  }

  const summary = await runWaveBackfill(rows, opts, {
    exists: waveModelFileExists,
    ensure: ensureWaveformModelFile,
    log: (line) => console.log(line),
  });
  console.log('\n--- waveform model backfill ---');
  console.log(opts.apply ? 'mode:            APPLY' : 'mode:            dry run (pass --apply to write)');
  console.log(`tracks read:     ${summary.considered}`);
  console.log(`no public clip:  ${summary.unsupported}`);
  console.log(`already have it: ${summary.alreadyHave}`);
  console.log(opts.apply ? `written:         ${summary.written}` : `would write:     ${summary.toWrite}`);
  if (opts.apply) console.log(`failed:          ${summary.failed}`);
  return summary.failed > 0 ? 1 : 0;
}
