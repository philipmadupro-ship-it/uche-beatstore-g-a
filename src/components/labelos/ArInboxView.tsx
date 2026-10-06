'use client';

/**
 * The A&R inbox (LABEL-25, 07 §2.4, 04 W3): the songs waiting for a decision,
 * oldest first, worked from the keyboard.
 *
 *   J / K next and previous · Space play · 1–5 rate · R start review ·
 *   S shortlist · H hold · P pass · C note · X select
 *
 * What a key does is `inboxKeyAction` (pure, tested); whether a stage key is
 * allowed is `offeredStageKeys`, which is LABEL-24's transition table for this
 * member — the inbox re-implements none of it. A stage move leaves the inbox
 * stages, so the row goes and the cursor moves on. Selecting rows (X, or the
 * box) opens the bulk bar. Reviews are MY review (`PUT …/reviews`); everyone's
 * ratings for the focused song are listed under it, which is what the song's
 * own artist reads too (D5). The shortcuts listen on `document`, before the
 * player's own window listener, and claim the keys they handle with
 * preventDefault so Space and P do not also drive the transport.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Check, Music, Pause, Play } from 'lucide-react';
import { ArtworkFallback } from '@/components/ui/ArtworkFallback';
import { BatchActionBar } from '@/components/ui/BatchActionBar';
import { Dropdown } from '@/components/ui/Dropdown';
import { toast } from '@/hooks/useToast';
import { usePlayer } from '@/hooks/usePlayer';
import { useOrgShell } from '@/components/labelos/OrgShellContext';
import type { ArInbox, ArInboxSong } from '@/lib/labelos/ar-inbox-store';
import { SONG_STAGE_LABEL, isSongStage, type SongStage } from '@/lib/labelos/song-stage';
import { postSongStage } from '@/lib/labelos/song-stage-client';
import { fetchInbox, putReview } from '@/lib/labelos/song-review-client';
import {
  NOTE_MAX,
  RATINGS,
  REVIEW_VERDICTS,
  REVIEW_VERDICT_LABEL,
  cursorAfterRemoval,
  inboxKeyAction,
  isReviewVerdict,
  offeredStageKeys,
  type InboxAction,
  type ReviewPatch,
} from '@/lib/labelos/song-review';
import { orgAudioUrl } from '@/lib/labelos/org-workspace';
import type { Track } from '@/lib/types';

const LABEL = 'text-[10px] font-mono uppercase tracking-[0.2em] text-white/40';
const CHIP = 'rounded-lg border px-2 py-0.5 text-[11px] transition-colors';
const CHIP_REST = 'border-white/10 bg-white/[0.06] text-white/60 hover:border-white/20 hover:bg-white/[0.10]';
const CHIP_ON = 'border-white/30 bg-white/[0.14] text-white';

type ReviewRow = { reviewerId: string; reviewer: string; rating: number | null; verdict: string | null; note: string | null; mine: boolean };

function playerTrack(orgId: string, s: ArInboxSong): Track {
  return {
    id: s.id,
    user_id: '',
    title: s.title ?? 'Untitled',
    type: 'song',
    audio_url: orgAudioUrl(orgId, s.id),
    preview_url: null,
    peaks_url: null,
    bands_url: null,
    cover_url: s.cover_url,
    duration_seconds: s.duration_seconds,
    bpm: s.bpm,
    key: s.key,
    stems_status: 'none',
    created_at: '',
  } as Track;
}

function isTyping(el: EventTarget | null): boolean {
  const node = el as HTMLElement | null;
  return !!node && (node.tagName === 'INPUT' || node.tagName === 'TEXTAREA' || node.tagName === 'SELECT' || node.isContentEditable);
}

export function ArInboxView({ orgId, orgSlug }: { orgId: string; orgSlug: string }) {
  const shell = useOrgShell();
  const router = useRouter();
  const caps = useMemo(() => new Set(shell?.capabilities ?? []), [shell]);
  const role = shell?.role;
  const [inbox, setInbox] = useState<ArInbox | null>(null);
  const [failed, setFailed] = useState(false);
  const [cursor, setCursorState] = useState<string | null>(null);
  const setCursor = useCallback((id: string | null) => { cursorRef.current = id; setCursorState(id); }, []);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // The note editor and the loaded reviews belong to ONE song: keyed by its id, they are gone the moment the cursor moves on.
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [reviewsTick, setReviewsTick] = useState(0);
  const [loaded, setLoaded] = useState<{ forId: string; rows: ReviewRow[] } | null>(null);
  const currentId = usePlayer((s) => s.currentTrack?.id ?? null);
  const isPlaying = usePlayer((s) => s.isPlaying);
  const noteRef = useRef<HTMLTextAreaElement | null>(null);
  // Escape and Ctrl+Enter unmount the textarea, and a removed focused element blurs: that blur must not save a second time (or save what Escape just abandoned).
  const noteClosed = useRef(false);
  // Stage moves run one after another, each judged against the songs as the one before left them (a quick R then S must not read a stale stage).
  const chain = useRef<Promise<void>>(Promise.resolve());
  const latest = useRef<ArInboxSong[]>([]);
  // The cursor, readable by a key pressed before React has re-rendered the one before it (J then Space in the same tick).
  const cursorRef = useRef<string | null>(null);

  const songs = useMemo(() => inbox?.songs ?? [], [inbox]);
  useEffect(() => { latest.current = songs; }, [songs]);
  const canReview = inbox?.canReview ?? false;
  const focused = songs.find((s) => s.id === cursor) ?? null;
  const editingNote = noteFor !== null && noteFor === cursor;
  const reviews = loaded && loaded.forId === cursor ? loaded.rows : null;

  const reloadSeq = useRef(0);
  const reload = useCallback(async (keep?: { removed?: ReadonlySet<string> }) => {
    const seq = ++reloadSeq.current;
    const before = latest.current.map((s) => s.id);
    const next = await fetchInbox(orgId);
    // An older answer must never replace a newer one (two reloads can resolve out of order).
    if (seq !== reloadSeq.current) return;
    if (!next) { setFailed(true); return; }
    setFailed(false);
    const gone = keep?.removed ?? new Set(before.filter((id) => !next.songs.some((s) => s.id === id)));
    setCursor(cursorAfterRemoval(before, cursorRef.current, gone) ?? next.songs[0]?.id ?? null);
    latest.current = next.songs;
    setInbox(next);
    setSelected((sel) => new Set([...sel].filter((id) => next.songs.some((s) => s.id === id))));
  }, [orgId, setCursor]);

  useEffect(() => {
    let cancelled = false;
    fetchInbox(orgId).then((next) => {
      if (cancelled) return;
      if (!next) { setFailed(true); return; }
      latest.current = next.songs;
      setInbox(next);
      setCursor(next.songs[0]?.id ?? null);
    });
    return () => { cancelled = true; };
  }, [orgId]);

  // Everyone's reviews of the focused song (what its artist reads too).
  useEffect(() => {
    if (!cursor) return;
    let cancelled = false;
    fetch(`/api/org/${orgId}/tracks/${cursor}/reviews`, { cache: 'no-store' })
      .then(async (res) => (res.ok ? ((await res.json()) as { reviews: ReviewRow[] }).reviews : []))
      .then((rows) => { if (!cancelled) setLoaded({ forId: cursor, rows }); })
      .catch(() => { if (!cancelled) setLoaded({ forId: cursor, rows: [] }); });
    return () => { cancelled = true; };
  }, [orgId, cursor, reviewsTick]);

  useEffect(() => {
    if (!cursor) return;
    document.querySelector(`[data-song-row="${cursor}"]`)?.scrollIntoView?.({ block: 'nearest' });
  }, [cursor]);

  useEffect(() => {
    if (editingNote) noteRef.current?.focus();
  }, [editingNote]);

  const runSave = useCallback(async (songId: string, patch: ReviewPatch) => {
    // Show it at once, from the song as the saves before this one left it; the reload brings the server's word and the new summary.
    const apply = (list: ArInboxSong[]) => list.map((s) => (s.id === songId ? { ...s, mine: { rating: s.mine?.rating ?? null, verdict: s.mine?.verdict ?? null, note: s.mine?.note ?? null, ...patch } } : s));
    latest.current = apply(latest.current);
    setInbox((prev) => prev && { ...prev, songs: apply(prev.songs) });
    const res = await putReview(orgId, songId, patch);
    if (!res.ok) toast.error(res.error);
    setReviewsTick((n) => n + 1);
    await reload();
  }, [orgId, reload]);

  const saveReview = useCallback((song: ArInboxSong, patch: ReviewPatch) => {
    if (!canReview) { toast.error('You can read reviews but not add one.'); return Promise.resolve(); }
    // Saves and stage moves share one queue: each starts when the one before has answered.
    chain.current = chain.current.then(() => runSave(song.id, patch)).catch(() => undefined);
    return chain.current;
  }, [canReview, runSave]);

  const runMove = useCallback(async (ids: readonly string[], to: SongStage) => {
    const targets = latest.current.filter((s) => ids.includes(s.id));
    const allowed = targets.filter((s) => offeredStageKeys(s.stage, caps, role).includes(to));
    if (allowed.length === 0) {
      toast.error(`${targets.length === 1 ? 'This song' : 'These songs'} cannot move to ${SONG_STAGE_LABEL[to]} from ${targets.length === 1 && isSongStage(targets[0].stage) ? SONG_STAGE_LABEL[targets[0].stage] : 'where they are'}.`);
      return;
    }
    setBusy(true);
    const results = await Promise.all(allowed.map(async (s) => ({ s, res: await postSongStage(orgId, s.id, to, s.stage as SongStage) })));
    setBusy(false);
    const done = results.filter((r) => r.res.ok);
    const failedMoves = results.filter((r) => !r.res.ok);
    if (failedMoves.length > 0) toast.error(failedMoves.length === 1 ? (failedMoves[0].res as { error: string }).error : `${failedMoves.length} songs could not be moved.`);
    if (done.length > 0) {
      const skipped = targets.length - allowed.length;
      toast.success(`${done.length} ${done.length === 1 ? 'song' : 'songs'} moved to ${SONG_STAGE_LABEL[to]}${skipped > 0 ? ` · ${skipped} not allowed` : ''}`);
      setSelected(new Set());
      // Apply the new stage at once: a quick next key (R, then S) must judge the song by where it is NOW, not by the last fetch.
      const moved = new Map(done.map((r) => [r.s.id, (r.res as { stage: SongStage }).stage]));
      latest.current = latest.current.map((x) => (moved.has(x.id) ? { ...x, stage: moved.get(x.id)! } : x));
      setInbox((prev) => prev && { ...prev, songs: prev.songs.map((x) => (moved.has(x.id) ? { ...x, stage: moved.get(x.id)! } : x)) });
      await reload({ removed: new Set(done.filter((r) => r.res.ok && !['inbox', 'in_review'].includes((r.res as { stage: string }).stage)).map((r) => r.s.id)) });
      // The workspace's stage counts live in the server-rendered pages: refresh them too.
      router.refresh();
    }
  }, [caps, orgId, reload, role, router]);

  const moveStage = useCallback((ids: readonly string[], to: SongStage) => {
    chain.current = chain.current.then(() => runMove(ids, to)).catch(() => undefined);
    return chain.current;
  }, [runMove]);

  const togglePlay = useCallback((s: ArInboxSong) => {
    if (currentId === s.id) usePlayer.getState().togglePlay();
    else usePlayer.getState().setTrack(playerTrack(orgId, s));
  }, [currentId, orgId]);

  const act = useCallback((a: InboxAction) => {
    const list = latest.current;
    const at = list.findIndex((s) => s.id === cursorRef.current);
    const focused = at >= 0 ? list[at] : null;
    switch (a.kind) {
      case 'move': {
        if (list.length === 0) return;
        const next = Math.min(list.length - 1, Math.max(0, (at < 0 ? (a.delta > 0 ? -1 : list.length) : at) + a.delta));
        setCursor(list[next].id);
        return;
      }
      case 'play': if (focused) togglePlay(focused); return;
      case 'rate': if (focused) void saveReview(focused, { rating: a.value }); return;
      case 'stage': if (focused) void moveStage(selected.size > 0 ? [...selected] : [focused.id], a.to); return;
      case 'comment':
        if (!focused) return;
        if (!canReview) { toast.error('You can read reviews but not add one.'); return; }
        setNoteDraft(focused.mine?.note ?? '');
        noteClosed.current = false;
        setNoteFor(focused.id);
        return;
      case 'select':
        if (focused) setSelected((sel) => { const n = new Set(sel); if (n.has(focused.id)) n.delete(focused.id); else n.add(focused.id); return n; });
        return;
    }
  }, [selected, canReview, saveReview, moveStage, togglePlay, setCursor]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const target = e.target as HTMLElement | null;
      const el = target && typeof target.closest === 'function' ? target : null;
      // Space and Enter belong to a focused button, link or menu item; every other key is ours.
      if ((e.key === ' ' || e.key === 'Enter') && el?.closest('button, a, [role="menu"], [role="menuitem"], [role="dialog"]')) return;
      if (el?.closest('[role="menu"], [role="dialog"], [role="listbox"]')) return;
      const action = inboxKeyAction({ key: e.key, shiftKey: e.shiftKey, altKey: e.altKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey, typing: isTyping(e.target) });
      if (!action) return;
      e.preventDefault();
      act(action);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [act]);

  const saveNote = async () => {
    if (!focused || noteClosed.current) return;
    noteClosed.current = true;
    setNoteFor(null);
    const next = noteDraft.trim();
    if (next === (focused.mine?.note ?? '')) return;
    await saveReview(focused, { note: next === '' ? null : next });
  };

  if (failed && !inbox) return <p className="rounded-xl border border-white/10 bg-[#0D0D0A] px-4 py-8 text-center text-[11px] text-white/60" data-testid="ar-failed">Could not load the inbox. Reload to try again.</p>;
  if (!inbox) return <p className="text-[11px] text-white/40" data-testid="ar-loading">Loading the inbox…</p>;

  const offered = focused ? offeredStageKeys(focused.stage, caps, role) : [];
  const bulkAction = (to: SongStage, label: string) => ({ label, onClick: () => void moveStage([...selected], to) });

  return (
    <div className="space-y-6" data-testid="ar-inbox">
      <p className="text-[11px] leading-relaxed text-white/60" data-testid="ar-hints">
        <span className="font-mono">J</span> / <span className="font-mono">K</span> move · <span className="font-mono">Space</span> play · <span className="font-mono">1</span>–<span className="font-mono">5</span> rate ·{' '}
        <span className="font-mono">R</span> start review · <span className="font-mono">S</span> shortlist · <span className="font-mono">H</span> hold · <span className="font-mono">P</span> pass ·{' '}
        <span className="font-mono">C</span> note · <span className="font-mono">X</span> select
      </p>

      {songs.length === 0 ? (
        <p className="rounded-xl border border-white/10 bg-[#0D0D0A] px-4 py-8 text-center text-[11px] text-white/40" data-testid="ar-empty">
          Nothing is waiting for review.{inbox.restricted > 0 ? ` ${inbox.restricted} more ${inbox.restricted === 1 ? 'song is' : 'songs are'} restricted for your role.` : ''}
        </p>
      ) : (
        <ul className="divide-y divide-white/10 overflow-hidden rounded-xl border border-white/10 bg-[#0D0D0A]" aria-label="Songs to review" data-testid="ar-list">
          {songs.map((s) => {
            const on = s.id === cursor;
            const playing = currentId === s.id && isPlaying;
            const stageLabel = isSongStage(s.stage) ? SONG_STAGE_LABEL[s.stage] : s.stage;
            return (
              <li key={s.id} data-song-row={s.id} data-stage={s.stage} aria-current={on ? 'true' : undefined} className={`${on ? 'bg-white/[0.06]' : ''} px-3 py-3 sm:px-4`}>
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={selected.has(s.id)}
                    onChange={() => setSelected((sel) => { const n = new Set(sel); if (n.has(s.id)) n.delete(s.id); else n.add(s.id); return n; })}
                    aria-label={`Select ${s.title ?? 'Untitled'}`}
                    className="h-4 w-4 shrink-0 accent-white"
                  />
                  <button type="button" onClick={() => { setCursor(s.id); togglePlay(s); }} aria-label={`${playing ? 'Pause' : 'Play'} ${s.title ?? 'Untitled'}`} className="relative h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-white/[0.06]">
                    <ArtworkFallback src={s.cover_url} seed={s.id} kind="track" sizes="40px" className="object-cover"><Music size={14} className="text-white/30" aria-hidden="true" /></ArtworkFallback>
                    <span className="absolute inset-0 grid place-items-center bg-black/40 text-white">{playing ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}</span>
                  </button>
                  <button type="button" onClick={() => setCursor(s.id)} className="min-w-0 flex-1 text-left" data-testid="ar-row-select">
                    <span className="block truncate text-[13px] text-white/80">{s.title ?? 'Untitled'}</span>
                    <span className="block truncate text-[11px] text-white/40">{s.artist?.name ?? 'No artist'}{s.project ? ` · ${s.project.name}` : ''}</span>
                  </button>
                  <span className={`${CHIP} ${CHIP_REST} hidden shrink-0 sm:inline`} data-testid="ar-stage">{stageLabel}</span>
                  <span className="shrink-0 font-mono text-[11px] tabular-nums text-white/60" data-testid="ar-summary" title="Average of every reviewer's rating">
                    {s.summary.average !== null ? `${s.summary.average.toFixed(1)} · ${s.summary.rated}` : '—'}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 pl-7 sm:pl-[3.25rem]">
                  <span className={LABEL}>{canReview ? 'My rating' : 'Ratings'}</span>
                  {canReview && RATINGS.map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => { setCursor(s.id); void saveReview(s, { rating: n }); }}
                      aria-label={`Rate ${s.title ?? 'Untitled'} ${n} of 5`}
                      aria-pressed={s.mine?.rating === n}
                      className={`${CHIP} ${s.mine?.rating === n ? CHIP_ON : CHIP_REST}`}
                      data-testid={`ar-rate-${n}`}
                    >{n}</button>
                  ))}
                  {s.mine?.verdict && <span className={`${CHIP} ${CHIP_REST}`} data-testid="ar-my-verdict">{isReviewVerdict(s.mine.verdict) ? REVIEW_VERDICT_LABEL[s.mine.verdict] : s.mine.verdict}</span>}
                  {s.mine?.note && <span className="text-[11px] text-white/40" data-testid="ar-has-note">note</span>}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {focused && (
        <section className="space-y-3 rounded-xl border border-white/10 bg-[#0D0D0A] p-4" aria-label={`Reviews of ${focused.title ?? 'Untitled'}`} data-testid="ar-detail">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-[13px] text-white/80">{focused.title ?? 'Untitled'}</h2>
            <Link href={`/o/${orgSlug}/songs/${focused.id}`} className="text-[11px] text-white/60 hover:text-white">Open song</Link>
          </div>
          {canReview && (
            <div className="flex flex-wrap items-center gap-2">
              <span className={LABEL}>Verdict</span>
              <Dropdown<string>
                value={focused.mine?.verdict ?? ''}
                placeholder="Choose a verdict"
                aria-label="My verdict"
                options={REVIEW_VERDICTS.map((v) => ({ value: v, label: REVIEW_VERDICT_LABEL[v] }))}
                onChange={(v) => { if (isReviewVerdict(v)) void saveReview(focused, { verdict: v }); }}
              />
              {offered.length > 0 && <span className="text-[11px] text-white/40" data-testid="ar-offered">Keys now: {offered.map((s) => SONG_STAGE_LABEL[s]).join(' · ')}</span>}
            </div>
          )}
          {editingNote && (
            <div className="space-y-2">
              <textarea
                ref={noteRef}
                value={noteDraft}
                maxLength={NOTE_MAX}
                onChange={(e) => setNoteDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') { e.preventDefault(); noteClosed.current = true; setNoteFor(null); }
                  else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void saveNote(); }
                }}
                onBlur={() => void saveNote()}
                rows={3}
                aria-label="My note"
                placeholder="A note for this song. Its artist reads it too."
                className="w-full rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2 text-[13px] text-white/80 outline-none focus:border-white/30"
                data-testid="ar-note"
              />
              <p className="text-[10px] text-white/40">Ctrl or Cmd + Enter saves · Escape cancels</p>
            </div>
          )}
          {reviews === null ? (
            <p className="text-[11px] text-white/40">Loading reviews…</p>
          ) : reviews.length === 0 ? (
            <p className="text-[11px] text-white/40" data-testid="ar-no-reviews">No reviews yet.</p>
          ) : (
            <ul className="space-y-2" data-testid="ar-reviews">
              {reviews.map((r) => (
                <li key={r.reviewerId} className="text-[11px] text-white/60" data-testid="ar-review">
                  <span className="text-white/80">{r.mine ? 'You' : r.reviewer}</span>
                  {r.rating !== null && <span className="ml-2 font-mono tabular-nums">{r.rating} of 5</span>}
                  {r.verdict && isReviewVerdict(r.verdict) && <span className="ml-2">{REVIEW_VERDICT_LABEL[r.verdict]}</span>}
                  {r.note && <p className="mt-1 whitespace-pre-wrap text-white/60">{r.note}</p>}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {canReview && (
        <BatchActionBar
          count={selected.size}
          noun={['song', 'songs']}
          onClear={() => setSelected(new Set())}
          busy={busy}
          actions={[
            { ...bulkAction('in_review', 'Start review'), icon: <Check size={12} aria-hidden="true" /> },
            bulkAction('shortlisted', 'Shortlist'),
            bulkAction('on_hold', 'Hold'),
            bulkAction('passed', 'Pass'),
          ]}
        />
      )}
    </div>
  );
}
