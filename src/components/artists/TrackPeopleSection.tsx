'use client';

/**
 * "Who has this?" in the track drawer, plus the song → beat link.
 *
 *   People      Artist #1 · New EP · Interested · played 3×
 *   Songs       songs built on this beat
 *   Built on    (songs only) the beat this song is built on — change it here
 *
 * Every row links through to the workspace, the project or the song, which is
 * what makes the connections navigable without a graph view. Renders nothing
 * for a beat nobody has, and nothing at all before migrations 122–126.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Dropdown, type DropdownOption } from '@/components/ui/Dropdown';
import { toast } from '@/hooks/useToast';
import { DECISION_META, isDecision } from '@/lib/contacts/decisions';
import { ENGAGEMENT_LABEL, type TrackEngagement } from '@/lib/contacts/track-engagement';
import { jsonOrThrow } from './types';

interface Person {
  contact: { id: string; name: string };
  projects: Array<{ id: string; name: string; inPortal: boolean }>;
  decision: string | null;
  engagement: TrackEngagement | null;
}

interface PeopleResponse {
  schemaReady: boolean;
  people: Person[];
  songs: Array<{ id: string; title: string | null; status: string | null }>;
  builtOn: { id: string; title: string } | null;
}

const H3 = 'mb-3 text-[9px] font-black uppercase tracking-[0.25em] text-white/40';

export function TrackPeopleSection({ trackId, trackType, onUpdate }: {
  trackId: string;
  trackType: string | null | undefined;
  onUpdate?: () => void;
}) {
  const [data, setData] = useState<PeopleResponse | null>(null);
  const [beats, setBeats] = useState<Array<{ id: string; title: string }>>([]);
  const [saving, setSaving] = useState(false);
  const isSong = trackType === 'song';

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/tracks/${trackId}/people`);
      if (res.ok) setData(await res.json());
    } catch {
      // Optional section.
    }
  }, [trackId]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!isSong) return;
    fetch('/api/tracks?type=beat').then((r) => (r.ok ? r.json() : [])).then((d) => {
      const rows = (Array.isArray(d) ? d : d.tracks ?? []) as Array<{ id: string; title: string }>;
      setBeats(rows.filter((t) => t.id !== trackId).map((t) => ({ id: t.id, title: t.title })));
    }).catch(() => {});
  }, [isSong, trackId]);

  const beatOptions: DropdownOption[] = useMemo(() => {
    const opts: DropdownOption[] = [{ value: 'none', label: 'Not set' }, ...beats.map((b) => ({ value: b.id, label: b.title }))];
    // Keep the current beat selectable even if it is not in the list yet.
    if (data?.builtOn && !beats.some((b) => b.id === data.builtOn!.id)) opts.push({ value: data.builtOn.id, label: data.builtOn.title });
    return opts;
  }, [beats, data?.builtOn]);

  const setBuiltOn = async (beatId: string | null) => {
    setSaving(true);
    try {
      await jsonOrThrow(await fetch(`/api/tracks/${trackId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ beat_track_id: beatId }),
      }));
      await load();
      onUpdate?.();
    } catch (err) {
      toast.error('Could not set the beat', err instanceof Error ? err.message : 'Try again');
    } finally {
      setSaving(false);
    }
  };

  if (!data || !data.schemaReady) return null;
  const hasPeople = data.people.length > 0;
  const hasSongs = data.songs.length > 0;
  if (!hasPeople && !hasSongs && !isSong) return null;

  return (
    <div className="border-b border-white/10 px-6 py-5" data-testid="track-people">
      {isSong && (
        <div className="mb-5">
          <h3 className={H3}>Built on</h3>
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <Dropdown
                value={data.builtOn?.id ?? 'none'}
                onChange={(v) => void setBuiltOn(v === 'none' ? null : v)}
                options={beatOptions}
                disabled={saving}
                menuWidth={260}
                aria-label="Beat this song is built on"
              />
            </div>
            {data.builtOn && (
              <Link href={`/library/${data.builtOn.id}`} className="shrink-0 text-[11px] text-white/50 hover:text-white">Open beat</Link>
            )}
          </div>
        </div>
      )}

      {hasPeople && (
        <div className={hasSongs ? 'mb-5' : ''}>
          <h3 className={H3}>People</h3>
          <ul className="space-y-1.5">
            {data.people.map((p) => {
              const decision = isDecision(p.decision) ? DECISION_META[p.decision].label : null;
              const eng = p.engagement?.step
                ? (p.engagement.step === 'played' && p.engagement.plays > 1 ? `played ${p.engagement.plays}×` : ENGAGEMENT_LABEL[p.engagement.step].toLowerCase())
                : null;
              return (
                <li key={p.contact.id} className="flex flex-wrap items-baseline gap-x-1.5 text-[12px] text-white/60">
                  <Link href={`/contacts/${p.contact.id}?tab=beats`} className="text-white/80 hover:text-white">{p.contact.name}</Link>
                  {p.projects.map((pr) => (
                    <span key={pr.id}>· <Link href={`/projects/${pr.id}`} className="hover:text-white">{pr.name}</Link></span>
                  ))}
                  {decision && <span className={p.decision === 'interested' ? 'text-[#6DC6A4]' : 'text-white/80'}>· {decision}</span>}
                  {eng && <span className="text-white/40">· {eng}</span>}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {hasSongs && (
        <div>
          <h3 className={H3}>Songs built on this beat</h3>
          <ul className="space-y-1.5">
            {data.songs.map((s) => (
              <li key={s.id} className="text-[12px]">
                <Link href={`/library/${s.id}`} className="text-white/80 hover:text-white">{s.title ?? 'Untitled'}</Link>
                {s.status && <span className="text-white/40"> · {s.status.replace('_', ' ')}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
