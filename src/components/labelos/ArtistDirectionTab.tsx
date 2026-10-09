'use client';

/**
 * The artist workspace's Direction tab (LABEL-26, 04 W6): the label's memory
 * of where an artist's music is going. Structured fields (no wiki) and a
 * list of references — a track, a link, a visual file from the artist's
 * projects, or a note — each open to the artist or the team's alone.
 *
 * Every edit is in place: a field saves when you leave it (Escape puts the
 * saved text back), a keyword is added with Enter and removed with its ×, a
 * reference's visibility is one toggle, and nothing opens a modal. What the
 * member may not read is already absent from the payload (an internal
 * reference is not sent to a member whose role is `artist`), so this tab
 * filters nothing itself.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ExternalLink, EyeOff, FileText, Image as ImageIcon, Link2, Lock, Music, Plus, X } from 'lucide-react';
import { confirmToast, toast } from '@/hooks/useToast';
import {
  DIRECTION_FIELDS,
  DIRECTION_FIELD_HINT,
  DIRECTION_FIELD_LABEL,
  DIRECTION_KEYWORDS_MAX,
  DIRECTION_KEYWORD_MAX,
  DIRECTION_TEXT_MAX,
  REFERENCE_KINDS,
  REFERENCE_KIND_LABEL,
  type ArtistDirection,
  type DirectionField,
  type ReferenceKind,
  type ReferenceView,
} from '@/lib/labelos/direction';
import {
  addReference,
  fetchDirection,
  fetchFileChoices,
  fetchTrackChoices,
  patchReference,
  removeReference,
  saveDirection,
  type DirectionPayload,
} from '@/lib/labelos/direction-client';
import type { FileChoice, TrackChoice } from '@/lib/labelos/direction-store';

const LABEL = 'text-[10px] font-mono uppercase tracking-[0.2em] text-white/40';
const EMPTY = 'rounded-xl border border-white/10 bg-[#0D0D0A] px-4 py-8 text-center text-[11px] text-white/40';
const FIELD =
  'w-full resize-none rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2 text-[13px] text-white/80 placeholder:text-white/30 transition-colors hover:border-white/20 focus:border-white/30 focus:outline-none disabled:opacity-40';
const BUTTON =
  'rounded-lg border border-white/10 bg-white/[0.06] px-3 py-1.5 text-[11px] text-white/70 transition-colors hover:border-white/20 hover:bg-white/[0.10] disabled:opacity-40';

const KIND_ICON: Record<ReferenceKind, typeof Music> = { track: Music, link: Link2, file: ImageIcon, note: FileText };

export function ArtistDirectionTab({ orgId, contactId }: { orgId: string; contactId: string }) {
  const [data, setData] = useState<DirectionPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchDirection(orgId, contactId).then((r) => {
      if (cancelled) return;
      if (r.ok) {
        setError(null);
        setData(r.data);
      } else setError(r.error);
    });
    return () => {
      cancelled = true;
    };
  }, [orgId, contactId]);

  if (error && !data) return <p className={EMPTY} role="alert" data-testid="direction-error">{error}</p>;
  if (!data) return <p className={EMPTY} data-testid="direction-loading">Loading…</p>;
  if (!data.schemaReady) return <p className={EMPTY}>Creative direction needs migration 152 applied on Supabase.</p>;

  const setReferences = (fn: (prev: ReferenceView[]) => ReferenceView[]) => setData((d) => (d ? { ...d, references: fn(d.references) } : d));

  return (
    <div className="space-y-10" data-testid="artist-direction">
      <DirectionFields
        orgId={orgId}
        contactId={contactId}
        direction={data.direction}
        canWrite={data.permissions.write}
        onSaved={(direction) => setData((d) => (d ? { ...d, direction } : d))}
      />
      <References
        orgId={orgId}
        contactId={contactId}
        references={data.references}
        restricted={data.restrictedReferences}
        permissions={data.permissions}
        onChange={setReferences}
      />
    </div>
  );
}

/* ── Structured fields ────────────────────────────────────────────────── */

function DirectionFields({ orgId, contactId, direction, canWrite, onSaved }: {
  orgId: string;
  contactId: string;
  direction: ArtistDirection;
  canWrite: boolean;
  onSaved: (d: ArtistDirection) => void;
}) {
  const [saved, setSaved] = useState(direction);
  const [busy, setBusy] = useState(false);
  // The latest saved document, readable inside a blur handler that fires before a re-render.
  const latest = useRef(direction);
  useEffect(() => {
    latest.current = saved;
  }, [saved]);

  const commit = useCallback(async (next: ArtistDirection): Promise<boolean> => {
    setBusy(true);
    const r = await saveDirection(orgId, contactId, next);
    setBusy(false);
    if (!r.ok) {
      toast.error(r.error);
      return false;
    }
    latest.current = r.direction;
    setSaved(r.direction);
    onSaved(r.direction);
    return true;
  }, [orgId, contactId, onSaved]);

  const saveField = (field: DirectionField, text: string) => {
    if ((latest.current[field] ?? '') === text.trim()) return Promise.resolve(true);
    return commit({ ...latest.current, [field]: text });
  };

  const keywords = saved.keywords ?? [];
  return (
    <section aria-labelledby="dir-fields" className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 id="dir-fields" className={LABEL}>Direction</h2>
        {busy && <span className="text-[11px] text-white/40" aria-live="polite">Saving…</span>}
      </div>
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        {DIRECTION_FIELDS.map((f) => (
          <DirectionField key={`${f}:${saved[f] ?? ''}`} field={f} value={saved[f] ?? ''} canWrite={canWrite} onSave={(t) => saveField(f, t)} />
        ))}
      </div>
      <div>
        <p className={`${LABEL} mb-2`}>Keywords</p>
        <KeywordRow
          keywords={keywords}
          canWrite={canWrite}
          onChange={(next) => commit({ ...latest.current, keywords: next })}
        />
      </div>
    </section>
  );
}

function DirectionField({ field, value, canWrite, onSave }: {
  field: DirectionField;
  value: string;
  canWrite: boolean;
  onSave: (text: string) => Promise<boolean>;
}) {
  // The parent keys this component by the saved value, so a save (or a failed one) resets the draft.
  const [text, setText] = useState(value);
  const id = `dir-${field}`;
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-[11px] text-white/60">{DIRECTION_FIELD_LABEL[field]}</label>
      {canWrite ? (
        <textarea
          id={id}
          value={text}
          rows={3}
          maxLength={DIRECTION_TEXT_MAX}
          placeholder={DIRECTION_FIELD_HINT[field]}
          className={FIELD}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => {
            if (text.trim() !== value) void onSave(text).then((ok) => { if (!ok) setText(value); });
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setText(value);
              e.currentTarget.blur();
            }
          }}
          data-testid={id}
        />
      ) : (
        <p className="min-h-[2.5rem] whitespace-pre-wrap rounded-lg border border-white/10 px-3 py-2 text-[13px] text-white/70" data-testid={id}>
          {value || <span className="text-white/30">—</span>}
        </p>
      )}
    </div>
  );
}

function KeywordRow({ keywords, canWrite, onChange }: { keywords: string[]; canWrite: boolean; onChange: (next: string[]) => Promise<boolean> }) {
  const [draft, setDraft] = useState('');
  const add = async () => {
    const word = draft.trim();
    if (!word) return;
    if (keywords.some((k) => k.toLowerCase() === word.toLowerCase())) return setDraft('');
    if (keywords.length >= DIRECTION_KEYWORDS_MAX) return toast.error(`At most ${DIRECTION_KEYWORDS_MAX} keywords.`);
    if (await onChange([...keywords, word])) setDraft('');
  };
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="direction-keywords">
      {keywords.map((k) => (
        <span key={k} className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.06] px-2.5 py-1 text-[11px] text-white/70">
          {k}
          {canWrite && (
            <button type="button" aria-label={`Remove ${k}`} onClick={() => void onChange(keywords.filter((x) => x !== k))} className="text-white/40 hover:text-white">
              <X size={11} aria-hidden="true" />
            </button>
          )}
        </span>
      ))}
      {keywords.length === 0 && !canWrite && <span className="text-[11px] text-white/30">—</span>}
      {canWrite && (
        <input
          value={draft}
          maxLength={DIRECTION_KEYWORD_MAX}
          placeholder="Add a keyword, Enter"
          aria-label="Add a keyword"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void add();
            }
          }}
          className="w-44 rounded-lg border border-white/10 bg-white/[0.06] px-2.5 py-1 text-[11px] text-white/80 placeholder:text-white/30 hover:border-white/20 focus:border-white/30 focus:outline-none"
        />
      )}
    </div>
  );
}

/* ── References ───────────────────────────────────────────────────────── */

function References({ orgId, contactId, references, restricted, permissions, onChange }: {
  orgId: string;
  contactId: string;
  references: ReferenceView[];
  restricted: number;
  permissions: { write: boolean; internal: boolean };
  onChange: (fn: (prev: ReferenceView[]) => ReferenceView[]) => void;
}) {
  const remove = async (ref: ReferenceView) => {
    const ok = await confirmToast('Remove this reference?', ref.title, { confirmLabel: 'Remove', danger: true });
    if (!ok) return;
    const r = await removeReference(orgId, contactId, ref.id);
    if (!r.ok) return toast.error(r.error);
    onChange((prev) => prev.filter((x) => x.id !== ref.id));
  };
  const flip = async (ref: ReferenceView) => {
    const r = await patchReference(orgId, contactId, ref.id, { visibility: ref.visibility === 'internal' ? 'artist' : 'internal' });
    if (!r.ok) return toast.error(r.error);
    if (r.reference) onChange((prev) => prev.map((x) => (x.id === ref.id ? (r.reference as ReferenceView) : x)));
  };

  return (
    <section aria-labelledby="dir-refs" className="space-y-3">
      <h2 id="dir-refs" className={LABEL}>References</h2>
      {permissions.write && (
        <AddReference
          orgId={orgId}
          contactId={contactId}
          canInternal={permissions.internal}
          onAdded={(ref) => onChange((prev) => [...prev, ref])}
        />
      )}
      {references.length === 0 ? (
        <p className={EMPTY} data-testid="direction-refs-empty">
          {permissions.write ? 'No references yet. Add a track, a link, a file or a note that shows where this artist is heading.' : 'No references yet.'}
        </p>
      ) : (
        <ul className="divide-y divide-white/[0.06] rounded-xl border border-white/10 bg-[#0D0D0A]" data-testid="direction-refs">
          {references.map((ref) => (
            <ReferenceRow key={ref.id} reference={ref} permissions={permissions} onFlip={() => void flip(ref)} onRemove={() => void remove(ref)} />
          ))}
        </ul>
      )}
      {restricted > 0 && (
        <p className="flex items-center gap-2 rounded-xl border border-white/10 px-4 py-3 text-[11px] text-white/50" data-testid="direction-restricted">
          <Lock size={12} className="shrink-0 text-white/30" aria-hidden="true" />
          <span>{restricted} reference{restricted === 1 ? '' : 's'} point{restricted === 1 ? 's' : ''} at material your role cannot open.</span>
        </p>
      )}
    </section>
  );
}

function ReferenceRow({ reference: ref, permissions, onFlip, onRemove }: {
  reference: ReferenceView;
  permissions: { write: boolean; internal: boolean };
  onFlip: () => void;
  onRemove: () => void;
}) {
  const Icon = KIND_ICON[ref.kind];
  const href = ref.kind === 'link' ? ref.url : ref.kind === 'file' ? ref.file?.downloadUrl ?? null : null;
  const internal = ref.visibility === 'internal';
  return (
    <li className="flex items-start gap-3 px-3 py-3" data-testid={`direction-ref-${ref.id}`}>
      <Icon size={14} className="mt-0.5 shrink-0 text-white/30" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2">
          {href ? (
            <a href={href} target="_blank" rel="noopener noreferrer" className="min-w-0 truncate text-[13px] text-white/80 hover:text-white">
              {ref.title}
              <ExternalLink size={10} className="ml-1.5 inline text-white/30" aria-hidden="true" />
            </a>
          ) : (
            <span className="min-w-0 truncate text-[13px] text-white/80">{ref.title}</span>
          )}
          <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.2em] text-white/30">{REFERENCE_KIND_LABEL[ref.kind]}</span>
          {internal && (
            <span className="flex shrink-0 items-center gap-1 rounded-lg border border-white/10 px-1.5 py-0.5 text-[10px] text-white/50" data-testid="direction-ref-internal">
              <EyeOff size={10} aria-hidden="true" /> Team only
            </span>
          )}
        </p>
        {ref.kind === 'track' && ref.trackTitle && ref.trackTitle !== ref.title && <p className="text-[11px] text-white/40">{ref.trackTitle}</p>}
        {ref.kind === 'link' && ref.host && <p className="text-[11px] text-white/40">{ref.host}</p>}
        {ref.note && <p className="mt-1 whitespace-pre-wrap text-[11px] text-white/50">{ref.note}</p>}
      </div>
      {permissions.write && (
        <div className="flex shrink-0 items-center gap-1">
          {permissions.internal && (
            <button type="button" onClick={onFlip} aria-pressed={internal} aria-label={internal ? 'Share with the artist' : 'Keep to the team'} title={internal ? 'Share with the artist' : 'Keep to the team'} className="rounded-lg p-1.5 text-white/40 transition-colors hover:text-white">
              <EyeOff size={13} aria-hidden="true" />
            </button>
          )}
          <button type="button" onClick={onRemove} aria-label={`Remove ${ref.title}`} className="rounded-lg p-1.5 text-white/40 transition-colors hover:text-white">
            <X size={13} aria-hidden="true" />
          </button>
        </div>
      )}
    </li>
  );
}

/* ── Adding one ───────────────────────────────────────────────────────── */

function AddReference({ orgId, contactId, canInternal, onAdded }: {
  orgId: string;
  contactId: string;
  canInternal: boolean;
  onAdded: (ref: ReferenceView) => void;
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<ReferenceKind>('link');
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [url, setUrl] = useState('');
  const [trackId, setTrackId] = useState<string | null>(null);
  const [assetId, setAssetId] = useState<string | null>(null);
  const [internal, setInternal] = useState(false);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setTitle(''); setNote(''); setUrl(''); setTrackId(null); setAssetId(null); setInternal(false);
  };
  const ready =
    kind === 'link' ? url.trim() !== '' && title.trim() !== '' :
    kind === 'note' ? note.trim() !== '' && title.trim() !== '' :
    kind === 'track' ? trackId !== null :
    assetId !== null;

  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true);
    const r = await addReference(orgId, contactId, { kind, title, note, url, trackId: trackId ?? undefined, assetId: assetId ?? undefined, internal });
    setBusy(false);
    if (!r.ok) return toast.error(r.error);
    if (r.reference) onAdded(r.reference);
    reset();
  };

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={`${BUTTON} flex items-center gap-1.5`} data-testid="direction-add-open">
        <Plus size={12} aria-hidden="true" /> Add a reference
      </button>
    );
  }

  return (
    <form
      className="space-y-3 rounded-xl border border-white/10 bg-[#0D0D0A] p-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') setOpen(false);
      }}
      data-testid="direction-add"
    >
      <div role="radiogroup" aria-label="Kind of reference" className="flex flex-wrap gap-2">
        {REFERENCE_KINDS.map((k) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={kind === k}
            onClick={() => { setKind(k); reset(); }}
            className={`rounded-lg border px-3 py-1.5 text-[11px] transition-colors ${kind === k ? 'border-white/30 bg-white/[0.14] text-white' : 'border-white/10 bg-white/[0.06] text-white/60 hover:border-white/20 hover:bg-white/[0.10]'}`}
          >
            {REFERENCE_KIND_LABEL[k]}
          </button>
        ))}
      </div>

      {kind === 'link' && (
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" aria-label="Link address" inputMode="url" className={FIELD} data-testid="direction-add-url" autoFocus />
      )}
      {kind === 'track' && <TrackPicker orgId={orgId} contactId={contactId} value={trackId} onPick={setTrackId} />}
      {kind === 'file' && <FilePicker orgId={orgId} contactId={contactId} value={assetId} onPick={setAssetId} />}

      {(kind === 'link' || kind === 'note') && (
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder={kind === 'link' ? 'Name it' : 'Title'} aria-label="Title" className={FIELD} data-testid="direction-add-title" />
      )}
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        maxLength={2000}
        placeholder={kind === 'note' ? 'The note' : 'Why it is a reference (optional)'}
        aria-label={kind === 'note' ? 'Note' : 'Why it is a reference'}
        className={FIELD}
        data-testid="direction-add-note"
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        {canInternal ? (
          <label className="flex items-center gap-2 text-[11px] text-white/60">
            <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} data-testid="direction-add-internal" />
            Team only — the artist will not see it
          </label>
        ) : <span />}
        <div className="flex gap-2">
          <button type="button" onClick={() => setOpen(false)} className={BUTTON}>Close</button>
          <button type="submit" disabled={!ready || busy} className={BUTTON} data-testid="direction-add-submit">{busy ? 'Adding…' : 'Add'}</button>
        </div>
      </div>
    </form>
  );
}

function TrackPicker({ orgId, contactId, value, onPick }: { orgId: string; contactId: string; value: string | null; onPick: (id: string | null) => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<TrackChoice[]>([]);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      void fetchTrackChoices(orgId, contactId, q).then((r) => {
        if (cancelled) return;
        setFailed(r.ok ? null : r.error);
        if (r.ok) setResults(r.tracks);
      });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [orgId, contactId, q]);
  return (
    <div className="space-y-2">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tracks by title" aria-label="Search tracks" className={FIELD} data-testid="direction-track-search" autoFocus />
      {failed ? (
        <p className="text-[11px] text-white/50" role="alert">{failed}</p>
      ) : (
        <ul className="max-h-48 overflow-y-auto rounded-lg border border-white/10" role="listbox" aria-label="Tracks">
          {results.length === 0 && <li className="px-3 py-2 text-[11px] text-white/40">No tracks match.</li>}
          {results.map((t) => (
            <li key={t.id} role="option" aria-selected={value === t.id}>
              <button type="button" onClick={() => onPick(value === t.id ? null : t.id)} className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-[13px] transition-colors hover:bg-white/[0.06] ${value === t.id ? 'bg-white/[0.10] text-white' : 'text-white/70'}`}>
                <span className="truncate">{t.title}</span>
                {t.type && <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.2em] text-white/30">{t.type}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FilePicker({ orgId, contactId, value, onPick }: { orgId: string; contactId: string; value: string | null; onPick: (id: string | null) => void }) {
  const [files, setFiles] = useState<FileChoice[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void fetchFileChoices(orgId, contactId).then((r) => {
      if (cancelled) return;
      if (r.ok) setFiles(r.files);
      else setFailed(r.error);
    });
    return () => {
      cancelled = true;
    };
  }, [orgId, contactId]);
  if (failed) return <p className="text-[11px] text-white/50" role="alert">{failed}</p>;
  if (!files) return <p className="text-[11px] text-white/40">Loading files…</p>;
  if (files.length === 0) return <p className="text-[11px] text-white/40" data-testid="direction-no-files">No artwork, photos, video or lyrics on this artist&apos;s projects yet. Add them in the Files tab.</p>;
  return (
    <ul className="max-h-48 overflow-y-auto rounded-lg border border-white/10" role="listbox" aria-label="Files">
      {files.map((f) => (
        <li key={f.id} role="option" aria-selected={value === f.id}>
          <button type="button" onClick={() => onPick(value === f.id ? null : f.id)} className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-[13px] transition-colors hover:bg-white/[0.06] ${value === f.id ? 'bg-white/[0.10] text-white' : 'text-white/70'}`}>
            <span className="truncate">{f.label}</span>
            <span className="shrink-0 truncate text-[11px] text-white/40">{f.project}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
