'use client';

/**
 * Download buttons for a release's distributor metadata (LABEL-34): CSV and
 * JSON, ERN-aligned names (lib/labelos/metadata-export). Shown only to a
 * caller who may export (`release.write`; the server decides again and its
 * words are the error toast). Self-contained: the release detail page passes
 * the org, the release and whether the member holds the ability.
 */
import { useState } from 'react';
import { toast } from '@/hooks/useToast';
import { downloadReleaseExport, type ExportFormat } from '@/lib/labelos/metadata-export-client';

const BTN =
  'rounded-lg border border-white/10 bg-white/[0.06] px-3 py-1.5 text-[11px] text-white/80 transition-colors hover:border-white/20 hover:bg-white/[0.10] disabled:opacity-40';
const LABEL = 'text-[10px] font-mono uppercase tracking-[0.2em] text-white/40';

export function ReleaseExportButtons({ orgId, releaseId, canExport }: { orgId: string; releaseId: string; canExport: boolean }) {
  const [busy, setBusy] = useState<ExportFormat | null>(null);
  if (!canExport) return null;

  async function run(format: ExportFormat) {
    setBusy(format);
    const res = await downloadReleaseExport(orgId, releaseId, format);
    setBusy(null);
    if (res.ok) toast.success('Metadata exported', res.filename);
    else toast.error('Could not export the metadata', res.error);
  }

  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Export metadata">
      <span className={LABEL}>Distributor metadata</span>
      <button type="button" className={BTN} disabled={busy !== null} onClick={() => void run('csv')}>
        {busy === 'csv' ? 'Exporting…' : 'Download CSV'}
      </button>
      <button type="button" className={BTN} disabled={busy !== null} onClick={() => void run('json')}>
        {busy === 'json' ? 'Exporting…' : 'Download JSON'}
      </button>
    </div>
  );
}
