'use client';

/**
 * The org's rights holders (LABEL-54): everyone who can be named on a credit or
 * a split line, with the data a label needs to pay and register them. What
 * each viewer is sent is the server's call (`partyView`): a roster artist gets
 * names only, an own-line member their own party, rights readers the legal
 * block (legal name, address, PRO, IPI), and only `rights.write` / `finance.read`
 * the payee block (tax id, payment instructions). This draws what arrived and
 * lets a writer edit it. Payment instructions are free text — the app stores
 * no bank number, and says so next to the field.
 *
 * A name that a circulated split sheet shows is locked (the server answers
 * 409 with the reason, shown under the form). The person a party names can
 * confirm their own details, correcting the legal fields first.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Plus, Search } from 'lucide-react';
import { Dropdown, type DropdownOption } from '@/components/ui/Dropdown';
import { confirmToast, toast } from '@/hooks/useToast';
import { cn } from '@/lib/utils';
import type { PartyView } from '@/lib/labelos/credits';
import {
  askToConfirm,
  confirmParty,
  createParty,
  loadParties,
  removeParty,
  updateParty,
  type PartiesPayload,
} from '@/lib/labelos/credits-client';
import { bodyFromForm, confirmationState, emptyForm, filterParties, formFromParty, partyFormError, type PartyForm } from '@/lib/labelos/parties-view';

const LABEL = 'text-[10px] font-mono uppercase tracking-[0.2em] text-white/40';
const NOTICE = 'rounded-xl border border-white/10 bg-[#0D0D0A] px-4 py-8 text-center text-[11px] text-white/60';
const BTN =
  'rounded-lg border border-white/10 bg-white/[0.06] px-3 py-1.5 text-[11px] text-white/80 transition-colors hover:border-white/20 hover:bg-white/[0.10] active:bg-white/[0.14] disabled:opacity-40';
const FIELD =
  'w-full rounded-lg border border-white/10 bg-[#090907] px-3 py-2 text-[11px] text-white placeholder:text-white/30 focus:border-white/30 focus:outline-none disabled:opacity-60';

const KINDS: DropdownOption<'person' | 'company'>[] = [
  { value: 'person', label: 'Person' },
  { value: 'company', label: 'Company' },
];
const AFFILIATIONS: DropdownOption<PartyForm['proAffiliation']>[] = [
  { value: 'unknown', label: 'Not known' },
  { value: 'affiliated', label: 'Affiliated' },
  { value: 'not_affiliated', label: 'Not affiliated' },
];

/** The fields a person may correct about themselves when they confirm (mirrors SELF_CORRECTABLE). */
const SELF_KEYS: (keyof PartyForm)[] = ['legalName', 'address', 'country', 'pro', 'proAffiliation', 'ipi', 'isni', 'publisherName', 'publisherIpi'];

export function PartiesView({ orgId }: { orgId: string }) {
  const [data, setData] = useState<PartiesPayload | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | 'new' | null>(null);

  const load = useCallback(async () => {
    const res = await loadParties(orgId);
    if (!res.ok) {
      setFailed(res.error);
      return;
    }
    setFailed(null);
    setData(res);
  }, [orgId]);
  useEffect(() => {
    let live = true;
    void loadParties(orgId).then((res) => {
      if (!live) return;
      if (!res.ok) setFailed(res.error);
      else setData(res);
    });
    return () => {
      live = false;
    };
  }, [orgId]);

  const shown = useMemo(() => (data ? filterParties(data.parties, query) : []), [data, query]);
  const current = selected && selected !== 'new' ? data?.parties.find((p) => p.id === selected) ?? null : null;

  if (failed) {
    return (
      <div className={NOTICE} data-testid="parties-failed">
        {failed}
        <button type="button" className={`${BTN} ml-3`} onClick={() => void load()}>Try again</button>
      </div>
    );
  }
  if (!data) return <p className="text-[11px] text-white/40" data-testid="parties-loading">Loading the parties…</p>;
  if (!data.schemaReady) return <p className={NOTICE} data-testid="parties-not-ready">Parties are not set up yet: the database migrations for credits are not all applied.</p>;

  const upsert = (party: PartyView) =>
    setData((d) => {
      if (!d) return d;
      const exists = d.parties.some((p) => p.id === party.id);
      const parties = exists ? d.parties.map((p) => (p.id === party.id ? party : p)) : [...d.parties, party].sort((a, b) => a.displayName.localeCompare(b.displayName));
      return { ...d, parties };
    });

  return (
    <div className="grid gap-6 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]" data-testid="parties">
      <section aria-label="Parties" className="min-w-0 space-y-3">
        <div className="flex items-center gap-2">
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">Search parties</span>
            <Search size={12} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/30" aria-hidden="true" />
            <input className={`${FIELD} pl-8`} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name, PRO or country" data-testid="parties-search" />
          </label>
          {data.canWrite && (
            <button type="button" className={cn(BTN, 'inline-flex items-center gap-1.5')} onClick={() => setSelected('new')} data-testid="party-new">
              <Plus size={11} aria-hidden="true" />Add party
            </button>
          )}
        </div>
        {shown.length === 0 ? (
          <p className={NOTICE} data-testid="parties-empty">{data.parties.length === 0 ? 'No rights holders to show yet.' : 'No party matches that search.'}</p>
        ) : (
          <ul className="space-y-1.5">
            {shown.map((p) => (
              <PartyRow key={p.id} party={p} active={p.id === selected} onOpen={() => setSelected(p.id)} />
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Party details" className="min-w-0">
        {selected === 'new' && data.canWrite ? (
          <PartyEditor
            key="new"
            orgId={orgId}
            data={data}
            party={null}
            onSaved={(p) => {
              upsert(p);
              setSelected(p.id);
            }}
            onClose={() => setSelected(null)}
          />
        ) : current ? (
          <PartyEditor
            key={current.id}
            orgId={orgId}
            data={data}
            party={current}
            onSaved={upsert}
            onDeleted={() => {
              setData((d) => (d ? { ...d, parties: d.parties.filter((p) => p.id !== current.id) } : d));
              setSelected(null);
            }}
            onClose={() => setSelected(null)}
          />
        ) : (
          <p className={NOTICE} data-testid="party-none">Pick a party to see its details.</p>
        )}
      </section>
    </div>
  );
}

function PartyRow({ party, active, onOpen }: { party: PartyView; active: boolean; onOpen: () => void }) {
  const state = confirmationState(party);
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        aria-current={active ? 'true' : undefined}
        data-testid="party-row"
        data-party={party.id}
        className={cn(
          'flex w-full items-center gap-3 rounded-xl border px-3.5 py-2.5 text-left transition-colors',
          active ? 'border-white/30 bg-white/[0.10]' : 'border-white/10 bg-[#0D0D0A] hover:border-white/20 hover:bg-white/[0.06]',
        )}
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] text-white/80">{party.displayName}</span>
          <span className="block truncate text-[11px] text-white/40">
            {party.kind === 'company' ? 'Company' : 'Person'}
            {party.legal?.legalName ? ` · ${party.legal.legalName}` : ''}
            {party.legal?.country ? ` · ${party.legal.country}` : ''}
          </span>
        </span>
        {party.mine && <span className={`${LABEL} text-white/60`}>You</span>}
        {state === 'confirmed' && (
          <span className="inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-[0.1em] text-[#6DC6A4]" data-testid="party-confirmed">
            <Check size={10} aria-hidden="true" />Confirmed
          </span>
        )}
        {state === 'unconfirmed' && <span className="text-[10px] font-mono uppercase tracking-[0.1em] text-[#c8a47a]" data-testid="party-unconfirmed">Not confirmed</span>}
      </button>
    </li>
  );
}

function Field({ label, value, onChange, disabled, hint, testid, placeholder, area }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  hint?: string;
  testid: string;
  placeholder?: string;
  area?: boolean;
}) {
  const id = `party-${testid}`;
  return (
    <div className="space-y-1">
      <label htmlFor={id} className={`${LABEL} block`}>{label}</label>
      {area ? (
        <textarea id={id} rows={2} className={FIELD} value={value} disabled={disabled} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} data-testid={testid} />
      ) : (
        <input id={id} className={FIELD} value={value} disabled={disabled} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} data-testid={testid} />
      )}
      {hint && <p className="text-[10px] text-white/40">{hint}</p>}
    </div>
  );
}

function PartyEditor({ orgId, data, party, onSaved, onDeleted, onClose }: {
  orgId: string;
  data: PartiesPayload;
  party: PartyView | null;
  onSaved: (p: PartyView) => void;
  onDeleted?: () => void;
  onClose: () => void;
}) {
  const original = useMemo(() => (party ? formFromParty(party) : null), [party]);
  const [form, setForm] = useState<PartyForm>(original ?? emptyForm());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isNew = party === null;
  const canEdit = data.canWrite;
  const selfConfirm = !!party?.mine && !!party.legal;
  const hasLegal = isNew || !!party?.legal;
  const showPayee = data.canSeePayee && (isNew || !!party?.payee);
  const set = <K extends keyof PartyForm>(key: K, value: PartyForm[K]) => setForm((f) => ({ ...f, [key]: value }));
  // A person confirming themselves edits the legal fields only; a writer edits everything; anyone else reads.
  const editable = (key: keyof PartyForm) => (canEdit ? true : selfConfirm ? SELF_KEYS.includes(key) : false);
  const members = data.members ?? [];
  const memberOptions: DropdownOption[] = [{ value: '', label: 'No account linked' }, ...members.map((m) => ({ value: m.userId, label: m.name }))];

  const finish = async (run: () => Promise<{ ok: true; party: PartyView } | { ok: false; error: string }>, done: string) => {
    setBusy(true);
    setError(null);
    const res = await run();
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onSaved(res.party);
    if (res.party && !isNew) setForm(formFromParty(res.party));
    toast.success(done);
  };

  const save = async () => {
    const problem = partyFormError(form);
    if (problem) {
      setError(problem);
      return;
    }
    const body = bodyFromForm(form, original);
    if (!isNew && Object.keys(body).length === 0) {
      setError('Nothing has changed.');
      return;
    }
    await finish(() => (isNew ? createParty(orgId, body) : updateParty(orgId, party.id, body)), isNew ? 'Party added' : 'Party saved');
  };

  const confirmMine = async () => {
    const corrections: Record<string, unknown> = {};
    const changed = bodyFromForm(form, original);
    for (const key of ['legal_name', 'address', 'country', 'pro', 'pro_affiliation', 'ipi', 'isni', 'publisher_name', 'publisher_ipi']) if (key in changed) corrections[key] = changed[key];
    const problem = partyFormError(form);
    if (problem) {
      setError(problem);
      return;
    }
    await finish(() => confirmParty(orgId, party!.id, corrections), 'Details confirmed');
  };

  const invite = async () => {
    setBusy(true);
    setError(null);
    const res = await askToConfirm(orgId, party!.id);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    toast.success('Asked to confirm');
  };

  const remove = async () => {
    const ok = await confirmToast('Delete this party?', party!.displayName, { confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    setBusy(true);
    const res = await removeParty(orgId, party!.id);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    toast.success('Party deleted');
    onDeleted?.();
  };

  const state = party ? confirmationState(party) : 'unknown';

  return (
    <div className="space-y-5 rounded-xl border border-white/10 bg-[#0D0D0A] p-4 sm:p-5" data-testid="party-editor">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-[16px] text-white/80">{isNew ? 'New party' : party.displayName}</h2>
          {!isNew && state === 'confirmed' && <p className="mt-0.5 text-[11px] text-[#6DC6A4]">Confirmed by the person on {party.legal?.confirmedAt?.slice(0, 10)}</p>}
          {!isNew && state === 'unconfirmed' && <p className="mt-0.5 text-[11px] text-[#c8a47a]">Not confirmed by the person yet</p>}
        </div>
        <button type="button" className={BTN} onClick={onClose} aria-label="Close the details">Close</button>
      </header>

      <fieldset className="space-y-3">
        <legend className={`${LABEL} mb-2`}>Name</legend>
        <Field label="Stage or display name" value={form.displayName} onChange={(v) => set('displayName', v)} disabled={!editable('displayName')} testid="display-name" hint="What a credit or split sheet shows." />
        {(isNew || canEdit) && (
          <div className="space-y-1">
            <span className={`${LABEL} block`}>Kind</span>
            <Dropdown value={form.kind} onChange={(v) => set('kind', v)} options={KINDS} aria-label="Kind" disabled={!editable('kind')} />
          </div>
        )}
        {canEdit && (
          <div className="space-y-1">
            <span className={`${LABEL} block`}>Linked account</span>
            <Dropdown value={form.userId} onChange={(v) => set('userId', v)} options={memberOptions} aria-label="Linked account" />
            <p className="text-[10px] text-white/40">The member who can see this party, confirm it and acknowledge their own split lines.</p>
          </div>
        )}
      </fieldset>

      {hasLegal && (
        <fieldset className="space-y-3">
          <legend className={`${LABEL} mb-2`}>Legal</legend>
          <Field label="Legal name" value={form.legalName} onChange={(v) => set('legalName', v)} disabled={!editable('legalName')} testid="legal-name" />
          {(isNew || canEdit) && <Field label="Email" value={form.email} onChange={(v) => set('email', v)} disabled={!editable('email')} testid="email" />}
          <Field label="Address" value={form.address} onChange={(v) => set('address', v)} disabled={!editable('address')} testid="address" area />
          <Field label="Country (two letters)" value={form.country} onChange={(v) => set('country', v)} disabled={!editable('country')} testid="country" placeholder="FR" />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="PRO" value={form.pro} onChange={(v) => set('pro', v)} disabled={!editable('pro')} testid="pro" placeholder="SACEM, ASCAP, BMI…" />
            <div className="space-y-1">
              <span className={`${LABEL} block`}>PRO membership</span>
              <Dropdown value={form.proAffiliation} onChange={(v) => set('proAffiliation', v)} options={AFFILIATIONS} aria-label="PRO membership" disabled={!editable('proAffiliation')} />
            </div>
            <Field label="IPI / CAE" value={form.ipi} onChange={(v) => set('ipi', v)} disabled={!editable('ipi')} testid="ipi" hint="9 to 11 digits." />
            <Field label="ISNI" value={form.isni} onChange={(v) => set('isni', v)} disabled={!editable('isni')} testid="isni" />
            <Field label="Publisher" value={form.publisherName} onChange={(v) => set('publisherName', v)} disabled={!editable('publisherName')} testid="publisher" />
            <Field label="Publisher IPI" value={form.publisherIpi} onChange={(v) => set('publisherIpi', v)} disabled={!editable('publisherIpi')} testid="publisher-ipi" />
          </div>
        </fieldset>
      )}

      {showPayee && (
        <fieldset className="space-y-3" data-testid="party-payee">
          <legend className={`${LABEL} mb-2`}>Payee</legend>
          <Field label="Tax id" value={form.taxId} onChange={(v) => set('taxId', v)} disabled={!editable('taxId')} testid="tax-id" />
          {data.canSeePayments && (
          <Field
            label="Payment instructions"
            value={form.paymentInstructions}
            onChange={(v) => set('paymentInstructions', v)}
            disabled={!editable('paymentInstructions')}
            testid="payment-instructions"
            area
            hint="Say how finance should pay, in words. Never type a bank account, IBAN or card number: this app does not store them."
          />
          )}
        </fieldset>
      )}

      {!isNew && !party.legal && !party.payee && <p className="text-[11px] text-white/40" data-testid="party-names-only">You can see this party’s name. Its details are held by the people who work on rights.</p>}

      {error && (
        <p role="alert" className="text-[11px] text-red-400" data-testid="party-error">{error}</p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {canEdit && (
          <button type="button" className={BTN} disabled={busy} onClick={() => void save()} data-testid="party-save">
            {isNew ? 'Add party' : 'Save changes'}
          </button>
        )}
        {selfConfirm && (
          <button type="button" className={BTN} disabled={busy} onClick={() => void confirmMine()} data-testid="party-confirm">
            {state === 'confirmed' ? 'Confirm again' : 'Confirm my details'}
          </button>
        )}
        {canEdit && !isNew && party.linkedUserId && state === 'unconfirmed' && (
          <button type="button" className={BTN} disabled={busy} onClick={() => void invite()} data-testid="party-invite">
            Ask to confirm
          </button>
        )}
        {canEdit && !isNew && (
          <button type="button" className={cn(BTN, 'ml-auto text-red-400')} disabled={busy} onClick={() => void remove()} data-testid="party-delete">
            Delete
          </button>
        )}
      </div>
    </div>
  );
}
