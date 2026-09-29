'use client';

/**
 * The workspace's Messages tab: one thread with the artist, plus their
 * requests.
 *
 *   OPEN REQUESTS
 *   "send me something darker" · for MIDNIGHT · 2d ago   [Done] [Decline]
 *
 *   MESSAGES
 *   Nova · 1h ago — "are you in town next week?"
 *   You · 20m ago — "yes, Thursday"                    Seen · Emailed
 *   [Write to Nova…]  ☑ Email if they're away   [Send]
 *
 * The artist reads and answers in their portal. A message is also emailed
 * unless the server decides they will see it anyway (lib/artist-messages).
 * Opening the tab marks the artist's messages as seen; the thread refreshes
 * every 30 s while the tab is visible.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from '@/hooks/useToast';
import { useVisiblePoll } from '@/hooks/useVisiblePoll';
import { relativeDays } from '@/components/crm/contacts-shared';
import { openRequests, type ArtistMessage, type RequestStatus } from '@/lib/artist-messages/messages';
import { jsonOrThrow } from './types';

const LABEL = 'text-[10px] font-mono uppercase tracking-[0.2em] text-white/40';
const FIELD = 'w-full rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2 text-[11px] text-white/80 placeholder:text-white/30 focus:border-white/30 focus:outline-none';
const CONTROL = 'rounded-lg border border-white/10 bg-white/[0.06] px-3 py-1.5 text-[11px] text-white/80 transition-colors hover:border-white/20 hover:bg-white/[0.10] disabled:opacity-40';

const STATUS_LABEL: Record<RequestStatus, string> = { open: 'Open', done: 'Done', declined: 'Declined' };

const SKIP_REASON: Record<string, string> = {
  active: 'they’re in their portal right now',
  recently_emailed: 'they already have an email about an unread message',
  no_email: 'this contact has no email address',
  no_portal: 'they have no active portal',
};

export function ArtistMessagesPanel({ contactId, contactName, onCountsChanged }: {
  contactId: string;
  contactName: string;
  /** The workspace's unread / open-request counts moved (refetch them). */
  onCountsChanged: () => void;
}) {
  const [messages, setMessages] = useState<ArtistMessage[] | null>(null);
  const [ready, setReady] = useState(true);
  const [draft, setDraft] = useState('');
  const [email, setEmail] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const seen = useRef<ArtistMessage[] | null>(null);
  // The parent passes a fresh function each render; the thread must not refetch for that.
  const countsChanged = useRef(onCountsChanged);
  useEffect(() => { countsChanged.current = onCountsChanged; }, [onCountsChanged]);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/contacts/${contactId}/messages?read=1`);
      if (!res.ok) return;
      const data = await res.json() as { schemaReady: boolean; messages: ArtistMessage[] };
      setReady(data.schemaReady !== false);
      const next = data.messages ?? [];
      // Opening the tab (or a new artist message arriving) just moved the
      // counts the tab badge shows.
      const known = new Set((seen.current ?? []).map((m) => m.id));
      const arrived = next.some((m) => m.author === 'artist' && !known.has(m.id));
      if (seen.current === null || arrived) countsChanged.current();
      seen.current = next;
      setMessages(next);
    } catch {
      // Keep what is on screen; the next poll retries.
    }
  }, [contactId]);

  useEffect(() => { void load(); }, [load]);
  useVisiblePoll(load, 30_000, ready);

  const thread = useMemo(() => (messages ?? []), [messages]);
  const open = useMemo(() => openRequests(thread), [thread]);
  const count = thread.length;

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [count]);

  const send = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    setBusy('send');
    try {
      const res = await fetch(`/api/contacts/${contactId}/messages`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: text, email }),
      });
      const data = await jsonOrThrow<{ message: ArtistMessage; emailed: boolean; emailSkipped: string | null; emailError: string | null }>(res);
      seen.current = [...(seen.current ?? []), data.message];
      setMessages(seen.current);
      setDraft('');
      if (data.emailed) toast.success(`Sent · emailed ${contactName}`);
      else if (data.emailError) toast.error(`Sent to the portal, but the email failed: ${data.emailError}`);
      else if (data.emailSkipped && SKIP_REASON[data.emailSkipped]) toast.success(`Sent to the portal · not emailed: ${SKIP_REASON[data.emailSkipped]}`);
      else toast.success('Sent to the portal');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not send');
    } finally {
      setBusy(null);
    }
  };

  const setStatus = async (m: ArtistMessage, status: RequestStatus) => {
    setBusy(m.id);
    try {
      const res = await fetch(`/api/contacts/${contactId}/messages/${m.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_status: status }),
      });
      const data = await jsonOrThrow<{ message: ArtistMessage }>(res);
      seen.current = (seen.current ?? []).map((x) => (x.id === m.id ? data.message : x));
      setMessages(seen.current);
      countsChanged.current();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update the request');
    } finally {
      setBusy(null);
    }
  };

  if (!ready) {
    return (
      <p className="rounded-xl border border-white/10 bg-[#0D0D0A] px-4 py-6 text-center text-[11px] text-white/40">
        Messages need migration 130 applied on Supabase.
      </p>
    );
  }
  if (messages === null) return <p className="text-[11px] text-white/40">Loading messages…</p>;

  return (
    <div className="space-y-8" data-testid="artist-messages">
      {open.length > 0 && (
        <section aria-labelledby="ws-requests">
          <h2 id="ws-requests" className={`${LABEL} mb-3`}>Open requests · {open.length}</h2>
          <ul className="divide-y divide-white/[0.06] rounded-xl border border-white/10 bg-[#0D0D0A]">
            {open.map((m) => (
              <li key={m.id} className="flex flex-wrap items-start gap-3 px-4 py-3" data-testid="open-request">
                <div className="min-w-0 flex-1">
                  <p className="whitespace-pre-wrap text-[13px] text-white/80">{m.body}</p>
                  <p className="mt-1 text-[11px] text-white/40">
                    {[m.projectName ? `for ${m.projectName}` : null, relativeDays(m.createdAt)].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button type="button" className={CONTROL} disabled={busy === m.id} onClick={() => void setStatus(m, 'done')}>Done</button>
                  <button type="button" className={CONTROL} disabled={busy === m.id} onClick={() => void setStatus(m, 'declined')}>Decline</button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="ws-messages">
        <h2 id="ws-messages" className={`${LABEL} mb-3`}>Messages</h2>
        {thread.length === 0 ? (
          <p className="mb-4 rounded-xl border border-white/10 bg-[#0D0D0A] px-4 py-6 text-center text-[11px] text-white/40">
            No messages yet. What you write here shows in {contactName}’s portal, and {contactName} can write back or ask you for something there.
          </p>
        ) : (
          <ol ref={listRef} className="mb-4 max-h-[28rem] space-y-3 overflow-y-auto rounded-xl border border-white/10 bg-[#0D0D0A] p-4" aria-live="polite">
            {thread.map((m) => {
              const mine = m.author === 'producer';
              return (
                <li key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`} data-testid="thread-message">
                  <div className={`max-w-[85%] rounded-xl border px-3 py-2 ${mine ? 'border-white/20 bg-white/[0.08]' : 'border-white/10 bg-white/[0.03]'}`}>
                    {m.kind === 'request' && (
                      <p className="mb-1 text-[10px] font-mono uppercase tracking-[0.2em] text-[#c8a47a]">
                        Request · {STATUS_LABEL[m.requestStatus ?? 'open']}{m.projectName ? ` · ${m.projectName}` : ''}
                      </p>
                    )}
                    <p className="whitespace-pre-wrap text-[13px] text-white/80">{m.body}</p>
                    <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[10px] text-white/40">
                      <span>{mine ? 'You' : m.authorName}</span>
                      <span>{relativeDays(m.createdAt)}</span>
                      {mine && m.readAt && <span className="text-[#6DC6A4]">Seen</span>}
                      {mine && m.emailedAt && <span>Emailed</span>}
                      {m.kind === 'request' && m.requestStatus !== 'open' && (
                        <button type="button" className="underline decoration-white/20 hover:text-white" disabled={busy === m.id} onClick={() => void setStatus(m, 'open')}>
                          Reopen
                        </button>
                      )}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        )}

        <div className="space-y-2">
          <label htmlFor="ws-message" className="sr-only">Message to {contactName}</label>
          <textarea
            id="ws-message"
            rows={3}
            maxLength={4000}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send(); } }}
            placeholder={`Write to ${contactName}…`}
            className={FIELD}
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-[11px] text-white/60">
              <input type="checkbox" checked={email} onChange={(e) => setEmail(e.target.checked)} className="accent-white" />
              Email if they’re away
            </label>
            <button type="button" className={CONTROL} disabled={!draft.trim() || busy === 'send'} onClick={() => void send()}>
              {busy === 'send' ? 'Sending…' : 'Send'}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
