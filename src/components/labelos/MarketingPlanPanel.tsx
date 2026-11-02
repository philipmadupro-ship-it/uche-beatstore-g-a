'use client';

/**
 * A release's marketing plan (LABEL-65), on the release page: the timeline
 * (pre-save, teaser, release, post), the platform checklist, asks to the artist,
 * tasks (LABEL-23's, on this release) and — only for someone who may read
 * budgets — the budget. Every call is a plain request to a plan route followed
 * by a reload; every rule is the server's, and its own words are what the toast
 * says. A control appears only for someone the server would let press it
 * (`me`). Single properties are edited in place (`InlineText`); nothing opens a
 * modal.
 */
import { useCallback, useEffect, useState } from 'react';
import { Check, X } from 'lucide-react';
import { Dropdown } from '@/components/ui/Dropdown';
import { InlineText } from '@/components/ui/InlineText';
import { TasksPanel } from '@/components/labelos/TasksPanel';
import { toast } from '@/hooks/useToast';
import { cn } from '@/lib/utils';
import {
  addBudgetLine,
  addMilestone,
  fetchMarketing,
  patchBudgetLine,
  patchMilestone,
  removeBudgetLine,
  removeMilestone,
  requestAsset,
  setAssetRequestStatus,
  setPlanRequired,
  setPlatformStep,
  type MarketingResult,
  type MarketingState,
} from '@/lib/labelos/marketing-plan-client';
import {
  ASSET_KINDS,
  ASSET_KIND_LABEL,
  BUDGET_STATUSES,
  PHASE_LABEL,
  PLAN_LIMITS,
  PLAN_PHASES,
  type AssetKind,
  type BudgetStatus,
  type PlanPhase,
} from '@/lib/labelos/marketing-plan';
import { formatMajor, money, parseMajor } from '@/lib/labelos/finance/money';

const LABEL = 'font-mono text-[10px] uppercase tracking-[0.2em] text-white/40';
const CARD = 'rounded-xl border border-white/10 bg-[#0D0D0A] p-4';
const FIELD = 'h-8 rounded-lg border border-white/10 bg-white/[0.06] px-2.5 text-[11px] text-white/80 placeholder:text-white/30 focus:border-white/30 focus:outline-none';
const BTN = 'inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.06] px-3 text-[11px] text-white/70 transition-colors hover:border-white/20 hover:bg-white/[0.10] hover:text-white disabled:opacity-40';
const ICON_BTN = 'grid size-7 shrink-0 place-items-center rounded-lg text-white/50 transition-colors hover:bg-white/[0.10] hover:text-white disabled:opacity-30';
const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'NGN', 'ZAR', 'JPY'] as const;

type Ready = Extract<MarketingState, { schemaReady: true }>;

const day = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

function amountText(minor: string, currency: string): string {
  try {
    return `${formatMajor(money(BigInt(minor), currency))} ${currency}`;
  } catch {
    return `${minor} ${currency}`;
  }
}

export function MarketingPlanPanel({ orgId, releaseId }: { orgId: string; releaseId: string }) {
  const [state, setState] = useState<MarketingState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetchMarketing(orgId, releaseId);
    if (res.ok) {
      setState(res.state);
      setError(null);
    } else setError(res.error);
  }, [orgId, releaseId]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Run one call, say what happened in the server's words, reload. Resolves true when it worked. */
  const act = useCallback(
    async (run: () => Promise<MarketingResult<object>>, success?: string): Promise<boolean> => {
      setBusy(true);
      try {
        const res = await run();
        if (!res.ok) {
          toast.error(res.error);
          return false;
        }
        if (success) toast.success(success);
        await load();
        return true;
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  if (error && !state) return <section className={CARD} data-testid="marketing-plan"><p className="text-[11px] text-white/60" role="alert">{error}</p></section>;
  if (!state) return <section className={CARD} data-testid="marketing-plan" aria-busy="true"><p className={LABEL}>Marketing</p></section>;
  if (!state.schemaReady) {
    return (
      <section className={CARD} data-testid="marketing-plan" data-ready="false">
        <h2 className={`${LABEL} mb-2`}>Marketing</h2>
        <p className="text-[11px] leading-relaxed text-white/60">Marketing plans are not set up for this workspace yet.</p>
      </section>
    );
  }
  const s = state;
  const items = s.items ?? [];
  const canWrite = s.me.canWrite;

  return (
    <section aria-labelledby="release-marketing" className="space-y-4" data-testid="marketing-plan" data-ready="true">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="release-marketing" className="font-heading text-[20px] font-bold tracking-tight text-white">Marketing</h2>
        {s.me.canSetRequired && (
          <button
            type="button"
            role="switch"
            aria-checked={s.required}
            disabled={busy}
            onClick={() => void act(() => setPlanRequired(orgId, !s.required), s.required ? 'The marketing gate no longer asks for a plan.' : 'The marketing gate now asks for a plan.')}
            className={cn(BTN, s.required && 'border-white/30 bg-white/[0.14] text-white')}
            data-testid="marketing-plan-required"
          >
            {s.required ? 'Plan required for the gate' : 'Require a plan for the gate'}
          </button>
        )}
      </div>

      {s.required && s.gateSkipped && (
        <p className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-[11px] leading-relaxed text-white/60" role="note" data-testid="marketing-plan-gate-skipped">
          A plan is required, but this organization has switched the marketing approval off, so the gate does not ask for one.
        </p>
      )}
      {s.required && !s.gateSkipped && (
        <p className="rounded-xl border border-white/20 bg-white/[0.06] px-4 py-3 text-[11px] leading-relaxed text-white/80" role="note" data-testid="marketing-plan-gate-note">
          {s.gate.missing.length === 0 && s.plan
            ? 'This organization asks for a plan before the marketing gate can pass, and this one has what it needs.'
            : `This organization asks for a plan before the marketing gate can pass. Still needed: a ${s.gate.missing.map((p) => PHASE_LABEL[p].toLowerCase()).join(' and a ')} milestone.`}
        </p>
      )}

      <Timeline orgId={orgId} releaseId={releaseId} items={items} canWrite={canWrite} busy={busy} act={act} />
      <Checklist orgId={orgId} releaseId={releaseId} state={s} canWrite={canWrite} busy={busy} act={act} />
      <Assets orgId={orgId} releaseId={releaseId} state={s} canWrite={canWrite} busy={busy} act={act} />
      {s.budget && <Budget orgId={orgId} releaseId={releaseId} budget={s.budget} canWrite={s.me.canWriteBudget} busy={busy} act={act} />}
      <TasksPanel orgId={orgId} object={{ kind: 'release', id: releaseId }} label="Tasks on this release" testId="marketing-tasks" />
    </section>
  );
}

type Act = (run: () => Promise<MarketingResult<object>>, success?: string) => Promise<boolean>;

// ── Timeline ─────────────────────────────────────────────────────────────

function Timeline({ orgId, releaseId, items, canWrite, busy, act }: { orgId: string; releaseId: string; items: NonNullable<Ready['items']>; canWrite: boolean; busy: boolean; act: Act }) {
  const [phase, setPhase] = useState<PlanPhase>('teaser');
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !due) return;
    if (await act(() => addMilestone(orgId, releaseId, { phase, title: title.trim(), due_on: due }), 'Milestone added.')) setTitle('');
  };

  return (
    <div className={CARD} data-testid="marketing-timeline">
      <h3 className={`${LABEL} mb-3`}>Timeline</h3>
      {items.length === 0 ? (
        <p className="text-[11px] text-white/50">Nothing planned yet.{canWrite ? ' Add the first milestone below.' : ''}</p>
      ) : (
        <ul className="divide-y divide-white/10">
          {items.map((i) => {
            const done = i.doneAt !== null;
            return (
              <li key={i.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2" data-testid={`milestone-${i.id}`} data-done={done ? 'true' : 'false'}>
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={done}
                  aria-label={`${done ? 'Reopen' : 'Complete'} “${i.title}”`}
                  disabled={!canWrite || busy}
                  onClick={() => void act(() => patchMilestone(orgId, releaseId, i.id, { done: !done }))}
                  className={cn('flex size-4 shrink-0 items-center justify-center rounded border transition-colors disabled:opacity-40', done ? 'border-white/30 bg-white/[0.14] text-white' : 'border-white/20 hover:border-white/40')}
                >
                  {done && <Check size={11} aria-hidden="true" />}
                </button>
                <span className={`${LABEL} w-20 shrink-0`}>{PHASE_LABEL[i.phase as PlanPhase] ?? i.phase}</span>
                <div className={cn('min-w-0 basis-full text-[13px] sm:flex-1 sm:basis-0', done ? 'text-white/40 line-through' : 'text-white/80')}>
                  {canWrite ? (
                    <InlineText value={i.title} label="Milestone title" maxLength={PLAN_LIMITS.title} onSave={(next) => act(() => patchMilestone(orgId, releaseId, i.id, { title: next }))} className="text-[13px]" inputClassName="text-[13px]" />
                  ) : (
                    i.title
                  )}
                </div>
                {canWrite ? (
                  <input type="date" value={i.dueOn} disabled={busy} aria-label={`Date for “${i.title}”`} onChange={(e) => e.target.value && void act(() => patchMilestone(orgId, releaseId, i.id, { due_on: e.target.value }))} className={FIELD} />
                ) : (
                  <span className="text-[11px] text-white/50">{day(i.dueOn)}</span>
                )}
                {canWrite && (
                  <button type="button" aria-label={`Remove “${i.title}”`} disabled={busy} onClick={() => void act(() => removeMilestone(orgId, releaseId, i.id), 'Milestone removed.')} className={ICON_BTN}>
                    <X size={14} aria-hidden="true" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {canWrite && (
        <form onSubmit={submit} className="mt-3 flex flex-wrap items-center gap-2" data-testid="marketing-milestone-form">
          <Dropdown<PlanPhase> value={phase} aria-label="Phase" options={PLAN_PHASES.map((p) => ({ value: p, label: PHASE_LABEL[p] }))} onChange={setPhase} />
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Milestone" aria-label="Milestone" maxLength={PLAN_LIMITS.title} className={cn(FIELD, 'min-w-[10rem] flex-1')} />
          <input type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Milestone date" className={FIELD} />
          <button type="submit" disabled={!title.trim() || !due || busy} className={BTN}>Add</button>
        </form>
      )}
    </div>
  );
}

// ── Platform checklist ───────────────────────────────────────────────────

function Checklist({ orgId, releaseId, state, canWrite, busy, act }: { orgId: string; releaseId: string; state: Ready; canWrite: boolean; busy: boolean; act: Act }) {
  const rows = state.checklist ?? [];
  return (
    <div className={CARD} data-testid="marketing-checklist">
      <h3 className={`${LABEL} mb-3`}>Platform checklist</h3>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((p) => (
          <fieldset key={p.platform} className="rounded-lg border border-white/10 p-3">
            <legend className="px-1 text-[11px] text-white/70">{p.label}</legend>
            <ul className="space-y-1.5">
              {p.steps.map((st) => (
                <li key={st.step}>
                  <label className="flex items-center gap-2 text-[11px] text-white/70">
                    <input
                      type="checkbox"
                      checked={st.done}
                      disabled={!canWrite || busy}
                      onChange={(e) => void act(() => setPlatformStep(orgId, releaseId, { platform: p.platform, step: st.step, done: e.target.checked }))}
                      aria-label={`${p.label}: ${st.label}`}
                    />
                    <span className={st.done ? 'text-white/40 line-through' : ''}>{st.label}</span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
        ))}
      </div>
    </div>
  );
}

// ── Asks to the artist ───────────────────────────────────────────────────

function Assets({ orgId, releaseId, state, canWrite, busy, act }: { orgId: string; releaseId: string; state: Ready; canWrite: boolean; busy: boolean; act: Act }) {
  const [kind, setKind] = useState<AssetKind>('photos');
  const [note, setNote] = useState('');
  const [after, setAfter] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const requests = state.assets ?? [];

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sending) return;
    setSending(true);
    const res = await requestAsset(orgId, releaseId, { kind, note: note.trim() || null }).finally(() => setSending(false));
    if (!res.ok) return void toast.error(res.error);
    setNote('');
    setAfter(
      res.delivery === 'notified'
        ? 'The artist has been told.'
        : res.delivery === 'failed'
          ? 'Recorded, but the artist could not be told just now.'
          : 'Recorded, but nobody with an account stands for this artist yet, so nobody was told. Ask them another way.',
    );
    await act(async () => ({ ok: true as const }));
  };

  return (
    <div className={CARD} data-testid="marketing-assets">
      <h3 className={`${LABEL} mb-3`}>Asked of the artist</h3>
      {requests.length === 0 ? (
        <p className="text-[11px] text-white/50">No requests yet.</p>
      ) : (
        <ul className="divide-y divide-white/10">
          {requests.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2" data-testid={`asset-${r.id}`} data-status={r.status}>
              <span className="text-[13px] text-white/80">{ASSET_KIND_LABEL[r.kind as AssetKind] ?? r.kind}</span>
              {r.note && <span className="min-w-0 flex-1 truncate text-[11px] text-white/50">{r.note}</span>}
              <span className="text-[10px] text-white/40">{r.status === 'open' ? (r.notified ? 'Asked' : 'Not delivered') : r.status === 'fulfilled' ? 'Received' : 'Cancelled'}</span>
              {canWrite && r.status === 'open' && (
                <>
                  <button type="button" disabled={busy} onClick={() => void act(() => setAssetRequestStatus(orgId, releaseId, r.id, 'fulfilled'))} className={BTN}>Mark received</button>
                  <button type="button" disabled={busy} onClick={() => void act(() => setAssetRequestStatus(orgId, releaseId, r.id, 'cancelled'))} className={BTN}>Cancel</button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {!canWrite && requests.some((r) => r.status === 'open') && (
        <p className="mt-3 text-[11px] leading-relaxed text-white/60" data-testid="marketing-asset-howto">
          To send these, reply to your A&amp;R contact at the label, or upload the files to the project they shared with you. They mark each one received.
        </p>
      )}
      {after && <p className="mt-2 text-[11px] leading-relaxed text-white/60" role="status" data-testid="marketing-asset-delivery">{after}</p>}
      {canWrite && (
        <form onSubmit={submit} className="mt-3 flex flex-wrap items-center gap-2">
          <Dropdown<AssetKind> value={kind} aria-label="What to ask for" options={ASSET_KINDS.map((k) => ({ value: k, label: ASSET_KIND_LABEL[k] }))} onChange={setKind} />
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" aria-label="Note" maxLength={PLAN_LIMITS.assetNote} className={cn(FIELD, 'min-w-[10rem] flex-1')} />
          <button type="submit" disabled={busy || sending} className={BTN}>Ask</button>
        </form>
      )}
    </div>
  );
}

// ── Budget (business readers only) ───────────────────────────────────────

function Budget({ orgId, releaseId, budget, canWrite, busy, act }: { orgId: string; releaseId: string; budget: NonNullable<Ready['budget']>; canWrite: boolean; busy: boolean; act: Act }) {
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState<string>('USD');
  const [status, setStatus] = useState<BudgetStatus>('planned');
  const parsed = amount.trim() ? parseMajor(amount, currency) : null;
  const invalid = amount.trim() !== '' && (parsed === null || parsed.minor < BigInt(0));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!label.trim() || !parsed || invalid) return;
    if (await act(() => addBudgetLine(orgId, releaseId, { label: label.trim(), amount_minor: parsed.minor.toString(), currency, status }), 'Budget line added.')) {
      setLabel('');
      setAmount('');
    }
  };

  return (
    <div className={CARD} data-testid="marketing-budget">
      <h3 className={`${LABEL} mb-1`}>Budget</h3>
      <p className="mb-3 text-[10px] text-white/40">Visible to people who can read the business side only.</p>
      {budget.lines.length === 0 ? (
        <p className="text-[11px] text-white/50">No budget lines yet.</p>
      ) : (
        <ul className="divide-y divide-white/10">
          {budget.lines.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2" data-testid={`budget-${l.id}`}>
              <div className="min-w-0 basis-full text-[13px] text-white/80 sm:flex-1 sm:basis-0">
                {canWrite ? <InlineText value={l.label} label="Budget line" maxLength={PLAN_LIMITS.label} onSave={(next) => act(() => patchBudgetLine(orgId, releaseId, l.id, { label: next }))} className="text-[13px]" inputClassName="text-[13px]" /> : l.label}
              </div>
              <span className="font-mono text-[11px] text-white/80" data-testid={`budget-amount-${l.id}`}>{amountText(l.amountMinor, l.currency)}</span>
              {canWrite ? (
                <Dropdown<BudgetStatus> value={l.status as BudgetStatus} aria-label={`Status of ${l.label}`} options={BUDGET_STATUSES.map((b) => ({ value: b, label: b[0].toUpperCase() + b.slice(1) }))} onChange={(next) => void act(() => patchBudgetLine(orgId, releaseId, l.id, { status: next }))} />
              ) : (
                <span className="text-[10px] capitalize text-white/40">{l.status}</span>
              )}
              {canWrite && (
                <button type="button" aria-label={`Remove “${l.label}”`} disabled={busy} onClick={() => void act(() => removeBudgetLine(orgId, releaseId, l.id), 'Budget line removed.')} className={ICON_BTN}>
                  <X size={14} aria-hidden="true" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {budget.totals.length > 0 && (
        <div className="mt-3 space-y-1 border-t border-white/10 pt-3" data-testid="marketing-budget-totals">
          {budget.totals.map((t) => (
            <p key={t.currency} className="flex flex-wrap gap-x-4 text-[11px] text-white/60">
              <span className="font-mono text-white/80">{amountText(t.total, t.currency)}</span>
              <span>planned {amountText(t.planned, t.currency)}</span>
              <span>committed {amountText(t.committed, t.currency)}</span>
              <span>spent {amountText(t.spent, t.currency)}</span>
            </p>
          ))}
        </div>
      )}
      {canWrite && (
        <form onSubmit={submit} className="mt-3 flex flex-wrap items-center gap-2" data-testid="marketing-budget-form">
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="What it pays for" aria-label="Budget line" maxLength={PLAN_LIMITS.label} className={cn(FIELD, 'min-w-[10rem] flex-1')} />
          <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="Amount" aria-label="Amount" aria-invalid={invalid} className={cn(FIELD, 'w-28', invalid && 'border-red-400/50')} />
          <Dropdown<string> value={currency} aria-label="Currency" options={CURRENCIES.map((c) => ({ value: c, label: c }))} onChange={setCurrency} />
          <Dropdown<BudgetStatus> value={status} aria-label="Status" options={BUDGET_STATUSES.map((b) => ({ value: b, label: b[0].toUpperCase() + b.slice(1) }))} onChange={setStatus} />
          <button type="submit" disabled={!label.trim() || !parsed || invalid || busy} className={BTN}>Add</button>
        </form>
      )}
    </div>
  );
}
