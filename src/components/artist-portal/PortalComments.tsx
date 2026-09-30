'use client';

/**
 * The artist's side of the conversation, inside the portal: one thread per
 * beat (under its row) and one per project (notes that are not about a beat).
 * Posting continues the latest thread so the producer reads one conversation,
 * except a comment pinned to a moment in the beat, which starts its own.
 * Pinned comments seek the player when the beat is the one playing.
 */

import { useState } from 'react';
import { usePlayer } from '@/hooks/usePlayer';
import { formatTimecode, pinAt, threadComments, type PortalComment } from '@/lib/artist-portal/comments';

export function PortalThread({
  comments,
  canComment,
  isActive,
  durationSeconds,
  placeholder,
  onPost,
}: {
  comments: PortalComment[];
  canComment: boolean;
  /** The beat this thread is about is the one loaded in the player. */
  isActive: boolean;
  durationSeconds: number | null;
  placeholder: string;
  onPost: (body: string, opts: { parentId: string | null; pin: { region_start: number; region_end: number } | null }) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState('');
  const [pinOn, setPinOn] = useState(false);
  const [sending, setSending] = useState(false);
  const progress = usePlayer((s) => s.progress);
  const seekTo = usePlayer((s) => s.seekTo);
  const threads = threadComments(comments);
  const pin = isActive ? pinAt(progress, durationSeconds) : null;

  const submit = async () => {
    const text = draft.trim();
    if (!text) return;
    setSending(true);
    const usePin = pinOn && pin ? pin : null;
    const last = threads[threads.length - 1];
    const ok = await onPost(text, { parentId: usePin ? null : last?.root.id ?? null, pin: usePin });
    setSending(false);
    if (ok) { setDraft(''); setPinOn(false); }
  };

  return (
    <div className="space-y-3" data-testid="portal-thread">
      {threads.length > 0 && (
        <ul className="space-y-3">
          {threads.map((t) => (
            <li key={t.root.id}>
              <ul className="space-y-2">
                <Line c={t.root} isActive={isActive} durationSeconds={durationSeconds} onSeek={seekTo} />
                {t.replies.length > 0 && (
                  <li>
                    <ul className="space-y-2 border-l border-white/10 pl-3">
                      {t.replies.map((r) => <Line key={r.id} c={r} isActive={isActive} durationSeconds={durationSeconds} onSeek={seekTo} />)}
                    </ul>
                  </li>
                )}
              </ul>
            </li>
          ))}
        </ul>
      )}
      {canComment ? (
        <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <label className="block">
            <span className="sr-only">{placeholder}</span>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void submit(); } }}
              rows={2}
              maxLength={5000}
              placeholder={placeholder}
              className="w-full resize-y rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2 text-sm text-white/80 placeholder:text-white/30 focus:border-white/30 focus:outline-none"
            />
          </label>
          <div className="flex items-center justify-between gap-3">
            {pin ? (
              <label className="flex items-center gap-2 text-xs text-white/60">
                <input type="checkbox" checked={pinOn} onChange={(e) => setPinOn(e.target.checked)} className="h-3.5 w-3.5 accent-white" />
                At {formatTimecode(pin.region_start)}
              </label>
            ) : <span />}
            <button
              type="submit"
              disabled={sending || !draft.trim()}
              className="rounded-lg border border-white/10 bg-white/[0.06] px-3 py-1.5 text-xs text-white/80 transition-colors hover:border-white/20 hover:bg-white/[0.10] disabled:opacity-40"
            >
              {sending ? 'Sending…' : 'Send'}
            </button>
          </div>
        </form>
      ) : threads.length === 0 ? (
        <p className="text-xs text-white/40">Comments are off for this project.</p>
      ) : null}
    </div>
  );
}

function Line({ c, isActive, durationSeconds, onSeek }: {
  c: PortalComment;
  isActive: boolean;
  durationSeconds: number | null;
  onSeek: (fraction: number) => void;
}) {
  return (
    <li className="text-sm">
      <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/40">
        <span className={c.fromProducer ? 'text-white/70' : 'text-white/50'}>{c.fromProducer ? c.authorName : 'You'}</span>
        {c.regionStart != null && (
          isActive && durationSeconds ? (
            <button type="button" onClick={() => onSeek(c.regionStart! / durationSeconds)} className="ml-2 rounded border border-white/20 px-1 text-white/70 hover:text-white">
              {formatTimecode(c.regionStart)}
            </button>
          ) : <span className="ml-2">at {formatTimecode(c.regionStart)}</span>
        )}
        <span className="ml-2">{new Date(c.createdAt).toLocaleDateString()}</span>
      </p>
      <p className="mt-0.5 whitespace-pre-wrap text-white/80">{c.body}</p>
    </li>
  );
}
