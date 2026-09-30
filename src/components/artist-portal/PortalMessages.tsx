'use client';

/**
 * The artist's conversation with the producer, in the portal's Messages tab.
 * One thread (not per beat — comments cover that), plus "Ask for something":
 * a request the producer marks done or declined, which the artist sees here.
 */

import { useEffect, useRef, useState } from 'react';
import { Dropdown } from '@/components/ui/Dropdown';
import type { ArtistMessage } from '@/lib/artist-messages/messages';

const STATUS: Record<'open' | 'done' | 'declined', { label: string; className: string }> = {
  open: { label: 'Waiting', className: 'text-white/50' },
  done: { label: 'Done', className: 'text-[#6DC6A4]' },
  declined: { label: 'Declined', className: 'text-white/40' },
};

export function PortalMessages({ messages, producerName, projects, onSend }: {
  messages: ArtistMessage[];
  producerName: string;
  projects: Array<{ id: string; name: string }>;
  onSend: (input: { body: string; kind: 'message' | 'request'; projectId: string | null }) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState('');
  const [kind, setKind] = useState<'message' | 'request'>('message');
  const [projectId, setProjectId] = useState<string>('');
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLOListElement>(null);
  const producer = producerName || 'your producer';

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const submit = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    const ok = await onSend({ body: text, kind, projectId: kind === 'request' && projectId ? projectId : null });
    setSending(false);
    if (ok) { setDraft(''); setKind('message'); setProjectId(''); }
  };

  return (
    <div className="space-y-4" data-testid="portal-messages">
      {messages.length === 0 ? (
        <p className="rounded-xl border border-white/10 bg-[#0D0D0A] px-4 py-8 text-center text-sm text-white/40">
          Nothing here yet. Write to {producer}, or ask for something — a darker beat, an alt version, stems.
        </p>
      ) : (
        <ol ref={listRef} className="max-h-[32rem] space-y-3 overflow-y-auto rounded-xl border border-white/10 bg-[#0D0D0A] p-4" aria-live="polite">
          {messages.map((m) => {
            const mine = m.author === 'artist';
            return (
              <li key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-xl border px-3 py-2 ${mine ? 'border-white/20 bg-white/[0.08]' : 'border-white/10 bg-white/[0.03]'}`}>
                  {m.kind === 'request' && m.requestStatus && (
                    <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.2em] text-[#c8a47a]">
                      Request{m.projectName ? ` · ${m.projectName}` : ''} · <span className={STATUS[m.requestStatus].className}>{STATUS[m.requestStatus].label}</span>
                    </p>
                  )}
                  <p className="whitespace-pre-wrap text-sm text-white/80">{m.body}</p>
                  <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.2em] text-white/40">
                    {mine ? 'You' : m.authorName} · {new Date(m.createdAt).toLocaleDateString()}
                    {!mine && !m.readAt && <span className="ml-2 text-[#6DC6A4]">New</span>}
                    {mine && m.readAt && <span className="ml-2">Seen</span>}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <div role="radiogroup" aria-label="What are you sending?" className="flex gap-2">
          {(['message', 'request'] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={kind === k}
              onClick={() => setKind(k)}
              className={`rounded-lg border px-3 py-1.5 text-xs transition-colors ${kind === k ? 'border-white/30 bg-white/[0.14] text-white' : 'border-white/10 bg-white/[0.06] text-white/60 hover:border-white/20 hover:bg-white/[0.10]'}`}
            >
              {k === 'message' ? 'Message' : 'Ask for something'}
            </button>
          ))}
        </div>
        <label className="block">
          <span className="sr-only">{kind === 'request' ? 'What do you need?' : `Message to ${producer}`}</span>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void submit(); } }}
            rows={3}
            maxLength={4000}
            placeholder={kind === 'request' ? 'What do you need? e.g. “something darker, around 140”' : `Write to ${producer}…`}
            className="w-full resize-y rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2 text-sm text-white/80 placeholder:text-white/30 focus:border-white/30 focus:outline-none"
          />
        </label>
        <div className="flex flex-wrap items-center justify-between gap-3">
          {kind === 'request' && projects.length > 0 ? (
            <div className="w-56">
              <Dropdown
                value={projectId || 'none'}
                onChange={(v) => setProjectId(v === 'none' ? '' : v)}
                options={[{ value: 'none', label: 'Not about a project' }, ...projects.map((p) => ({ value: p.id, label: p.name }))]}
                aria-label="Project"
              />
            </div>
          ) : <span />}
          <button
            type="submit"
            disabled={sending || !draft.trim()}
            className="rounded-lg border border-white/10 bg-white/[0.06] px-3 py-1.5 text-xs text-white/80 transition-colors hover:border-white/20 hover:bg-white/[0.10] disabled:opacity-40"
          >
            {sending ? 'Sending…' : kind === 'request' ? 'Send request' : 'Send'}
          </button>
        </div>
      </form>
    </div>
  );
}
