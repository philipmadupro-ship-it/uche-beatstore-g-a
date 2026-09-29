'use client';

/**
 * Linked material, in the track drawer: the pieces of one record.
 *
 *   LINKED
 *   Beat          MIDNIGHT                      ×
 *   Instrumental  NIGHT DRIVE (inst)            ×
 *   Loop          Keys 140                      ×
 *   [Auto ▾] [search your tracks…]
 *     + Keys 140 · loop        + Pad 90 · loop      (click to link)
 *   [Download all (.zip)]  [Share all]  [Send to…]
 *
 * One hop in both directions (a loop shows the beats that use it). "Download
 * all" is ONE zip of this track and everything linked; "Share all" makes one
 * share link of the set with downloads on; "Send to…" opens the usual Send
 * Beat flow with the set pre-selected. The relation is guessed from the type
 * of the track picked (lib/tracks/links#suggestRelation) and can be changed.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Download, Link2, Send, Share2, X } from 'lucide-react';
import { Dropdown } from '@/components/ui/Dropdown';
import { Popover } from '@/components/ui/Popover';
import { SendBeatModal } from '@/components/crm/SendBeatModal';
import { toast } from '@/hooks/useToast';
import { copyToClipboard } from '@/lib/clipboard';
import { linkLabel, relationChoices, suggestRelation, type LinkRelation } from '@/lib/tracks/links';
import type { Contact } from '@/lib/types';

interface LinkedRow {
  relation: LinkRelation;
  direction: 'out' | 'in';
  label: string;
  track: { id: string; title: string | null; type: string | null };
}

interface Candidate { id: string; title: string; type: string | null }

const H3 = 'mb-3 text-[9px] font-black uppercase tracking-[0.25em] text-white/40';
const CONTROL = 'inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.06] px-3 py-1.5 text-[11px] text-white/80 transition-colors hover:border-white/20 hover:bg-white/[0.10] disabled:opacity-40';

/** The track type a relation usually points at, to narrow the picker. */
const TYPE_FOR: Partial<Record<LinkRelation, string>> = { beat: 'beat', instrumental: 'instrumental', loop: 'loop', topline: 'topline' };

export function TrackLinkedSection({ trackId, trackTitle, trackType, onUpdate }: {
  trackId: string;
  trackTitle: string | null;
  trackType: string | null | undefined;
  onUpdate?: () => void;
}) {
  const [links, setLinks] = useState<LinkedRow[] | null>(null);
  /** 'auto' picks the relation from the linked track's type (suggestRelation). */
  const [relation, setRelation] = useState<LinkRelation | 'auto'>('auto');
  const [query, setQuery] = useState('');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [sendTo, setSendTo] = useState<Contact | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/tracks/${trackId}/links`);
      if (!res.ok) { setLinks([]); return; }
      setLinks(((await res.json()) as { links: LinkedRow[] }).links ?? []);
    } catch {
      setLinks([]);
    }
  }, [trackId]);
  useEffect(() => { void load(); }, [load]);

  // The picker: tracks of the type this relation usually points at, or any
  // type when the producer is searching by name.
  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      const params = new URLSearchParams({ limit: '20', lean: '1' });
      if (query.trim()) params.set('q', query.trim());
      else if (relation !== 'auto' && TYPE_FOR[relation]) params.set('type', TYPE_FOR[relation]!);
      else { setCandidates([]); return; }
      fetch(`/api/tracks?${params}`).then((r) => (r.ok ? r.json() : [])).then((d) => {
        if (!alive) return;
        const rows = (Array.isArray(d) ? d : d.tracks ?? []) as Array<{ id: string; title: string | null; type: string | null }>;
        setCandidates(rows.filter((r) => r.id !== trackId).map((r) => ({ id: r.id, title: r.title ?? 'Untitled', type: r.type })));
      }).catch(() => {});
    }, 200);
    return () => { alive = false; clearTimeout(t); };
  }, [query, relation, trackId]);

  const linkedIds = useMemo(() => new Set((links ?? []).map((l) => l.track.id)), [links]);
  const shown = useMemo(() => candidates.filter((c) => !linkedIds.has(c.id)).slice(0, 6), [candidates, linkedIds]);
  const relationFor = (c: Candidate): LinkRelation => {
    if (relation !== 'auto') return relation;
    const guess = suggestRelation(trackType ?? null, c.type);
    return relationChoices(trackType ?? null).includes(guess) ? guess : 'version';
  };

  const mutate = async (method: 'POST' | 'DELETE', body: { track_id: string; relation: LinkRelation; direction: 'out' | 'in' }) => {
    setBusy(body.track_id);
    try {
      const res = await fetch(`/api/tracks/${trackId}/links`, {
        method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
      setLinks((data as { links: LinkedRow[] }).links ?? []);
      onUpdate?.();
      return true;
    } catch (err) {
      toast.error(method === 'POST' ? 'Could not link' : 'Could not unlink', err instanceof Error ? err.message : 'Try again');
      return false;
    } finally {
      setBusy(null);
    }
  };

  const addLink = async (c: Candidate) => {
    if (await mutate('POST', { track_id: c.id, relation: relationFor(c), direction: 'out' })) setQuery('');
  };

  const setIds = [trackId, ...(links ?? []).map((l) => l.track.id)];

  const shareAll = async () => {
    setBusy('share');
    try {
      const res = await fetch('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ track_ids: setIds, title: `${trackTitle ?? 'Untitled'} + linked`, allow_downloads: true, kind: 'track' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !(data as { url?: string }).url) throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
      const url = (data as { url: string }).url;
      const copied = await copyToClipboard(url);
      toast.success(copied ? 'Share link copied' : 'Share link created', `${setIds.length} tracks, downloads on`);
    } catch (err) {
      toast.error('Could not create the share', err instanceof Error ? err.message : 'Try again');
    } finally {
      setBusy(null);
    }
  };

  if (links === null) return null;

  return (
    <div className="border-b border-white/10 px-6 py-5" data-testid="track-linked">
      <h3 className={H3}>Linked</h3>

      {links.length === 0 ? (
        <p className="mb-3 text-[11px] text-white/40">
          Nothing linked yet. Link the beat, instrumental, loops or topline that belong with this track, then download or send them together.
        </p>
      ) : (
        <ul className="mb-3 space-y-1" data-testid="linked-list">
          {links.map((l) => (
            <li key={`${l.relation}-${l.direction}-${l.track.id}`} className="flex items-center gap-2 text-[11px]">
              <span className="w-24 shrink-0 font-mono text-[10px] uppercase tracking-[0.2em] text-white/40">{l.label}</span>
              <Link href={`/library/${l.track.id}`} className="min-w-0 flex-1 truncate text-white/80 hover:text-white">{l.track.title ?? 'Untitled'}</Link>
              <button
                type="button"
                disabled={busy === l.track.id}
                onClick={() => void mutate('DELETE', { track_id: l.track.id, relation: l.relation, direction: l.direction })}
                aria-label={`Unlink ${l.track.title ?? 'track'}`}
                className="grid size-5 shrink-0 place-items-center rounded text-white/30 hover:bg-white/10 hover:text-white disabled:opacity-40"
              >
                <X size={11} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div className="w-36 shrink-0">
          <Dropdown
            value={relation}
            onChange={(v) => setRelation(v as LinkRelation | 'auto')}
            options={[{ value: 'auto', label: 'Auto (by type)' }, ...relationChoices(trackType ?? null).map((r) => ({ value: r, label: linkLabel(r, 'out') }))]}
            aria-label="What the linked track is"
          />
        </div>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search your tracks to link…"
          aria-label="Search tracks to link"
          className="min-w-0 flex-1 rounded-lg border border-white/10 bg-white/[0.06] px-3 py-1.5 text-[11px] text-white/80 placeholder:text-white/30 focus:border-white/30 focus:outline-none"
        />
      </div>
      {(query.trim() || relation !== 'auto') && (
        <ul className="mb-3 space-y-1" aria-label="Tracks you can link" data-testid="link-candidates">
          {shown.length === 0 ? (
            <li className="text-[11px] text-white/40">No matching tracks.</li>
          ) : shown.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                disabled={busy === c.id}
                onClick={() => void addLink(c)}
                aria-label={`Link ${c.title} as ${linkLabel(relationFor(c), 'out')}`}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-[11px] text-white/70 transition-colors hover:bg-white/[0.08] hover:text-white disabled:opacity-40"
              >
                <Link2 size={11} aria-hidden="true" className="shrink-0 text-white/40" />
                <span className="min-w-0 flex-1 truncate">{c.title}</span>
                <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.2em] text-white/40">{linkLabel(relationFor(c), 'out')}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <a href={`/api/tracks/${trackId}/links/zip`} download className={CONTROL} data-testid="download-linked-zip">
          <Download size={11} aria-hidden="true" /> {links.length ? `Download all (${setIds.length}) · zip` : 'Download · zip'}
        </a>
        <button type="button" className={CONTROL} disabled={busy === 'share'} onClick={() => void shareAll()}>
          <Share2 size={11} aria-hidden="true" /> Share all
        </button>
        <SendToContact onPick={setSendTo} />
      </div>

      {sendTo && (
        <SendBeatModal
          contact={sendTo}
          initialTrackIds={setIds}
          onClose={() => setSendTo(null)}
          onSuccess={() => { setSendTo(null); toast.success(`Sent ${setIds.length} tracks to ${sendTo.name}`); }}
        />
      )}
    </div>
  );
}

/** "Send to…": pick a contact, then the usual Send Beat flow opens with the set. */
function SendToContact({ onPick }: { onPick: (c: Contact) => void }) {
  const [open, setOpen] = useState(false);
  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const load = () => {
    if (contacts !== null) return;
    setContacts([]);
    fetch('/api/contacts').then((r) => (r.ok ? r.json() : [])).then((d) => {
      setContacts((Array.isArray(d) ? d : d.contacts ?? []) as Contact[]);
    }).catch(() => {});
  };
  return (
    <Popover
      width={260}
      open={open}
      onOpenChange={(v) => { setOpen(v); if (v) load(); }}
      initialFocus
      label="Send the set to a contact"
      trigger={({ toggle, ref }) => (
        <button type="button" ref={ref as (el: HTMLButtonElement | null) => void} onClick={toggle} className={CONTROL}>
          <Send size={11} aria-hidden="true" /> Send to…
        </button>
      )}
    >
      <div className="space-y-2 p-3">
        <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-white/40">Contact</p>
        {contacts === null || contacts.length === 0 ? (
          <p className="text-[11px] text-white/40">{contacts === null ? 'Loading…' : 'No contacts yet.'}</p>
        ) : (
          <Dropdown
            value=""
            onChange={(id) => { const c = contacts.find((x) => x.id === id); if (c) { setOpen(false); onPick(c); } }}
            options={[{ value: '', label: 'Pick a contact…' }, ...contacts.map((c) => ({ value: c.id, label: c.name }))]}
            aria-label="Contact to send to"
            menuWidth={236}
          />
        )}
      </div>
    </Popover>
  );
}
