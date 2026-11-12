'use client';

/**
 * The finance overview (LABEL-64): totals, each payee's position, each release's income against
 * cost, and the periods with their close. Every figure is the server's (it sums stored facts);
 * this draws them. A member limited to some artists is sent only their payees and releases and
 * no periods. Closing a period needs `finance.approve`; reopening is the owner's.
 */
import { useCallback, useEffect, useState } from 'react';
import { Lock, LockOpen } from 'lucide-react';
import { confirmToast } from '@/hooks/useToast';
import { showMoney } from '@/lib/labelos/earnings-client';
import { closePeriod, fetchDashboard, reopenPeriod, type Dashboard, type PeriodOverviewItem } from '@/lib/labelos/finance-dashboard-client';
import { cn } from '@/lib/utils';

const LABEL = 'text-[10px] font-mono uppercase tracking-[0.2em] text-white/40';
const NOTICE = 'rounded-xl border border-white/10 bg-[var(--surface-primary)] px-4 py-6 text-center text-[11px] text-white/60';
const CARD = 'rounded-xl border border-white/10 bg-[var(--surface-primary)] p-4';
const BTN = 'inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.06] px-3 py-1.5 text-[11px] text-white/80 transition-colors hover:border-white/20 hover:bg-white/[0.10] disabled:opacity-40 disabled:hover:border-white/10 disabled:hover:bg-white/[0.06]';

export function FinanceDashboardView({ orgId }: { orgId: string }) {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetchDashboard(orgId);
    if (!r.ok) return setError(r.error);
    setError(null);
    setData(r);
  }, [orgId]);
  useEffect(() => {
    let live = true;
    void fetchDashboard(orgId).then((r) => {
      if (!live) return;
      if (!r.ok) return setError(r.error);
      setData(r);
    });
    return () => {
      live = false;
    };
  }, [orgId]);

  if (error) {
    return (
      <div className={NOTICE} data-testid="finance-failed">
        {error}
        <button type="button" className={cn(BTN, 'ml-3')} onClick={() => void load()}>Try again</button>
      </div>
    );
  }
  if (!data) return <p className="text-[11px] text-white/40" data-testid="finance-loading">Loading the finance overview…</p>;
  if (!data.schemaReady) return <p className={NOTICE} data-testid="finance-not-ready">Finance is not set up yet: the finance database migrations (179 to 181) are not applied.</p>;

  return (
    <div className="space-y-10" data-testid="finance-dashboard" data-scoped={data.scoped ? 'true' : 'false'}>
      {data.scoped && <p className="text-[11px] text-white/50" data-testid="finance-scoped">You see the payees and releases of your artists only; royalties are your artists’ payees’ share.</p>}

      {data.summary.currencies.map((c) => (
        <section key={c.currency} aria-label={`Summary in ${c.currency}`} className={cn(CARD, 'grid grid-cols-2 gap-4 lg:grid-cols-4')} data-testid="finance-summary" data-currency={c.currency}>
          <Stat label={`Still to recover · ${c.currency}`} value={showMoney(c.advances.unrecouped, c.currency)} testid="sum-unrecouped" />
          <Stat label="Owed to payees now" value={showMoney(c.payouts.owed, c.currency)} testid="sum-owed" />
          <Stat label="Income on releases" value={showMoney(c.earnings.gross, c.currency)} testid="sum-gross" />
          {c.earnings.margin !== undefined && <Stat label="Margin after royalties and marketing" value={showMoney(c.earnings.margin, c.currency)} testid="sum-margin" />}
        </section>
      ))}
      {data.summary.currencies.length === 0 && <p className={NOTICE} data-testid="finance-empty">Nothing recorded yet. Import earnings, or record an advance.</p>}

      <section aria-labelledby="pos-h" data-testid="finance-positions">
        <h2 id="pos-h" className={cn(LABEL, 'mb-3')}>Position per payee · {data.positions.length}</h2>
        {data.positions.length === 0 ? (
          <p className={NOTICE}>No payee yet.</p>
        ) : (
          <ul className="space-y-2">
            {data.positions.map((p) => (
              <li key={p.payeeId} className="rounded-xl border border-white/10 bg-[var(--surface-primary)] p-3" data-testid="position-row" data-payee={p.payeeId}>
                <p className="text-[13px] text-white">{p.name ?? 'Payee'} <span className="text-white/40">· {p.currency}{p.active ? '' : ' · inactive'}</span></p>
                <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4 lg:grid-cols-6">
                  <Cell label="Recoupable advance" value={showMoney(p.recoupableAdvancedMinor, p.currency)} />
                  <Cell label="Still to recover" value={showMoney(p.unrecoupedMinor, p.currency)} testid="pos-unrecouped" />
                  <Cell label="Earned" value={showMoney(p.earnedMinor, p.currency)} />
                  <Cell label="Recouped" value={showMoney(p.recoupedMinor, p.currency)} />
                  <Cell label="Paid" value={showMoney(p.paidMinor, p.currency)} />
                  <Cell label="Owed now" value={showMoney(p.owedMinor, p.currency)} testid="pos-owed" />
                </dl>
                {p.nonRecoupableAdvancedMinor !== '0' && <p className="mt-1 text-[11px] text-white/50">Plus {showMoney(p.nonRecoupableAdvancedMinor, p.currency)} advanced, not recoupable.</p>}
                {p.notOnStatementMinor !== '0' && <p className="mt-1 text-[11px] text-white/50">{showMoney(p.notOnStatementMinor, p.currency)} earned is not on a statement yet.</p>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="rel-h" data-testid="finance-releases">
        <h2 id="rel-h" className={cn(LABEL, 'mb-3')}>Income against cost per release · {data.releases.length}</h2>
        {data.releases.length === 0 ? (
          <p className={NOTICE}>No release has income yet.</p>
        ) : (
          <ul className="space-y-2">
            {data.releases.map((r) => (
              <li key={`${r.releaseId}-${r.currency}`} className="rounded-xl border border-white/10 bg-[var(--surface-primary)] p-3" data-testid="release-row" data-release={r.releaseId}>
                <p className="text-[13px] text-white">{r.title} <span className="text-white/40">· {r.currency}</span></p>
                <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
                  <Cell label="Income" value={showMoney(r.grossMinor, r.currency)} testid="rel-gross" />
                  <Cell label="Royalties" value={showMoney(r.royaltiesMinor, r.currency)} />
                  {r.spentMinor !== undefined && <Cell label="Marketing spent" value={showMoney(r.spentMinor, r.currency)} />}
                  {r.marginMinor !== undefined && <Cell label="Margin" value={showMoney(r.marginMinor, r.currency)} testid="rel-margin" />}
                </dl>
                {r.committedMinor !== undefined && r.committedMinor !== '0' && <p className="mt-1 text-[11px] text-white/50">{showMoney(r.committedMinor, r.currency)} more is committed in the marketing plan.</p>}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-[11px] leading-relaxed text-white/40">
          Costs = spent marketing budget (the release’s marketing plan). No other cost is recorded in the system yet.
        </p>
        {data.unattributed.length > 0 && (
          <ul className="mt-2 space-y-1 text-[11px] text-white/50" data-testid="finance-unattributed">
            {data.unattributed.map((u) => (
              <li key={`${u.kind}-${u.currency}`}>
                {showMoney(u.grossMinor, u.currency)} on {u.lines} line{u.lines === 1 ? '' : 's'} {u.kind === 'ambiguous' ? 'could be on more than one release, so is not counted on any' : 'matches no release'}.
              </li>
            ))}
          </ul>
        )}
      </section>

      {data.periods && (
        <section aria-labelledby="per-h" data-testid="finance-periods">
          <h2 id="per-h" className={cn(LABEL, 'mb-3')}>Periods · {data.periods.length}</h2>
          {data.periods.length === 0 ? (
            <p className={NOTICE}>No period yet. Open one from Statements.</p>
          ) : (
            <ul className="space-y-2">
              {data.periods.map((p) => <PeriodRow key={p.id} orgId={orgId} period={p} onDone={load} />)}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

function Stat({ label, value, testid }: { label: string; value: string; testid?: string }) {
  return (
    <div>
      <p className={LABEL}>{label}</p>
      <p className="mt-1 text-[16px] tabular-nums text-white" data-testid={testid}>{value}</p>
    </div>
  );
}
function Cell({ label, value, testid }: { label: string; value: string; testid?: string }) {
  return (
    <div>
      <dt className="text-[10px] text-white/40">{label}</dt>
      <dd className="text-[11px] tabular-nums text-white/80" data-testid={testid}>{value}</dd>
    </div>
  );
}

function PeriodRow({ orgId, period: p, onDone }: { orgId: string; period: PeriodOverviewItem; onDone: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const closed = p.status === 'closed';

  async function close() {
    const warn = p.closeWarnings.length > 0 ? ` ${p.closeWarnings.join(' ')}` : '';
    const ok = await confirmToast('Close this period?', `It will take no new earnings file and no new statement.${warn}`, { confirmLabel: 'Close period' });
    if (!ok) return;
    setBusy(true);
    const r = await closePeriod(orgId, p.id);
    setBusy(false);
    if (r.ok) {
      setMsg(null);
      await onDone();
    } else setMsg(r.error);
  }
  async function reopen() {
    const ok = await confirmToast('Reopen this period?', 'Only an owner can. New earnings files and statements can be made for it again; the reopening is recorded.', { confirmLabel: 'Reopen period' });
    if (!ok) return;
    setBusy(true);
    const r = await reopenPeriod(orgId, p.id);
    setBusy(false);
    if (r.ok) {
      setMsg(null);
      await onDone();
    } else setMsg(r.error);
  }

  return (
    <li className="rounded-xl border border-white/10 bg-[var(--surface-primary)] p-3" data-testid="period-row" data-status={p.status}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-0 basis-full sm:basis-0 sm:flex-1">
          <p className="truncate text-[13px] text-white">{p.label}</p>
          <p className="text-[11px] text-white/60">{p.startsOn} to {p.endsOn} · {p.imports} file{p.imports === 1 ? '' : 's'}{p.draftStatements ? ` · ${p.draftStatements} draft statement${p.draftStatements === 1 ? '' : 's'}` : ''}</p>
        </div>
        <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-mono uppercase tracking-[0.1em]', closed ? 'border-white/20 text-white/60' : 'border-[#6DC6A4]/40 text-[#6DC6A4]')} data-testid="period-status">
          {closed ? 'Closed' : 'Open'}
        </span>
        {p.canClose && (
          <button type="button" className={BTN} disabled={busy} onClick={() => void close()} data-testid="period-close">
            <Lock size={12} strokeWidth={1.75} aria-hidden="true" /> Close
          </button>
        )}
        {p.canReopen && (
          <button type="button" className={BTN} disabled={busy} onClick={() => void reopen()} data-testid="period-reopen">
            <LockOpen size={12} strokeWidth={1.75} aria-hidden="true" /> Reopen
          </button>
        )}
      </div>
      {!closed && p.closeBlocked && <p className="mt-2 text-[11px] text-white/50" data-testid="period-blocked">{p.closeBlocked}</p>}
      {!closed && !p.closeBlocked && p.closeWarnings.map((w) => <p key={w} className="mt-2 text-[11px] text-[#c8a47a]" data-testid="period-warning">{w}</p>)}
      {msg && <p role="alert" className="mt-2 text-[11px] text-[#ffb7a8]" data-testid="period-message">{msg}</p>}
    </li>
  );
}
