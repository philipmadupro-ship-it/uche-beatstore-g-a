'use client';

/**
 * Advances (LABEL-64): the ledger of money paid to a payee up front — recoupable (drawn down out of
 * their later earnings) or not. What each viewer may see and do is the server's
 * (`/api/org/[orgId]/finance/advances`); this draws what it sent. The kind, amount and date of an
 * advance that a recoupment or a statement already uses are FIXED (the row says so and offers no
 * edit); its note can still change. The app records money paid elsewhere; it never sends any.
 */
import { useCallback, useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { Dropdown } from '@/components/ui/Dropdown';
import { confirmToast } from '@/hooks/useToast';
import { showMoney } from '@/lib/labelos/earnings-client';
import {
  createAdvance, fetchAdvances, patchAdvance, typedAmountMinor, voidAdvance,
  type AdvanceItem, type AdvancePayee, type LedgerTotal,
} from '@/lib/labelos/finance-dashboard-client';
import { formatMajor, isCurrency, money } from '@/lib/labelos/finance/money';
import { ADVANCE_KIND_LABEL, ADVANCE_STATUS_LABEL } from '@/lib/labelos/finance/advances';
import { cn } from '@/lib/utils';

const LABEL = 'text-[10px] font-mono uppercase tracking-[0.2em] text-white/40';
const NOTICE = 'rounded-xl border border-white/10 bg-[var(--surface-primary)] px-4 py-6 text-center text-[11px] text-white/60';
const CARD = 'rounded-xl border border-white/10 bg-[var(--surface-primary)] p-4';
const BTN = 'inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.06] px-3 py-1.5 text-[11px] text-white/80 transition-colors hover:border-white/20 hover:bg-white/[0.10] disabled:opacity-40 disabled:hover:border-white/10 disabled:hover:bg-white/[0.06]';
const FIELD = 'w-full min-w-0 max-w-full rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-[11px] text-white/80 outline-none focus:border-white/30 disabled:opacity-40';
const KINDS = [
  { value: 'recoupable', label: 'Recoupable — repaid out of earnings' },
  { value: 'non_recoupable', label: 'Non-recoupable — never repaid' },
] as const;

type Loaded = { canWrite: boolean; advances: AdvanceItem[]; totals: LedgerTotal[]; payees: AdvancePayee[] };

/** The text a field starts with when editing an amount: "12.50", never grouped. */
const typed = (minor: string, currency: string): string => (isCurrency(currency) ? formatMajor(money(BigInt(minor), currency)) : minor);

export function AdvancesView({ orgId }: { orgId: string }) {
  const [data, setData] = useState<Loaded | null>(null);
  const [notReady, setNotReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetchAdvances(orgId);
    if (!r.ok) return setError(r.error);
    setError(null);
    setNotReady(!r.schemaReady);
    setData({ canWrite: r.canWrite, advances: r.advances, totals: r.totals, payees: r.payees });
  }, [orgId]);

  useEffect(() => {
    let live = true;
    void fetchAdvances(orgId).then((r) => {
      if (!live) return;
      if (!r.ok) return setError(r.error);
      setNotReady(!r.schemaReady);
      setData({ canWrite: r.canWrite, advances: r.advances, totals: r.totals, payees: r.payees });
    });
    return () => {
      live = false;
    };
  }, [orgId]);

  if (error) {
    return (
      <div className={NOTICE} data-testid="advances-failed">
        {error}
        <button type="button" className={cn(BTN, 'ml-3')} onClick={() => void load()}>Try again</button>
      </div>
    );
  }
  if (!data) return <p className="text-[11px] text-white/40" data-testid="advances-loading">Loading advances…</p>;
  if (notReady) return <p className={NOTICE} data-testid="advances-not-ready">Advances are not set up yet: the finance database migrations (179 to 182) are not applied.</p>;

  const names = new Map(data.payees.map((p) => [p.id, p.name ?? 'Payee']));
  return (
    <div className="space-y-8" data-testid="advances">
      {data.totals.length > 0 && (
        <section aria-label="Ledger totals" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="advances-totals">
          {data.totals.map((t) => (
            <div key={t.currency} className={cn(CARD, 'sm:col-span-2 lg:col-span-4 grid grid-cols-2 gap-4 lg:grid-cols-4')}>
              <Stat label={`Recoupable · ${t.currency}`} value={showMoney(t.recoupableMinor, t.currency)} />
              <Stat label="Recouped so far" value={showMoney(t.recoupedMinor, t.currency)} />
              <Stat label="Still to recover" value={showMoney(t.unrecoupedMinor, t.currency)} testid="total-unrecouped" />
              <Stat label="Non-recoupable" value={showMoney(t.nonRecoupableMinor, t.currency)} />
            </div>
          ))}
        </section>
      )}

      {data.canWrite && <AdvanceForm orgId={orgId} payees={data.payees} onDone={load} />}
      {!data.canWrite && <p className="text-[11px] text-white/50" data-testid="advances-readonly">You can read the ledger; recording an advance needs finance write access.</p>}

      <section aria-labelledby="ledger-h" data-testid="advances-ledger">
        <h2 id="ledger-h" className={cn(LABEL, 'mb-3')}>Ledger · {data.advances.length}</h2>
        {data.advances.length === 0 ? (
          <p className={NOTICE} data-testid="advances-empty">No advance recorded yet.</p>
        ) : (
          <ul className="space-y-2">
            {[...data.advances].reverse().map((a) => (
              <AdvanceRow key={`${a.id}|${a.kind}|${a.amountMinor}|${a.paidOn}|${a.note}|${a.canEditTerms}`} orgId={orgId} advance={a} payee={names.get(a.payeeId) ?? 'Payee'} canWrite={data.canWrite} onDone={load} />
            ))}
          </ul>
        )}
      </section>
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

function AdvanceForm({ orgId, payees, onDone }: { orgId: string; payees: AdvancePayee[]; onDone: () => Promise<void> }) {
  const active = payees.filter((p) => p.active);
  const [payeeId, setPayeeId] = useState('');
  const [kind, setKind] = useState<'recoupable' | 'non_recoupable'>('recoupable');
  const [amount, setAmount] = useState('');
  const [paidOn, setPaidOn] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const payee = active.find((p) => p.id === payeeId);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!payee) return setMsg({ ok: false, text: 'Choose who the advance is for.' });
    const minor = typedAmountMinor(amount, payee.currency);
    if (!minor) return setMsg({ ok: false, text: `Enter an amount above zero in ${payee.currency}, like 1500 or 1,500.00.` });
    setBusy(true);
    const r = await createAdvance(orgId, { payee_id: payee.id, kind, amount_minor: minor, ...(paidOn ? { paid_on: paidOn } : {}), ...(note.trim() ? { note: note.trim() } : {}) });
    setBusy(false);
    if (!r.ok) return setMsg({ ok: false, text: r.error });
    setMsg({ ok: true, text: 'Advance recorded.' });
    setAmount('');
    setNote('');
    setPaidOn('');
    await onDone();
  }

  if (active.length === 0) {
    return <p className={NOTICE} data-testid="advance-no-payees">An advance is made to a payee. Add a payee first (Rights → Parties, then make the party a payee).</p>;
  }
  return (
    <form onSubmit={(e) => void submit(e)} className={cn(CARD, 'space-y-4')} data-testid="advance-form">
      <h2 className={LABEL}>Record an advance</h2>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2">
        <div className="block min-w-0 space-y-1">
          <span className="text-[11px] text-white/60">Payee</span>
          <Dropdown<string> value={payeeId} onChange={setPayeeId} options={[{ value: '', label: 'Choose a payee' }, ...active.map((p) => ({ value: p.id, label: `${p.name ?? 'Payee'} · ${p.currency}` }))]} className="w-full" aria-label="Payee" />
        </div>
        <div className="block min-w-0 space-y-1">
          <span className="text-[11px] text-white/60">Kind</span>
          <Dropdown<'recoupable' | 'non_recoupable'> value={kind} onChange={setKind} options={KINDS.map((k) => ({ value: k.value, label: k.label }))} className="w-full" aria-label="Kind" />
        </div>
        <label className="block min-w-0 space-y-1">
          <span className="text-[11px] text-white/60">Amount{payee ? ` (${payee.currency})` : ''}</span>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="1,500.00" className={FIELD} data-testid="advance-amount" />
        </label>
        <label className="block min-w-0 space-y-1">
          <span className="text-[11px] text-white/60">Paid on (optional)</span>
          <input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} className={FIELD} data-testid="advance-date" />
        </label>
      </div>
      <label className="block min-w-0 space-y-1">
        <span className="text-[11px] text-white/60">Note (optional, up to 500 characters)</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} className={FIELD} data-testid="advance-note" />
      </label>
      <p className="text-[11px] leading-relaxed text-white/50">
        This records money you paid outside this app. A recoupable advance is repaid out of the payee’s next earnings, oldest first, before they are owed anything; once any of it has been recouped, or a statement uses it, its kind, amount and date are fixed.
      </p>
      <div className="flex items-center gap-3">
        <button type="submit" className={BTN} disabled={busy} data-testid="advance-submit">
          <Plus size={12} strokeWidth={1.75} aria-hidden="true" />
          {busy ? 'Recording…' : 'Record advance'}
        </button>
        {msg && <p role={msg.ok ? 'status' : 'alert'} className={cn('text-[11px]', msg.ok ? 'text-[#6DC6A4]' : 'text-[#ffb7a8]')} data-testid="advance-message">{msg.text}</p>}
      </div>
    </form>
  );
}

function AdvanceRow({ orgId, advance: a, payee, canWrite, onDone }: { orgId: string; advance: AdvanceItem; payee: string; canWrite: boolean; onDone: () => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [kind, setKind] = useState(a.kind);
  const [amount, setAmount] = useState(typed(a.amountMinor, a.currency));
  const [paidOn, setPaidOn] = useState(a.paidOn ?? '');
  const [note, setNote] = useState(a.note ?? '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const live = a.status !== 'void';

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const body: Parameters<typeof patchAdvance>[2] = {};
    if (a.canEditTerms) {
      if (kind !== a.kind) body.kind = kind;
      const minor = typedAmountMinor(amount, a.currency);
      if (!minor) return setMsg(`Enter an amount above zero in ${a.currency}.`);
      if (minor !== a.amountMinor) body.amount_minor = minor;
      if ((paidOn || null) !== a.paidOn) body.paid_on = paidOn || null;
    }
    if ((note.trim() || null) !== a.note) body.note = note.trim() || null;
    if (Object.keys(body).length === 0) {
      setEditing(false);
      return;
    }
    setBusy(true);
    const r = await patchAdvance(orgId, a.id, body);
    setBusy(false);
    if (!r.ok) {
      setMsg(r.error);
      if (r.code === 'advance_referenced') await onDone();
      return;
    }
    setMsg(null);
    setEditing(false);
    await onDone();
  }
  async function voidIt() {
    const ok = await confirmToast('Void this advance?', 'Use this for an entry made by mistake. It counts for nothing afterwards and cannot be undone.', { confirmLabel: 'Void advance', danger: true });
    if (!ok) return;
    setBusy(true);
    const r = await voidAdvance(orgId, a.id);
    setBusy(false);
    if (r.ok) await onDone();
    else setMsg(r.error);
  }

  return (
    <li className={cn('rounded-xl border border-white/10 bg-[var(--surface-primary)] p-3', !live && 'opacity-60')} data-testid="advance-row" data-status={a.status} data-kind={a.kind}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-0 basis-full sm:basis-0 sm:flex-1">
          <p className="truncate text-[13px] text-white">{payee}</p>
          <p className="text-[11px] text-white/60">
            {ADVANCE_KIND_LABEL[a.kind]}{a.paidOn ? ` · paid ${a.paidOn}` : ''}{a.note ? ` · ${a.note}` : ''}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[13px] tabular-nums text-white" data-testid="advance-amount-shown">{showMoney(a.amountMinor, a.currency)}</p>
          {a.kind === 'recoupable' && live && (
            <p className="text-[11px] tabular-nums text-white/60" data-testid="advance-remaining">
              {showMoney(a.remainingMinor, a.currency)} left{a.status !== 'open' ? ` · ${showMoney(a.recoupedMinor, a.currency)} recouped` : ''}
            </p>
          )}
        </div>
        <span
          className={cn('rounded-full border px-2 py-0.5 text-[10px] font-mono uppercase tracking-[0.1em]', a.status === 'recouped' ? 'border-[#6DC6A4]/40 text-[#6DC6A4]' : 'border-white/20 text-white/60')}
          data-testid="advance-status"
        >
          {ADVANCE_STATUS_LABEL[a.status]}
        </span>
        {canWrite && live && (
          <>
            <button type="button" className={BTN} disabled={busy} onClick={() => setEditing((v) => !v)} data-testid="advance-edit">{editing ? 'Cancel' : 'Edit'}</button>
            {a.canVoid && <button type="button" className={BTN} disabled={busy} onClick={() => void voidIt()} data-testid="advance-void">Void</button>}
          </>
        )}
      </div>
      {live && !a.canEditTerms && (
        <p className="mt-2 text-[11px] text-white/50" data-testid="advance-fixed">
          Kind, amount and date are fixed: money has been recouped from this advance or a statement uses it.
        </p>
      )}
      {editing && (
        <form onSubmit={(e) => void save(e)} className="mt-3 space-y-3 border-t border-white/10 pt-3" data-testid="advance-edit-form">
          <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-3">
            <div className="block min-w-0 space-y-1">
              <span className="text-[11px] text-white/60">Kind</span>
              <Dropdown<string> value={kind} onChange={(v) => setKind(v as AdvanceItem['kind'])} options={KINDS.map((k) => ({ value: k.value, label: k.label }))} disabled={!a.canEditTerms} className="w-full" aria-label="Kind" />
            </div>
            <label className="block min-w-0 space-y-1">
              <span className="text-[11px] text-white/60">Amount ({a.currency})</span>
              <input value={amount} onChange={(e) => setAmount(e.target.value)} disabled={!a.canEditTerms} inputMode="decimal" className={FIELD} data-testid="advance-edit-amount" />
            </label>
            <label className="block min-w-0 space-y-1">
              <span className="text-[11px] text-white/60">Paid on</span>
              <input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} disabled={!a.canEditTerms} className={FIELD} />
            </label>
          </div>
          <label className="block min-w-0 space-y-1">
            <span className="text-[11px] text-white/60">Note</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} className={FIELD} data-testid="advance-edit-note" />
          </label>
          <button type="submit" className={BTN} disabled={busy} data-testid="advance-save">{busy ? 'Saving…' : 'Save'}</button>
        </form>
      )}
      {msg && <p role="alert" className="mt-2 text-[11px] text-[#ffb7a8]" data-testid="advance-row-message">{msg}</p>}
    </li>
  );
}
