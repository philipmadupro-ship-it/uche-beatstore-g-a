'use client';

/**
 * The dialog that edits a filter definition (LABEL-37). It builds a draft of
 * the plain filter object and hands it to `parseDefinition` on Apply, so what
 * the server will accept is what the form can say: a reversed range or an
 * unknown value is an error shown here, not a silent fix. Clauses a viewer's
 * role cannot read (credits, splits, involvement; legal approvals) are not
 * offered at all — the route refuses a view that uses them, and a clause the
 * form hid cannot be left in a definition by accident (`stripUnusable`).
 *
 * Names in the pickers (artists, people) come from the caller, already limited
 * to what the viewer may see.
 */
import { useMemo, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Dropdown, type DropdownOption } from '@/components/ui/Dropdown';
import { cn } from '@/lib/utils';
import { CREDIT_ROLES } from '@/lib/labelos/credit-roles';
import { RECORDING_KINDS } from '@/lib/labelos/capabilities';
import { SONG_STAGES, SONG_STAGE_LABEL } from '@/lib/labelos/song-stage';
import { RELEASE_GATES } from '@/lib/labelos/release-readiness';
import { RELEASE_STATES, RELEASE_TYPES } from '@/lib/labelos/releases';
import {
  FEATURE_ROLES,
  GATE_STATUSES,
  LEGAL_APPROVALS,
  MISSING_FIELDS,
  PRODUCER_ROLES,
  SPLIT_STATES,
  parseDefinition,
  type CreditClause,
  type Definition,
  type GateClause,
} from '@/lib/labelos/filters';

export type Choice = { id: string; name: string };

const LABEL = 'text-[9px] font-mono uppercase tracking-[0.2em] text-white/40';
const INPUT = 'min-h-9 w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 text-[11px] text-white/80 placeholder:text-white/30 focus:border-white/30 focus:outline-none';

const KIND_LABEL: Record<string, string> = {
  beat_source: 'Beat', demo: 'Demo', rough: 'Rough', topline: 'Topline', loop: 'Loop', mix: 'Mix', master: 'Master',
  instrumental: 'Instrumental', acapella: 'Acapella', clean: 'Clean', reference: 'Reference',
};
const MISSING_LABEL: Record<string, string> = { artwork: 'Artwork', isrc: 'ISRC', credits: 'Credits', bpm: 'Tempo', key: 'Key' };
const GATE_LABEL: Record<string, string> = {
  tracklist: 'Tracklist', masters: 'Masters', credits_splits: 'Credits & splits', legal: 'Legal', artwork: 'Artwork', metadata: 'Metadata', marketing: 'Marketing',
};
const STATUS_LABEL: Record<string, string> = {
  not_started: 'Not started', blocked: 'Blocked', awaiting_approval: 'Awaiting approval', approved: 'Approved', satisfied: 'Satisfied', not_required: 'Not required', stale: 'Stale',
};
const LEGAL_LABEL: Record<string, string> = { none: 'Not asked', waiting: 'Waiting', approved: 'Approved', changes_requested: 'Changes requested' };

type Draft = Record<string, unknown>;

/** The role presets a credit clause offers on top of the single roles. */
const ROLE_PRESETS: DropdownOption<string>[] = [
  { value: '', label: 'Any role' },
  { value: 'preset:producers', label: 'Producer (any production role)' },
  { value: 'preset:feature', label: 'Featured artist' },
];
const ROLE_OPTIONS: DropdownOption<string>[] = [
  ...ROLE_PRESETS,
  ...CREDIT_ROLES.filter((r) => !r.legacy || r.key === 'producer' || r.key === 'feature').map((r) => ({ value: r.key, label: r.label })),
];
const rolesOf = (value: string): string[] | undefined =>
  value === '' ? undefined : value === 'preset:producers' ? [...PRODUCER_ROLES] : value === 'preset:feature' ? [...FEATURE_ROLES] : [value];
const valueOfRoles = (roles: string[] | undefined): string => {
  if (!roles?.length) return '';
  if (roles.length === PRODUCER_ROLES.length && PRODUCER_ROLES.every((r) => roles.includes(r))) return 'preset:producers';
  if (roles.length === 1 && roles[0] === 'feature') return 'preset:feature';
  return roles[0];
};

function Chips<T extends string>({ options, value, onChange, label }: { options: { value: T; label: string }[]; value: readonly T[]; onChange: (next: T[]) => void; label: string }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label={label}>
      {options.map((o) => {
        const on = value.includes(o.value);
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((v) => v !== o.value) : [...value, o.value])}
            className={cn(
              'rounded-full border px-2.5 py-1 text-[10px] transition-colors',
              on ? 'border-white/30 bg-white/[0.14] text-white' : 'border-white/10 bg-white/[0.04] text-white/60 hover:border-white/20 hover:text-white',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <p className={LABEL}>{title}</p>
      {children}
    </section>
  );
}

function DateRange({ from, to, onChange, label }: { from?: string; to?: string; onChange: (from: string | undefined, to: string | undefined) => void; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <input type="date" aria-label={`${label} from`} className={INPUT} value={from ?? ''} onChange={(e) => onChange(e.target.value || undefined, to)} />
      <span className="text-[10px] text-white/30">to</span>
      <input type="date" aria-label={`${label} to`} className={INPUT} value={to ?? ''} onChange={(e) => onChange(from, e.target.value || undefined)} />
    </div>
  );
}

export function FilterEditor({
  open,
  onClose,
  definition,
  onApply,
  artists,
  people,
  canRights,
  canApprovals,
}: {
  open: boolean;
  onClose: () => void;
  definition: Definition;
  onApply: (next: Definition) => void;
  artists: Choice[];
  /** Parties the viewer may filter on (empty without rights.read). */
  people: Choice[];
  canRights: boolean;
  canApprovals: boolean;
}) {
  // Every opening starts from the definition now applied (the parent remounts the editor per opening).
  const [draft, setDraft] = useState<Draft>(() => ({ ...(definition.filter as Draft) }));
  const [error, setError] = useState<string | null>(null);
  const subject = definition.subject;

  const set = (patch: Draft) =>
    setDraft((d) => {
      const next = { ...d, ...patch };
      for (const [k, v] of Object.entries(next)) if (v === undefined || v === '' || (Array.isArray(v) && v.length === 0)) delete next[k];
      return next;
    });
  const arr = <T,>(key: string): T[] => (draft[key] as T[] | undefined) ?? [];

  const artistOptions = useMemo(() => artists.map((a) => ({ value: a.id, label: a.name })), [artists]);
  const partyOptions: DropdownOption<string>[] = useMemo(() => [{ value: '', label: 'Anyone' }, ...people.map((p) => ({ value: p.id, label: p.name }))], [people]);

  const apply = () => {
    const filter = stripUnusable(draft, { canRights, canApprovals });
    const parsed = parseDefinition({ v: definition.v, subject, filter });
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    onApply(parsed.definition);
  };

  const credits = arr<CreditClause>('credits');
  const gates = arr<GateClause>('gates');

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={subject === 'songs' ? 'Filter songs' : 'Filter releases'}
      description="Everything here narrows the list. You only ever see what your role and artists allow."
      size="lg"
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <Button variant="ghost" size="sm" onClick={() => { setDraft({}); setError(null); }}>Clear all</Button>
          <div className="flex items-center gap-2">
            {error && <span role="alert" className="text-[10px] text-[var(--error-text)]">{error}</span>}
            <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
            <Button variant="primary" size="sm" onClick={apply}>Apply filters</Button>
          </div>
        </div>
      }
    >
      <div className="space-y-5" data-testid="filter-editor">
        <Block title="Title contains">
          <input className={INPUT} aria-label="Title contains" maxLength={80} value={(draft.text as string | undefined) ?? ''} onChange={(e) => set({ text: e.target.value || undefined })} />
        </Block>

        {subject === 'songs' ? (
          <>
            <Block title="Stage">
              <Chips label="Stage" options={SONG_STAGES.map((s) => ({ value: s, label: SONG_STAGE_LABEL[s] }))} value={arr<string>('stages')} onChange={(v) => set({ stages: v })} />
            </Block>
            {artistOptions.length > 0 && (
              <Block title="Artist">
                <Chips label="Artist" options={artistOptions} value={arr<string>('artistIds')} onChange={(v) => set({ artistIds: v })} />
              </Block>
            )}
            <Block title="Created">
              <DateRange label="Created" from={draft.createdFrom as string | undefined} to={draft.createdTo as string | undefined} onChange={(createdFrom, createdTo) => set({ createdFrom, createdTo })} />
            </Block>
            <Block title="Has a recording of kind">
              <div className="grid gap-2 sm:grid-cols-[minmax(0,12rem)_1fr]">
                <Dropdown
                  aria-label="Recording kind"
                  value={(draft.recording as { kind?: string } | undefined)?.kind ?? ''}
                  onChange={(kind) => set({ recording: kind ? { ...(draft.recording as object | undefined), kind } : undefined })}
                  options={[{ value: '', label: 'Any' }, ...RECORDING_KINDS.map((k) => ({ value: k as string, label: KIND_LABEL[k] ?? k }))]}
                />
                <DateRange
                  label="Recording made"
                  from={(draft.recording as { from?: string } | undefined)?.from}
                  to={(draft.recording as { to?: string } | undefined)?.to}
                  onChange={(from, to) => {
                    const rec = draft.recording as { kind?: string } | undefined;
                    if (rec?.kind) set({ recording: { kind: rec.kind, ...(from ? { from } : {}), ...(to ? { to } : {}) } });
                  }}
                />
              </div>
            </Block>
            <Block title="Missing">
              <Chips label="Missing" options={MISSING_FIELDS.filter((m) => m !== 'credits' || canRights).map((m) => ({ value: m, label: MISSING_LABEL[m] }))} value={arr<string>('missing')} onChange={(v) => set({ missing: v })} />
            </Block>
            <Block title="Release">
              <Dropdown
                aria-label="Released"
                value={draft.released === undefined ? '' : draft.released ? 'yes' : 'no'}
                onChange={(v) => set({ released: v === '' ? undefined : v === 'yes' })}
                options={[{ value: '', label: 'Released or not' }, { value: 'no', label: 'Unreleased' }, { value: 'yes', label: 'Released' }]}
              />
            </Block>
            <Block title="Tempo and key">
              <div className="grid grid-cols-3 gap-2">
                <input type="number" min={1} max={400} aria-label="Tempo from" placeholder="BPM from" className={INPUT} value={(draft.bpmMin as number | undefined) ?? ''} onChange={(e) => set({ bpmMin: e.target.value ? Number(e.target.value) : undefined })} />
                <input type="number" min={1} max={400} aria-label="Tempo to" placeholder="BPM to" className={INPUT} value={(draft.bpmMax as number | undefined) ?? ''} onChange={(e) => set({ bpmMax: e.target.value ? Number(e.target.value) : undefined })} />
                <input aria-label="Key" placeholder="Key, e.g. F minor" maxLength={40} className={INPUT} value={(draft.key as string | undefined) ?? ''} onChange={(e) => set({ key: e.target.value || undefined })} />
              </div>
            </Block>
            {canApprovals && (
              <Block title="Legal approval">
                <Dropdown
                  aria-label="Legal approval"
                  value={(draft.legalApproval as string | undefined) ?? ''}
                  onChange={(v) => set({ legalApproval: v || undefined })}
                  options={[{ value: '', label: 'Any' }, ...LEGAL_APPROVALS.map((a) => ({ value: a as string, label: LEGAL_LABEL[a] }))]}
                />
              </Block>
            )}
            {canRights && (
              <>
                <Block title="Splits">
                  <Dropdown
                    aria-label="Splits"
                    value={(draft.splits as string | undefined) ?? ''}
                    onChange={(v) => set({ splits: v || undefined })}
                    options={[{ value: '', label: 'Any' }, ...SPLIT_STATES.map((s) => ({ value: s as string, label: s === 'incomplete' ? 'Not complete' : 'Complete' }))]}
                  />
                </Block>
                <Block title="Credits">
                  <div className="space-y-2">
                    {credits.map((c, i) => (
                      <div key={i} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]" data-testid="credit-clause">
                        <Dropdown aria-label="Credited person" value={c.partyId ?? ''} options={partyOptions} onChange={(v) => set({ credits: credits.map((x, j) => (j === i ? { ...x, partyId: v || undefined } : x)) })} />
                        <Dropdown aria-label="Credited as" value={valueOfRoles(c.roles)} options={ROLE_OPTIONS} onChange={(v) => set({ credits: credits.map((x, j) => (j === i ? { ...x, roles: rolesOf(v) } : x)) })} />
                        <Button variant="ghost" size="sm" aria-label="Remove this credit filter" onClick={() => set({ credits: credits.filter((_, j) => j !== i) })}>Remove</Button>
                      </div>
                    ))}
                    {credits.length < 5 && (
                      <Button variant="secondary" size="sm" onClick={() => set({ credits: [...credits, {}] })}>Add a credit filter</Button>
                    )}
                  </div>
                </Block>
                <Block title="Involving">
                  <Dropdown aria-label="Involving" value={(draft.involves as string | undefined) ?? ''} options={partyOptions.map((o) => (o.value === '' ? { ...o, label: 'Nobody in particular' } : o))} onChange={(v) => set({ involves: v || undefined })} />
                  <p className="text-[10px] text-white/40">Credited, on a split, or the account that uploaded it, was given a task on it or is on its project.</p>
                </Block>
              </>
            )}
          </>
        ) : (
          <>
            <Block title="State">
              <Chips label="State" options={RELEASE_STATES.map((s) => ({ value: s, label: s[0].toUpperCase() + s.slice(1) }))} value={arr<string>('states')} onChange={(v) => set({ states: v })} />
            </Block>
            <Block title="Type">
              <Chips label="Type" options={RELEASE_TYPES.map((t) => ({ value: t, label: t === 'ep' ? 'EP' : t[0].toUpperCase() + t.slice(1) }))} value={arr<string>('types')} onChange={(v) => set({ types: v })} />
            </Block>
            {artistOptions.length > 0 && (
              <Block title="Artist">
                <Chips label="Artist" options={artistOptions} value={arr<string>('artistIds')} onChange={(v) => set({ artistIds: v })} />
              </Block>
            )}
            <Block title="Target date">
              <DateRange label="Target" from={draft.targetFrom as string | undefined} to={draft.targetTo as string | undefined} onChange={(targetFrom, targetTo) => set({ targetFrom, targetTo })} />
            </Block>
            <Block title="Release date">
              <DateRange label="Release" from={draft.releaseFrom as string | undefined} to={draft.releaseTo as string | undefined} onChange={(releaseFrom, releaseTo) => set({ releaseFrom, releaseTo })} />
            </Block>
            <Block title="Delivered">
              <DateRange label="Delivered" from={draft.deliveredFrom as string | undefined} to={draft.deliveredTo as string | undefined} onChange={(deliveredFrom, deliveredTo) => set({ deliveredFrom, deliveredTo })} />
            </Block>
            <Block title="Ready to deliver">
              <Dropdown
                aria-label="Ready to deliver"
                value={draft.ready === undefined ? '' : draft.ready ? 'yes' : 'no'}
                onChange={(v) => set({ ready: v === '' ? undefined : v === 'yes' })}
                options={[{ value: '', label: 'Either' }, { value: 'yes', label: 'Ready' }, { value: 'no', label: 'Not ready' }]}
              />
            </Block>
            <Block title="Gates">
              <div className="space-y-3">
                {gates.map((g, i) => (
                  <div key={i} className="space-y-1.5" data-testid="gate-clause">
                    <div className="flex items-center gap-2">
                      <Dropdown
                        aria-label="Gate"
                        value={g.gate}
                        options={RELEASE_GATES.map((x) => ({ value: x as string, label: GATE_LABEL[x] }))}
                        onChange={(v) => set({ gates: gates.map((x, j) => (j === i ? { ...x, gate: v as GateClause['gate'] } : x)) })}
                      />
                      <Button variant="ghost" size="sm" aria-label="Remove this gate filter" onClick={() => set({ gates: gates.filter((_, j) => j !== i) })}>Remove</Button>
                    </div>
                    <Chips
                      label={`${GATE_LABEL[g.gate]} is`}
                      options={GATE_STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] }))}
                      value={g.status}
                      onChange={(status) => set({ gates: gates.map((x, j) => (j === i ? { ...x, status } : x)) })}
                    />
                  </div>
                ))}
                {gates.length < RELEASE_GATES.length && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      const used = new Set(gates.map((x) => x.gate));
                      const gate = RELEASE_GATES.find((x) => !used.has(x));
                      if (gate) set({ gates: [...gates, { gate, status: ['blocked'] }] });
                    }}
                  >
                    Add a gate filter
                  </Button>
                )}
              </div>
            </Block>
          </>
        )}
      </div>
    </Modal>
  );
}

/** A clause the viewer cannot use is never left in a draft, even if it arrived with the URL. */
export function stripUnusable(draft: Draft, can: { canRights: boolean; canApprovals: boolean }): Draft {
  const out = { ...draft };
  if (!can.canRights) {
    delete out.credits;
    delete out.involves;
    delete out.splits;
    if (Array.isArray(out.missing)) out.missing = (out.missing as string[]).filter((m) => m !== 'credits');
  }
  if (!can.canApprovals) delete out.legalApproval;
  // Clauses with nothing in them mean nothing.
  if (Array.isArray(out.credits)) out.credits = (out.credits as CreditClause[]).filter((c) => c.partyId || c.roles?.length || c.status?.length);
  if (Array.isArray(out.gates)) out.gates = (out.gates as GateClause[]).filter((g) => g.status.length > 0);
  for (const [k, v] of Object.entries(out)) if (v === undefined || (Array.isArray(v) && v.length === 0)) delete out[k];
  return out;
}
