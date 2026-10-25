'use client';

/**
 * A release (LABEL-33, 09 §4): its details, tracklist, artwork, the seven
 * gates with what blocks each, and the delivery. Everything here is a plain
 * call to a release route (`lib/labelos/release-client`) followed by a
 * refresh of the server-rendered data; every rule — who may write, what is
 * ready, who may override — is the server's, and its own words are what the
 * toast says. A control appears only for someone the server would let press
 * it (`me`), and a draft is the only state whose tracklist, artwork and
 * delivery change.
 *
 * Reordering is up / down buttons and a position field, never dragging (07
 * §2.5). The actions area (`data-testid="release-actions"`) is a plain flex
 * row on purpose: LABEL-34's export buttons and calendar link are mounted there, for
 * `release.write` only.
 */
import { useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowDown, ArrowUp, X } from 'lucide-react';
import { ActionMenu, type MenuSection } from '@/components/ui/ActionMenu';
import { ReleaseCalendarLink } from './ReleaseCalendarLink';
import { ReleaseExportButtons } from './ReleaseExportButtons';
import { Dropdown, type DropdownOption } from '@/components/ui/Dropdown';
import { InlineText } from '@/components/ui/InlineText';
import { Popover } from '@/components/ui/Popover';
import { TONE_TEXT } from '@/components/labelos/ReleaseGateStrip';
import { toast } from '@/hooks/useToast';
import { cn } from '@/lib/utils';
import { gateTone, gateWord } from '@/lib/labelos/release-board';
import {
  addReleaseItem,
  cancelRelease,
  deliverRelease,
  getMasterOptions,
  patchRelease,
  removeReleaseItem,
  reopenRelease,
  reorderReleaseItems,
  setItemExplicit,
  setItemMaster,
  setReleaseArtwork,
  type MasterOptions,
} from '@/lib/labelos/release-client';
import { MASTER_RELATION_LABEL } from '@/lib/labelos/master-choice';
import { formatTerritories, parseLanguage, parseTerritories } from '@/lib/labelos/release-form';
import { OrgApprovals } from '@/components/labelos/OrgApprovals';
import type { ReleaseDetail } from '@/lib/labelos/release-detail-store';
import { gateSkipNotice } from '@/lib/labelos/org-settings';
import { RELEASE_GATES, RELEASE_GATE_LABEL, type ReleaseGate } from '@/lib/labelos/release-readiness';
import { moveBy, moveTo } from '@/lib/labelos/release-tracklist';

const LABEL = 'text-[10px] font-mono uppercase tracking-[0.2em] text-white/40';
const BTN =
  'rounded-lg border border-white/10 bg-white/[0.06] px-2.5 py-1 text-[11px] text-white/80 transition-colors hover:border-white/20 hover:bg-white/[0.10] disabled:opacity-40';
const ICON_BTN = 'grid size-7 place-items-center rounded-lg text-white/60 transition-colors hover:bg-white/[0.10] hover:text-white disabled:opacity-30';
const FIELD = 'w-full rounded-lg border border-white/10 bg-[#090907] px-3 py-2 text-[11px] text-white placeholder:text-white/30 focus:border-white/30 focus:outline-none';
const CARD = 'rounded-xl border border-white/10 bg-[#0D0D0A] p-4';

const day = (iso: string | null) =>
  iso ? new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : null;

type Detail = ReleaseDetail;

export function ReleaseDetailView({ orgId, orgSlug, detail, extraActions }: { orgId: string; orgSlug: string; detail: Detail; extraActions?: ReactNode }) {
  const router = useRouter();
  const { release, me } = detail;
  const draft = release.state === 'draft';
  const gateNotice = gateSkipNotice(detail.gatesSkipped ?? [], release.state);
  // An import (LABEL-42) is entered delivered, but its tracklist is what is being entered:
  // editable until it is on the store, where each song's public preview was promoted for that list.
  const importedOpen = release.importedReleased && release.state === 'delivered' && !release.storeListed && me.canManagePublic;
  const editable = (draft || importedOpen) && me.canWrite;
  const [busy, setBusy] = useState(false);

  /** One write, then a refresh of the server data; the server's own words on failure. */
  const act = async (run: () => Promise<{ ok: true } | { ok: false; error: string }>, success?: string): Promise<boolean> => {
    setBusy(true);
    const res = await run();
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error);
      return false;
    }
    if (success) toast.success(success);
    router.refresh();
    return true;
  };

  const saveField = async (key: string, value: string): Promise<boolean> => {
    const v = value.trim();
    let body: Record<string, unknown>;
    if (key === 'territories') {
      const parsed = parseTerritories(v);
      if (!parsed.ok) {
        toast.error(parsed.error);
        return false;
      }
      body = { territories: parsed.codes };
    } else if (key === 'language') {
      const parsed = parseLanguage(v);
      if (!parsed.ok) {
        toast.error(parsed.error);
        return false;
      }
      body = { language: parsed.code };
    } else {
      body = { [key]: key === 'title' ? v : v === '' ? null : v };
    }
    return act(() => patchRelease(orgId, release.id, body));
  };

  const menu: MenuSection[] = [];
  if (me.canWrite && draft) menu.push({ id: 'state', items: [{ id: 'cancel', label: 'Cancel release', danger: true, onSelect: () => void act(() => cancelRelease(orgId, release.id), 'Release cancelled') }] });
  if (me.canWrite && release.state === 'cancelled') menu.push({ id: 'state', items: [{ id: 'reopen', label: 'Reopen as draft', onSelect: () => void act(() => reopenRelease(orgId, release.id), 'Release reopened') }] });

  return (
    <div className="space-y-6" data-testid="release-detail" data-state={release.state}>
      <header>
        <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-white/60">
          <Link href={`/o/${orgSlug}/releases`} className="hover:text-white">Releases</Link>
          {detail.artist ? ` · ${detail.artist.name}` : ''}
        </p>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            {editable ? (
              <InlineText
                value={release.title}
                label="Release title"
                maxLength={300}
                onSave={saveField.bind(null, 'title')}
                className="font-heading text-[28px] font-bold leading-[1.05] tracking-tight text-white sm:text-[32px] md:text-[40px]"
                inputClassName="font-heading text-[28px] font-bold leading-[1.05] tracking-tight text-white sm:text-[32px] md:text-[40px]"
              />
            ) : (
              <h1 className="font-heading text-[28px] font-bold leading-[1.05] tracking-tight text-white sm:text-[32px] md:text-[40px]">{release.title}</h1>
            )}
            <p className="mt-2 text-[11px] text-white/60" data-testid="release-state">
              <span className="capitalize">{release.type}</span> · {release.state === 'delivered' ? 'Delivered' : release.state === 'cancelled' ? 'Cancelled' : 'Draft'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2" data-testid="release-actions">
            {me.canWrite && (
              <>
                <ReleaseExportButtons orgId={orgId} releaseId={release.id} canExport />
                <ReleaseCalendarLink orgId={orgId} />
              </>
            )}
            {extraActions}
            {menu.length > 0 && <ActionMenu sections={menu} label="Release actions" align="right" busy={busy} />}
          </div>
        </div>
      </header>

      {gateNotice && (
        <p className="rounded-xl border border-white/20 bg-white/[0.06] px-4 py-3 text-[11px] leading-relaxed text-white/80" role="note" data-testid="release-gate-skipped">
          {gateNotice}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <Tracklist orgId={orgId} orgSlug={orgSlug} detail={detail} editable={editable} busy={busy} act={act} />
          <Artwork orgId={orgId} detail={detail} editable={editable} busy={busy} act={act} />
          <Details detail={detail} editable={editable} onSave={saveField} />
        </div>
        <div className="space-y-6">
          <Gates detail={detail} orgSlug={orgSlug} />
          {/* The five gates that need a person (09 §4) are asked for and answered here; the server shows each member only what they may do, and nothing at all to one who may not read approvals. */}
          {draft && <OrgApprovals key={release.id} orgId={orgId} subject={{ kind: 'release', id: release.id }} onChanged={() => router.refresh()} />}
          <Delivery orgId={orgId} detail={detail} busy={busy} act={act} />
        </div>
      </div>
    </div>
  );
}

type Act = (run: () => Promise<{ ok: true } | { ok: false; error: string }>, success?: string) => Promise<boolean>;

// ── Tracklist ───────────────────────────────────────────────────────────

function Tracklist({ orgId, orgSlug, detail, editable, busy, act }: { orgId: string; orgSlug: string; detail: Detail; editable: boolean; busy: boolean; act: Act }) {
  const { release, items, me } = detail;
  const order = items.map((i) => i.id);

  const reorder = (next: string[] | null) => {
    if (next) void act(() => reorderReleaseItems(orgId, release.id, next));
  };

  return (
    <section aria-labelledby="release-tracklist" className={CARD} data-testid="release-tracklist">
      <h2 id="release-tracklist" className={`${LABEL} mb-3`}>Tracklist</h2>
      {items.length === 0 ? (
        <p className="text-[11px] text-white/60" data-testid="release-tracklist-empty">No tracks yet.{editable ? ' Add the songs this release goes out with.' : ''}</p>
      ) : (
        <ol className="space-y-1.5">
          {items.map((item, index) => (
            <li key={item.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-white/10 px-2.5 py-2" data-testid={`release-item-${item.id}`} data-position={item.position}>
              {editable ? (
                <PositionField
                  value={item.position}
                  max={items.length}
                  disabled={busy}
                  label={`Position of ${item.title ?? 'track'}`}
                  onCommit={(p) => reorder(moveTo(order, item.id, p))}
                />
              ) : (
                <span className="w-6 text-center font-mono text-[10px] text-white/40">{item.position}</span>
              )}
              <div className="min-w-0 flex-1 basis-40">
                {item.title ? (
                  <Link href={`/o/${orgSlug}/songs/${item.songId}`} className="truncate text-[13px] text-white hover:underline">{item.title}</Link>
                ) : (
                  <span className="text-[13px] text-white/40">Restricted song</span>
                )}
                <p className="text-[10px] font-mono uppercase tracking-[0.1em] text-white/40" data-testid={`release-item-info-${item.id}`}>
                  {item.ownMaster ? 'Own mix' : 'Separate master'}
                  {item.explicit ? ' · Explicit' : ''}
                  {item.versionTitle ? ` · ${item.versionTitle}` : ''}
                </p>
              </div>
              {editable && item.title && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <MasterPicker orgId={orgId} releaseId={release.id} item={item} busy={busy} act={act} />
                  <button
                    type="button"
                    className={BTN}
                    aria-pressed={item.explicit}
                    disabled={busy}
                    data-testid={`release-item-explicit-${item.id}`}
                    onClick={() => void act(() => setItemExplicit(orgId, release.id, item.id, !item.explicit))}
                  >
                    {item.explicit ? 'Explicit' : 'Mark explicit'}
                  </button>
                </div>
              )}
              {editable && (
                <div className="flex items-center">
                  <button type="button" className={ICON_BTN} aria-label={`Move ${item.title ?? 'track'} up`} disabled={busy || index === 0} onClick={() => reorder(moveBy(order, item.id, -1))}>
                    <ArrowUp className="size-3.5" />
                  </button>
                  <button type="button" className={ICON_BTN} aria-label={`Move ${item.title ?? 'track'} down`} disabled={busy || index === items.length - 1} onClick={() => reorder(moveBy(order, item.id, 1))}>
                    <ArrowDown className="size-3.5" />
                  </button>
                  <button type="button" className={ICON_BTN} aria-label={`Remove ${item.title ?? 'track'}`} disabled={busy} onClick={() => void act(() => removeReleaseItem(orgId, release.id, item.id), 'Track removed')}>
                    <X className="size-3.5" />
                  </button>
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
      {editable && <AddTrack orgId={orgId} detail={detail} busy={busy} act={act} />}
      {!editable && release.state !== 'draft' && <p className="mt-3 text-[11px] text-white/40">{release.importedReleased && release.storeListed ? 'Take this release off the store to change its tracklist.' : release.importedReleased && !me.canManagePublic ? 'Only an owner or an admin can change the tracklist of a release that was entered as already out.' : `A ${release.state} release keeps its tracklist.`}</p>}
    </section>
  );
}

/**
 * Add a song: pick it, then the recording it goes out as (the master chooser,
 * LABEL-55). The song's single linked master is chosen for you; with none or
 * several you choose, and Add waits for that. The rules are the server's
 * (`master-options` offers only what the item route will accept).
 */
function AddTrack({ orgId, detail, busy, act }: { orgId: string; detail: Detail; busy: boolean; act: Act }) {
  const { release, candidates } = detail;
  const [pick, setPick] = useState('');
  const [choice, setChoice] = useState<MasterOptions | null>(null);
  const [masterId, setMasterId] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const latest = useRef('');
  const options: DropdownOption<string>[] = candidates.map((c) => ({ value: c.id, label: c.title }));

  const choose = async (songId: string) => {
    latest.current = songId;
    setPick(songId);
    setChoice(null);
    setMasterId('');
    setLoadError(null);
    if (!songId) return;
    setLoading(true);
    const res = await getMasterOptions(orgId, release.id, songId);
    if (latest.current !== songId) return;
    setLoading(false);
    if (!res.ok) return setLoadError(res.error);
    setChoice(res);
    setMasterId(res.defaultId ?? '');
  };

  if (options.length === 0) return <p className="mt-3 text-[11px] text-white/40" data-testid="release-add-track">No other songs of this artist to add.</p>;

  const masterOptions: DropdownOption<string>[] = (choice?.options ?? []).map((o) => ({ value: o.id, label: `${o.title} · ${MASTER_RELATION_LABEL[o.relation]}` }));
  const onlyOwnMix = choice !== null && choice.options.length === 1;
  return (
    <div className="mt-3 space-y-2" data-testid="release-add-track">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-[200px] flex-1">
          <Dropdown value={pick} onChange={(id) => void choose(id)} options={options} placeholder="Add a song…" aria-label="Song to add" />
        </div>
        <button
          type="button"
          className={BTN}
          disabled={busy || loading || !pick || !choice || !masterId}
          data-testid="release-add-submit"
          onClick={async () => {
            if (await act(() => addReleaseItem(orgId, release.id, pick, masterId), 'Track added')) void choose('');
          }}
        >
          Add to tracklist
        </button>
      </div>
      {loading && <p className="text-[11px] text-white/40">Looking for its masters…</p>}
      {loadError && <p role="alert" className="text-[11px] text-[var(--error-text)]">{loadError}</p>}
      {choice && (
        <div className="space-y-1.5" data-testid="release-master-choice" data-ask={choice.ask ? 'true' : 'false'}>
          <span className={LABEL}>Goes out as</span>
          <Dropdown value={masterId} onChange={setMasterId} options={masterOptions} placeholder="Choose the recording…" aria-label="Master recording" />
          <p className="text-[10px] text-white/40" data-testid="release-master-hint">
            {!choice.ask
              ? 'Its linked master is selected.'
              : onlyOwnMix
                ? 'No master is linked to this song. Link one on the song page, or release its own mix — the masters gate stays open until a master is chosen.'
                : 'This song has more than one recording. Choose the one that goes out.'}
          </p>
        </div>
      )}
    </div>
  );
}

/** Change which recording an item goes out as, from its row. The options are read when it opens. */
function MasterPicker({ orgId, releaseId, item, busy, act }: { orgId: string; releaseId: string; item: Detail['items'][number]; busy: boolean; act: Act }) {
  const [state, setState] = useState<{ loading: boolean; error: string | null; options: MasterOptions['options'] }>({ loading: false, error: null, options: [] });
  const load = async () => {
    setState({ loading: true, error: null, options: [] });
    const res = await getMasterOptions(orgId, releaseId, item.songId);
    setState(res.ok ? { loading: false, error: null, options: res.options } : { loading: false, error: res.error, options: [] });
  };
  return (
    <Popover
      label={`Master for ${item.title ?? 'track'}`}
      width={300}
      align="right"
      onOpenChange={(open) => {
        if (open) void load();
      }}
      trigger={({ toggle, ref, open }) => (
        <button type="button" ref={ref} onClick={toggle} aria-expanded={open} disabled={busy} className={BTN} data-testid={`release-item-master-${item.id}`}>
          Master
        </button>
      )}
    >
      {(close) => (
        <div className="space-y-1 p-2 text-[11px]" data-testid={`release-item-master-options-${item.id}`}>
          {state.loading && <p className="px-2 py-1 text-white/40">Loading…</p>}
          {state.error && <p role="alert" className="px-2 py-1 text-[var(--error-text)]">{state.error}</p>}
          {state.options.map((o) => {
            const current = o.id.toLowerCase() === item.masterId.toLowerCase();
            return (
              <button
                key={o.id}
                type="button"
                aria-pressed={current}
                disabled={busy}
                data-testid={`release-item-master-option-${o.id}`}
                className={cn('flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-white/[0.08] disabled:opacity-40', current ? 'bg-white/[0.08] text-white' : 'text-white/80')}
                onClick={() => {
                  close();
                  if (!current) void act(() => setItemMaster(orgId, releaseId, item.id, o.id), 'Master changed');
                }}
              >
                <span className="min-w-0 truncate">{o.title}</span>
                <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.1em] text-white/40">{MASTER_RELATION_LABEL[o.relation]}{current ? ' · current' : ''}</span>
              </button>
            );
          })}
        </div>
      )}
    </Popover>
  );
}

function PositionField({ value, max, label, disabled, onCommit }: { value: number; max: number; label: string; disabled: boolean; onCommit: (position: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  const [seen, setSeen] = useState(value);
  // The server's position wins whenever it changes underneath the field.
  if (seen !== value) {
    setSeen(value);
    setDraft(String(value));
  }
  const commit = () => {
    const n = Number(draft);
    if (!Number.isFinite(n) || draft.trim() === '') return setDraft(String(value));
    if (Math.trunc(n) !== value) onCommit(n);
    else setDraft(String(value));
  };
  return (
    <input
      type="number"
      inputMode="numeric"
      min={1}
      max={max}
      value={draft}
      disabled={disabled}
      aria-label={label}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') setDraft(String(value));
      }}
      className="w-10 rounded-lg border border-white/10 bg-[#090907] px-1 py-1 text-center font-mono text-[10px] text-white/80 focus:border-white/30 focus:outline-none disabled:opacity-40"
    />
  );
}

// ── Artwork ─────────────────────────────────────────────────────────────

function Artwork({ orgId, detail, editable, busy, act }: { orgId: string; detail: Detail; editable: boolean; busy: boolean; act: Act }) {
  const { release, artwork } = detail;
  const options: DropdownOption<string>[] = [
    ...artwork.options.map((o) => ({ value: o.id, label: o.label })),
    ...(release.artworkAssetId && !artwork.current ? [{ value: release.artworkAssetId, label: 'Current file (not shown to you)' }] : []),
  ];
  return (
    <section aria-labelledby="release-artwork" className={CARD} data-testid="release-artwork">
      <h2 id="release-artwork" className={`${LABEL} mb-3`}>Artwork</h2>
      <div className="flex flex-wrap items-center gap-4">
        <div className="grid size-24 shrink-0 place-items-center overflow-hidden rounded-xl border border-white/10 bg-[#090907]">
          {artwork.current ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/org/${orgId}/projects/${release.projectId}/assets/${artwork.current.id}/download?inline=1`}
              alt={`Artwork: ${artwork.current.label}`}
              className="size-full object-cover"
            />
          ) : (
            <span className="px-2 text-center text-[10px] font-mono uppercase tracking-[0.1em] text-white/30">None</span>
          )}
        </div>
        <div className="min-w-[200px] flex-1 space-y-2">
          <p className="text-[11px] text-white/60" data-testid="release-artwork-name">
            {artwork.current ? artwork.current.label : release.artworkAssetId ? 'An artwork file is set.' : 'No artwork is set.'}
          </p>
          {editable && (options.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <div className="min-w-[180px] flex-1">
                <Dropdown
                  value={release.artworkAssetId ?? ''}
                  onChange={(id) => void act(() => setReleaseArtwork(orgId, release.id, id || null), 'Artwork set')}
                  options={options}
                  placeholder="Choose artwork…"
                  disabled={busy}
                  aria-label="Artwork file"
                />
              </div>
              {release.artworkAssetId && (
                <button type="button" className={BTN} disabled={busy} onClick={() => void act(() => setReleaseArtwork(orgId, release.id, null), 'Artwork cleared')}>
                  Clear
                </button>
              )}
            </div>
          ) : (
            <p className="text-[11px] text-white/40">Add an artwork or photo file to the release’s project, then choose it here. JPEG or PNG.</p>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── Details ─────────────────────────────────────────────────────────────

const DETAIL_FIELDS: { key: string; label: string; read: (r: Detail['release']) => string | null; placeholder: string }[] = [
  { key: 'upc', label: 'UPC', read: (r) => r.upc, placeholder: '12 or 13 digits' },
  { key: 'label_name', label: 'Label', read: (r) => r.labelName, placeholder: 'Label name' },
  { key: 'p_line', label: '℗ line', read: (r) => r.pLine, placeholder: '℗ 2026 …' },
  { key: 'c_line', label: '© line', read: (r) => r.cLine, placeholder: '© 2026 …' },
  { key: 'primary_genre', label: 'Genre', read: (r) => r.primaryGenre, placeholder: 'Primary genre' },
  { key: 'language', label: 'Language', read: (r) => r.language, placeholder: 'en, pt-BR…' },
  { key: 'territories', label: 'Territories', read: (r) => formatTerritories(r.territories) || null, placeholder: 'WW, or US GB FR…' },
  { key: 'distributor', label: 'Distributor', read: (r) => r.distributor, placeholder: 'Who it will go to' },
  { key: 'target_date', label: 'Target date', read: (r) => r.targetDate, placeholder: 'YYYY-MM-DD' },
  { key: 'release_date', label: 'Release date', read: (r) => r.releaseDate, placeholder: 'YYYY-MM-DD' },
];

function Details({ detail, editable, onSave }: { detail: Detail; editable: boolean; onSave: (key: string, value: string) => Promise<boolean> }) {
  return (
    <section aria-labelledby="release-details" className={CARD} data-testid="release-details">
      <h2 id="release-details" className={`${LABEL} mb-3`}>Details</h2>
      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
        {DETAIL_FIELDS.map((f) => {
          const value = f.read(detail.release) ?? '';
          return (
            <div key={f.key} data-testid={`release-field-${f.key}`}>
              <dt className={LABEL}>{f.label}</dt>
              <dd className="mt-0.5 text-[11px] text-white/80">
                {editable ? (
                  <InlineText value={value} label={f.label} placeholder={f.placeholder} emptyLabel="Not set" maxLength={f.key === 'territories' ? 1000 : 200} onSave={onSave.bind(null, f.key)} />
                ) : (
                  value || <span className="text-white/40">Not set</span>
                )}
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}

// ── Gates ───────────────────────────────────────────────────────────────

function Gates({ detail, orgSlug }: { detail: Detail; orgSlug: string }) {
  const { readiness } = detail;
  return (
    <section aria-labelledby="release-gates" className={CARD} data-testid="release-gates">
      <h2 id="release-gates" className={`${LABEL} mb-3`}>Gates</h2>
      {!readiness ? (
        <p className="text-[11px] text-white/60">The gates could not be worked out: a migration this release needs is not applied.</p>
      ) : (
        <ul className="space-y-2">
          {RELEASE_GATES.map((g) => (
            <GateRow key={g} gate={g} view={readiness.gates[g]} mayReadRights={detail.me.mayReadRights} orgSlug={orgSlug} canFix={detail.me.canWrite} />
          ))}
        </ul>
      )}
    </section>
  );
}

function GateRow({ gate, view, mayReadRights, orgSlug, canFix }: { gate: ReleaseGate; view: NonNullable<Detail['readiness']>['gates'][ReleaseGate]; mayReadRights: boolean; orgSlug: string; canFix: boolean }) {
  const tone = gateTone(view.status);
  const hasDetail = view.blockerCount > 0 || view.warningCount > 0;
  return (
    <li className="flex flex-wrap items-center justify-between gap-2" data-testid={`release-gate-${gate}`} data-status={view.status}>
      <span className="text-[13px] text-white">{RELEASE_GATE_LABEL[gate]}</span>
      <span className="flex items-center gap-2">
        <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-mono uppercase tracking-[0.1em]', TONE_TEXT[tone])} data-testid={`release-gate-chip-${gate}`}>
          {gateWord(view.status)}
        </span>
        {hasDetail && (
          <Popover
            label={`${RELEASE_GATE_LABEL[gate]}: what is open`}
            width={320}
            align="right"
            trigger={({ toggle, ref, open }) => (
              <button type="button" ref={ref} onClick={toggle} aria-expanded={open} className={BTN} data-testid={`release-gate-open-${gate}`}>
                {view.blockerCount > 0 ? `${view.blockerCount} to fix` : `${view.warningCount} to check`}
              </button>
            )}
          >
            <div className="space-y-3 p-3 text-[11px]" data-testid={`release-gate-popover-${gate}`}>
              {view.blockers.length > 0 && (
                <div>
                  <p className={`${LABEL} mb-1.5`}>Blocking</p>
                  <ul className="space-y-1.5">
                    {view.blockers.map((b, i) => (
                      <li key={`${b.code}-${b.itemId ?? i}-${i}`} className="text-white/80">
                        {b.message}
                        {canFix && b.code === 'isrc' && b.songId && b.trackId && (
                          <Link
                            href={`/o/${orgSlug}/songs/${b.songId}?edit=${b.trackId}#details`}
                            className="ml-2 text-white underline decoration-white/30 underline-offset-2 hover:decoration-white"
                            data-testid={`release-fix-isrc-${b.trackId}`}
                          >
                            Add the ISRC
                          </Link>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {view.warnings.length > 0 && (
                <div>
                  <p className={`${LABEL} mb-1.5`}>To check</p>
                  <ul className="space-y-1.5">
                    {view.warnings.map((b, i) => (
                      <li key={`${b.code}-${b.itemId ?? i}-${i}`} className="text-white/60">{b.message}</li>
                    ))}
                  </ul>
                </div>
              )}
              {view.withheld > 0 && !mayReadRights && (
                <p className="text-white/40" data-testid="release-gate-withheld">
                  {view.withheld} more {view.withheld === 1 ? 'item involves' : 'items involve'} rights details you cannot read.
                </p>
              )}
            </div>
          </Popover>
        )}
      </span>
    </li>
  );
}

// ── Delivery ────────────────────────────────────────────────────────────

function Delivery({ orgId, detail, busy, act }: { orgId: string; detail: Detail; busy: boolean; act: Act }) {
  const { release, readiness, me } = detail;
  const [distributor, setDistributor] = useState('');
  const [deliveredOn, setDeliveredOn] = useState('');
  const [override, setOverride] = useState(false);
  const [note, setNote] = useState('');

  if (release.state === 'delivered') {
    return (
      <section aria-labelledby="release-delivery" className={CARD} data-testid="release-delivery">
        <h2 id="release-delivery" className={`${LABEL} mb-3`}>Delivery</h2>
        <p className="text-[13px] text-white" data-testid="release-delivered">
          Delivered{release.deliveredTo ? ` to ${release.deliveredTo}` : ''}{release.deliveredAt ? ` · ${day(release.deliveredAt)}` : ''}
        </p>
      </section>
    );
  }
  if (release.state !== 'draft') {
    return (
      <section aria-labelledby="release-delivery" className={CARD} data-testid="release-delivery">
        <h2 id="release-delivery" className={`${LABEL} mb-3`}>Delivery</h2>
        <p className="text-[11px] text-white/60">A cancelled release is not delivered. Reopen it to work on it again.</p>
      </section>
    );
  }
  if (!me.canWrite) {
    return (
      <section aria-labelledby="release-delivery" className={CARD} data-testid="release-delivery">
        <h2 id="release-delivery" className={`${LABEL} mb-3`}>Delivery</h2>
        <p className="text-[11px] text-white/60">{readiness?.readyToDeliver ? 'This release is ready to deliver.' : 'This release is not ready to deliver yet.'} Delivering needs release access.</p>
      </section>
    );
  }

  const ready = readiness?.readyToDeliver === true;
  const open = readiness ? Object.values(readiness.gates).filter((g) => !['approved', 'satisfied', 'not_required'].includes(g.status)).length : 0;
  const overriding = !ready && override;
  const problem =
    !readiness ? 'The gates could not be worked out.'
    : !distributor.trim() ? 'Name the distributor.'
    : !ready && !me.isOwner ? 'Only an owner can deliver a release that is not ready.'
    : !ready && !override ? 'Some gates are open.'
    : overriding && !note.trim() ? 'Say why it is delivered before it is ready.'
    : null;

  return (
    <section aria-labelledby="release-delivery" className={CARD} data-testid="release-delivery">
      <h2 id="release-delivery" className={`${LABEL} mb-3`}>Delivery</h2>
      <p className="mb-3 text-[11px] text-white/60" data-testid="release-delivery-readiness">
        {ready ? 'Every gate is satisfied.' : readiness ? `${open} ${open === 1 ? 'gate is' : 'gates are'} still open.` : 'Readiness is not available.'}
      </p>
      <div className="space-y-2">
        <label className="block">
          <span className={LABEL}>Distributor</span>
          <input className={`${FIELD} mt-1`} value={distributor} maxLength={120} onChange={(e) => setDistributor(e.target.value)} placeholder="Who it was sent to" data-testid="release-distributor" />
        </label>
        <label className="block">
          <span className={LABEL}>Delivered on</span>
          <input className={`${FIELD} mt-1`} type="date" value={deliveredOn} onChange={(e) => setDeliveredOn(e.target.value)} data-testid="release-delivered-on" />
          <span className="mt-1 block text-[10px] text-white/40">Leave blank for today.</span>
        </label>
        {!ready && me.isOwner && (
          <div className="rounded-lg border border-white/10 p-3">
            <label className="flex items-center gap-2 text-[11px] text-white/80">
              <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} data-testid="release-override" />
              Deliver anyway, as an owner
            </label>
            {override && (
              <label className="mt-2 block">
                <span className={LABEL}>Why</span>
                <textarea className={`${FIELD} mt-1`} rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Recorded with the delivery." data-testid="release-override-note" />
              </label>
            )}
          </div>
        )}
        <button
          type="button"
          className={BTN}
          disabled={busy || problem !== null}
          title={problem ?? undefined}
          data-testid="release-deliver"
          onClick={() =>
            void act(
              () => deliverRelease(orgId, release.id, { distributor: distributor.trim(), deliveredOn: deliveredOn || undefined, override: overriding, overrideNote: note }),
              'Release delivered',
            )
          }
        >
          {overriding ? 'Deliver anyway' : 'Mark delivered'}
        </button>
        {problem && <p className="text-[10px] text-white/40" data-testid="release-deliver-reason">{problem}</p>}
      </div>
    </section>
  );
}
