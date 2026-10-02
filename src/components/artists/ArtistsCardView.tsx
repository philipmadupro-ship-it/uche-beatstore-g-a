'use client';

/**
 * The Artists (and Labels & A&R) view on /contacts: every contact in
 * workspace mode with that role as a card —
 * avatar, name, relationship stage, the project you are working on together,
 * what is moving, and what they have done with it. Everyone else is under
 * "Other contacts". Cards link to the workspace; the search matches a name,
 * a linked project or a stage (lib/contacts/audience).
 */

import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { searchArtists } from '@/lib/contacts/audience';
import Link from 'next/link';
import { Layers } from 'lucide-react';
import { ArtworkFallback } from '@/components/ui/ArtworkFallback';
import { relativeDays } from '@/components/crm/contacts-shared';
import { RELATIONSHIP_META } from '@/lib/contacts/relationship';
import { describeMoving, type ArtistSummary } from '@/lib/contacts/artist-summary';

const NOUNS = {
  artist: {
    one: 'artist', many: 'artists',
    empty: 'No artists yet. Open a contact and choose Start workspace — linking them to a project makes them an artist, with their own portal.',
  },
  label: {
    one: 'label', many: 'labels',
    empty: 'No label or A&R workspaces yet. Open a label contact and choose Start workspace — link them to a pack or a project and they get their own portal, like an artist.',
  },
} as const;

export function ArtistsCardView({ artists, ready, failed, kind = 'artist', linkFor, emptyText }: {
  /** From /api/contacts/artists, loaded by the page (it also splits the table by them). Null while loading. */
  artists: ArtistSummary[] | null;
  ready: boolean;
  failed: boolean;
  /** Which tab this is; only changes the wording. */
  kind?: keyof typeof NOUNS;
  /**
   * Where a card links. Defaults to the producer's workspace (/contacts/<id>).
   * Null renders the card without a link — the org roster (LABEL-10) until
   * the org artist workspace exists, so a card never points at a page the
   * viewer cannot open.
   */
  linkFor?: (contactId: string) => string | null;
  /** Overrides the empty-state copy (the producer's mentions Start workspace). */
  emptyText?: string;
}) {
  const noun = NOUNS[kind];
  const hrefOf = linkFor ?? ((id: string) => `/contacts/${id}`);
  const [query, setQuery] = useState('');
  const shown = useMemo(() => searchArtists(artists ?? [], query), [artists, query]);

  if (failed) return <p className="py-16 text-center text-[11px] text-white/40">Could not load {noun.many}. Reload to try again.</p>;
  if (!ready) return <p className="py-16 text-center text-[11px] text-white/40">The artist workspace needs migrations 122–129 applied on Supabase.</p>;
  if (artists === null) return <p className="py-16 text-center font-mono text-[10px] uppercase tracking-[0.2em] text-white/40">Loading {noun.many}…</p>;
  if (artists.length === 0) {
    return (
      <p className={kind === 'artist' ? 'mx-auto max-w-md py-16 text-center text-[11px] text-white/40' : 'rounded-xl border border-white/10 bg-[#0D0D0A] px-4 py-5 text-center text-[11px] text-white/40'}>
        {emptyText ?? noun.empty}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <label className="relative block max-w-sm">
        <span className="sr-only">Search {noun.many}</span>
        <Search size={13} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Search ${noun.many} or their projects…`}
          className="w-full rounded-lg border border-white/10 bg-white/[0.06] py-2 pl-8 pr-3 text-[11px] text-white/80 placeholder:text-white/30 focus:border-white/30 focus:outline-none"
        />
      </label>
      {shown.length === 0 && <p className="py-10 text-center text-[11px] text-white/40">No {noun.one} matches “{query}”.</p>}
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid={kind === 'artist' ? 'artists-cards' : 'labels-cards'}>
      {shown.map((a) => {
        const moving = describeMoving(a.decisions);
        const facts = [
          a.plays > 0 ? `Played ${a.plays}×` : null,
          a.downloads > 0 ? `${a.downloads} download${a.downloads === 1 ? '' : 's'}` : null,
          a.portal?.live ? (a.portal.lastViewedAt ? `opened ${relativeDays(a.portal.lastViewedAt)}` : 'portal not opened') : a.portal ? 'portal revoked' : null,
        ].filter(Boolean).join(' · ');
        const href = hrefOf(a.contact.id);
        const cardClass = 'flex h-full flex-col gap-3 rounded-xl border border-white/10 bg-[#0D0D0A] p-4';
        const body = (
          <>
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
          </>
        );
        return (
          <li key={a.contact.id}>
            {href ? (
              <Link href={href} className={`${cardClass} transition-colors hover:border-white/20`} data-testid={`artist-card-${a.contact.id}`}>
                {body}
              </Link>
            ) : (
              <div className={cardClass} data-testid={`artist-card-${a.contact.id}`}>{body}</div>
            )}
          </li>
        );
      })}
    </ul>
    </div>
  );
}
