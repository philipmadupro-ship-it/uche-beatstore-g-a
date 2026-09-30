'use client';

/**
 * The top of the Producers and Labels & A&R tabs on /contacts: one card per
 * contact in that role with what matters for that relationship, and the
 * send that fits it (lib/contacts/roles):
 *
 *   PRODUCERS        Kofi · also Artist        12 loops sent · 3 credits   [Send loops]
 *   LABELS & A&R     Ada (A&R)                 4 toplines · 2 packs        [Send toplines] [Send a pack]
 *
 * The full table (stages, tags, bulk actions) stays underneath, filtered to
 * the same people.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Send } from 'lucide-react';
import { relativeDays } from '@/components/crm/contacts-shared';
import { ROLE_SENDS, otherRoleBadge, type RoleGroup } from '@/lib/contacts/roles';

export interface RoleSummary {
  contact: { id: string; name: string; email: string | null; avatar_url: string | null; category: string | null; secondary_category: string | null };
  sent: { beats: number; loops: number; toplines: number; songs: number; packs: number };
  lastSentAt: string | null;
  credited: { total: number; loops: number };
}

/** Most recently contacted first; the rest one click away, never silently dropped. */
const CARDS_SHOWN = 9;

export type RoleSendPreset = (typeof ROLE_SENDS)[RoleGroup][number];

function facts(group: 'producer' | 'label', s: RoleSummary): string {
  const n = (count: number, word: string) => (count ? `${count} ${word}${count === 1 ? '' : 's'}` : null);
  const parts = group === 'producer'
    ? [n(s.sent.loops, 'loop'), n(s.sent.beats, 'beat'), s.credited.total ? `${s.credited.total} credit${s.credited.total === 1 ? '' : 's'}${s.credited.loops ? ` (${s.credited.loops} loop${s.credited.loops === 1 ? '' : 's'})` : ''}` : null]
    : [n(s.sent.toplines, 'topline'), n(s.sent.packs, 'pack'), n(s.sent.songs, 'song'), n(s.sent.beats, 'beat')];
  return parts.filter(Boolean).join(' · ') || 'Nothing sent yet';
}

export function RoleSummaryStrip({ group, onSend }: {
  group: 'producer' | 'label';
  onSend: (contactId: string, preset: RoleSendPreset) => void;
}) {
  const [rows, setRows] = useState<RoleSummary[] | null>(null);
  const [all, setAll] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch(`/api/contacts/roles?group=${group}`)
      .then((r) => (r.ok ? r.json() : { contacts: [] }))
      .then((d: { contacts: RoleSummary[] }) => { if (alive) setRows(d.contacts ?? []); })
      .catch(() => { if (alive) setRows([]); });
    return () => { alive = false; };
  }, [group]);

  if (rows === null) return <p className="mb-4 font-mono text-[10px] uppercase tracking-[0.2em] text-white/40">Loading…</p>;
  if (rows.length === 0) {
    return (
      <p className="mb-6 rounded-xl border border-white/10 bg-[#0D0D0A] px-4 py-6 text-center text-[11px] text-white/40">
        {group === 'producer'
          ? 'No producers yet. Set a contact’s role (or extra role) to Producer to see loops sent and shared credits here.'
          : 'No labels or A&R yet. Set a contact’s role (or extra role) to Label, A&R or Manager to see toplines and packs sent here.'}
      </p>
    );
  }

  const shown = all ? rows : rows.slice(0, CARDS_SHOWN);
  return (
    <div className="mb-6">
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid={`role-strip-${group}`}>
      {shown.map((s) => {
        const badge = otherRoleBadge(s.contact, false, group);
        return (
          <li key={s.contact.id} className="flex flex-col gap-3 rounded-xl border border-white/10 bg-[#0D0D0A] p-4" data-testid={`role-card-${s.contact.id}`}>
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border border-white/10 bg-white/[0.06] text-[11px] text-white/80">
                {s.contact.avatar_url
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={s.contact.avatar_url} alt="" className="h-full w-full object-cover" />
                  : s.contact.name[0]?.toUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                <Link href={`/contacts/${s.contact.id}`} className="block truncate text-[13px] text-white/90 hover:text-white">{s.contact.name}</Link>
                <span className="block text-[11px] text-white/40">
                  {s.contact.category || 'No role'}{badge ? ` · ${badge}` : ''}
                  {s.lastSentAt ? ` · sent ${relativeDays(s.lastSentAt)}` : ''}
                </span>
              </span>
            </div>
            <p className="text-[11px] text-white/60">{facts(group, s)}</p>
            <div className="flex flex-wrap gap-2">
              {ROLE_SENDS[group].map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => onSend(s.contact.id, preset)}
                  disabled={!s.contact.email}
                  title={s.contact.email ? undefined : 'Add an email to send'}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.06] px-3 py-1.5 text-[11px] text-white/80 transition-colors hover:border-white/20 hover:bg-white/[0.10] disabled:opacity-40"
                >
                  <Send size={11} aria-hidden="true" /> {preset.label}
                </button>
              ))}
            </div>
          </li>
        );
      })}
    </ul>
    {rows.length > CARDS_SHOWN && (
      <button type="button" onClick={() => setAll(!all)} className="mt-3 text-[11px] text-white/50 hover:text-white">
        {all ? 'Show fewer' : `Show all ${rows.length}`}
      </button>
    )}
    </div>
  );
}
