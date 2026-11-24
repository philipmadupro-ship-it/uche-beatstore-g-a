import { waveFileUrlFor } from '@/lib/visuals/waveform-file';
import { isOrgMasterRef } from '@/lib/labelos/org-upload';

/**
 * Which tracks the `.wave.bin` backfill touches and in what order — pure, so the
 * ordering and the skips are tested (scripts/ops/backfill-waveform-models.mjs runs it).
 */
export interface WaveBackfillRow {
  id: string;
  preview_url: string | null;
  store_listed: boolean | null;
  created_at?: string | null;
  /** Label OS rows: never backfilled (their previews are private). */
  org_id?: string | null;
}

/** Store-listed first, then oldest first; only rows with a public preview a file can sit beside. */
export function pickWaveBackfillRows(rows: WaveBackfillRow[]): WaveBackfillRow[] {
  return rows
    .filter((r) => !r.org_id && !isOrgMasterRef(r.preview_url) && waveFileUrlFor(r.preview_url) !== null)
    .map((r, index) => ({ r, index }))
    .sort((a, b) => {
      const listed = Number(b.r.store_listed === true) - Number(a.r.store_listed === true);
      if (listed !== 0) return listed;
      const ca = a.r.created_at ?? '';
      const cb = b.r.created_at ?? '';
      return ca < cb ? -1 : ca > cb ? 1 : a.index - b.index;
    })
    .map((x) => x.r);
}

export interface WaveBackfillSummary {
  considered: number;
  /** Rows with no public preview a file can be written beside (null, private, org). */
  unsupported: number;
  alreadyHave: number;
  /** Dry run: how many would be written. Apply: how many were. */
  toWrite: number;
  written: number;
  failed: number;
  dryRun: boolean;
  failures: Array<{ id: string; preview_url: string }>;
}

export interface WaveBackfillDeps {
  exists: (previewUrl: string) => Promise<boolean>;
  ensure: (previewUrl: string) => Promise<'written' | 'skipped' | 'failed'>;
  log?: (line: string) => void;
}

/** Walk the picked rows until `limit` need a file; write them only when `apply`. */
export async function runWaveBackfill(
  rows: WaveBackfillRow[],
  opts: { apply: boolean; limit?: number | null },
  deps: WaveBackfillDeps,
): Promise<WaveBackfillSummary> {
  const picked = pickWaveBackfillRows(rows);
  const limit = opts.limit && opts.limit > 0 ? opts.limit : Infinity;
  const summary: WaveBackfillSummary = {
    considered: rows.length,
    unsupported: rows.length - picked.length,
    alreadyHave: 0,
    toWrite: 0,
    written: 0,
    failed: 0,
    dryRun: !opts.apply,
    failures: [],
  };
  for (const row of picked) {
    if (summary.toWrite >= limit) break;
    const url = row.preview_url as string;
    if (await deps.exists(url)) { summary.alreadyHave += 1; continue; }
    summary.toWrite += 1;
    if (!opts.apply) { deps.log?.(`would write ${url}.wave.bin${row.store_listed ? ' (listed)' : ''}`); continue; }
    const outcome = await deps.ensure(url);
    if (outcome === 'written') { summary.written += 1; deps.log?.(`wrote ${url}.wave.bin`); }
    else { summary.failed += 1; summary.failures.push({ id: row.id, preview_url: url }); deps.log?.(`FAILED ${url} (${outcome})`); }
  }
  return summary;
}
