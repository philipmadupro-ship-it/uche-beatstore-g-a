'use client';

/**
 * Comments on an org project (LABEL-22), inline — no modal:
 *
 *   Comments · mix v3 (current)                         Show resolved (2)
 *   Dana · 0:12  [from mix v1]  [Team only]
 *     Vocal is too bright at the hook
 *     Reply · Resolve · Edit · Delete
 *   ┌ Add a comment … ┐  ☐ At 0:48   ☐ Team only                    [Send]
 *
 * The same region-pin idea as the portal and share pages (a comment can be
 * pinned to the moment that is playing; a pin seeks the player when its
 * recording is the one loaded) and the same threading
 * (lib/artist-portal/comments), over `/api/org/<org>/projects/<id>/comments`.
 *
 * With `trackId`, the list is that recording's own comments plus the
 * UNRESOLVED threads of its earlier versions, labelled "from mix v2" — the
 * server decides what carries (lib/labelos/org-comments#carryForward). Without
 * one it is the whole project. "Team only" appears only for someone who may
 * write a team-only note; an artist or an external member never sees the
 * control, and the server would refuse it anyway.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Lock } from 'lucide-react';
import { confirmToast, toast } from '@/hooks/useToast';
import { usePlayer } from '@/hooks/usePlayer';
import { useVisiblePoll } from '@/hooks/useVisiblePoll';
import { formatTimecode, pinAt, threadComments } from '@/lib/artist-portal/comments';
import { InlineText } from '@/components/ui/InlineText';
import type { OrgComment } from '@/lib/labelos/org-comments';

const LABEL = 'text-[10px] font-mono uppercase tracking-[0.2em] text-white/40';
const BUTTON = 'rounded-lg border border-white/10 bg-white/[0.06] px-3 py-1.5 text-[11px] text-white/80 transition-colors hover:border-white/20 hover:bg-white/[0.10] disabled:opacity-40';
const LINK = 'text-[11px] text-white/40 transition-colors hover:text-white/80 disabled:opacity-40';
const CHIP = 'rounded border border-white/20 px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-[0.12em]';

type Me = { canComment: boolean; canPostInternal: boolean };
type Payload = {
  schemaReady?: boolean;
  comments?: OrgComment[];
  me?: Me;
  version?: { label: string; current: boolean } | null;
  recordings?: { id: string; title: string }[];
};

export interface OrgCommentsProps {
  orgId: string;
  projectId: string;
  /** One recording: its comments plus carried threads. Omit for the whole project. */
  trackId?: string | null;
  /** The recording's length, for pinning a comment to the playhead. */
  durationSeconds?: number | null;
  /** Called when the list loads, so a parent (a picker) can show the project's recordings. */
  onRecordings?: (recordings: { id: string; title: string }[]) => void;
  /** Poll interval in ms; 0 turns polling off. */
  pollMs?: number;
}

export function OrgComments({ orgId, projectId, trackId = null, durationSeconds = null, onRecordings, pollMs = 30_000 }: OrgCommentsProps) {
  // The payload remembers which list it is for, so a change of recording never shows the previous one's comments.
  const [loaded, setLoaded] = useState<{ url: string; payload: Payload } | null>(null);
  const [failed, setFailed] = useState(false);
  const [showResolved, setShowResolved] = useState(false);
  const base = `/api/org/${orgId}/projects/${projectId}/comments`;
  // The picker's list rides along only for the screen that asked for it.
  const params = [trackId ? `trackId=${trackId}` : null, onRecordings ? 'recordings=1' : null].filter(Boolean).join('&');
  const listUrl = params ? `${base}?${params}` : base;
  const data = loaded?.url === listUrl ? loaded.payload : null;
  // The list currently wanted: a slower answer for a recording the reader has since left is dropped, not shown.
  const wanted = useRef(listUrl);
  useEffect(() => { wanted.current = listUrl; }, [listUrl]);

  const load = useCallback(async () => {
    try {
      const res = await fetch(listUrl, { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as Payload;
      if (wanted.current !== listUrl) return;
      setLoaded({ url: listUrl, payload: body });
      setFailed(false);
      if (body.recordings) onRecordings?.(body.recordings);
    } catch {
      setFailed(true);
    }
  }, [listUrl, onRecordings]);

  useEffect(() => { void load(); }, [load]);
  useVisiblePoll(load, pollMs, pollMs > 0);

  const me = data?.me ?? { canComment: false, canPostInternal: false };
  const comments = useMemo(() => data?.comments ?? [], [data]);
  const threads = useMemo(() => threadComments(comments), [comments]);
  const open = threads.filter((t) => !t.root.resolvedAt);
  const resolved = threads.filter((t) => t.root.resolvedAt);

  async function call(url: string, init: RequestInit): Promise<{ ok: boolean; body: Record<string, unknown> }> {
    try {
      const res = await fetch(url, { ...init, headers: { 'content-type': 'application/json' } });
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) toast.error('Could not save', typeof body.error === 'string' ? body.error : undefined);
      return { ok: res.ok, body };
    } catch {
      toast.error('Could not save', 'Check your connection and try again.');
      return { ok: false, body: {} };
    }
  }
  const post = async (payload: Record<string, unknown>) => {
    const r = await call(base, { method: 'POST', body: JSON.stringify(payload) });
    if (r.ok) await load();
    return r.ok;
  };
  const patch = async (id: string, payload: Record<string, unknown>) => {
    const r = await call(`${base}/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
    if (r.ok) await load();
    return r.ok;
  };
  const remove = async (c: OrgComment) => {
    const ok = await confirmToast('Delete this comment?', 'Its replies go with it.', { confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    const r = await call(`${base}/${c.id}`, { method: 'DELETE' });
    if (r.ok) await load();
  };

  if (failed && !data) return <p className="text-[11px] text-white/40" role="status">Comments could not be loaded.</p>;
  if (!data) return <p className="text-[11px] text-white/40" role="status">Loading comments…</p>;
  if (data.schemaReady === false) return <p className="text-[11px] text-white/40">Comments are not available on this server yet.</p>;

  return (
    <section aria-label="Comments" className="space-y-4" data-testid="org-comments">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h3 className={LABEL}>
          Comments{data.version ? <span className="ml-2 text-white/60">{data.version.label}{data.version.current ? ' · current' : ''}</span> : null}
        </h3>
        {resolved.length > 0 && (
          <button type="button" className={LINK} aria-pressed={showResolved} onClick={() => setShowResolved((v) => !v)}>
            {showResolved ? 'Hide' : 'Show'} resolved ({resolved.length})
          </button>
        )}
      </header>

      {open.length === 0 && !(showResolved && resolved.length > 0) && (
        <p className="text-[11px] text-white/40">{resolved.length > 0 ? 'Everything here is resolved.' : 'No comments yet.'}</p>
      )}

      <ul className="space-y-4">
        {[...open, ...(showResolved ? resolved : [])].map((t) => (
          <li key={t.root.id} data-testid={`thread-${t.root.id}`} className={t.root.resolvedAt ? 'opacity-60' : ''}>
            <Thread
              root={t.root}
              replies={t.replies}
              me={me}
              durationSeconds={durationSeconds}
              onReply={(body, rootId) => post({ body, parent_id: rootId })}
              onResolve={(c, resolvedNow) => patch(c.id, { resolved: resolvedNow })}
              onEdit={(c, body) => patch(c.id, { body })}
              onVisibility={(c, visibility) => patch(c.id, { visibility })}
              onDelete={remove}
            />
          </li>
        ))}
      </ul>

      {me.canComment ? (
        <Composer me={me} trackId={trackId} durationSeconds={durationSeconds} onSend={(body, o) => post({ body, track_id: trackId, ...o })} />
      ) : (
        <p className="text-[11px] text-white/40">Your role can read comments but not add them.</p>
      )}
    </section>
  );
}

function Thread({ root, replies, me, durationSeconds, onReply, onResolve, onEdit, onVisibility, onDelete }: {
  root: OrgComment;
  replies: OrgComment[];
  me: Me;
  durationSeconds: number | null;
  onReply: (body: string, rootId: string) => Promise<boolean>;
  onResolve: (c: OrgComment, resolved: boolean) => Promise<boolean>;
  onEdit: (c: OrgComment, body: string) => Promise<boolean>;
  onVisibility: (c: OrgComment, v: 'artist' | 'internal') => Promise<boolean>;
  onDelete: (c: OrgComment) => void;
}) {
  const [replying, setReplying] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const resolved = !!root.resolvedAt;

  async function sendReply() {
    const text = draft.trim();
    if (!text) return;
    setSending(true);
    // Cleared at once (what you typed is on its way); put back if it could not be saved.
    setDraft('');
    const ok = await onReply(text, root.id);
    setSending(false);
    if (ok) setReplying(false);
    else setDraft(text);
  }

  return (
    <div className="space-y-2">
      <Line c={root} durationSeconds={durationSeconds} onEdit={onEdit} onVisibility={onVisibility} onDelete={onDelete} />
      {replies.length > 0 && (
        <ul className="space-y-2 border-l border-white/10 pl-3">
          {replies.map((r) => (
            <li key={r.id}>
              <Line c={r} durationSeconds={durationSeconds} onEdit={onEdit} onVisibility={onVisibility} onDelete={onDelete} />
            </li>
          ))}
        </ul>
      )}
      {me.canComment && (
        <div className="flex flex-wrap items-center gap-3 pl-0.5">
          <button type="button" className={LINK} onClick={() => setReplying((v) => !v)}>Reply</button>
          <button type="button" className={LINK} onClick={() => void onResolve(root, !resolved)}>{resolved ? 'Reopen' : 'Resolve'}</button>
        </div>
      )}
      {replying && (
        <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); void sendReply(); }}>
          <label className="block">
            <span className="sr-only">Reply</span>
            <textarea
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void sendReply(); } if (e.key === 'Escape') setReplying(false); }}
              rows={2}
              maxLength={5000}
              placeholder="Write a reply"
              className="w-full resize-y rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2 text-[13px] text-white/80 placeholder:text-white/30 focus:border-white/30 focus:outline-none"
            />
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" className={LINK} onClick={() => setReplying(false)}>Cancel</button>
            <button type="submit" className={BUTTON} disabled={sending || !draft.trim()}>{sending ? 'Sending…' : 'Send reply'}</button>
          </div>
        </form>
      )}
    </div>
  );
}

function Line({ c, durationSeconds, onEdit, onVisibility, onDelete }: {
  c: OrgComment;
  durationSeconds: number | null;
  onEdit: (c: OrgComment, body: string) => Promise<boolean>;
  onVisibility: (c: OrgComment, v: 'artist' | 'internal') => Promise<boolean>;
  onDelete: (c: OrgComment) => void;
}) {
  const seekTo = usePlayer((s) => s.seekTo);
  // A pin seeks only when ITS recording is the one loaded in the player.
  const loadedId = usePlayer((s) => s.currentTrack?.id ?? null);
  const pinTrack = c.carriedFrom?.trackId ?? c.trackId;
  const canSeek = c.regionStart != null && !!durationSeconds && loadedId != null && loadedId === pinTrack;
  const [editing, setEditing] = useState(false);
  const internal = c.visibility === 'internal';

  return (
    <div className="text-[13px]">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[10px] uppercase tracking-[0.2em] text-white/40">
        <span className={c.mine ? 'text-white/70' : 'text-white/50'}>{c.mine ? 'You' : c.authorName}</span>
        {c.regionStart != null && (
          canSeek ? (
            <button type="button" onClick={() => seekTo(c.regionStart! / durationSeconds!)} className={`${CHIP} text-white/70 hover:text-white`} aria-label={`Play from ${formatTimecode(c.regionStart)}`}>
              {formatTimecode(c.regionStart)}
            </button>
          ) : <span>at {formatTimecode(c.regionStart)}</span>
        )}
        <span>{new Date(c.createdAt).toLocaleDateString()}</span>
        {c.carriedFrom && <span className={`${CHIP} text-white/60`} data-testid="carried-label">from {c.carriedFrom.label}</span>}
        {internal && (
          <span className={`${CHIP} inline-flex items-center gap-1 text-white/60`} data-testid="internal-chip" title="Only your organization's team can read this">
            <Lock size={9} aria-hidden="true" /> Team only
          </span>
        )}
        {c.editedAt && <span>edited</span>}
      </p>
      {c.can.edit ? (
        <InlineText
          label="Comment"
          value={c.body}
          multiline
          rows={3}
          maxLength={5000}
          editing={editing}
          onEditingChange={setEditing}
          hideAffordance
          className="mt-0.5 block whitespace-pre-wrap text-[13px] text-white/80"
          inputClassName="text-[13px] text-white/80"
          onSave={(next) => onEdit(c, next)}
        />
      ) : (
        <p className="mt-0.5 whitespace-pre-wrap text-white/80">{c.body}</p>
      )}
      {(c.can.edit || c.can.changeVisibility || c.can.delete) && (
        <div className="mt-1 flex flex-wrap items-center gap-3">
          {c.can.edit && <button type="button" className={LINK} onClick={() => setEditing(true)}>Edit</button>}
          {c.can.changeVisibility && (
            <button type="button" className={LINK} onClick={() => void onVisibility(c, internal ? 'artist' : 'internal')}>
              {internal ? 'Make visible to the artist' : 'Make team only'}
            </button>
          )}
          {c.can.delete && <button type="button" className={LINK} onClick={() => onDelete(c)}>Delete</button>}
        </div>
      )}
    </div>
  );
}

function Composer({ me, trackId, durationSeconds, onSend }: {
  me: Me;
  trackId: string | null;
  durationSeconds: number | null;
  onSend: (body: string, extra: Record<string, unknown>) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState('');
  const [pinOn, setPinOn] = useState(false);
  const [internal, setInternal] = useState(false);
  const [sending, setSending] = useState(false);
  const progress = usePlayer((s) => s.progress);
  const loadedId = usePlayer((s) => s.currentTrack?.id ?? null);
  const pin = trackId && loadedId === trackId ? pinAt(progress, durationSeconds) : null;

  async function submit() {
    const text = draft.trim();
    if (!text) return;
    setSending(true);
    const extra: Record<string, unknown> = {};
    if (pinOn && pin) Object.assign(extra, pin);
    if (internal && me.canPostInternal) extra.visibility = 'internal';
    // Cleared at once (what you typed is on its way); put back if it could not be saved.
    setDraft('');
    setPinOn(false);
    const ok = await onSend(text, extra);
    setSending(false);
    if (!ok) setDraft(text);
  }

  return (
    <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); void submit(); }} data-testid="org-comment-composer">
      <label className="block">
        <span className="sr-only">Add a comment</span>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void submit(); } }}
          rows={2}
          maxLength={5000}
          placeholder={trackId ? 'Add a comment on this recording' : 'Add a comment on the project'}
          className="w-full resize-y rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2 text-[13px] text-white/80 placeholder:text-white/30 focus:border-white/30 focus:outline-none"
        />
      </label>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-4 text-[11px] text-white/60">
          {pin && (
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={pinOn} onChange={(e) => setPinOn(e.target.checked)} className="h-3.5 w-3.5 accent-white" />
              At {formatTimecode(pin.region_start)}
            </label>
          )}
          {me.canPostInternal && (
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} className="h-3.5 w-3.5 accent-white" />
              Team only
            </label>
          )}
        </div>
        <button type="submit" className={BUTTON} disabled={sending || !draft.trim()}>{sending ? 'Sending…' : 'Send'}</button>
      </div>
    </form>
  );
}
