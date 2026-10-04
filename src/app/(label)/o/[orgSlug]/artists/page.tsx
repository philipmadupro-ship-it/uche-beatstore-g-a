'use client';

/**
 * `/o/<slug>/artists` — the org's artist roster (LABEL-10, 17 R3, 07 §2.2):
 * its contacts in workspace mode or with an artist role, drawn with the
 * same `ArtistsCardView` cards as the producer's /contacts (R12: no parallel
 * set of components). A member limited to some artists sees only those; one
 * limited to none sees an empty roster and is told why.
 *
 * Each card opens the artist's org workspace (LABEL-17,
 * /o/<slug>/artists/<contactId>). Adding and editing people is the
 * /api/org/[orgId]/contacts routes; the page stays the roster list.
 */
import { useEffect, useMemo, useState } from 'react';
import { PageContainer } from '@/components/layout/PageHeader';
import { ArtistsCardView } from '@/components/artists/ArtistsCardView';
import { OrgUploadPanel } from '@/components/labelos/OrgUploadPanel';
import { useOrgShell } from '@/components/labelos/OrgShellContext';
import { rosterSummary } from '@/lib/labelos/roster';
import { ORG_KIND_LABELS } from '@/lib/labelos/switcher';
import type { OrgContactView } from '@/lib/labelos/org-contacts';

type Load = { state: 'loading' } | { state: 'failed' } | { state: 'ready'; contacts: OrgContactView[] };

export default function OrgArtistsPage() {
  const shell = useOrgShell();
  const orgId = shell?.org.id ?? null;
  const [load, setLoad] = useState<Load>({ state: 'loading' });

  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    fetch(`/api/org/${orgId}/contacts?view=roster`, { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as { contacts?: OrgContactView[] };
        if (!cancelled) setLoad({ state: 'ready', contacts: body.contacts ?? [] });
      })
      .catch(() => {
        if (!cancelled) setLoad({ state: 'failed' });
      });
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  const artists = useMemo(() => (load.state === 'ready' ? load.contacts.map(rosterSummary) : null), [load]);
  const uploadArtists = useMemo(() => (load.state === 'ready' ? load.contacts.map((c) => ({ id: c.id, name: c.name })) : []), [load]);

  if (!shell) return null;
  const limited = shell.scope === 'artists' || shell.role === 'artist';
  const empty = limited
    ? 'You have not been given any artists in this organization yet. An owner or admin chooses them on the Members page.'
    : shell.org.kind === 'artist'
      ? 'This organization’s artist is missing. Ask its owner.'
      : 'No artists yet. People in this organization’s directory with an artist role appear here.';

  return (
    <PageContainer>
      <header className="mb-6 sm:mb-8">
        <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-white/60">
          {ORG_KIND_LABELS[shell.org.kind]} · {shell.org.name}
        </p>
        <h1 className="font-heading text-[28px] font-bold leading-[1.05] tracking-tight text-white sm:text-[32px] md:text-[40px]">
          Artists
        </h1>
        <p className="mt-2 max-w-xl text-[11px] leading-relaxed text-white/70">
          {limited ? 'The artists you work on in this organization.' : 'Everyone on this organization’s roster.'}
        </p>
      </header>
      {/* LABEL-14: demos and material go straight into the roster (W3). */}
      {shell.capabilities.includes('catalog.write') && <OrgUploadPanel orgId={shell.org.id} artists={uploadArtists} />}
      <ArtistsCardView
        artists={artists}
        ready
        failed={load.state === 'failed'}
        linkFor={(id) => `/o/${shell.org.slug}/artists/${id}`}
        emptyText={empty}
      />
    </PageContainer>
  );
}
