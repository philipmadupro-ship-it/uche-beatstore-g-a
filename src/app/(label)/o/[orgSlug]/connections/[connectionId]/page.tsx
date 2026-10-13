/**
 * `/o/<slug>/connections/<connectionId>` — the music a connected artist org
 * shares with this label (LABEL-41). A server page: the connection is
 * authorised here with requireConnectionOfLabel (the org's own, active, the
 * artist org live, the member's own artist scope and `catalog.read`), so an
 * ended connection, another label's, a member out of scope or a missing id all
 * get the real 404 — the same answer as the API, on the very next request.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageContainer } from '@/components/layout/PageHeader';
import { ConnectedMusicView } from '@/components/labelos/ConnectedMusicView';
import { orgShellFor, requireConnectionOfLabel } from '@/lib/auth/org-access';
import { loadConnectedMusic } from '@/lib/labelos/connected-music';
import { orgIdentities } from '@/lib/labelos/connections-store';

export const dynamic = 'force-dynamic';

export default async function ConnectedMusicPage({ params }: { params: Promise<{ orgSlug: string; connectionId: string }> }) {
  const { orgSlug, connectionId } = await params;
  const shell = await orgShellFor(orgSlug);
  if (!shell) notFound();
  const access = await requireConnectionOfLabel({ orgId: shell.org.id, connectionId, cap: 'catalog.read' });
  if (!access.ok) notFound();
  const [music, identities] = await Promise.all([loadConnectedMusic(access), orgIdentities(access.admin, [access.sourceOrgId])]);
  const artist = identities.get(access.sourceOrgId);
  if (!artist) notFound();

  return (
    <PageContainer>
      <header className="mb-6 sm:mb-8">
        <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-white/60">
          <Link href={`/o/${shell.org.slug}/artists`} className="hover:text-white">Artists</Link> · {shell.org.name}
        </p>
        <h1 className="font-heading text-[28px] font-bold leading-[1.05] tracking-tight text-white sm:text-[32px] md:text-[40px]">{artist.name}</h1>
        <p className="mt-2 max-w-xl text-[11px] leading-relaxed text-white/70">
          What {artist.name} shares with this label. You hear it with your own permissions, and nothing here changes their side.
        </p>
      </header>
      <ConnectedMusicView orgId={shell.org.id} music={music} />
    </PageContainer>
  );
}
