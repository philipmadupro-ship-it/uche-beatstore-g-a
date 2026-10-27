'use client';

/**
 * The contract template editor (LABEL-57). Every contract type has a platform
 * starting template (placeholder wording, marked "Not legal advice — have
 * counsel review") in code. Saving here writes the organization's OWN next
 * version of that type; a contract keeps the wording it was made from, so an
 * edit changes only contracts started afterwards. Writers hold
 * `contracts.write`; the server decides, the screen just hides the buttons.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { Dropdown } from '@/components/ui/Dropdown';
import { toast } from '@/hooks/useToast';
import { cn } from '@/lib/utils';
import { MERGE_FIELDS } from '@/lib/labelos/contracts/merge-fields';
import { renderSample } from '@/lib/labelos/contracts/render';
import { sameClauses } from '@/lib/labelos/contracts/template-edit';
import type { TemplateClause } from '@/lib/labelos/contracts/templates';
import { TEMPLATE_TYPES, type TemplateTypeId } from '@/lib/labelos/contracts/types';
import { loadTemplates, saveTemplate, type TemplatesPayload } from '@/lib/labelos/contracts-client';

const LABEL = 'text-[10px] font-mono uppercase tracking-[0.2em] text-white/40';
const NOTICE = 'rounded-xl border border-white/10 bg-[#0D0D0A] px-4 py-8 text-center text-[11px] text-white/60';
const BTN =
  'rounded-lg border border-white/10 bg-white/[0.06] px-3 py-1.5 text-[11px] text-white/80 transition-colors hover:border-white/20 hover:bg-white/[0.10] active:bg-white/[0.14] disabled:opacity-40';
const FIELD =
  'w-full rounded-lg border border-white/10 bg-[#090907] px-3 py-2 text-[11px] text-white placeholder:text-white/30 focus:border-white/30 focus:outline-none disabled:opacity-60';

type Draft = { name: string; clauses: TemplateClause[] };

export function ContractTemplatesView({ orgId }: { orgId: string }) {
  const [data, setData] = useState<TemplatesPayload | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [type, setType] = useState<TemplateTypeId>('recording');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [preview, setPreview] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const focused = useRef<number>(0);

  const effective = useCallback(
    (t: TemplateTypeId, d: TemplatesPayload): Draft => {
      const own = d.org.filter((o) => o.type === t).sort((a, b) => b.version - a.version)[0];
      const platform = d.platform.find((p) => p.type === t)!;
      return own ? { name: own.name, clauses: own.clauses } : { name: platform.name, clauses: platform.clauses };
    },
    [],
  );

  useEffect(() => {
    let live = true;
    void loadTemplates(orgId).then((res) => {
      if (!live) return;
      if (!res.ok) setFailed(res.error);
      else {
        setData(res);
        setDraft(effective('recording', res));
      }
    });
    return () => {
      live = false;
    };
  }, [orgId, effective]);

  const pick = (t: TemplateTypeId) => {
    if (!data) return;
    setType(t);
    setDraft(effective(t, data));
    setError(null);
    setPreview(false);
  };

  const platform = data?.platform.find((p) => p.type === type) ?? null;
  const versions = useMemo(() => (data ? data.org.filter((o) => o.type === type).sort((a, b) => b.version - a.version) : []), [data, type]);
  const current = data && draft ? effective(type, data) : null;
  const dirty = !!(draft && current && (draft.name !== current.name || !sameClauses(draft.clauses, current.clauses)));

  if (failed) return <div className={NOTICE} data-testid="templates-failed">{failed}</div>;
  if (!data || !draft || !platform) return <p className="text-[11px] text-white/40" data-testid="templates-loading">Loading the templates…</p>;
  if (!data.schemaReady) {
    return <p className={NOTICE} data-testid="templates-not-ready">Contract templates are not set up yet: the database migration for them (176) is not applied.</p>;
  }

  const setClause = (i: number, patch: Partial<TemplateClause>) => setDraft({ ...draft, clauses: draft.clauses.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  const move = (i: number, by: number) => {
    const next = [...draft.clauses];
    const j = i + by;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    setDraft({ ...draft, clauses: next });
  };
  const insertField = (key: string) => {
    const i = Math.min(focused.current, draft.clauses.length - 1);
    setClause(i, { body: `${draft.clauses[i].body}${draft.clauses[i].body && !/\s$/.test(draft.clauses[i].body) ? ' ' : ''}{{${key}}}` });
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    const res = await saveTemplate(orgId, type, { name: draft.name, clauses: draft.clauses.map((c) => ({ id: c.id, heading: c.heading, body: c.body })) });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    if (res.unchanged) return toast.success('Nothing changed');
    toast.success(`Saved as version ${res.template?.version ?? ''}`);
    const fresh = await loadTemplates(orgId);
    if (fresh.ok) {
      setData(fresh);
      setDraft(effective(type, fresh));
    }
  };

  const sample = renderSample({ slots: platform.slots, clauses: draft.clauses });

  return (
    <div className="grid gap-6 md:grid-cols-[minmax(0,4fr)_minmax(0,8fr)]" data-testid="templates">
      <section aria-label="Contract types" className="min-w-0">
        <ul className="space-y-1.5">
          {TEMPLATE_TYPES.map((t) => {
            const own = data.org.filter((o) => o.type === t.id).length;
            return (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => pick(t.id)}
                  aria-current={type === t.id}
                  data-testid={`template-type-${t.id}`}
                  className={cn('flex w-full items-center justify-between gap-3 rounded-lg border bg-[#0D0D0A] px-3 py-2 text-left text-[11px] transition-colors hover:border-white/20', type === t.id ? 'border-white/30 text-white' : 'border-white/10 text-white/70')}
                >
                  <span className="truncate">{t.label}</span>
                  <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.15em] text-white/40">{own ? `Yours v${own}` : 'Platform'}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-label="Template" className="min-w-0 space-y-4 rounded-xl border border-white/10 bg-[#0D0D0A] p-4 sm:p-5">
        <header className="space-y-1">
          <p className="text-[11px] text-white/60">{platform.summary}</p>
          <p className="text-[10px] text-white/40" data-testid="template-source">
            {versions[0] ? `Your version ${versions[0].version}, from ${versions[0].based_on ?? 'scratch'}.` : `The platform starting template (version ${platform.version}). Saving makes it yours.`}
          </p>
          <p className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-[11px] text-white/70">Placeholder wording — not legal advice. Have counsel review it before anyone signs.</p>
        </header>

        <div className="flex flex-wrap gap-2">
          <button type="button" className={BTN} onClick={() => setPreview((p) => !p)} data-testid="template-preview-toggle">{preview ? 'Back to editing' : 'Preview with sample data'}</button>
          {data.canWrite && versions[0] && (
            <button type="button" className={BTN} onClick={() => { setDraft({ name: platform.name, clauses: platform.clauses }); setPreview(false); }} data-testid="template-use-platform">Start again from the platform wording</button>
          )}
        </div>

        {preview ? (
          <div className="space-y-4" data-testid="template-sample">
            {sample.clauses.map((c) => (
              <section key={c.id} className="space-y-1">
                <h3 className="text-[12px] font-semibold text-white/80">{c.heading}</h3>
                <p className="whitespace-pre-wrap text-[11px] leading-relaxed text-white/70">{c.body}</p>
              </section>
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            <label className="block space-y-1.5">
              <span className={LABEL}>Template name</span>
              <input className={FIELD} value={draft.name} disabled={!data.canWrite} onChange={(e) => setDraft({ ...draft, name: e.target.value })} data-testid="template-name" />
            </label>
            {data.canWrite && (
              <div className="space-y-1.5">
                <span className={LABEL}>Insert a merge field into the clause you are editing</span>
                <Dropdown value="" onChange={(v) => v && insertField(v)} options={[...MERGE_FIELDS.map((f) => ({ value: f.key, label: f.label })), { value: 'contract.term', label: 'Contract term' }, { value: 'contract.territory', label: 'Territory' }, { value: 'contract.effective_date', label: 'Start date' }, { value: 'artist.name', label: 'Artist name' }, { value: 'song.title', label: 'Song title' }, { value: 'release.title', label: 'Release title' }, ...platform.slots.map((s) => ({ value: `party.${s.role}`, label: `Party: ${s.label}` }))]} placeholder="Choose a field" aria-label="Insert a merge field" />
              </div>
            )}
            <ol className="space-y-4">
              {draft.clauses.map((c, i) => (
                <li key={c.id} className="space-y-1.5 rounded-lg border border-white/10 p-3" data-testid={`template-clause-${i}`}>
                  <div className="flex items-center gap-2">
                    <input className={FIELD} value={c.heading} disabled={!data.canWrite} onChange={(e) => setClause(i, { heading: e.target.value })} aria-label={`Clause ${i + 1} heading`} onFocus={() => (focused.current = i)} />
                    {data.canWrite && (
                      <div className="flex shrink-0 gap-1">
                        <button type="button" className={BTN} onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move clause ${i + 1} up`}><ArrowUp size={11} aria-hidden="true" /></button>
                        <button type="button" className={BTN} onClick={() => move(i, 1)} disabled={i === draft.clauses.length - 1} aria-label={`Move clause ${i + 1} down`}><ArrowDown size={11} aria-hidden="true" /></button>
                        <button type="button" className={BTN} onClick={() => setDraft({ ...draft, clauses: draft.clauses.filter((_, j) => j !== i) })} disabled={draft.clauses.length === 1} aria-label={`Remove clause ${i + 1}`}><Trash2 size={11} aria-hidden="true" /></button>
                      </div>
                    )}
                  </div>
                  <textarea className={`${FIELD} min-h-[96px] leading-relaxed`} value={c.body} disabled={!data.canWrite} onChange={(e) => setClause(i, { body: e.target.value })} aria-label={`Clause ${i + 1} text`} onFocus={() => (focused.current = i)} data-testid={`template-body-${i}`} />
                </li>
              ))}
            </ol>
            {data.canWrite && (
              <button type="button" className={cn(BTN, 'inline-flex items-center gap-1.5')} onClick={() => setDraft({ ...draft, clauses: [...draft.clauses, { id: `clause-${draft.clauses.length + 1}`, heading: 'New clause', body: '' }] })} data-testid="template-add-clause">
                <Plus size={11} aria-hidden="true" />Add a clause
              </button>
            )}
          </div>
        )}

        {error && <p role="alert" className="text-[11px] text-[#ff8b73]" data-testid="template-error">{error}</p>}
        {data.canWrite && !preview && (
          <div className="flex items-center gap-3 border-t border-white/10 pt-4">
            <button type="button" className={BTN} disabled={busy || !dirty} onClick={() => void save()} data-testid="template-save">{busy ? 'Saving…' : 'Save as a new version'}</button>
            {!dirty && <span className="text-[10px] text-white/40">No changes yet.</span>}
          </div>
        )}

        {versions.length > 0 && (
          <div className="space-y-1.5 border-t border-white/10 pt-4" data-testid="template-versions">
            <p className={LABEL}>Your versions</p>
            <ul className="space-y-1">
              {versions.map((v) => (
                <li key={v.id} className="flex items-center justify-between gap-3 text-[11px] text-white/60">
                  <span>Version {v.version} · {new Date(v.created_at).toLocaleDateString('en-GB')}</span>
                  <button type="button" className="text-[10px] underline hover:text-white" onClick={() => { setDraft({ name: v.name, clauses: v.clauses }); setPreview(false); }}>Load into the editor</button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}
