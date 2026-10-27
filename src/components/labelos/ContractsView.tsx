'use client';

/**
 * The org's contracts (LABEL-57): a list, a form that starts a draft from a
 * template, and the contract itself with its text filled in. What each viewer
 * is sent is the server's call (`mayReadContract`, `contractView`): contracts
 * staff get every contract in their scope and the internal note; a roster
 * artist or a named party gets their own, once sent. This draws what arrived.
 * Editing the wording clause by clause, the live preview and sending for
 * signature are LABEL-58; signing is LABEL-60.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { Dropdown, type DropdownOption } from '@/components/ui/Dropdown';
import { confirmToast, toast } from '@/hooks/useToast';
import { cn } from '@/lib/utils';
import type { ContractView } from '@/lib/labelos/contracts/context';
import { mergeField } from '@/lib/labelos/contracts/merge-fields';
import { platformTemplate } from '@/lib/labelos/contracts/templates';
import { CONTRACT_STATUS_LABELS, PARTY_ROLE_LABELS, TEMPLATE_TYPES, TEMPLATE_TYPE_LABELS, isEditable, type PartyRole, type TemplateTypeId } from '@/lib/labelos/contracts/types';
import { bodyFromContractForm, contractFormError, emptyContractForm, fieldHint, formFromContract, type ContractForm } from '@/lib/labelos/contracts-form';
import { createContract, loadContract, loadContracts, updateContract, voidContract, type ContractDetail, type ContractsPayload } from '@/lib/labelos/contracts-client';
import { fetchParties } from '@/lib/labelos/credits-client';
import { fetchOrgSearch } from '@/lib/labelos/org-search-client';

const LABEL = 'text-[10px] font-mono uppercase tracking-[0.2em] text-white/40';
const NOTICE = 'rounded-xl border border-white/10 bg-[#0D0D0A] px-4 py-8 text-center text-[11px] text-white/60';
const BTN =
  'rounded-lg border border-white/10 bg-white/[0.06] px-3 py-1.5 text-[11px] text-white/80 transition-colors hover:border-white/20 hover:bg-white/[0.10] active:bg-white/[0.14] disabled:opacity-40';
const FIELD =
  'w-full rounded-lg border border-white/10 bg-[#090907] px-3 py-2 text-[11px] text-white placeholder:text-white/30 focus:border-white/30 focus:outline-none disabled:opacity-60';

type Lookups = { parties: DropdownOption[]; artists: DropdownOption[]; releases: DropdownOption[] };
const NONE = '';

async function loadLookups(orgId: string): Promise<Lookups> {
  const [parties, contacts, releases] = await Promise.all([
    fetchParties(orgId),
    fetch(`/api/org/${orgId}/contacts?view=roster`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : { contacts: [] })).catch(() => ({ contacts: [] })),
    fetch(`/api/org/${orgId}/releases`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : { releases: [] })).catch(() => ({ releases: [] })),
  ]);
  return {
    parties: parties.ok ? parties.parties.map((p) => ({ value: p.id, label: p.displayName })) : [],
    artists: ((contacts.contacts ?? []) as { id: string; name: string }[]).map((c) => ({ value: c.id, label: c.name })),
    releases: ((releases.releases ?? []) as { id: string; title: string }[]).map((r) => ({ value: r.id, label: r.title })),
  };
}

function StatusBadge({ status }: { status: ContractView['status'] }) {
  return (
    <span className={cn('rounded-md border px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.15em]', status === 'signed' ? 'border-[#6DC6A4]/40 text-[#6DC6A4]' : status === 'void' ? 'border-white/10 text-white/30 line-through' : 'border-white/20 text-white/60')}>
      {CONTRACT_STATUS_LABELS[status]}
    </span>
  );
}

function SongPicker({ orgId, title, onPick }: { orgId: string; title: string | null; onPick: (id: string, title: string) => void }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<{ id: string; title: string }[]>([]);
  useEffect(() => {
    if (q.trim().length < 2) return;
    const ctl = new AbortController();
    const t = setTimeout(() => {
      fetchOrgSearch(orgId, q.trim(), ctl.signal)
        .then((r) => setHits(r.groups.filter((g) => g.group === 'songs').flatMap((g) => g.hits).map((h) => ({ id: h.id, title: h.title }))))
        .catch(() => undefined);
    }, 250);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [orgId, q]);
  return (
    <div className="space-y-1.5">
      <input className={FIELD} value={q} onChange={(e) => setQ(e.target.value)} placeholder={title ? `Song: ${title} — search to change` : 'Search for a song'} aria-label="Search for a song" data-testid="contract-song-search" />
      {q.trim().length >= 2 && hits.length > 0 && (
        <ul className="max-h-40 overflow-auto rounded-lg border border-white/10 bg-[#0D0D0A]">
          {hits.map((h) => (
            <li key={h.id}>
              <button type="button" className="w-full px-3 py-1.5 text-left text-[11px] text-white/80 hover:bg-white/[0.06]" onClick={() => { onPick(h.id, h.title); setQ(''); setHits([]); }}>
                {h.title}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FormFields({ orgId, type, form, setForm, lookups, songTitle, setSongTitle }: {
  orgId: string; type: TemplateTypeId; form: ContractForm; setForm: (f: ContractForm) => void; lookups: Lookups; songTitle: string | null; setSongTitle: (t: string | null) => void;
}) {
  const def = platformTemplate(type);
  const set = (patch: Partial<ContractForm>) => setForm({ ...form, ...patch });
  const setParty = (role: PartyRole, index: number, id: string) => {
    const list = [...(form.parties[role] ?? [])];
    list[index] = id;
    set({ parties: { ...form.parties, [role]: list.filter(Boolean) } });
  };
  return (
    <div className="space-y-4">
      <label className="block space-y-1.5">
        <span className={LABEL}>Title</span>
        <input className={FIELD} value={form.title} onChange={(e) => set({ title: e.target.value })} data-testid="contract-title" />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <span className={LABEL}>Artist</span>
          <Dropdown className="w-full" value={form.artistId} onChange={(v) => set({ artistId: v })} options={[{ value: NONE, label: 'No artist' }, ...lookups.artists]} aria-label="Artist" />
        </div>
        <div className="space-y-1.5">
          <span className={LABEL}>Release</span>
          <Dropdown className="w-full" value={form.releaseId} onChange={(v) => set({ releaseId: v })} options={[{ value: NONE, label: 'No release' }, ...lookups.releases]} aria-label="Release" />
        </div>
      </div>
      <div className="space-y-1.5">
        <span className={LABEL}>Song</span>
        <SongPicker orgId={orgId} title={songTitle} onPick={(id, t) => { set({ trackId: id }); setSongTitle(t); }} />
        {form.trackId && (
          <button type="button" className="text-[10px] text-white/50 underline" onClick={() => { set({ trackId: '' }); setSongTitle(null); }}>Remove the song</button>
        )}
      </div>
      <fieldset className="space-y-3">
        <legend className={LABEL}>Parties</legend>
        {def.slots.map((slot) => {
          const ids = form.parties[slot.role] ?? [];
          const rows = slot.many ? [...ids, ''] : [ids[0] ?? ''];
          return (
            <div key={slot.role} className="space-y-1.5" data-testid={`contract-slot-${slot.role}`}>
              <span className="text-[11px] text-white/60">{slot.label}{slot.required ? '' : ' (optional)'}</span>
              {rows.map((id, i) => (
                <Dropdown key={`${slot.role}-${i}`} value={id} onChange={(v) => setParty(slot.role, i, v)} options={[{ value: NONE, label: 'Not chosen yet' }, ...lookups.parties]} aria-label={`Party: ${slot.label}${slot.many ? ` ${i + 1}` : ''}`} />
              ))}
            </div>
          );
        })}
        {lookups.parties.length === 0 && <p className="text-[10px] text-white/40">No parties yet. <Link className="underline" href="./parties">Add them on the Parties page</Link>.</p>}
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="space-y-1.5">
          <span className={LABEL}>Starts</span>
          <input className={FIELD} value={form.effectiveDate} onChange={(e) => set({ effectiveDate: e.target.value })} placeholder="2027-03-01" data-testid="contract-start" />
        </label>
        <label className="space-y-1.5">
          <span className={LABEL}>Term (months)</span>
          <input className={FIELD} value={form.termMonths} onChange={(e) => set({ termMonths: e.target.value })} inputMode="numeric" data-testid="contract-term" />
        </label>
        <label className="space-y-1.5">
          <span className={LABEL}>Territory</span>
          <input className={FIELD} value={form.territories} onChange={(e) => set({ territories: e.target.value })} placeholder="WW or GB, FR" data-testid="contract-territory" />
        </label>
      </div>
      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className={`${LABEL} mb-2`}>Terms</legend>
        {def.suggestedFields.map((key) => {
          const field = mergeField(key);
          if (!field) return null;
          return (
            <label key={key} className="space-y-1.5">
              <span className="text-[11px] text-white/60">{field.label}</span>
              <input className={FIELD} value={form.fields[key] ?? ''} onChange={(e) => set({ fields: { ...form.fields, [key]: e.target.value } })} data-testid={`contract-field-${key}`} aria-describedby={fieldHint(key) ? `hint-${key}` : undefined} />
              {fieldHint(key) && <span id={`hint-${key}`} className="block text-[10px] text-white/40">{fieldHint(key)}</span>}
            </label>
          );
        })}
      </fieldset>
      <label className="block space-y-1.5">
        <span className={LABEL}>Internal note (never shown to the artist)</span>
        <textarea className={`${FIELD} min-h-[64px]`} value={form.note} onChange={(e) => set({ note: e.target.value })} data-testid="contract-note" />
      </label>
    </div>
  );
}

export function ContractsView({ orgId }: { orgId: string }) {
  const [data, setData] = useState<ContractsPayload | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [lookups, setLookups] = useState<Lookups>({ parties: [], artists: [], releases: [] });
  const [selected, setSelected] = useState<string | 'new' | null>(null);
  const [detail, setDetail] = useState<ContractDetail | null>(null);
  const [editing, setEditing] = useState(false);
  const [type, setType] = useState<TemplateTypeId>('recording');
  const [form, setForm] = useState<ContractForm>(emptyContractForm);
  const [songTitle, setSongTitle] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    const res = await loadContracts(orgId);
    if (!res.ok) setFailed(res.error);
    else {
      setFailed(null);
      setData(res);
    }
  }, [orgId]);

  useEffect(() => {
    let live = true;
    void loadContracts(orgId).then((res) => {
      if (!live) return;
      if (!res.ok) setFailed(res.error);
      else setData(res);
    });
    return () => {
      live = false;
    };
  }, [orgId]);

  useEffect(() => {
    if (!data?.canWrite) return;
    let live = true;
    void loadLookups(orgId).then((l) => live && setLookups(l));
    return () => {
      live = false;
    };
  }, [orgId, data?.canWrite]);

  useEffect(() => {
    if (!selected || selected === 'new') return;
    let live = true;
    void loadContract(orgId, selected).then((res) => {
      if (!live) return;
      if (res.ok) setDetail(res);
      else {
        setDetail(null);
        setError(res.error);
      }
    });
    return () => {
      live = false;
    };
  }, [orgId, selected]);

  const typeOptions = useMemo(() => TEMPLATE_TYPES.map((t) => ({ value: t.id, label: t.label })), []);

  if (failed) {
    return (
      <div className={NOTICE} data-testid="contracts-failed">
        {failed}
        <button type="button" className={`${BTN} ml-3`} onClick={() => void reload()}>Try again</button>
      </div>
    );
  }
  if (!data) return <p className="text-[11px] text-white/40" data-testid="contracts-loading">Loading the contracts…</p>;
  if (!data.schemaReady) return <p className={NOTICE} data-testid="contracts-not-ready">Contracts are not set up yet: the database migration for them (176) is not applied.</p>;

  const open = (id: string | 'new' | null) => {
    setSelected(id);
    setDetail(null);
    setEditing(false);
    setError(null);
    if (id === 'new') {
      setForm(emptyContractForm());
      setSongTitle(null);
    }
  };

  const slots = platformTemplate(type).slots;

  const submitNew = async () => {
    const problem = contractFormError(form, slots);
    if (problem) return setError(problem);
    setBusy(true);
    const res = await createContract(orgId, { type, ...bodyFromContractForm(form) });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    toast.success('Draft started');
    await reload();
    open(res.id);
  };

  const submitEdit = async () => {
    if (!detail) return;
    const problem = contractFormError(form, platformTemplate(detail.contract.type).slots);
    if (problem) return setError(problem);
    setBusy(true);
    const res = await updateContract(orgId, detail.contract.id, bodyFromContractForm(form));
    setBusy(false);
    if (!res.ok) return setError(res.error);
    toast.success('Saved');
    setError(null);
    setEditing(false);
    await reload();
    const fresh = await loadContract(orgId, detail.contract.id);
    if (fresh.ok) setDetail(fresh);
  };

  const doVoid = async () => {
    if (!detail) return;
    const ok = await confirmToast('Void this contract?', detail.contract.title, { confirmLabel: 'Void', danger: true });
    if (!ok) return;
    const res = await voidContract(orgId, detail.contract.id);
    if (!res.ok) return toast.error(res.error);
    toast.success('Contract voided');
    await reload();
    const fresh = await loadContract(orgId, detail.contract.id);
    if (fresh.ok) setDetail(fresh);
  };

  const contract = detail?.contract ?? null;

  return (
    <div className="grid gap-6 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]" data-testid="contracts">
      <section aria-label="Contracts" className="min-w-0 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <p className={LABEL}>{data.contracts.length} contract{data.contracts.length === 1 ? '' : 's'}</p>
          <div className="flex items-center gap-2">
            {data.canWrite && (
              <Link className={BTN} href="./contracts/templates" data-testid="contract-templates-link">Templates</Link>
            )}
            {data.canWrite && (
              <button type="button" className={cn(BTN, 'inline-flex items-center gap-1.5')} onClick={() => open('new')} data-testid="contract-new">
                <Plus size={11} aria-hidden="true" />New contract
              </button>
            )}
          </div>
        </div>
        {data.contracts.length === 0 ? (
          <p className={NOTICE} data-testid="contracts-empty">{data.canWrite ? 'No contracts yet. Start one from a template.' : 'No contracts to show.'}</p>
        ) : (
          <ul className="space-y-2">
            {data.contracts.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => open(c.id)}
                  aria-current={selected === c.id}
                  data-testid={`contract-row-${c.id}`}
                  className={cn('w-full rounded-xl border bg-[#0D0D0A] px-4 py-3 text-left transition-colors hover:border-white/20', selected === c.id ? 'border-white/30' : 'border-white/10')}
                >
                  <span className="flex items-start justify-between gap-3">
                    <span className="min-w-0 truncate text-[11px] text-white/80">{c.title}</span>
                    <StatusBadge status={c.status} />
                  </span>
                  <span className="mt-1 block text-[10px] text-white/40">{TEMPLATE_TYPE_LABELS[c.type]}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Contract" className="min-w-0 rounded-xl border border-white/10 bg-[#0D0D0A] p-4 sm:p-5">
        {selected === 'new' && (
          <div className="space-y-4" data-testid="contract-new-form">
            <h2 className="font-heading text-[20px] text-white">New contract</h2>
            <div className="space-y-1.5">
              <span className={LABEL}>Type</span>
              <Dropdown className="w-full" value={type} onChange={(v) => { setType(v as TemplateTypeId); setForm((f) => ({ ...f, parties: {}, fields: {} })); }} options={typeOptions} aria-label="Contract type" />
              <p className="text-[10px] text-white/40">{platformTemplate(type).summary}</p>
            </div>
            <FormFields orgId={orgId} type={type} form={form} setForm={setForm} lookups={lookups} songTitle={songTitle} setSongTitle={setSongTitle} />
            {error && <p role="alert" className="text-[11px] text-[#ff8b73]" data-testid="contract-error">{error}</p>}
            <div className="flex gap-2">
              <button type="button" className={BTN} disabled={busy} onClick={() => void submitNew()} data-testid="contract-create">{busy ? 'Starting…' : 'Start draft'}</button>
              <button type="button" className={BTN} onClick={() => open(null)}>Cancel</button>
            </div>
          </div>
        )}

        {selected === null && <p className="py-10 text-center text-[11px] text-white/40">Pick a contract to read it.</p>}

        {selected && selected !== 'new' && !contract && !error && <p className="text-[11px] text-white/40">Loading…</p>}
        {selected && selected !== 'new' && !contract && error && <p className="text-[11px] text-[#ff8b73]">{error}</p>}

        {contract && detail && !editing && (
          <article className="space-y-5" data-testid="contract-detail">
            <header className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-heading text-[20px] leading-tight text-white" data-testid="contract-detail-title">{contract.title}</h2>
                <StatusBadge status={contract.status} />
              </div>
              <p className="text-[10px] text-white/40">
                {TEMPLATE_TYPE_LABELS[contract.type]} · wording v{contract.template_version}
                {contract.effective_date ? ` · from ${contract.effective_date}` : ''}
              </p>
              {contract.parties.length > 0 && (
                <ul className="flex flex-wrap gap-2 text-[11px] text-white/70">
                  {contract.parties.map((p) => (
                    <li key={`${p.role}-${p.party_id}`} className="rounded-md border border-white/10 px-2 py-0.5">{PARTY_ROLE_LABELS[p.role]}: {p.name}</li>
                  ))}
                </ul>
              )}
              {contract.internal_note && <p className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-[11px] text-white/70" data-testid="contract-internal-note">Internal: {contract.internal_note}</p>}
            </header>
            {detail.document.missing.length > 0 && contract.status === 'draft' && (
              <p className="text-[11px] text-white/60" data-testid="contract-missing">Still to fill in: {detail.document.missing.length} value{detail.document.missing.length === 1 ? '' : 's'}.</p>
            )}
            <div className="space-y-4" data-testid="contract-document">
              {detail.document.clauses.map((c) => (
                <section key={c.id} className="space-y-1">
                  <h3 className="text-[11px] font-semibold text-white/80">{c.heading}</h3>
                  <p className="whitespace-pre-wrap text-[11px] leading-relaxed text-white/70">{c.body}</p>
                </section>
              ))}
            </div>
            {(detail.canWrite || data.canWrite) && contract.status !== 'void' && (
              <div className="flex flex-wrap gap-2 border-t border-white/10 pt-4">
                {detail.canWrite && isEditable(contract.status) && (
                  <button type="button" className={BTN} onClick={() => { setForm(formFromContract(contract)); setSongTitle(null); setEditing(true); setError(null); }} data-testid="contract-edit">Edit details</button>
                )}
                {data.canWrite && <button type="button" className={BTN} onClick={() => void doVoid()} data-testid="contract-void">Void</button>}
              </div>
            )}
          </article>
        )}

        {contract && detail && editing && (
          <div className="space-y-4" data-testid="contract-edit-form">
            <h2 className="font-heading text-[20px] text-white">Edit details</h2>
            <FormFields orgId={orgId} type={contract.type} form={form} setForm={setForm} lookups={lookups} songTitle={songTitle ?? (contract.track_id ? 'chosen' : null)} setSongTitle={setSongTitle} />
            {error && <p role="alert" className="text-[11px] text-[#ff8b73]" data-testid="contract-error">{error}</p>}
            <div className="flex gap-2">
              <button type="button" className={BTN} disabled={busy} onClick={() => void submitEdit()} data-testid="contract-save">{busy ? 'Saving…' : 'Save'}</button>
              <button type="button" className={BTN} onClick={() => { setEditing(false); setError(null); }}>Cancel</button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
