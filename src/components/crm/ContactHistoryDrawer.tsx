'use client';

import { useEffect, useState, useMemo } from 'react';
import {
  Send, Mail, Clock, CheckCircle, ArrowUpRight, XCircle, Music, ExternalLink, Loader2, ChevronDown,
} from 'lucide-react';
import { BeatSend, Contact, Track } from '@/lib/types';
import { toast } from '@/hooks/useToast';
import { Button } from '@/components/ui/Button';
import { Drawer } from '@/components/ui/Drawer';
import { EmptyState } from '@/components/ui/EmptyState';

// Module-level cache so re-opening the drawer (or opening it on
// successive contacts in one session) doesn't refetch the whole
// /api/tracks list every time. 60s TTL — long enough to skip the
// duplicate cost when the user clicks through 4 contacts in 5 seconds,
// short enough that fresh uploads land in the lookup within a minute.
let _tracksCache: { at: number; promise: Promise<Track[]> } | null = null;
const TRACKS_CACHE_TTL_MS = 60_000;

function loadTracksCached(): Promise<Track[]> {
  if (_tracksCache && Date.now() - _tracksCache.at < TRACKS_CACHE_TTL_MS) {
    return _tracksCache.promise;
  }
  const promise = fetch('/api/tracks')
    .then((r) => (r.ok ? r.json() : []))
    .then((data) => (Array.isArray(data) ? data : data.tracks || []))
    .catch(() => []);
  _tracksCache = { at: Date.now(), promise };
  return promise;
}

interface Props {
  contact: Contact;
  /** Beat-sends already filtered to this contact by the parent. */
  sends: BeatSend[];
  onClose: () => void;
  onSendAgain: () => void;
}

/**
 * Per-contact send history side drawer.
 *
 * Renders the sends in reverse-chronological order with:
 *  - status pill (sent / opened / interested / placed / pass)
 *  - the timestamp
 *  - the personal message attached to the send
 *  - the tracks that went out (hydrated from /api/tracks via id list —
 *    we don't have a stored snapshot of "what was in the share at send
 *    time," so the titles reflect current track names)
 *  - quick links to the share URL (recipient view) and to the contact's
 *    "Send again" button
 *
 * Track titles fetch lazily on mount; until then we show count + the
 * raw track_ids array length, so the drawer never appears empty.
 */
// Same status order as the PATCH endpoint's enum. Defined here too so
// the UI can render a dropdown without round-tripping for the catalog.
const STATUS_OPTIONS: BeatSend['status'][] = ['sent', 'opened', 'interested', 'negotiating', 'placed', 'pass'];

export function ContactHistoryDrawer({ contact, sends, onClose, onSendAgain }: Props) {
  // Local copy of sends so optimistic status updates feel instant. The
  // parent refetches via onSuccess after the send modal, which then
  // re-runs this drawer with the canonical data on next open.
  const [localSends, setLocalSends] = useState(sends);
  useEffect(() => { setLocalSends(sends); }, [sends]);

  const [savingStatusId, setSavingStatusId] = useState<string | null>(null);
  const [openStatusId, setOpenStatusId] = useState<string | null>(null);

  const sorted = useMemo(
    () => [...localSends].sort((a, b) =>
      String(b.sent_at ?? '').localeCompare(String(a.sent_at ?? '')),
    ),
    [localSends],
  );

  const updateStatus = async (sendId: string, newStatus: BeatSend['status']) => {
    // Optimistic stamp — flip the status locally and roll back if the
    // PATCH fails. We don't reload the whole list because there's a
    // tight 1:1 between row and status pill; rollback is cheap.
    const prev = localSends.find((s) => s.id === sendId)?.status;
    setLocalSends((list) => list.map((s) => s.id === sendId ? { ...s, status: newStatus } : s));
    setSavingStatusId(sendId);
    setOpenStatusId(null);
    try {
      const res = await fetch(`/api/beat_sends/${sendId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    } catch (err: unknown) {
      // Roll back.
      if (prev) {
        setLocalSends((list) => list.map((s) => s.id === sendId ? { ...s, status: prev } : s));
      }
      toast.error('Couldn’t update status', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setSavingStatusId(null);
    }
  };

  // Collect every distinct track_id mentioned across all sends to this
  // contact, then resolve them once. Bulk hydration > N requests.
  const allTrackIds = useMemo(() => {
    const set = new Set<string>();
    for (const s of sorted) {
      for (const id of s.track_ids ?? []) set.add(id);
    }
    return Array.from(set);
  }, [sorted]);

  const [trackLookup, setTrackLookup] = useState<Map<string, Track>>(new Map());
  const [hydrating, setHydrating] = useState(false);

  useEffect(() => {
    if (allTrackIds.length === 0) return;
    let aborted = false;
    setHydrating(true);
    (async () => {
      try {
        // Cached fetch — opening 5 contacts in quick succession hits the
        // network once, not five times.
        const list = await loadTracksCached();
        if (aborted) return;
        const idSet = new Set(allTrackIds);
        const map = new Map<string, Track>();
        for (const t of list) {
          if (idSet.has(t.id)) map.set(t.id, t);
        }
        setTrackLookup(map);
      } finally {
        if (!aborted) setHydrating(false);
      }
    })();
    return () => { aborted = true; };
    // Re-run only when the set of tracked ids changes — sends will
    // refetch from the parent if new ones land.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allTrackIds.join('|')]);

  return (
    <Drawer
      onClose={onClose}
      title="Send history"
      description={contact.email ? `${contact.name} · ${contact.email}` : contact.name}
      icon={
        <span className="text-[12px] font-medium text-[var(--text-primary)]">
          {contact.name[0]?.toUpperCase()}
        </span>
      }
      size="md"
      closeLabel={`Close send history for ${contact.name}`}
      contentClassName="px-4 py-4 space-y-3"
      headerAction={
        <div className="flex w-full items-center justify-between gap-3">
          <p className="font-mono text-[10px] uppercase tracking-wider text-[var(--text-readable)]">
            {sorted.length === 0
              ? 'No sends yet'
              : `${sorted.length} send${sorted.length === 1 ? '' : 's'} on record`}
          </p>
          <Button
            onClick={onSendAgain}
            disabled={!contact.email}
            variant="accent"
            size="sm"
            leadingIcon={<Send size={11} aria-hidden="true" />}
          >
            Send again
          </Button>
        </div>
      }
    >
          {sorted.length === 0 ? (
            <EmptyState
              icon={<Clock size={24} aria-hidden="true" />}
              title="No sends yet"
              description="Sends to this contact will appear here."
              className="border-dashed py-16"
            />
          ) : (
            sorted.map((s) => {
              const status = statusConfig(s.status);
              const Icon = status.icon;
              const titles = (s.track_ids ?? []).map((id) => trackLookup.get(id)?.title ?? null);
              const knownCount = titles.filter(Boolean).length;
              const totalCount = s.track_ids?.length ?? 0;
              return (
                <div
                  key={s.id}
                  className="border border-[#211F1A] bg-[#11100D] rounded-lg p-4 hover:border-[#3B372F] transition-colors"
                >
                  <div className="flex items-center justify-between gap-2 mb-2">
                    {/* Status as a self-contained dropdown — click to
                        cycle the send through the pipeline. Saved
                        immediately via PATCH /api/beat_sends/[id]. */}
                    <div className="relative">
                      <button
                        onClick={() => setOpenStatusId(openStatusId === s.id ? null : s.id)}
                        disabled={savingStatusId === s.id}
                        className={`inline-flex items-center gap-1.5 text-[9px] font-mono uppercase tracking-wider px-2 py-1 rounded ${status.bg} ${status.color} hover:brightness-125 disabled:opacity-50 transition-all`}
                        title="Click to change status"
                      >
                        {savingStatusId === s.id
                          ? <Loader2 size={10} className="animate-spin" />
                          : <Icon size={10} />}
                        {status.label}
                        <ChevronDown size={9} className="opacity-50" />
                      </button>
                      {openStatusId === s.id && (
                        <>
                          {/* Backdrop captures outside-clicks to close the
                              menu — small inline solution avoids pulling
                              in a popover library for one use. */}
                          <div
                            className="fixed inset-0 z-[80]"
                            onClick={() => setOpenStatusId(null)}
                          />
                          <div className="absolute top-full left-0 mt-1 z-[81] bg-[#090907] border border-[#2B2821] rounded-md shadow-2xl py-1 min-w-[140px]">
                            {STATUS_OPTIONS.map((opt) => {
                              const cfg = statusConfig(opt);
                              const OptIcon = cfg.icon;
                              const isCurrent = opt === s.status;
                              return (
                                <button
                                  key={opt}
                                  onClick={() => updateStatus(s.id, opt)}
                                  className={`w-full flex items-center gap-2 px-3 py-1.5 text-[10px] font-mono uppercase tracking-wider text-left transition-colors ${
                                    isCurrent
                                      ? `${cfg.bg} ${cfg.color}`
                                      : `text-[#D0C3AF] hover:bg-[#1A1813] hover:text-white`
                                  }`}
                                >
                                  <OptIcon size={10} />
                                  {cfg.label}
                                  {isCurrent && <CheckCircle size={9} className="ml-auto opacity-60" />}
                                </button>
                              );
                            })}
                          </div>
                        </>
                      )}
                    </div>
                    <span className="text-[9px] font-mono text-[#9B9282]">
                      {s.sent_at
                        ? new Date(s.sent_at).toLocaleString('en-US', {
                          month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
                        })
                        : '—'}
                    </span>
                  </div>

                  {/* Track list — uses hydrated titles when available */}
                  <div className="flex items-start gap-2 mb-2">
                    <Music size={11} className="text-[#B4AA99] mt-0.5 shrink-0" />
                    <div className="text-[11px] text-[#bbb] leading-relaxed">
                      {totalCount === 0 ? (
                        <span className="text-[#9B9282]">No tracks recorded</span>
                      ) : (
                        <>
                          {titles
                            .filter((t): t is string => Boolean(t))
                            .slice(0, 5)
                            .join(', ')}
                          {knownCount < totalCount && (
                            <span className="text-[#9B9282]">
                              {' '}
                              {hydrating ? '· loading…' : `· +${totalCount - knownCount} more`}
                            </span>
                          )}
                          {knownCount === 0 && !hydrating && (
                            <span className="text-[#9B9282]">{totalCount} track{totalCount === 1 ? '' : 's'}</span>
                          )}
                        </>
                      )}
                    </div>
                  </div>

                  {/* Message preview */}
                  {s.message && (
                    <p className="text-[11px] text-[#D0C3AF] leading-relaxed bg-[#090907] border-l-2 border-[#C9BCA8]/40 pl-3 py-1.5 my-2 italic">
                      {s.message}
                    </p>
                  )}

                  {/* Share link */}
                  {s.share_token && (
                    <a
                      href={`/share/${s.share_token}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[10px] font-mono text-[#E7D7BE] hover:text-[#F3E6D1] mt-2"
                    >
                      <ExternalLink size={9} />
                      Open share link
                    </a>
                  )}
                </div>
              );
            })
          )}

          {hydrating && sorted.length > 0 && (
            <div className="flex items-center justify-center py-3 text-[10px] text-[#9B9282]">
              <Loader2 size={11} className="animate-spin mr-2" />
              Resolving track titles…
            </div>
          )}
    </Drawer>
  );
}

function statusConfig(status: BeatSend['status']) {
  switch (status) {
    case 'sent':        return { icon: Mail, color: 'text-[#D0C3AF]', bg: 'bg-[#211F1A]', label: 'Sent' };
    case 'opened':      return { icon: Clock, color: 'text-blue-400', bg: 'bg-blue-400/10', label: 'Opened' };
    case 'interested':  return { icon: ArrowUpRight, color: 'text-[#D6BE7A]', bg: 'bg-[#D6BE7A]/10', label: 'Interested' };
    case 'negotiating': return { icon: Clock, color: 'text-purple-400', bg: 'bg-purple-400/10', label: 'Negotiating' };
    case 'placed':      return { icon: CheckCircle, color: 'text-green-500', bg: 'bg-green-500/10', label: 'Placed' };
    case 'pass':        return { icon: XCircle, color: 'text-red-500', bg: 'bg-red-500/10', label: 'Pass' };
    default:            return { icon: Mail, color: 'text-[#9B9282]', bg: 'bg-[#211F1A]', label: String(status) };
  }
}
