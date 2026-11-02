'use client';

/**
 * Earnings (LABEL-62): import a distributor CSV, see the imported files, and
 * work the needs-review queue. What each viewer may see and do is the server's
 * (`/api/org/[orgId]/finance/earnings/**`); this draws what it sent. Importing
 * and re-running need `finance.write` on the whole organization (`canWrite`).
 *
 * Plain on purpose: no amounts are computed here, and the same file imported
 * twice is a no-op the server says so about.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw, Upload } from 'lucide-react';
import { Dropdown } from '@/components/ui/Dropdown';
import {
  fetchImports, fetchQueue, recalculate, showMoney, uploadEarnings,
  type EarningsImport, type ImportAttempt, type ReviewLine,
} from '@/lib/labelos/earnings-client';
import { cn } from '@/lib/utils';

const LABEL = 'text-[10px] font-mono uppercase tracking-[0.2em] text-white/40';
const NOTICE = 'rounded-xl border border-white/10 bg-[#0D0D0A] px-4 py-6 text-center text-[11px] text-white/60';
const CARD = 'rounded-xl border border-white/10 bg-[#0D0D0A] p-4';
const BTN = 'inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.06] px-3 py-1.5 text-[11px] text-white/80 transition-colors hover:border-white/20 hover:bg-white/[0.10] disabled:opacity-40 disabled:hover:border-white/10 disabled:hover:bg-white/[0.06]';
const FIELD = 'w-full rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-[11px] text-white/80 outline-none focus:border-white/30';

const PRESET_OPTIONS = [
  { value: 'auto', label: 'Detect the service' },
  { value: 'distrokid', label: 'DistroKid' },
  { value: 'tunecore', label: 'TuneCore' },
  { value: 'cdbaby', label: 'CD Baby' },
  { value: 'generic', label: 'Other (name the columns)' },
] as const;

export function EarningsView({ orgId }: { orgId: string }) {
  const [imports, setImports] = useState<EarningsImport[] | null>(null);
  const [queue, setQueue] = useState<ReviewLine[]>([]);
  const [state, setState] = useState<{ schemaReady: boolean; canWrite: boolean; scoped: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // One loader for the first load and every refresh; `live` stops a late answer from landing after unmount.
  const show = useCallback((i: Awaited<ReturnType<typeof fetchImports>>, q: Awaited<ReturnType<typeof fetchQueue>>) => {
    if (!i.ok) return setError(i.error);
    if (!q.ok) return setError(q.error);
    setError(null);
    setImports(i.imports);
    setQueue(q.lines);
    setState({ schemaReady: i.schemaReady && q.schemaReady, canWrite: i.canWrite, scoped: i.scoped });
  }, []);
  const load = useCallback(async () => {
    const [i, q] = await Promise.all([fetchImports(orgId), fetchQueue(orgId)]);
    show(i, q);
  }, [orgId, show]);

  useEffect(() => {
    let live = true;
    void Promise.all([fetchImports(orgId), fetchQueue(orgId)]).then(([i, q]) => {
      if (live) show(i, q);
    });
    return () => {
      live = false;
    };
  }, [orgId, show]);

  if (error) {
    return (
      <div className={NOTICE} data-testid="earnings-failed">
        {error}
        <button type="button" className={cn(BTN, 'ml-3')} onClick={() => void load()}>Try again</button>
      </div>
    );
  }
  if (!state || !imports) return <p className="text-[11px] text-white/40" data-testid="earnings-loading">Loading earnings…</p>;
  if (!state.schemaReady) {
    return <p className={NOTICE} data-testid="earnings-not-ready">Earnings are not set up yet: the finance database migrations (179 and 180) are not applied.</p>;
  }

  return (
    <div className="space-y-8" data-testid="earnings">
      {state.canWrite && <ImportForm orgId={orgId} onDone={load} />}
      {!state.canWrite && (
        <p className="text-[11px] text-white/50" data-testid="earnings-readonly">
          {state.scoped ? 'You see the lines that belong to your artists. Imports are for finance members who see the whole organization.' : 'You can read earnings here; importing needs finance write access.'}
        </p>
      )}

      <section aria-labelledby="queue-h" data-testid="earnings-queue">
        <h2 id="queue-h" className={cn(LABEL, 'mb-3')}>Needs review · {queue.length}</h2>
        {queue.length === 0 ? (
          <p className={NOTICE} data-testid="queue-empty">Nothing is waiting. Every line was matched and allocated.</p>
        ) : (
          <ul className="space-y-2">
            {queue.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-white/10 bg-[#0D0D0A] p-3" data-testid="queue-line" data-reason={l.reason ?? ''}>
                <div className="min-w-0 basis-full sm:basis-0 sm:flex-1">
                  <p className="truncate text-[13px] text-white">{l.title ?? l.isrc ?? l.upc ?? `Line ${l.line_no}`}</p>
                  <p className="text-[11px] text-white/60">
                    {[l.isrc, l.upc, l.store, `line ${l.line_no}`].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <span className="text-[11px] text-white/80 tabular-nums">{showMoney(l.gross_minor, l.currency)}</span>
                <span className="rounded-full border border-[#c8a47a]/40 px-2 py-0.5 text-[10px] font-mono uppercase tracking-[0.1em] text-[#c8a47a]">{l.reason_label ?? 'Needs review'}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="imports-h" data-testid="earnings-imports">
        <h2 id="imports-h" className={cn(LABEL, 'mb-3')}>Imported files · {imports.length}</h2>
        {imports.length === 0 ? (
          <p className={NOTICE} data-testid="imports-empty">{state.scoped ? 'Files are listed for finance members who see the whole organization.' : 'No file imported yet.'}</p>
        ) : (
          <ul className="space-y-2">
            {imports.map((i) => (
              <ImportRow key={i.id} orgId={orgId} item={i} canWrite={state.canWrite} waiting={queue.filter((q) => q.import_id === i.id).length} onDone={load} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function ImportRow({ orgId, item, canWrite, waiting, onDone }: { orgId: string; item: EarningsImport; canWrite: boolean; waiting: number; onDone: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  async function rerun() {
    setBusy(true);
    const r = await recalculate(orgId, item.id);
    setBusy(false);
    setNote(r.ok ? `${r.resolved} line${r.resolved === 1 ? '' : 's'} allocated, ${r.stillWaiting} still waiting.` : r.error);
    if (r.ok) await onDone();
  }
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-white/10 bg-[#0D0D0A] p-3" data-testid="import-row">
      <div className="min-w-0 basis-full sm:basis-0 sm:flex-1">
        <p className="truncate text-[13px] text-white">{item.file_name ?? 'Earnings file'}</p>
        <p className="text-[11px] text-white/60">{item.source} · {item.row_count} lines · {new Date(item.created_at).toLocaleDateString('en-GB')}</p>
        {note && <p className="mt-1 text-[11px] text-white/60" role="status">{note}</p>}
      </div>
      <span className="text-[11px] text-white/80 tabular-nums">{showMoney(item.total_minor, item.currency)}</span>
      {canWrite && waiting > 0 && (
        <button type="button" className={BTN} disabled={busy} onClick={() => void rerun()} data-testid="import-rerun">
          <RefreshCw size={12} strokeWidth={1.75} aria-hidden="true" />
          Re-run {waiting} waiting
        </button>
      )}
    </li>
  );
}

function ImportForm({ orgId, onDone }: { orgId: string; onDone: () => Promise<void> }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [preset, setPreset] = useState<string>('auto');
  const [currency, setCurrency] = useState('');
  const [incomeClass, setIncomeClass] = useState<'master' | 'publishing'>('master');
  const [round, setRound] = useState(false);
  const [amountCol, setAmountCol] = useState('');
  const [isrcCol, setIsrcCol] = useState('');
  const [upcCol, setUpcCol] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportAttempt | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) return setResult({ ok: false, error: 'Choose a CSV file.' });
    const form = new FormData();
    form.set('file', file);
    form.set('preset', preset);
    if (currency.trim()) form.set('currency', currency.trim());
    form.set('income_class', incomeClass);
    form.set('round_fractional', round ? 'true' : 'false');
    if (preset === 'generic') {
      form.set('mapping', JSON.stringify({ amount: amountCol, ...(isrcCol ? { isrc: isrcCol } : {}), ...(upcCol ? { upc: upcCol } : {}) }));
    }
    setBusy(true);
    const r = await uploadEarnings(orgId, form);
    setBusy(false);
    setResult(r);
    if (r.ok && r.summary.created) {
      if (fileRef.current) fileRef.current.value = '';
      await onDone();
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className={cn(CARD, 'space-y-4')} data-testid="earnings-form">
      <h2 className={LABEL}>Import a distributor report</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1">
          <span className="text-[11px] text-white/60">CSV file (up to 4 MB)</span>
          <input ref={fileRef} type="file" accept=".csv,text/csv" className={FIELD} data-testid="earnings-file" />
        </label>
        <div className="block space-y-1">
          <span className="text-[11px] text-white/60">Service</span>
          <Dropdown<string> value={preset} onChange={setPreset} options={PRESET_OPTIONS.map((o) => ({ value: o.value, label: o.label }))} className="w-full" aria-label="Service" />
        </div>
        <label className="block space-y-1">
          <span className="text-[11px] text-white/60">Currency (when the file does not say)</span>
          <input value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase().slice(0, 3))} placeholder="USD" className={FIELD} data-testid="earnings-currency" />
        </label>
        <div className="block space-y-1">
          <span className="text-[11px] text-white/60">Income is</span>
          <Dropdown<'master' | 'publishing'> value={incomeClass} onChange={setIncomeClass} options={[{ value: 'master', label: 'Master (recording) income' }, { value: 'publishing', label: 'Publishing income' }]} className="w-full" aria-label="Income is" />
        </div>
      </div>
      {preset === 'generic' && (
        <div className="grid gap-3 sm:grid-cols-3" data-testid="earnings-mapping">
          <label className="block space-y-1"><span className="text-[11px] text-white/60">Amount column</span><input value={amountCol} onChange={(e) => setAmountCol(e.target.value)} className={FIELD} data-testid="map-amount" /></label>
          <label className="block space-y-1"><span className="text-[11px] text-white/60">ISRC column</span><input value={isrcCol} onChange={(e) => setIsrcCol(e.target.value)} className={FIELD} data-testid="map-isrc" /></label>
          <label className="block space-y-1"><span className="text-[11px] text-white/60">UPC column (optional)</span><input value={upcCol} onChange={(e) => setUpcCol(e.target.value)} className={FIELD} data-testid="map-upc" /></label>
        </div>
      )}
      <label className="flex items-start gap-2 text-[11px] text-white/60">
        <input type="checkbox" checked={round} onChange={(e) => setRound(e.target.checked)} className="mt-0.5" data-testid="earnings-round" />
        <span>Round fractional cents (half to even). Most services report more decimals than a cent; without this, such a file is refused rather than rounded behind your back.</span>
      </label>
      <p className="text-[11px] leading-relaxed text-white/50">
        A file is one currency. Amounts are never converted: a line is allocated only to payees paid in the file’s currency, and the rest wait in the review queue below.
        Importing the same file again changes nothing.
      </p>
      <div className="flex items-center gap-3">
        <button type="submit" className={BTN} disabled={busy} data-testid="earnings-submit">
          <Upload size={12} strokeWidth={1.75} aria-hidden="true" />
          {busy ? 'Importing…' : 'Import'}
        </button>
      </div>
      {result && !result.ok && (
        <div role="alert" className="space-y-1 text-[11px] text-[#ffb7a8]" data-testid="earnings-error">
          <p>{result.error}</p>
          {result.issues && (
            <ul className="list-disc pl-4 text-white/60">
              {result.issues.map((i) => <li key={i.lineNo}>Line {i.lineNo}: {i.message}</li>)}
              {result.more ? <li>…and {result.more} more.</li> : null}
            </ul>
          )}
        </div>
      )}
      {result?.ok && (
        <p role="status" className="text-[11px] text-[#6DC6A4]" data-testid="earnings-result">
          {result.summary.created
            ? `Imported ${result.summary.lines} lines: ${result.summary.allocated_lines} allocated, ${result.summary.waiting_lines} waiting for review${result.summary.rounded_lines ? `, ${result.summary.rounded_lines} rounded to the cent` : ''}.`
            : result.summary.message ?? 'This file was imported before. Nothing changed.'}
        </p>
      )}
    </form>
  );
}
