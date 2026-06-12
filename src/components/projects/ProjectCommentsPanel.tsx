'use client';

import { useEffect, useId, useState, useCallback } from 'react';
import { MessageSquare, Send, Trash2, Loader2, User, RefreshCw, Filter, Pin } from 'lucide-react';
import { toast, confirmToast } from '@/hooks/useToast';
import { createClient } from '@/lib/supabase/client';

interface Comment {
  id: string;
  project_id: string;
  track_id: string | null;
  user_id: string | null;
  share_token: string | null;
  author_name: string;
  body: string;
  parent_id: string | null;
  // Region anchor — see migration 013. Both set or both null.
  region_start: number | null;
  region_end: number | null;
  edited_at: string | null;
  deleted_at: string | null;
  created_at: string;
}

/** mm:ss formatter shared with the share-page comment renderer. */
function fmtTime(s: number): string {
  if (!isFinite(s) || s < 0) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

interface TrackLookup {
  id: string;
  title: string;
}

interface Props {
  projectId: string;
  /** Optional list of tracks in the project so we can label "comment on track X". */
  tracks?: TrackLookup[];
  /**
   * When set, the panel only shows comments pinned to this track id and the
   * reply form auto-pins new replies to the same track. Used by the
   * TrackDetailsDrawer's track-feedback section so reviewers see only the
   * notes that are about the track they're listening to.
   */
  pinnedTrackId?: string | null;
  /**
   * Compact layout: hides the header chrome and shrinks padding. Used when
   * the panel is embedded inside another card (e.g. the drawer).
   */
  compact?: boolean;
}

/**
 * Owner-side comments view for a project.
 *
 *  - Lists every comment (guest + owner replies) chronologically.
 *  - Reply box stamps the owner's user_id server-side.
 *  - Each row has a soft-delete action; deleted comments disappear from
 *    both this panel and the public share view but the row is kept for
 *    audit.
 *  - Auto-refreshes on a 15-second cadence so an open owner tab catches
 *    new guest feedback without a manual reload. (Phase 2.5 will swap
 *    this for a Supabase Realtime channel.)
 */
export function ProjectCommentsPanel({ projectId, tracks = [], pinnedTrackId = null, compact = false }: Props) {
  // Per-mount unique suffix on the Supabase channel name. Without this,
  // React 19 Strict Mode (or any remount of the same projectId) re-uses
  // the SAME named channel; the cleanup runs but the channel object
  // doesn't fully reset before the second mount tries to add another
  // .on() callback, causing the runtime error:
  //   "Cannot add postgres_changes callbacks ... after subscribe()".
  // useId is stable per mount, deterministic for SSR/CSR alignment.
  const instanceId = useId();
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  // User-controlled filter (panel only). When `pinnedTrackId` is provided
  // by the parent we ignore this state so the embed in the drawer can't
  // be overridden into showing unrelated comments.
  const [filterTrackId, setFilterTrackId] = useState<string | 'all'>('all');
  const effectiveTrackFilter: string | null =
    pinnedTrackId !== null ? pinnedTrackId : (filterTrackId === 'all' ? null : filterTrackId);

  const visible = effectiveTrackFilter
    ? comments.filter((c) => c.track_id === effectiveTrackFilter)
    : comments;

  const trackTitleOf = useCallback(
    (trackId: string | null) => {
      if (!trackId) return null;
      return tracks.find((t) => t.id === trackId)?.title ?? null;
    },
    [tracks],
  );

  const fetchComments = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/comments`);
      if (!res.ok) return;
      const data = await res.json();
      setComments(data.comments ?? []);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchComments();

    // Realtime: subscribe to INSERT/UPDATE/DELETE on project_comments for
    // this project. Replaces the previous 15s poll — instant fan-out to
    // every open project tab when a guest leaves feedback, and zero API
    // traffic between actual events.
    //
    // We can't subscribe with a JOIN filter on Supabase Realtime (Postgres
    // CDC is row-level only), so we filter by project_id which uses the
    // column we already index on. The listener body handles INSERT (push
    // onto state), UPDATE (replace in-place — includes soft-deletes that
    // stamp deleted_at), and DELETE (remove). Soft-deleted rows from
    // UPDATE are filtered out client-side to keep the panel honest.
    const supabase = createClient();
    const channel = supabase
      .channel(`project_comments:${projectId}:${instanceId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'project_comments', filter: `project_id=eq.${projectId}` },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            const row = payload.new as Comment;
            if (row.deleted_at) return;
            setComments((prev) => {
              // Dedupe — the owner reply path also calls fetchComments()
              // after POST, which may race with this push notification.
              if (prev.some((c) => c.id === row.id)) return prev;
              return [...prev, row];
            });
          } else if (payload.eventType === 'UPDATE') {
            const row = payload.new as Comment;
            setComments((prev) =>
              row.deleted_at
                ? prev.filter((c) => c.id !== row.id)
                : prev.map((c) => (c.id === row.id ? row : c)),
            );
          } else if (payload.eventType === 'DELETE') {
            const row = payload.old as Comment;
            setComments((prev) => prev.filter((c) => c.id !== row.id));
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [projectId, fetchComments, instanceId]);

  const submit = async () => {
    if (!draft.trim()) return;
    setPosting(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // When the embed is pinned to a track, owner replies inherit that
        // pin so the conversation stays threaded by track.
        body: JSON.stringify({
          body: draft.trim(),
          track_id: effectiveTrackFilter,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error('Couldn’t post reply', data.error);
        return;
      }
      setDraft('');
      fetchComments();
    } finally {
      setPosting(false);
    }
  };

  const remove = async (c: Comment) => {
    const ok = await confirmToast(
      'Delete this comment?',
      'The author will no longer see it on their share link. This is a soft delete — say so if you want it gone permanently.',
      { confirmLabel: 'Delete', cancelLabel: 'Cancel' },
    );
    if (!ok) return;
    setDeleting(c.id);
    try {
      const res = await fetch(`/api/projects/${projectId}/comments/${c.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        toast.error('Delete failed', e.error);
        return;
      }
      fetchComments();
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className={compact ? '' : 'border border-[#2B2821] rounded-lg bg-[#090907]'}>
      {!compact && (
        <header className="flex items-center justify-between px-5 py-4 border-b border-[#2B2821]">
          <div className="flex items-center gap-2">
            <MessageSquare size={12} className="text-[#B4AA99]" />
            <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-[#D0C3AF]">
              Project comments
              {visible.length > 0 && (
                <span className="text-[#9B9282] ml-1.5 font-mono">
                  {visible.length}{visible.length !== comments.length ? `/${comments.length}` : ''}
                </span>
              )}
            </h3>
          </div>
          <div className="flex items-center gap-2">
            {/* Track filter — only when no external pin is forced. The pinned
                drawer embed hides this since its filter is fixed by props. */}
            {pinnedTrackId === null && tracks.length > 0 && (
              <div className="flex items-center gap-1.5 bg-[#090907] border border-[#211F1A] rounded-md px-2 py-1">
                <Filter size={10} className="text-[#9B9282]" />
                <select
                  value={filterTrackId}
                  onChange={(e) => setFilterTrackId(e.target.value)}
                  className="bg-transparent text-[10px] text-[#bbb] focus:outline-none cursor-pointer"
                  title="Filter comments by pinned track"
                >
                  <option value="all">All tracks</option>
                  {tracks.map((t) => (
                    <option key={t.id} value={t.id}>{t.title}</option>
                  ))}
                </select>
              </div>
            )}
            <button
              onClick={fetchComments}
              className="p-1.5 text-[#9B9282] hover:text-white transition-colors"
              title="Refresh comments"
            >
              <RefreshCw size={11} />
            </button>
          </div>
        </header>
      )}

      <div className={compact ? 'space-y-3' : 'px-5 py-4 space-y-3'}>
        {loading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 size={14} className="animate-spin text-[#837B6D]" />
          </div>
        ) : visible.length === 0 ? (
          <p className="text-[11px] text-[#9B9282] py-2">
            {effectiveTrackFilter
              ? 'No comments pinned to this track yet.'
              : 'No comments yet. When recipients of a share link with “Commenter” access leave feedback, it\'ll appear here.'}
          </p>
        ) : (
          visible.map((c) => {
            const isOwner = !!c.user_id;
            const onTrack = trackTitleOf(c.track_id);
            return (
              <div
                key={c.id}
                className={`group rounded-md px-4 py-3 border ${
                  isOwner
                    ? 'bg-[#342F27]/40 border-[#C9BCA8]/30'
                    : 'bg-[#090907] border-[#211F1A]'
                }`}
              >
                <div className="flex items-start justify-between gap-3 mb-1.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <div
                      className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${
                        isOwner ? 'bg-[#C9BCA8] text-white' : 'bg-[#211F1A] text-[#D0C3AF]'
                      }`}
                    >
                      <User size={9} />
                    </div>
                    <span className="text-[11px] font-medium text-[#F7EBDD] truncate">
                      {c.author_name}
                    </span>
                    {isOwner && (
                      <span className="text-[8px] font-bold text-[#F3E6D1] uppercase tracking-wider">
                        You
                      </span>
                    )}
                    <span className="text-[9px] font-mono text-[#9B9282]">
                      {new Date(c.created_at).toLocaleString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </span>
                    {onTrack && (
                      <span
                        className="flex items-center gap-1 text-[9px] font-mono text-[#F3E6D1] bg-[#342F27] border border-[#C9BCA8]/40 rounded px-1.5 py-0.5 truncate"
                        title={`Pinned to ${onTrack}`}
                      >
                        <Pin size={8} />
                        {onTrack}
                      </span>
                    )}
                    {c.region_start != null && c.region_end != null && (
                      // Read-only timecode chip in the owner panel — the
                      // owner doesn't have a PlayerCanvas open here, so
                      // clicking can't seek (yet). Still useful as
                      // metadata: tells the owner *which slice* of the
                      // track the reviewer flagged.
                      <span
                        className="text-[9px] font-mono text-[#F3E6D1] bg-[#342F27] border border-[#C9BCA8]/40 rounded px-1.5 py-0.5"
                        title="Region-anchored comment"
                      >
                        {fmtTime(c.region_start)}–{fmtTime(c.region_end)}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => remove(c)}
                    disabled={deleting === c.id}
                    className="p-1 rounded text-[#837B6D] hover:text-red-400 hover:bg-[#211F1A] opacity-0 group-hover:opacity-100 transition-all"
                    title="Delete comment"
                  >
                    {deleting === c.id ? (
                      <Loader2 size={10} className="animate-spin" />
                    ) : (
                      <Trash2 size={10} />
                    )}
                  </button>
                </div>
                <p className="text-[12px] text-[#bbb] leading-relaxed whitespace-pre-wrap">
                  {c.body}
                </p>
              </div>
            );
          })
        )}

        {/* Reply box */}
        <div className="pt-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Reply or post a note for collaborators…"
            rows={2}
            className="w-full bg-[#090907] border border-[#211F1A] rounded px-3 py-2 text-[12px] text-white placeholder:text-[#837B6D] focus:outline-none focus:border-[#C9BCA8] resize-none"
          />
          <div className="flex items-center justify-between mt-2">
            <p className="text-[9px] text-[#9B9282]">
              Posts as the project owner.
              {effectiveTrackFilter && (
                <> Will be pinned to <span className="text-[#F3E6D1]">{trackTitleOf(effectiveTrackFilter)}</span>.</>
              )}
            </p>
            <button
              onClick={submit}
              disabled={posting || !draft.trim()}
              className="flex items-center gap-1.5 bg-[#E7D7BE] hover:bg-[#C9BCA8] disabled:opacity-40 text-white text-[10px] font-bold uppercase tracking-widest px-4 py-2 rounded transition-colors"
            >
              {posting ? <Loader2 size={11} className="animate-spin" /> : <Send size={10} />}
              Post
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
