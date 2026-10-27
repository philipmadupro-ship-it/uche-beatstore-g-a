'use client';

/**
 * One contract (LABEL-58): the field form beside a live preview, clause-level
 * editing of the wording, the per-version history, the PDF, and "Send for
 * signature". The server decides what the viewer is sent (staff get the
 * wording and history; an artist or named party gets the text once sent) and
 * what they may do; this draws it.
 *
 * The preview is the SERVER rendering the unsaved form (`…/preview`), so the
 * screen, the sent text and the PDF come from one renderer and the browser
 * never holds party identity rows. Below `md` the form and the preview are
 * two tabs of one column; from `md` they sit side by side.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowDown, ArrowUp, Download, Plus, Trash2 } from 'lucide-react';
import { confirmToast, toast } from '@/hooks/useToast';
import { cn } from '@/lib/utils';
import type { Rendered } from '@/lib/labelos/contracts/render';
import { fieldKeysOf } from '@/lib/labelos/contracts/render';
import { mergeField } from '@/lib/labelos/contracts/merge-fields';
import { CONTRACT_STATUS_LABELS, TEMPLATE_TYPE_LABELS, isEditable } from '@/lib/labelos/contracts/types';
import type { TemplateClause } from '@/lib/labelos/contracts/templates';
import type { HistoryEntry } from '@/lib/labelos/contracts/history';
import { bodyFromContractForm, contractFormError, emptyContractForm, formFromContract, type ContractForm } from '@/lib/labelos/contracts-form';
import {
  contractPdfUrl, fileContractCopy, loadContract, loadSuggestions, previewContract, sendContract, storedCopyUrl, updateContract,
  type ContractDetail, type ClauseDraft, type Suggestions,
} from '@/lib/labelos/contracts-client';
import { BTN, FIELD, FormFields, LABEL, NOTICE, StatusBadge, loadLookups, type Lookups } from './ContractsView';

/** "contract.effective_date" → "Effective date"; typed fields keep their own label. */
const missingLabel = (key: string): string => {
  const own = mergeField(key)?.label;
  if (own) return own;
  const words = key.replace(/^(contract|party)\./, '').replace(/[._]/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
};

const MARK_LABEL = { edited: 'Edited from the template', added: 'Added to this contract' } as const;

/** A merge value still empty is shown in brackets by the renderer; give it a colour so a reader sees what is left. */
function Filled({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\[[^\]\n]+\])/g).map((part, i) =>
        /^\[[^\]\n]+\]$/.test(part) ? <span key={i} className="rounded bg-white/[0.08] px-0.5 text-[#c8a47a]" data-testid="contract-blank">{part}</span> : <span key={i}>{part}</span>,
      )}
    </>
  );
}

function Preview({ doc }: { doc: Rendered }) {
  return (
    <div className="space-y-4" data-testid="contract-preview">
      {doc.clauses.map((c, i) => (
        <section key={c.id} className="space-y-1">
          <h3 className="text-[11px] font-semibold text-white/80"><Filled text={`${i + 1}. ${c.heading}`} /></h3>
          <p className="whitespace-pre-wrap text-[11px] leading-relaxed text-white/70"><Filled text={c.body} /></p>
        </section>
      ))}
    </div>
  );
}

function historyLine(h: HistoryEntry): string {
  switch (h.kind) {
    case 'created': return 'Draft started';
    case 'sent': return 'Sent for signature';
    case 'voided': return 'Voided';
    case 'document': return 'PDF filed in the project';
    case 'edited': {
      const parts: string[] = [];
      if (h.clauses.length) parts.push(`wording: ${h.clauses.map((c) => c.heading ?? c.id).join(', ')}`);
      if (h.changed.length) parts.push(h.changed.map((k) => k.replace(/_/g, ' ')).join(', '));
      return parts.length ? `Edited ${parts.join(' · ')}` : 'Edited';
    }
  }
}

function History({ entries, actors }: { entries: HistoryEntry[]; actors: Record<string, string> }) {
  if (entries.length === 0) return <p className="text-[11px] text-white/40">No history yet.</p>;
  return (
    <ol className="space-y-2" data-testid="contract-history">
      {entries.map((h) => (
        <li key={h.id} className="rounded-lg border border-white/10 px-3 py-2 text-[11px] text-white/70" data-testid={`contract-history-${h.kind}`}>
          <span className="block text-white/80">{h.version ? <span className="mr-2 font-mono text-[10px] text-white/40">v{h.version}</span> : null}{historyLine(h)}</span>
          <span className="block text-[10px] text-white/40">{h.actorId ? (actors[h.actorId] ?? 'A member') : 'System'} · {new Date(h.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
        </li>
      ))}
    </ol>
  );
}

export function ContractEditor({ orgId, contractId }: { orgId: string; contractId: string }) {
  const [detail, setDetail] = useState<ContractDetail | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [form, setForm] = useState<ContractForm>(emptyContractForm);
  const [clauses, setClauses] = useState<ClauseDraft[]>([]);
  const [saved, setSaved] = useState('');
  const [lookups, setLookups] = useState<Lookups>({ parties: [], artists: [], releases: [] });
  const [suggestions, setSuggestions] = useState<Suggestions | null>(null);
  const [preview, setPreview] = useState<Rendered | null>(null);
  const [previewNote, setPreviewNote] = useState<string | null>(null);
  const [tab, setTab] = useState<'edit' | 'preview'>('edit');
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const [busy, setBusy] = useState<null | 'save' | 'send' | 'copy'>(null);
  const [songTitle, setSongTitle] = useState<string | null>(null);

  const adopt = useCallback((d: ContractDetail) => {
    setDetail(d);
    const f = formFromContract(d.contract);
    const c = (d.clauses ?? []).map((x) => ({ id: x.id, heading: x.heading, body: x.body }));
    setForm(f);
    setClauses(c);
    setSaved(JSON.stringify([bodyFromContractForm(f), c]));
    setPreview(d.document);
    setPreviewNote(null);
    setMissing([]);
  }, []);

  const reload = useCallback(async () => {
    const res = await loadContract(orgId, contractId);
    if (!res.ok) setFailed(res.status === 404 ? 'This contract does not exist, or it is not yours to read.' : res.error);
    else adopt(res);
  }, [orgId, contractId, adopt]);

  useEffect(() => {
    let live = true;
    void loadContract(orgId, contractId).then((res) => {
      if (!live) return;
      if (!res.ok) setFailed(res.status === 404 ? 'This contract does not exist, or it is not yours to read.' : res.error);
      else adopt(res);
    });
    return () => {
      live = false;
    };
  }, [orgId, contractId, adopt]);

  const contract = detail?.contract ?? null;
  const editable = !!detail?.canWrite && !!contract && isEditable(contract.status) && !!detail.clauses;

  useEffect(() => {
    if (!editable) return;
    let live = true;
    void loadLookups(orgId).then((l) => live && setLookups(l));
    void loadSuggestions(orgId, contractId).then((s) => live && s.ok && setSuggestions(s));
    return () => {
      live = false;
    };
  }, [orgId, contractId, editable]);

  const dirty = useMemo(() => !!detail && JSON.stringify([bodyFromContractForm(form), clauses]) !== saved, [detail, form, clauses, saved]);

  // The live preview: the server renders the unsaved form; a rejected form keeps the last good text and says why.
  const seq = useRef(0);
  useEffect(() => {
    if (!editable || !contract) return;
    const problem = contractFormError(form, []);
    if (problem && problem.startsWith('Give')) return;
    const n = ++seq.current;
    const t = setTimeout(() => {
      const body = bodyFromContractForm(form);
      delete body.internal_note;
      void previewContract(orgId, contractId, { ...body, clauses }).then((res) => {
        if (n !== seq.current) return;
        if (res.ok) {
          setPreview(res.document);
          setPreviewNote(null);
        } else setPreviewNote(res.error);
      });
    }, 400);
    return () => clearTimeout(t);
  }, [orgId, contractId, editable, contract, form, clauses]);

  if (failed) {
    return (
      <div className={NOTICE} data-testid="contract-editor-failed">
        {failed} <Link className="ml-2 underline" href="../contracts">Back to contracts</Link>
      </div>
    );
  }
  if (!detail || !contract) return <p className="text-[11px] text-white/40" data-testid="contract-editor-loading">Loading the contract…</p>;

  const marks = detail.clause_marks;
  const doc = preview ?? detail.document;
  const extraFields = fieldKeysOf(clauses as TemplateClause[]);
  const canManage = !!detail.can_manage;

  const setClause = (i: number, patch: Partial<ClauseDraft>) => setClauses((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const moveClause = (i: number, d: -1 | 1) =>
    setClauses((cs) => {
      const j = i + d;
      if (j < 0 || j >= cs.length) return cs;
      const next = [...cs];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  const save = async (): Promise<number | null> => {
    const problem = contractFormError(form, []);
    if (problem) {
      setError(problem);
      return null;
    }
    setBusy('save');
    const res = await updateContract(orgId, contractId, { ...bodyFromContractForm(form), clauses, base_version: contract.version });
    setBusy(null);
    if (!res.ok) {
      setError(res.error);
      return null;
    }
    setError(null);
    toast.success('Saved');
    await reload();
    return res.version ?? contract.version;
  };

  const send = async () => {
    // The version THIS editor shows: if a colleague saved another since, the server refuses (409) rather than freeze words nobody here read.
    let reviewed = contract.version;
    if (dirty) {
      const saved = await save();
      if (saved === null) return;
      reviewed = saved;
    }
    const ok = await confirmToast('Send for signature?', 'This is the last edit: the wording and the values are frozen once it is sent.', { confirmLabel: 'Send' });
    if (!ok) return;
    setBusy('send');
    const res = await sendContract(orgId, contractId, reviewed);
    setBusy(null);
    if (!res.ok) {
      setError(res.error);
      setMissing(res.missing ?? []);
      return;
    }
    setError(null);
    toast.success('Sent for signature');
    await reload();
  };

  const fileCopy = async () => {
    setBusy('copy');
    const res = await fileContractCopy(orgId, contractId);
    setBusy(null);
    if (!res.ok) return setError(res.error);
    toast.success(res.reused ? 'This version already has a PDF in the project' : 'PDF filed in the project');
    await reload();
  };

  const edit = (
    <div className="space-y-6" data-testid="contract-editor-form">
      {suggestions && (suggestions.fields.length > 0 || suggestions.artist_parties.length > 0) && (
        <section className="space-y-2 rounded-lg border border-white/10 p-3" data-testid="contract-suggestions">
          <p className={LABEL}>Suggestions</p>
          <ul className="flex flex-wrap gap-2">
            {suggestions.artist_parties.map((p) => (
              <li key={p.id}>
                <button type="button" className={BTN} onClick={() => setForm({ ...form, parties: { ...form.parties, artist: [p.id] } })} data-testid={`suggest-party-${p.id}`}>
                  Use {p.name} as the artist
                </button>
              </li>
            ))}
            {suggestions.fields.map((s) => (
              <li key={`${s.key}-${s.partyId}`}>
                <button type="button" className={BTN} onClick={() => setForm({ ...form, fields: { ...form.fields, [s.key]: s.value } })} data-testid={`suggest-${s.key}-${s.partyId}`} title={s.source}>
                  {mergeField(s.key)?.label ?? s.key}: {s.value} <span className="text-white/40">· {s.source}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <FormFields orgId={orgId} type={contract.type} form={form} setForm={setForm} lookups={lookups} songTitle={songTitle ?? (contract.track_id ? 'chosen' : null)} setSongTitle={setSongTitle} extraFields={extraFields} />

      <fieldset className="space-y-3" data-testid="contract-clauses">
        <legend className={LABEL}>Wording</legend>
        {clauses.map((c, i) => {
          const mark = c.id ? marks?.marks[c.id] : undefined;
          return (
            <div key={c.id ?? i} className="space-y-1.5 rounded-lg border border-white/10 p-3" data-testid={`clause-${c.id ?? i}`}>
              <div className="flex items-center gap-2">
                <input className={FIELD} value={c.heading} onChange={(e) => setClause(i, { heading: e.target.value })} aria-label={`Clause ${i + 1} heading`} data-testid={`clause-heading-${c.id ?? i}`} />
                <button type="button" className="rounded-lg p-1.5 text-white/50 hover:text-white disabled:opacity-30" disabled={i === 0} onClick={() => moveClause(i, -1)} aria-label={`Move clause ${i + 1} up`}><ArrowUp size={13} aria-hidden="true" /></button>
                <button type="button" className="rounded-lg p-1.5 text-white/50 hover:text-white disabled:opacity-30" disabled={i === clauses.length - 1} onClick={() => moveClause(i, 1)} aria-label={`Move clause ${i + 1} down`}><ArrowDown size={13} aria-hidden="true" /></button>
                <button type="button" className="rounded-lg p-1.5 text-white/50 hover:text-[#ff8b73] disabled:opacity-30" disabled={clauses.length <= 1} onClick={() => setClauses((cs) => cs.filter((_, j) => j !== i))} aria-label={`Remove clause ${i + 1}`}><Trash2 size={13} aria-hidden="true" /></button>
              </div>
              <textarea className={`${FIELD} min-h-[96px]`} value={c.body} onChange={(e) => setClause(i, { body: e.target.value })} aria-label={`Clause ${i + 1} text`} data-testid={`clause-body-${c.id ?? i}`} />
              {mark && mark !== 'same' && <p className="text-[10px] text-[#c8a47a]" data-testid={`clause-mark-${c.id}`}>{MARK_LABEL[mark]}</p>}
            </div>
          );
        })}
        <button type="button" className={cn(BTN, 'inline-flex items-center gap-1.5')} onClick={() => setClauses((cs) => [...cs, { heading: 'New clause', body: 'Text of the clause. Merge fields look like {{advance}}.' }])} data-testid="clause-add">
          <Plus size={11} aria-hidden="true" />Add a clause
        </button>
        {marks && marks.removed.length > 0 && (
          <p className="text-[10px] text-white/40" data-testid="clause-removed">Removed from the template wording: {marks.removed.map((c) => c.heading).join(', ')}.</p>
        )}
      </fieldset>
    </div>
  );

  const side = (
    <aside className="space-y-4" aria-label="Preview">
      {previewNote && <p className="text-[10px] text-[#c8a47a]" data-testid="preview-note">The preview is paused: {previewNote}</p>}
      {doc.missing.length > 0 && contract.status === 'draft' && <p className="text-[11px] text-white/60" data-testid="contract-missing">Still to fill in: {doc.missing.length} value{doc.missing.length === 1 ? '' : 's'}.</p>}
      <div className="rounded-xl border border-white/10 bg-[#0D0D0A] p-4 sm:p-5"><Preview doc={doc} /></div>
    </aside>
  );

  return (
    <div className="space-y-6" data-testid="contract-editor">
      <header className="space-y-2">
        <Link className="text-[10px] text-white/50 underline" href="../contracts">All contracts</Link>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-heading text-[28px] font-bold leading-[1.05] tracking-tight text-white md:text-[32px]" data-testid="contract-editor-title">{contract.title}</h1>
          <StatusBadge status={contract.status} />
        </div>
        <p className="text-[10px] text-white/40" data-testid="contract-editor-meta">
          {TEMPLATE_TYPE_LABELS[contract.type]} · version {contract.version} · {CONTRACT_STATUS_LABELS[contract.status]}
          {marks && marks.changed > 0 ? ` · ${marks.changed} clause${marks.changed === 1 ? '' : 's'} differ from the template` : ''}
        </p>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {editable && <button type="button" className={BTN} disabled={!dirty || busy !== null} onClick={() => void save()} data-testid="contract-editor-save">{busy === 'save' ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}</button>}
          {editable && <button type="button" className={BTN} disabled={busy !== null} onClick={() => void send()} data-testid="contract-send" title="The last edit: the contract is frozen once sent">{busy === 'send' ? 'Sending…' : 'Send for signature'}</button>}
          {detail.clauses && contract.status !== 'void' && (
            <a className={cn(BTN, 'inline-flex items-center gap-1.5')} href={contractPdfUrl(orgId, contractId)} data-testid="contract-pdf"><Download size={11} aria-hidden="true" />Download PDF</a>
          )}
          {detail.copy && <a className={BTN} href={storedCopyUrl(orgId, detail.copy)} data-testid="contract-copy-link">Open the filed copy</a>}
          {canManage && detail.can_store && !detail.copy && contract.status !== 'void' && (
            <button type="button" className={BTN} disabled={busy !== null || dirty} onClick={() => void fileCopy()} data-testid="contract-file-copy" title={dirty ? 'Save your changes first' : undefined}>{busy === 'copy' ? 'Filing…' : 'File a PDF copy in the project'}</button>
          )}
        </div>
        {detail.clauses && !detail.can_store && contract.status !== 'void' && (
          <p className="text-[10px] text-white/40" data-testid="contract-not-storable">This contract is not attached to a song or release in a project, so its PDF is made when you download it and is not filed.</p>
        )}
        {error && (
          <div role="alert" className="text-[11px] text-[#ff8b73]" data-testid="contract-editor-error">
            {error}
            {missing.length > 0 && <span className="block text-white/60">Empty: {missing.map(missingLabel).join(', ')}</span>}
          </div>
        )}
      </header>

      {editable ? (
        <>
          <div className="flex gap-2 md:hidden" role="tablist" aria-label="Edit or preview">
            {(['edit', 'preview'] as const).map((t) => (
              <button key={t} type="button" role="tab" aria-selected={tab === t} className={cn(BTN, tab === t && 'border-white/30 bg-white/[0.14]')} onClick={() => setTab(t)} data-testid={`contract-tab-${t}`}>{t === 'edit' ? 'Edit' : 'Preview'}</button>
            ))}
          </div>
          <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className={cn('min-w-0', tab === 'preview' && 'hidden md:block')}>{edit}</div>
            <div className={cn('min-w-0 md:sticky md:top-20 md:self-start', tab === 'edit' && 'hidden md:block')}>{side}</div>
          </div>
        </>
      ) : (
        <div className="max-w-3xl">{side}</div>
      )}

      {detail.history && (
        <section className="space-y-2" aria-label="History">
          <h2 className={LABEL}>History by version</h2>
          <History entries={detail.history} actors={detail.history_actors ?? {}} />
        </section>
      )}
    </div>
  );
}
