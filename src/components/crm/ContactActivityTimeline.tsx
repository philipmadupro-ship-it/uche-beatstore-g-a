'use client';

/**
 * ContactActivityTimeline — the CRM contact's unified story.
 *
 * Fetches /api/contacts/[id]/activity, which merges:
 *   - stored notes / stage changes / logged purchases
 *   - derived beat-send events (sent / opened / clicked)
 *   - purchases matched by buyer email
 *
 * Renders an engagement summary strip, an "add note" input, and the
 * newest-first timeline. Self-contained: owns its own fetch + refresh so
 * the parent page doesn't need rewiring.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Send, MailOpen, MousePointerClick, ShoppingBag, StickyNote,
  GitBranch, Play, Clock, Loader2, Plus,
} from 'lucide-react';
import type { ContactActivity, EngagementSummary, ActivityKind } from '@/lib/contacts/activity';

interface Props {
  contactId: string;
  contactName: string;
  onSendBeat?: () => void;
}

const KIND_META: Record<ActivityKind, { icon: React.ComponentType<{ size?: number }>; tint: string; ring: string }> = {
  beat_sent:    { icon: Send,                tint: '#8A7A5C', ring: 'rgba(138,122,92,0.25)' },
  email_opened: { icon: MailOpen,            tint: '#6DC6A4', ring: 'rgba(109,198,164,0.25)' },
  link_clicked: { icon: MousePointerClick,   tint: '#6DC6A4', ring: 'rgba(109,198,164,0.25)' },
  track_played: { icon: Play,                tint: '#9d95e8', ring: 'rgba(157,149,232,0.25)' },
  purchase:     { icon: ShoppingBag,         tint: '#D4BFA0', ring: 'rgba(212,191,160,0.30)' },
  note:         { icon: StickyNote,          tint: '#a08a6a', ring: 'rgba(160,138,106,0.20)' },
  stage_change: { icon: GitBranch,           tint: '#a08a6a', ring: 'rgba(160,138,106,0.20)' },
};

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function ContactActivityTimeline({ contactId, contactName, onSendBeat }: Props) {
  const [timeline, setTimeline] = useState<ContactActivity[]>([]);
  const [summary, setSummary] = useState<EngagementSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [noteText, setNoteText] = useState('');
  const [savingNote, setSavingNote] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/contacts/${contactId}/activity`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setTimeline(data.timeline ?? []);
      setSummary(data.summary ?? null);
    } catch {
      // leave empty; parent shows the rest of the page regardless
    } finally {
      setLoading(false);
    }
  }, [contactId]);

  useEffect(() => { void load(); }, [load]);

  async function addNote(e: React.FormEvent) {
    e.preventDefault();
    const text = noteText.trim();
    if (!text || savingNote) return;
    setSavingNote(true);
    try {
      const res = await fetch(`/api/contacts/${contactId}/activity`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'note', title: text }),
      });
      if (res.ok) {
        setNoteText('');
        await load();
      }
    } finally {
      setSavingNote(false);
    }
  }

  const summaryChips: Array<{ label: string; value: string | number; accent?: boolean }> = summary
    ? [
        { label: 'Sends', value: summary.sends },
        { label: 'Opens', value: summary.opens },
        { label: 'Clicks', value: summary.clicks },
        { label: 'Purchases', value: summary.purchases, accent: summary.purchases > 0 },
        { label: 'Revenue', value: summary.revenue > 0 ? `$${summary.revenue.toLocaleString()}` : '$0', accent: summary.revenue > 0 },
      ]
    : [];

  return (
    <section>
      <h2 className="text-[10px] font-mono uppercase tracking-[0.2em] text-[#6a5d4a] mb-3 flex items-center gap-2">
        <Clock size={11} /> Activity
      </h2>

      {/* Engagement summary strip */}
      {summary && (
        <div className="flex flex-wrap gap-2 mb-4">
          {summaryChips.map((c) => (
            <div
              key={c.label}
              className="flex flex-col items-center px-3.5 py-2 rounded-xl border min-w-[64px]"
              style={{
                background: c.accent ? 'rgba(212,191,160,0.08)' : 'rgba(255,255,255,0.02)',
                borderColor: c.accent ? 'rgba(212,191,160,0.25)' : '#1f1a13',
              }}
            >
              <span className="text-[15px] font-bold tabular-nums" style={{ color: c.accent ? '#D4BFA0' : '#E8DCC8' }}>
                {c.value}
              </span>
              <span className="text-[8px] font-mono uppercase tracking-[0.15em] text-[#5a5142] mt-0.5">{c.label}</span>
            </div>
          ))}
        </div>
      )}

      {/* Add note */}
      <form onSubmit={addNote} className="flex gap-2 mb-4">
        <input
          value={noteText}
          onChange={(e) => setNoteText(e.target.value)}
          placeholder="Add a note to the timeline…"
          className="flex-1 bg-white/[0.02] border border-[#1f1a13] rounded-lg px-3 py-2 text-[12px] text-[#E8DCC8] placeholder:text-[#3a3328] focus:outline-none focus:border-[#2d2620]"
        />
        <button
          type="submit"
          disabled={!noteText.trim() || savingNote}
          className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/[0.05] border border-white/[0.08] text-[11px] font-mono uppercase tracking-wider text-[#a08a6a] hover:text-[#E8DCC8] disabled:opacity-40 transition-colors"
        >
          {savingNote ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
          Note
        </button>
      </form>

      {/* Timeline */}
      {loading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 size={16} className="animate-spin text-[#3a3328]" />
        </div>
      ) : timeline.length === 0 ? (
        <div className="text-center py-12 border border-dashed border-[#1f1a13] rounded-xl">
          <p className="text-[11px] text-[#6a5d4a] mb-3">No activity yet</p>
          {onSendBeat && (
            <button
              onClick={onSendBeat}
              className="inline-flex items-center gap-2 text-[11px] text-[#E8D8B8] hover:text-white"
            >
              <Send size={11} /> Send your first beat to {contactName}
            </button>
          )}
        </div>
      ) : (
        <ol className="relative space-y-1 before:absolute before:left-[15px] before:top-2 before:bottom-2 before:w-px before:bg-[#1f1a13]">
          {timeline.map((a) => {
            const meta = KIND_META[a.kind] ?? KIND_META.note;
            const Icon = meta.icon;
            return (
              <li key={a.id} className="relative flex items-start gap-3 pl-0 py-2">
                {/* Node */}
                <span
                  className="relative z-10 shrink-0 w-8 h-8 rounded-full flex items-center justify-center"
                  style={{ background: '#14110d', border: `1px solid ${meta.ring}`, color: meta.tint }}
                >
                  <Icon size={13} />
                </span>
                {/* Body */}
                <div className="min-w-0 flex-1 pt-0.5">
                  <p className="text-[12.5px] text-[#E8DCC8] leading-snug">{a.title}</p>
                  {a.body && <p className="text-[11px] text-[#6a5d4a] mt-0.5">{a.body}</p>}
                  <p className="text-[10px] font-mono text-[#5a5142] mt-1">{relativeTime(a.occurredAt)}</p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
