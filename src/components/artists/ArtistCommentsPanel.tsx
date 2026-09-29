'use client';

/**
 * The artist's portal conversation, in the workspace's Activity tab.
 *
 *   COMMENTS
 *   Artist #1 · MIDNIGHT · at 1:23 · 2h ago
 *     "the 808 hits hard, can we get a version without the flute?"
 *     UCHE · 1h ago — "yes, sending tonight"
 *     [Reply…]
 *
 * Replies go into the same thread and show in the artist's portal on their
 * next visit. Nothing is emailed. Renders nothing before migration 128.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Dropdown } from '@/components/ui/Dropdown';
import { toast } from '@/hooks/useToast';
import { relativeDays } from '@/components/crm/contacts-shared';
import { formatTimecode, threadComments, type PortalComment } from '@/lib/artist-portal/comments';
import { jsonOrThrow } from './types';

type WorkspaceComment = PortalComment & { projectName: string; trackTitle: string | null };

const LABEL = 'text-[10px] font-mono uppercase tracking-[0.2em] text-white/40';
const FIELD = 'w-full rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2 text-[11px] text-white/80 placeholder:text-white/30 focus:border-white/30 focus:outline-none';
const CONTROL = 'rounded-lg border border-white/10 bg-white/[0.06] px-3 py-1.5 text-[11px] text-white/80 transition-colors hover:border-white/20 hover:bg-white/[0.10] disabled:opacity-40';

export function ArtistCommentsPanel({ contactId, contactName, projects }: {
  contactId: string;
  contactName: string;
  projects: Array<{ id: string; name: string }>;
}) {
  const [comments, setComments] = useState<WorkspaceComment[] | null>(null);
  const [ready, setReady] = useState(true);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [newProject, setNewProject] = useState<string>('');

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/contacts/${contactId}/comments`);
      if (!res.ok) return;
      const data = await res.json() as { schemaReady: boolean; comments: WorkspaceComment[] };
      setReady(data.schemaReady !== false);
      setComments(data.comments ?? []);
    } catch {
      // Optional panel.
    }
  }, [contactId]);

  useEffect(() => { void load(); }, [load]);

  const byId = useMemo(() => new Map((comments ?? []).map((c) => [c.id, c])), [comments]);
  const threads = useMemo(() => threadComments(comments ?? []).reverse(), [comments]);

  const send = async (key: string, payload: { project_id: string; track_id?: string | null; parent_id?: string | null }) => {
    const text = (drafts[key] ?? '').trim();
    if (!text) return;
    setBusy(key);
    try {
      await jsonOrThrow(await fetch(`/api/contacts/${contactId}/comments`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, body: text }),
      }));
      setDrafts((d) => ({ ...d, [key]: '' }));
      await load();
    } catch (err) {
      toast.error('Could not send', err instanceof Error ? err.message : 'Try again');
    } finally {
      setBusy(null);
    }
  };

  if (!ready || comments === null) return null;
  const projectForNew = newProject || projects[0]?.id || '';

  return (
    <section aria-labelledby="ws-comments" className="mb-8" data-testid="artist-comments">
      <div className="mb-3 flex items-center justify-between">
        <h2 id="ws-comments" className={LABEL}>Comments</h2>
        <span className="text-[11px] text-white/30">{comments.length ? `${comments.length} in the portal thread` : ''}</span>
      </div>

      {threads.length === 0 ? (
        <p className="mb-3 rounded-xl border border-white/10 bg-[#0D0D0A] px-4 py-5 text-center text-[11px] text-white/40">
          No comments yet. When {contactName} comments on a beat in their portal it shows here, and you can answer in the same thread.
        </p>
      ) : (
        <ul className="mb-3 space-y-3">
          {threads.map(({ root, replies }) => {
            const c = byId.get(root.id)!;
            const key = `reply-${root.id}`;
            return (
              <li key={root.id} className="rounded-xl border border-white/10 bg-[#0D0D0A] p-3" data-testid={`ws-comment-${root.id}`}>
                <p className="mb-1 text-[11px] text-white/40">
                  <span className="text-white/70">{root.authorName}</span>
                  {' · '}<Link href={`/projects/${c.projectId}`} className="hover:text-white">{c.projectName}</Link>
                  {c.trackTitle && <> · {c.trackTitle}</>}
                  {root.regionStart != null && <> · at {formatTimecode(root.regionStart)}</>}
                  {' · '}{relativeDays(root.createdAt)}
                </p>
                <p className="whitespace-pre-wrap text-[13px] text-white/80">{root.body}</p>
                {replies.length > 0 && (
                  <ul className="mt-2 space-y-2 border-l border-white/10 pl-3">
                    {replies.map((r) => (
                      <li key={r.id}>
                        <p className="text-[11px] text-white/40"><span className={r.fromProducer ? 'text-white/60' : 'text-white/70'}>{r.authorName}</span> · {relativeDays(r.createdAt)}</p>
                        <p className="whitespace-pre-wrap text-[13px] text-white/70">{r.body}</p>
                      </li>
                    ))}
                  </ul>
                )}
                <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); void send(key, { project_id: c.projectId, track_id: c.trackId, parent_id: root.id }); }}>
                  <label className="flex-1">
                    <span className="sr-only">Reply to {root.authorName}</span>
                    <input value={drafts[key] ?? ''} onChange={(e) => setDrafts((d) => ({ ...d, [key]: e.target.value }))} placeholder="Reply…" maxLength={5000} className={FIELD} />
                  </label>
                  <button type="submit" disabled={busy === key || !(drafts[key] ?? '').trim()} className={CONTROL}>Reply</button>
                </form>
              </li>
            );
          })}
        </ul>
      )}

      {projects.length > 0 && (
        <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); void send('new', { project_id: projectForNew }); }}>
          {projects.length > 1 && (
            <Dropdown
              value={projectForNew}
              onChange={setNewProject}
              options={projects.map((p) => ({ value: p.id, label: p.name }))}
              aria-label="Project for the new message"
              menuWidth={220}
            />
          )}
          <label className="min-w-[200px] flex-1">
            <span className="sr-only">Message {contactName}</span>
            <input value={drafts.new ?? ''} onChange={(e) => setDrafts((d) => ({ ...d, new: e.target.value }))} placeholder={`Write to ${contactName} in their portal…`} maxLength={5000} className={FIELD} />
          </label>
          <button type="submit" disabled={busy === 'new' || !(drafts.new ?? '').trim()} className={CONTROL}>Post</button>
        </form>
      )}
    </section>
  );
}
