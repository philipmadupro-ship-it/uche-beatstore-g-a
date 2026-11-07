'use client';

/**
 * Statements and payment tracking (LABEL-63). Staff generate a statement per payee per period,
 * approve (a different person than the generator, unless an owner), issue, record payments made
 * elsewhere and export; the payee's own artist sees only their ISSUED statements. What each viewer
 * may see and do is the server's; this draws what it sent. No amount is computed here.
 */
import { useCallback, useEffect, useState } from 'react';
import { Download, FileText } from 'lucide-react';
import { Dropdown } from '@/components/ui/Dropdown';
import { confirmToast } from '@/hooks/useToast';
import { showMoney } from '@/lib/labelos/earnings-client';
import { currencyExponent, isCurrency } from '@/lib/labelos/finance/money';
import {
  createPeriod, exportUrl, fetchPayees, fetchPeriods, fetchStatement, fetchStatements, generateStatement, minorFromTyped, payoutUrl, recordPayment, statementAct, voidPayment,
  type PayeeItem, type PeriodItem, type StatementDetail, type StatementItem,
} from '@/lib/labelos/statements-client';
import { cn } from '@/lib/utils';

const LABEL = 'text-[10px] font-mono uppercase tracking-[0.2em] text-white/40';
const NOTICE = 'rounded-xl border border-white/10 bg-[var(--surface-primary)] px-4 py-6 text-center text-[11px] text-white/60';
const CARD = 'rounded-xl border border-white/10 bg-[var(--surface-primary)] p-4';
const BTN = 'inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.06] px-3 py-1.5 text-[11px] text-white/80 transition-colors hover:border-white/20 hover:bg-white/[0.10] disabled:opacity-40 disabled:hover:border-white/10 disabled:hover:bg-white/[0.06]';
const FIELD = 'w-full rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-[11px] text-white/80 outline-none focus:border-white/30';

const STATUS_LABEL: Record<string, string> = { draft: 'Draft', approved: 'Approved', issued: 'Issued', void: 'Void' };
const PAY_LABEL: Record<string, string> = { nothing_due: 'Nothing due', unpaid: 'Unpaid', partial: 'Partly paid', paid: 'Paid' };
const share = (units: number | null): string => {
  if (units === null) return '';
  const frac = String(units % 10000).padStart(4, '0').replace(/0+$/, '');
  return `${Math.floor(units / 10000)}${frac ? `.${frac}` : ''}%`;
};

export function StatementsView({ orgId }: { orgId: string }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof fetchStatements>> | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(async () => setData(await fetchStatements(orgId)), [orgId]);
  useEffect(() => {
    let live = true;
    void fetchStatements(orgId).then((r) => {
      if (live) setData(r);
    });
    return () => {
      live = false;
    };
  }, [orgId]);

  if (!data) return <p className="text-[11px] text-white/40" data-testid="statements-loading">Loading statements…</p>;
  if (!data.ok) return <div className={NOTICE} data-testid="statements-failed">{data.error}<button type="button" className={cn(BTN, 'ml-3')} onClick={() => void load()}>Try again</button></div>;
  if (!data.schemaReady) return <p className={NOTICE} data-testid="statements-not-ready">Statements are not set up yet: the finance database migrations (179, 180 and 181) are not applied.</p>;

  const { own, statements } = data;
  return (
    <div className="space-y-8" data-testid="statements" data-own={own ? 'true' : 'false'}>
      {!own && data.canGenerate && <GenerateForm orgId={orgId} onDone={async (id) => { await load(); setSelected(id); }} />}
      <section aria-labelledby="st-h">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 id="st-h" className={LABEL}>{own ? 'Your statements' : 'Statements'} · {statements.length}</h2>
          {!own && data.canApprove && (
            <a className={BTN} href={payoutUrl(orgId)} data-testid="payout-csv"><Download size={12} strokeWidth={1.75} aria-hidden="true" />Payout CSV</a>
          )}
        </div>
        {statements.length === 0 ? (
          <p className={NOTICE} data-testid="statements-empty">{own ? 'Nothing has been issued to you yet.' : 'No statement yet. Open a period, import earnings into it, then generate a statement for a payee.'}</p>
        ) : (
          <ul className="space-y-2">
            {statements.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => setSelected(selected === s.id ? null : s.id)}
                  aria-expanded={selected === s.id}
                  className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-white/10 bg-[var(--surface-primary)] p-3 text-left transition-colors hover:border-white/20"
                  data-testid="statement-row"
                  data-status={s.status}
                >
                  <div className="min-w-0 basis-full sm:basis-0 sm:flex-1">
                    <p className="truncate text-[13px] text-white">{own ? s.periodLabel : `${s.payeeName ?? 'Payee'} · ${s.periodLabel ?? ''}`}</p>
                    <p className="text-[11px] text-white/60">{s.currency}{s.paymentState ? ` · ${PAY_LABEL[s.paymentState]}` : ''}</p>
                  </div>
                  <span className="text-[11px] tabular-nums text-white/80">{showMoney(s.netMinor, s.currency)}</span>
                  <span className="rounded-full border border-white/20 px-2 py-0.5 text-[10px] font-mono uppercase tracking-[0.1em] text-white/60">{STATUS_LABEL[s.status]}</span>
                </button>
                {selected === s.id && <Detail orgId={orgId} item={s} onChanged={load} />}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function GenerateForm({ orgId, onDone }: { orgId: string; onDone: (id: string) => Promise<void> }) {
  const [periods, setPeriods] = useState<PeriodItem[]>([]);
  const [canOpen, setCanOpen] = useState(false);
  const [payees, setPayees] = useState<PayeeItem[]>([]);
  const [payeeId, setPayeeId] = useState('');
  const [periodId, setPeriodId] = useState('');
  const [label, setLabel] = useState('');
  const [starts, setStarts] = useState('');
  const [ends, setEnds] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const reload = useCallback(async () => {
    const [p, y] = await Promise.all([fetchPeriods(orgId), fetchPayees(orgId)]);
    if (p.ok) {
      setPeriods(p.periods.filter((x) => x.status === 'open'));
      setCanOpen(p.canWrite);
    }
    if (y.ok) setPayees(y.payees.filter((x) => x.status === 'active'));
  }, [orgId]);
  useEffect(() => {
    let live = true;
    void Promise.all([fetchPeriods(orgId), fetchPayees(orgId)]).then(([p, y]) => {
      if (!live) return;
      if (p.ok) {
        setPeriods(p.periods.filter((x) => x.status === 'open'));
        setCanOpen(p.canWrite);
      }
      if (y.ok) setPayees(y.payees.filter((x) => x.status === 'active'));
    });
    return () => {
      live = false;
    };
  }, [orgId]);

  async function open(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const r = await createPeriod(orgId, { label, starts_on: starts, ends_on: ends });
    setBusy(false);
    if (!r.ok) return setMsg({ ok: false, text: r.error });
    setMsg({ ok: true, text: `Period “${r.period.label}” is open. Pick it when you import earnings.` });
    setLabel('');
    setStarts('');
    setEnds('');
    await reload();
  }
  async function generate() {
    setBusy(true);
    const r = await generateStatement(orgId, { payee_id: payeeId, period_id: periodId });
    setBusy(false);
    if (!r.ok) return setMsg({ ok: false, text: r.error });
    setMsg({ ok: true, text: `Draft made from ${r.lines} lines.` });
    await onDone(r.id);
  }

  return (
    <section className={cn(CARD, 'space-y-4')} data-testid="statement-generate">
      <h2 className={LABEL}>Generate a statement</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <span className="text-[11px] text-white/60">Payee</span>
          <Dropdown<string> value={payeeId} onChange={setPayeeId} options={[{ value: '', label: 'Choose a payee' }, ...payees.map((p) => ({ value: p.id, label: `${p.name ?? 'Payee'} · ${p.currency}` }))]} className="w-full" aria-label="Payee" />
        </div>
        <div className="space-y-1">
          <span className="text-[11px] text-white/60">Period</span>
          <Dropdown<string> value={periodId} onChange={setPeriodId} options={[{ value: '', label: 'Choose a period' }, ...periods.map((p) => ({ value: p.id, label: p.label }))]} className="w-full" aria-label="Period" />
        </div>
      </div>
      <button type="button" className={BTN} disabled={busy || !payeeId || !periodId} onClick={() => void generate()} data-testid="statement-generate-submit">
        <FileText size={12} strokeWidth={1.75} aria-hidden="true" />Generate
      </button>
      <p className="text-[11px] leading-relaxed text-white/50">
        A statement copies what the earnings run already worked out for this payee in this period — allocations less the advances already recouped. Generating again replaces only a draft.
      </p>
      {canOpen && (
        <form onSubmit={(e) => void open(e)} className="grid gap-3 border-t border-white/10 pt-4 sm:grid-cols-4" data-testid="period-form">
          <label className="space-y-1"><span className="text-[11px] text-white/60">New period</span><input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Q3 2026" className={FIELD} data-testid="period-label" /></label>
          <label className="space-y-1"><span className="text-[11px] text-white/60">From</span><input type="date" value={starts} onChange={(e) => setStarts(e.target.value)} className={FIELD} data-testid="period-start" /></label>
          <label className="space-y-1"><span className="text-[11px] text-white/60">To</span><input type="date" value={ends} onChange={(e) => setEnds(e.target.value)} className={FIELD} data-testid="period-end" /></label>
          <div className="flex items-end"><button type="submit" className={BTN} disabled={busy || !label || !starts || !ends} data-testid="period-submit">Open period</button></div>
        </form>
      )}
      {msg && <p role={msg.ok ? 'status' : 'alert'} className={cn('text-[11px]', msg.ok ? 'text-[#6DC6A4]' : 'text-[#ffb7a8]')} data-testid="statement-message">{msg.text}</p>}
    </section>
  );
}

function Detail({ orgId, item, onChanged }: { orgId: string; item: StatementItem; onChanged: () => Promise<void> }) {
  const [detail, setDetail] = useState<StatementDetail | null>(null);
  const [own, setOwn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    const r = await fetchStatement(orgId, item.id);
    if (r.ok) {
      setDetail(r.statement);
      setOwn(r.own);
      setError(null);
    } else setError(r.error);
  }, [orgId, item.id]);
  useEffect(() => {
    let live = true;
    void fetchStatement(orgId, item.id).then((r) => {
      if (!live) return;
      if (r.ok) {
        setDetail(r.statement);
        setOwn(r.own);
      } else setError(r.error);
    });
    return () => {
      live = false;
    };
  }, [orgId, item.id]);

  async function act(kind: 'approve' | 'issue' | 'void') {
    if (kind === 'void') {
      const ok = await confirmToast('Void this statement?', 'It stops counting, disappears from the artist’s view and frees its earnings for a new draft.', { confirmLabel: 'Void', danger: true });
      if (!ok) return;
    }
    setBusy(true);
    const r = await statementAct(orgId, item.id, kind);
    setBusy(false);
    setNote(r.ok ? null : r.error);
    await reload();
    await onChanged();
  }

  if (error) return <p className="mt-2 text-[11px] text-[#ffb7a8]" role="alert">{error}</p>;
  if (!detail) return <p className="mt-2 text-[11px] text-white/40">Loading…</p>;
  const a = detail.actions;
  return (
    <div className="mt-2 space-y-4 rounded-xl border border-white/10 bg-[var(--surface-primary)] p-4" data-testid="statement-detail">
      <div className="grid gap-1 text-[11px]">
        {detail.songs.map((s) => (
          <div key={s.trackId ?? s.title} className="flex justify-between gap-3" data-testid="statement-song">
            <span className="truncate text-white/80">{s.title}{s.shareUnits !== null && <span className="ml-2 text-white/40">{share(s.shareUnits)}</span>}</span>
            <span className="tabular-nums text-white/80">{showMoney(s.earnedMinor, detail.currency)}</span>
          </div>
        ))}
        <div className="flex justify-between gap-3 text-white/60"><span>Advances recouped</span><span className="tabular-nums" data-testid="statement-recouped">−{showMoney(detail.recoupedMinor, detail.currency)}</span></div>
        <div className="flex justify-between gap-3 border-t border-white/10 pt-1 text-white"><span>Net</span><span className="tabular-nums" data-testid="statement-net">{showMoney(detail.netMinor, detail.currency)}</span></div>
        {detail.status === 'issued' && (
          <>
            <div className="flex justify-between gap-3 text-white/60"><span>Paid</span><span className="tabular-nums" data-testid="statement-paid">{showMoney(detail.paidMinor ?? '0', detail.currency)}</span></div>
            <div className="flex justify-between gap-3 text-white/60"><span>Outstanding · {PAY_LABEL[detail.paymentState ?? 'unpaid']}</span><span className="tabular-nums" data-testid="statement-outstanding">{showMoney(detail.outstandingMinor ?? '0', detail.currency)}</span></div>
          </>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {a?.approve && <button type="button" className={BTN} disabled={busy} onClick={() => void act('approve')} data-testid="statement-approve">Approve</button>}
        {a?.issue && <button type="button" className={BTN} disabled={busy} onClick={() => void act('issue')} data-testid="statement-issue">Issue to the artist</button>}
        {a?.void && <button type="button" className={BTN} disabled={busy} onClick={() => void act('void')} data-testid="statement-void">Void</button>}
        <a className={BTN} href={exportUrl(orgId, item.id, 'pdf')} data-testid="statement-pdf"><Download size={12} strokeWidth={1.75} aria-hidden="true" />PDF</a>
        <a className={BTN} href={exportUrl(orgId, item.id, 'csv')} data-testid="statement-csv"><Download size={12} strokeWidth={1.75} aria-hidden="true" />CSV</a>
      </div>
      {!own && detail.status === 'draft' && !a?.approve && a?.regenerate && (
        <p className="text-[11px] text-white/50">Someone other than the person who generated this draft approves it (an owner may approve their own).</p>
      )}
      {note && <p className="text-[11px] text-[#ffb7a8]" role="alert" data-testid="statement-act-error">{note}</p>}

      {detail.status === 'issued' && (
        <Payments orgId={orgId} detail={detail} own={own} onChanged={async () => { await reload(); await onChanged(); }} />
      )}
    </div>
  );
}

function Payments({ orgId, detail, own, onChanged }: { orgId: string; detail: StatementDetail; own: boolean; onChanged: () => Promise<void> }) {
  const [amount, setAmount] = useState('');
  const [paidOn, setPaidOn] = useState(new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const exp = isCurrency(detail.currency) ? currencyExponent(detail.currency) : 2;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const minor = minorFromTyped(amount, exp);
    if (!minor) return setError('Enter an amount above zero.');
    setBusy(true);
    const r = await recordPayment(orgId, detail.id, { amount_minor: minor, paid_on: paidOn, ...(reference.trim() ? { reference: reference.trim() } : {}) });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setError(null);
    setAmount('');
    setReference('');
    await onChanged();
  }
  async function voidIt(id: string) {
    const ok = await confirmToast('Void this payment?', 'The statement’s balance is worked out again without it.', { confirmLabel: 'Void', danger: true });
    if (!ok) return;
    const r = await voidPayment(orgId, detail.id, id);
    setError(r.ok ? null : r.error);
    await onChanged();
  }

  return (
    <div className="space-y-3 border-t border-white/10 pt-3" data-testid="statement-payments">
      <h3 className={LABEL}>Payments recorded</h3>
      {detail.payments.length === 0 && <p className="text-[11px] text-white/50">No payment recorded yet.</p>}
      <ul className="space-y-1">
        {detail.payments.map((p) => (
          <li key={p.id} className={cn('flex flex-wrap items-center justify-between gap-2 text-[11px]', p.voided ? 'text-white/30 line-through' : 'text-white/80')} data-testid="payment-row">
            <span>{p.paidOn}{p.reference ? ` · ${p.reference}` : ''}</span>
            <span className="flex items-center gap-3 tabular-nums">
              {showMoney(p.amountMinor, p.currency)}
              {!own && detail.actions?.voidPayment && !p.voided && <button type="button" className={BTN} onClick={() => void voidIt(p.id)} data-testid="payment-void">Void</button>}
            </span>
          </li>
        ))}
      </ul>
      {!own && detail.actions?.recordPayment && (
        <form onSubmit={(e) => void submit(e)} className="grid gap-3 sm:grid-cols-4" data-testid="payment-form">
          <label className="space-y-1"><span className="text-[11px] text-white/60">Amount ({detail.currency})</span><input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" className={FIELD} data-testid="payment-amount" /></label>
          <label className="space-y-1"><span className="text-[11px] text-white/60">Paid on</span><input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} className={FIELD} data-testid="payment-date" /></label>
          <label className="space-y-1"><span className="text-[11px] text-white/60">Reference (not an account number)</span><input value={reference} onChange={(e) => setReference(e.target.value)} className={FIELD} data-testid="payment-reference" /></label>
          <div className="flex items-end"><button type="submit" className={BTN} disabled={busy || !amount} data-testid="payment-submit">Record payment</button></div>
        </form>
      )}
      {!own && <p className="text-[11px] text-white/40">This records a payment made outside Label OS. The app does not move money.</p>}
      {error && <p className="text-[11px] text-[#ffb7a8]" role="alert" data-testid="payment-error">{error}</p>}
    </div>
  );
}
