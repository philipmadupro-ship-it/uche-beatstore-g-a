'use client';

/**
 * "My beats" on /store/account/me — the buyer's own library of beats, in the
 * shape the producer's Library uses: one flat list, filter, sort, play, and
 * select-to-act.
 *
 * Two kinds of row (see lib/store/buyer-workspace.ts): **owned** (a license or
 * a bundle track) and **requested** (an offer made on a beat). Everything about
 * which rows exist, how they filter and sort, and which can play or be added to
 * a project is decided in that pure module; this file only draws it.
 *
 * "Create project" is a buyer playlist made from the selection
 * (`create_playlist` + `track_ids` on `/api/store/me`), so it lands in
 * "Projects" below and follows the buyer across devices.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Download, FolderPlus, Loader2, Music, Pause, Play, Search, X } from 'lucide-react';
import { Checkbox } from '@/components/ui/Checkbox';
import { Dropdown } from '@/components/ui/Dropdown';
import { ArtworkFallback } from '@/components/ui/ArtworkFallback';
import { toast } from '@/hooks/useToast';
import { usePlayer } from '@/hooks/usePlayer';
import {
  BUYER_PROJECT_MAX_TRACKS,
  beatToPlayerTrack,
  describeOwnedSound,
  filterBuyerBeats,
  formatBeatKey,
  ownedSound,
  projectTrackIds,
  sortBuyerBeats,
  type BuyerBeat,
  type BuyerBeatSort,
  type BuyerBeatStatusFilter,
} from '@/lib/store/buyer-workspace';

const BEATS_URL = '/api/store/me?session=1';

const STATUS_OPTIONS: Array<{ value: BuyerBeatStatusFilter; label: string }> = [
  { value: 'all', label: 'All beats' },
  { value: 'owned', label: 'Owned' },
  { value: 'requested', label: 'Requested' },
];

const SORT_OPTIONS: Array<{ value: BuyerBeatSort; label: string }> = [
  { value: 'recent', label: 'Newest' },
  { value: 'title', label: 'Title' },
  { value: 'bpm', label: 'BPM' },
  { value: 'key', label: 'Key' },
];

function metaLine(b: BuyerBeat): string {
  const parts = [
    b.bpm ? `${b.bpm} BPM` : null,
    formatBeatKey(b.key, b.scale),
    b.type,
  ].filter(Boolean);
  return parts.join(' · ') || (b.available ? 'Beat' : 'No longer listed');
}

function statusLabel(b: BuyerBeat): string {
  if (b.status === 'owned') {
    return b.license ? `Owned · ${b.license.charAt(0).toUpperCase()}${b.license.slice(1)}` : 'Owned';
  }
  const price = b.offer ? `$${b.offer.price_usd.toLocaleString('en-US', { maximumFractionDigits: 2 })}` : '';
  return `Offer ${price} · ${b.offer?.status ?? 'pending'}`.replace('  ', ' ');
}

async function readError(res: Response): Promise<string> {
  const j = await res.json().catch(() => ({}));
  return (j as { error?: string }).error ?? `HTTP ${res.status}`;
}

export function BuyerBeatsWorkspace() {
  const queryClient = useQueryClient();
  const { currentTrack, isPlaying, setTrack, setQueue, togglePlay } = usePlayer();

  const [status, setStatus] = useState<BuyerBeatStatusFilter>('all');
  const [sort, setSort] = useState<BuyerBeatSort>('recent');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [projectName, setProjectName] = useState('');

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['buyerMeBeats'],
    queryFn: async () => {
      const res = await fetch(`${BEATS_URL}&view=beats`);
      if (!res.ok) throw new Error(await readError(res));
      const j = (await res.json()) as { beats?: BuyerBeat[] };
      return Array.isArray(j.beats) ? j.beats : [];
    },
    retry: false,
  });

  const beats = useMemo(() => data ?? [], [data]);
  const visible = useMemo(
    () => sortBuyerBeats(filterBuyerBeats(beats, { status, query }), sort),
    [beats, status, query, sort],
  );
  const sound = useMemo(() => describeOwnedSound(ownedSound(beats)), [beats]);

  // The project keeps the order the buyer sees (their sort), not the server's.
  const chosen = useMemo(
    () => projectTrackIds(sortBuyerBeats(beats, sort), selected),
    [beats, selected, sort],
  );
  const selectableVisible = visible.filter((b) => b.canAddToProject);
  const allVisibleChosen = selectableVisible.length > 0 && selectableVisible.every((b) => selected.has(b.id));
  const someVisibleChosen = selectableVisible.some((b) => selected.has(b.id));

  const toggle = (id: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleAllVisible = () => setSelected((prev) => {
    const next = new Set(prev);
    if (allVisibleChosen) selectableVisible.forEach((b) => next.delete(b.id));
    else selectableVisible.forEach((b) => next.add(b.id));
    return next;
  });

  const play = (beat: BuyerBeat) => {
    const track = beatToPlayerTrack(beat);
    if (!track) return;
    if (currentTrack?.id === beat.id) { togglePlay(); return; }
    setQueue(visible.map(beatToPlayerTrack).filter((t): t is NonNullable<typeof t> => t !== null));
    setTrack(track);
  };

  const createProject = useMutation({
    mutationFn: async (input: { name: string; track_ids: string[] }) => {
      const res = await fetch(BEATS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create_playlist', ...input }),
      });
      if (!res.ok) throw new Error(await readError(res));
    },
    onSuccess: (_d, input) => {
      toast.success('Project created', `${input.track_ids.length} beat${input.track_ids.length === 1 ? '' : 's'} saved under Projects.`);
      setSelected(new Set());
      setProjectName('');
      void queryClient.invalidateQueries({ queryKey: ['buyerMeLibrary'] });
    },
    onError: (e: Error) => toast.error('Could not create project', e.message),
  });

  const submitProject = () => {
    const name = projectName.trim();
    if (!name || chosen.length === 0 || createProject.isPending) return;
    createProject.mutate({ name, track_ids: chosen });
  };

  const filtersActive = status !== 'all' || query.trim() !== '';

  return (
    <section className="mt-10" aria-labelledby="my-beats-heading">
      <h2 id="my-beats-heading" className="text-[10px] font-mono uppercase tracking-[0.25em] text-white/80 mb-1 flex items-center gap-2">
        <Music size={11} />
        My beats{beats.length > 0 ? ` (${beats.length})` : ''}
      </h2>
      {sound && <p className="text-[11px] text-white/60 mb-3">Your sound · {sound}</p>}

      {isLoading ? (
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-5 py-8 flex justify-center" role="status" aria-label="Loading your beats">
          <Loader2 size={16} className="animate-spin text-white/40" />
        </div>
      ) : isError ? (
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-5 py-6 text-center" role="alert">
          <AlertCircle size={20} className="text-red-400 mx-auto mb-2" />
          <p className="text-[11px] text-white mb-1">Couldn&apos;t load your beats</p>
          <p className="text-[11px] text-white/60 mb-4">{(error as Error)?.message}</p>
          <button
            type="button"
            onClick={() => void refetch()}
            disabled={isFetching}
            className="text-[10px] font-mono uppercase tracking-wider px-4 py-2 rounded-lg border border-white/10 bg-white/[0.06] text-white hover:bg-white/[0.10] hover:border-white/20 transition-colors disabled:opacity-40"
          >
            Try again
          </button>
        </div>
      ) : beats.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-6 py-10 text-center">
          <Music size={22} className="text-white/40 mx-auto mb-2" />
          <p className="text-[13px] text-white font-medium mb-1">No beats yet</p>
          <p className="text-[11px] text-white/60 max-w-md mx-auto mb-4">
            Beats you license, and beats you make an offer on, collect here so you can play and group them.
          </p>
          <Link
            href="/store"
            className="inline-block text-[10px] font-mono uppercase tracking-wider px-4 py-2 rounded-lg bg-white text-black hover:bg-white/90 transition-colors"
          >
            Browse beats
          </Link>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <label className="relative flex-1 min-w-[160px]">
              <span className="sr-only">Search my beats</span>
              <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none" aria-hidden="true" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search title, key, BPM"
                className="w-full bg-[#090907] border border-white/10 rounded-lg pl-8 pr-3 py-2 text-[11px] text-white placeholder:text-white/40 focus:outline-none focus:border-white/20"
              />
            </label>
            <Dropdown<BuyerBeatStatusFilter>
              value={status}
              onChange={setStatus}
              options={STATUS_OPTIONS}
              aria-label="Filter beats"
              className="w-[130px]"
            />
            <Dropdown<BuyerBeatSort>
              value={sort}
              onChange={setSort}
              options={SORT_OPTIONS}
              label="Sort:"
              aria-label="Sort beats"
              align="right"
              className="w-[140px]"
            />
          </div>

          {selectableVisible.length > 0 && (
            <label className="flex items-center gap-2 px-1 mb-2 text-[10px] font-mono uppercase tracking-wider text-white/60 cursor-pointer w-fit">
              <Checkbox
                checked={allVisibleChosen}
                indeterminate={!allVisibleChosen && someVisibleChosen}
                onChange={toggleAllVisible}
                aria-label="Select all shown beats"
              />
              Select all shown
            </label>
          )}

          {visible.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-5 py-8 text-center">
              <p className="text-[11px] text-white/60 mb-3">No beats match.</p>
              {filtersActive && (
                <button
                  type="button"
                  onClick={() => { setStatus('all'); setQuery(''); }}
                  className="text-[10px] font-mono uppercase tracking-wider px-3 py-1.5 rounded-lg border border-white/10 bg-white/[0.06] text-white hover:bg-white/[0.10] hover:border-white/20 transition-colors"
                >
                  Clear filters
                </button>
              )}
            </div>
          ) : (
            <ul className="space-y-2">
              {visible.map((b) => {
                const isCurrent = currentTrack?.id === b.id;
                const showPause = isCurrent && isPlaying;
                return (
                  <li
                    key={b.id}
                    className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors ${
                      isCurrent ? 'border-white/20 bg-white/[0.08]' : 'border-white/10 bg-white/[0.04]'
                    }`}
                  >
                    {b.canAddToProject ? (
                      <Checkbox
                        checked={selected.has(b.id)}
                        onChange={() => toggle(b.id)}
                        aria-label={`Select ${b.title}`}
                      />
                    ) : (
                      <span className="size-4 shrink-0" aria-hidden="true" />
                    )}

                    <div className="relative size-12 shrink-0 overflow-hidden rounded-lg border border-white/10 bg-[#090907]">
                      {b.available ? (
                        <ArtworkFallback src={b.cover_url} seed={b.id} kind="track" sizes="48px" className="object-cover">
                          <Music size={13} aria-hidden="true" />
                        </ArtworkFallback>
                      ) : (
                        <div className="size-full grid place-items-center text-white/40"><Music size={13} aria-hidden="true" /></div>
                      )}
                      {b.playable && (
                        <button
                          type="button"
                          onClick={() => play(b)}
                          aria-label={`${showPause ? 'Pause' : 'Play'} ${b.title}`}
                          aria-pressed={showPause}
                          className="absolute inset-0 grid place-items-center bg-black/45 text-white transition-colors hover:bg-black/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                        >
                          {showPause
                            ? <Pause size={14} fill="currentColor" />
                            : <Play size={14} fill="currentColor" className="ml-0.5" />}
                        </button>
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      {b.listed ? (
                        <Link href={`/store/${b.id}`} className="block truncate text-[11px] font-medium text-white hover:underline underline-offset-2">
                          {b.title}
                        </Link>
                      ) : (
                        <p className="truncate text-[11px] font-medium text-white">{b.title}</p>
                      )}
                      <p className="mt-0.5 truncate text-[10px] font-mono text-white/45">{metaLine(b)}</p>
                      <p className={`mt-0.5 truncate text-[10px] font-mono ${b.status === 'owned' ? 'text-[#6DC6A4]' : 'text-white/60'}`}>
                        {statusLabel(b)}
                      </p>
                    </div>

                    {b.status === 'owned' && b.openUrl && (
                      <a
                        href={b.openUrl}
                        className="flex shrink-0 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2 text-[10px] font-mono uppercase tracking-wider text-white transition-colors hover:border-white/20 hover:bg-white/[0.10]"
                      >
                        <Download size={11} aria-hidden="true" />
                        Open
                      </a>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {chosen.length > 0 && (
            <form
              onSubmit={(e) => { e.preventDefault(); submitProject(); }}
              className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-white/20 bg-white/[0.06] px-3 py-2.5"
              aria-label="Create a project from the selected beats"
            >
              <span className="text-[10px] font-mono uppercase tracking-wider text-white/80 tabular-nums">
                {chosen.length} selected
              </span>
              <input
                type="text"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="Project name"
                maxLength={80}
                aria-label="Project name"
                className="flex-1 min-w-[140px] bg-[#090907] border border-white/10 rounded-lg px-3 py-2 text-[11px] text-white placeholder:text-white/40 focus:outline-none focus:border-white/20"
              />
              <button
                type="submit"
                disabled={!projectName.trim() || createProject.isPending}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white text-black text-[11px] font-bold uppercase tracking-wider hover:bg-white/90 transition-colors disabled:opacity-40"
              >
                {createProject.isPending ? <Loader2 size={11} className="animate-spin" /> : <FolderPlus size={11} />}
                Create project
              </button>
              <button
                type="button"
                onClick={() => setSelected(new Set())}
                aria-label="Clear selection"
                className="grid size-8 place-items-center rounded-lg text-white/60 hover:text-white hover:bg-white/[0.06] transition-colors"
              >
                <X size={13} />
              </button>
              {selected.size > BUYER_PROJECT_MAX_TRACKS && (
                <p className="basis-full text-[10px] text-white/60">
                  A project holds up to {BUYER_PROJECT_MAX_TRACKS} beats; the first {BUYER_PROJECT_MAX_TRACKS} are used.
                </p>
              )}
            </form>
          )}
        </>
      )}
    </section>
  );
}
