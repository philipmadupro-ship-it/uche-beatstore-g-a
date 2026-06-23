'use client';

/**
 * SoundCloud-style timestamped comments on a store beat.
 *
 * Fans post anonymously (just need a display name); the comment is
 * pinned to a moment in the track via a number input. The persistent
 * /store player exposes the current playhead via usePlayer().progress
 * (0..1) which we pre-fill into the timestamp field when the buyer
 * is listening to *this* beat — drops the friction of "what second
 * was that again?" to zero.
 *
 * Producer moderation (delete / pin / hide) is server-side via
 * /api/tracks/[id]/comments/[commentId]; not exposed here.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, MessageCircle, Pin, Send } from 'lucide-react';
import { toast } from '@/hooks/useToast';
import { usePlayer } from '@/hooks/usePlayer';

interface CommentRow {
  id: string;
  author_name: string;
  timestamp_seconds: number;
  body: string;
  is_pinned: boolean;
  created_at: string;
}

function fmtTs(seconds: number): string {
  if (!seconds || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function fmtRelative(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function BeatComments({
  trackId,
  trackDurationSeconds,
  accentColor,
  onSeek,
}: {
  trackId: string;
  trackDurationSeconds: number | null | undefined;
  accentColor: string;
  onSeek?: (seconds: number) => void;
}) {
  const queryClient = useQueryClient();
  const { currentTrack, progress } = usePlayer();
  const isPlayingThis = currentTrack?.id === trackId;
  const livePlayhead = isPlayingThis && trackDurationSeconds
    ? Math.floor(progress * trackDurationSeconds)
    : 0;

  const { data, isLoading } = useQuery({
    queryKey: ['beatComments', trackId],
    queryFn: async () => {
      const res = await fetch(`/api/store/comments/${trackId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      return (j.comments ?? []) as CommentRow[];
    },
  });
  const comments = data ?? [];

  const [authorName, setAuthorName] = useState('');
  const [body, setBody] = useState('');
  // Manual timestamp override. Defaults to live playhead when the
  // current track is playing, 0 otherwise. Producer can override by
  // clicking the timestamp pill.
  const [tsOverride, setTsOverride] = useState<number | null>(null);
  const effectiveTs = tsOverride ?? livePlayhead;

  const post = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/store/comments/${trackId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          author_name: authorName.trim(),
          body: body.trim(),
          timestamp_seconds: Math.max(0, Math.min(trackDurationSeconds ?? 36000, effectiveTs)),
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
      return j.comment as CommentRow;
    },
    onSuccess: () => {
      setBody('');
      setTsOverride(null);
      queryClient.invalidateQueries({ queryKey: ['beatComments', trackId] });
      toast.success('Posted', `at ${fmtTs(effectiveTs)}`);
    },
    onError: (err: Error) => {
      toast.error('Could not post', err.message);
    },
  });

  const canPost = authorName.trim().length > 0 && body.trim().length > 0 && !post.isPending;

  return (
    <section className="mt-16">
      <div className="flex items-center gap-2 mb-4">
        <MessageCircle size={14} className="text-white/40" />
        <h2 className="text-[14px] font-medium text-[#F7EBDD]">
          Comments {comments.length > 0 && <span className="text-white/40 font-mono">({comments.length})</span>}
        </h2>
      </div>

      {/* Composer */}
      <div className="rounded-2xl border border-white/[0.08] bg-[#171511]/70 backdrop-blur-xl p-4 mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-[140px_1fr] gap-2 mb-2">
          <input
            type="text"
            value={authorName}
            onChange={(e) => setAuthorName(e.target.value)}
            placeholder="Your name"
            maxLength={60}
            className="bg-[#090907] border border-[#2B2821] rounded-lg px-3 py-2 text-[12px] text-[#F7EBDD] placeholder:text-[#6E685B] focus:outline-none focus:border-[#3B372F]"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              title="Edit timestamp"
              onClick={() => {
                const next = window.prompt('Pin comment to which time (seconds)?', String(effectiveTs));
                if (next == null) return;
                const n = Number(next);
                if (Number.isFinite(n) && n >= 0) setTsOverride(Math.floor(n));
              }}
              className="shrink-0 px-2.5 py-1.5 rounded-md text-[11px] font-mono tabular-nums border border-[#3B372F] text-[#D0C3AF] hover:text-white transition-colors"
            >
              @{fmtTs(effectiveTs)}
            </button>
            <input
              type="text"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={`Say something at ${fmtTs(effectiveTs)}…`}
              maxLength={500}
              onKeyDown={(e) => { if (e.key === 'Enter' && canPost) post.mutate(); }}
              className="flex-1 bg-[#090907] border border-[#2B2821] rounded-lg px-3 py-2 text-[12px] text-[#F7EBDD] placeholder:text-[#6E685B] focus:outline-none focus:border-[#3B372F]"
            />
            <button
              type="button"
              onClick={() => post.mutate()}
              disabled={!canPost}
              className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-md text-black text-[11px] font-bold uppercase tracking-wider transition-opacity disabled:opacity-40 hover:opacity-90"
              style={{ backgroundColor: accentColor }}
            >
              {post.isPending ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />}
              Post
            </button>
          </div>
        </div>
        <p className="text-[10px] font-mono text-white/30">
          {isPlayingThis ? 'Timestamp auto-set to the current playhead.' : 'Type your name + a one-line reaction.'}
        </p>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="py-6 text-center">
          <Loader2 size={16} className="animate-spin text-white/40 mx-auto" />
        </div>
      ) : comments.length === 0 ? (
        <p className="text-[12px] text-white/40 text-center py-6">
          No comments yet — be the first to drop one.
        </p>
      ) : (
        <ul className="divide-y divide-white/[0.05]">
          {comments.map((c) => (
            <li key={c.id} className="py-3 flex items-start gap-3">
              <button
                type="button"
                title="Play from this moment"
                onClick={() => onSeek?.(c.timestamp_seconds)}
                className="shrink-0 mt-0.5 px-2 py-0.5 rounded-md text-[10px] font-mono tabular-nums"
                style={{ backgroundColor: `${accentColor}26`, color: accentColor }}
              >
                {fmtTs(c.timestamp_seconds)}
              </button>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 text-[11px]">
                  <span className="font-semibold text-[#F7EBDD] truncate">{c.author_name}</span>
                  <span className="text-white/30">·</span>
                  <span className="text-white/40 font-mono">{fmtRelative(c.created_at)}</span>
                  {c.is_pinned && (
                    <span className="ml-1 flex items-center gap-0.5 text-[10px] font-mono uppercase tracking-wider" style={{ color: accentColor }}>
                      <Pin size={9} />
                      pinned
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-[13px] text-white/80 leading-relaxed break-words">
                  {c.body}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
