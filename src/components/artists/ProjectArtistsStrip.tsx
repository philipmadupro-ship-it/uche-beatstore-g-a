'use client';

/**
 * The project page's Artists strip: every contact linked to this project,
 * each with portal status and the one action that matters here — Share (the
 * first time) or Notify · N new (after). "Add artist" links a contact.
 *
 * It also hands the parent every linked artist's decision per track, so each
 * track row can carry a small pill ("Artist #1 · Interested") without the
 * track list knowing anything about artists.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { BellRing, Send, UserPlus } from 'lucide-react';
import { Dropdown } from '@/components/ui/Dropdown';
import { toast } from '@/hooks/useToast';
import { isDecision, type Decision } from '@/lib/contacts/decisions';
import { relativeDays } from '@/components/crm/contacts-shared';
import { jsonOrThrow } from './types';

export interface ProjectArtist {
  contact: { id: string; name: string; email: string | null; avatar_url: string | null };
  link: { role: string; in_portal: boolean; allow_downloads: boolean; last_notified_at: string | null };
  portal: { url: string; revoked: boolean; last_viewed_at: string | null } | null;
  notifyCount: number;
}

export type TrackDecisions = Record<string, Array<{ contact_id: string; name: string; decision: Decision; set_by: string }>>;

export function ProjectArtistsStrip({ projectId, refreshKey, onDecisions }: {
  projectId: string;
  /** Bump to refetch (e.g. after tracks are added, which changes Notify counts). */
  refreshKey?: number;
  onDecisions?: (d: TrackDecisions) => void;
}) {
  const [artists, setArtists] = useState<ProjectArtist[] | null>(null);
  const [schemaReady, setSchemaReady] = useState(true);
  const [contacts, setContacts] = useState<Array<{ id: string; name: string }>>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/contacts`);
      if (!res.ok) return;
      const data = await res.json();
      setSchemaReady(data.schemaReady !== false);
      const list = (data.contacts ?? []) as ProjectArtist[];
      setArtists(list);
      const names = new Map(list.map((a) => [a.contact.id, a.contact.name]));
      const out: TrackDecisions = {};
      for (const [trackId, rows] of Object.entries((data.decisions ?? {}) as Record<string, Array<{ contact_id: string; decision: string; set_by: string }>>)) {
        out[trackId] = rows
          .filter((r) => isDecision(r.decision) && names.has(r.contact_id))
          .map((r) => ({ contact_id: r.contact_id, name: names.get(r.contact_id)!, decision: r.decision as Decision, set_by: r.set_by }));
      }
      onDecisions?.(out);
    } catch {
      // The strip is additive; the page works without it.
    }
  }, [projectId, onDecisions]);

  useEffect(() => { void load(); }, [load, refreshKey]);

  useEffect(() => {
    fetch('/api/contacts').then((r) => (r.ok ? r.json() : [])).then((d) => {
      const rows = (Array.isArray(d) ? d : d.contacts ?? []) as Array<{ id: string; name: string }>;
      setContacts(rows.map((c) => ({ id: c.id, name: c.name })));
    }).catch(() => {});
  }, []);

  const call = async (key: string, url: string, method: string, body: unknown, success: (d: Record<string, unknown>) => string) => {
    setBusy(key);
    try {
      const data = await jsonOrThrow<Record<string, unknown>>(await fetch(url, {
        method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      }));
      toast.success(success(data));
    } catch (err) {
      toast.error('Something went wrong', err instanceof Error ? err.message : 'Try again');
    } finally {
      setBusy(null);
      void load();
    }
  };

  if (!schemaReady || artists === null) return null;
  const linked = new Set(artists.map((a) => a.contact.id));
  const addable = contacts.filter((c) => !linked.has(c.id));

  return (
    <section aria-label="Artists on this project" className="mb-6" data-testid="project-artists-strip">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-[10px] font-mono uppercase tracking-[0.2em] text-white/40">Artists</span>
        {artists.map((a) => {
          const live = a.portal && !a.portal.revoked && a.link.in_portal;
          return (
            <div key={a.contact.id} className="flex items-center gap-2 rounded-xl border border-white/10 bg-[#0D0D0A] py-1 pl-1 pr-2">
              <Link href={`/contacts/${a.contact.id}?tab=projects`} className="flex items-center gap-2 rounded-lg pr-1 hover:bg-white/[0.06]">
                <span className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-full border border-white/10 bg-white/[0.06] text-[11px] text-white/80">
                  {a.contact.avatar_url
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={a.contact.avatar_url} alt="" className="h-full w-full object-cover" />
                    : a.contact.name[0]?.toUpperCase()}
                </span>
                <span className="text-[11px] text-white/80">{a.contact.name}</span>
              </Link>
              <span className="text-[11px] text-white/40">
                {live ? (a.portal!.last_viewed_at ? `opened ${relativeDays(a.portal!.last_viewed_at)}` : 'not opened') : 'not shared'}
              </span>
              {!a.link.in_portal || !live ? (
                <button
                  type="button"
                  disabled={busy === a.contact.id || !a.contact.email}
                  title={a.contact.email ? `Put this project in ${a.contact.name}'s portal and email them` : 'This contact has no email'}
                  onClick={() => call(a.contact.id, `/api/projects/${projectId}/contacts/${a.contact.id}/share`, 'POST', {}, () => `Shared with ${a.contact.name}`)}
                  className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.06] px-2 py-1 text-[11px] text-white/80 hover:border-white/20 hover:bg-white/[0.10] disabled:opacity-40"
                >
                  <Send size={11} aria-hidden="true" /> Share
                </button>
              ) : (
                <button
                  type="button"
                  disabled={busy === a.contact.id || a.notifyCount === 0}
                  title={a.notifyCount === 0 ? 'Nothing new since the last notify' : `Email ${a.contact.name} about ${a.notifyCount} new`}
                  onClick={() => call(a.contact.id, `/api/contacts/${a.contact.id}/notify`, 'POST', {}, (d) => `Notified ${a.contact.name} · ${d.itemCount} new`)}
                  className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.06] px-2 py-1 text-[11px] text-white/80 hover:border-white/20 hover:bg-white/[0.10] disabled:opacity-40"
                >
                  <BellRing size={11} aria-hidden="true" /> Notify{a.notifyCount > 0 ? ` · ${a.notifyCount} new` : ''}
                </button>
              )}
            </div>
          );
        })}
        {addable.length > 0 && (
          <div className="flex items-center gap-1 text-white/50">
            <UserPlus size={12} aria-hidden="true" />
            <Dropdown
              value=""
              onChange={(v) => { if (v) void call(`add-${v}`, `/api/projects/${projectId}/contacts`, 'POST', { contact_id: v }, () => 'Artist linked'); }}
              options={addable.map((c) => ({ value: c.id, label: c.name }))}
              placeholder="Add artist"
              aria-label="Add an artist to this project"
              menuWidth={240}
            />
          </div>
        )}
      </div>
    </section>
  );
}

/** The pill line under a track row: one pill per linked artist with a decision. */
export function TrackDecisionPills({ rows }: { rows: TrackDecisions[string] | undefined }) {
  if (!rows || rows.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5 pb-2 pl-12" data-testid="track-decision-pills">
      {rows.map((r) => (
        <span key={r.contact_id} className={`rounded-lg border px-2 py-0.5 text-[10px] ${r.decision === 'interested' ? 'border-[#6DC6A4]/40 text-[#6DC6A4]' : r.decision === 'passed' ? 'border-white/10 text-white/40' : 'border-white/20 text-white/70'}`}>
          {r.name} · {r.decision.charAt(0).toUpperCase() + r.decision.slice(1)}
        </span>
      ))}
    </div>
  );
}
