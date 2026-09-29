'use client';

/**
 * The Artists view on /contacts: every contact in workspace mode as a card —
 * avatar, name, relationship stage, the project you are working on together,
 * what is moving, and what they have done with it. Everyone else stays in the
 * Network table. Cards link to the workspace.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Layers } from 'lucide-react';
import { ArtworkFallback } from '@/components/ui/ArtworkFallback';
import { relativeDays } from '@/components/crm/contacts-shared';
import { RELATIONSHIP_META } from '@/lib/contacts/relationship';
import { describeMoving, type ArtistSummary } from '@/lib/contacts/artist-summary';

export function ArtistsCardView() {
  const [artists, setArtists] = useState<ArtistSummary[] | null>(null);
  const [ready, setReady] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch('/api/contacts/artists')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { schemaReady: boolean; artists: ArtistSummary[] }) => {
        if (!alive) return;
        setReady(d.schemaReady !== false);
        setArtists(d.artists ?? []);
      })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, []);

  if (failed) return <p className="py-16 text-center text-[11px] text-white/40">Could not load artists. Reload to try again.</p>;
  if (!ready) return <p className="py-16 text-center text-[11px] text-white/40">The artist workspace needs migrations 122–129 applied on Supabase.</p>;
  if (artists === null) return <p className="py-16 text-center font-mono text-[10px] uppercase tracking-[0.2em] text-white/40">Loading artists…</p>;
  if (artists.length === 0) {
    return (
      <p className="mx-auto max-w-md py-16 text-center text-[11px] text-white/40">
        No artists yet. Open a contact and choose Start workspace — linking them to a project makes them an artist, with their own portal.
      </p>
    );
  }

  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="artists-cards">
      {artists.map((a) => {
        const moving = describeMoving(a.decisions);
        const facts = [
          a.plays > 0 ? `Played ${a.plays}×` : null,
          a.downloads > 0 ? `${a.downloads} download${a.downloads === 1 ? '' : 's'}` : null,
          a.portal?.live ? (a.portal.lastViewedAt ? `opened ${relativeDays(a.portal.lastViewedAt)}` : 'portal not opened') : a.portal ? 'portal revoked' : null,
        ].filter(Boolean).join(' · ');
        return (
          <li key={a.contact.id}>
            <Link
              href={`/contacts/${a.contact.id}`}
              className="flex h-full flex-col gap-3 rounded-xl border border-white/10 bg-[#0D0D0A] p-4 transition-colors hover:border-white/20"
              data-testid={`artist-card-${a.contact.id}`}
            >
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-white/10 bg-white/[0.06] text-[13px] text-white/80">
                  {a.contact.avatar_url
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={a.contact.avatar_url} alt="" className="h-full w-full object-cover" />
                    : a.contact.name[0]?.toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-white/90">{a.contact.name}</span>
                  <span className="block text-[11px] text-white/50">
                    {RELATIONSHIP_META[a.relationship.stage].label}
                    {a.relationship.parked && <span className="text-white/30"> · parked</span>}
                  </span>
                </span>
                {a.notifyCount > 0 && (
                  <span className="shrink-0 rounded-lg border border-[#6DC6A4]/40 px-2 py-0.5 text-[10px] text-[#6DC6A4]" title="New in their portal since the last notify">
                    {a.notifyCount} to notify
                  </span>
                )}
              </div>

              {a.activeProject ? (
                <div className="flex items-center gap-3">
                  <span className="relative h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-white/[0.06]">
                    <ArtworkFallback src={a.activeProject.cover_url} seed={a.activeProject.id} kind="project" sizes="40px" className="object-cover">
                      <Layers size={14} className="text-white/30" aria-hidden="true" />
                    </ArtworkFallback>
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[11px] text-white/70">{a.activeProject.name}</span>
                    <span className="block text-[11px] text-white/40">
                      {a.projectCount > 1 ? `+${a.projectCount - 1} more project${a.projectCount === 2 ? '' : 's'}` : 'Active project'}
                    </span>
                  </span>
                </div>
              ) : (
                <p className="text-[11px] text-white/30">No active project</p>
              )}

              <p className={`text-[11px] ${moving ? 'text-[#6DC6A4]' : 'text-white/30'}`}>{moving || 'Nothing moving yet'}</p>
              {facts && <p className="mt-auto text-[11px] text-white/40">{facts}</p>}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
